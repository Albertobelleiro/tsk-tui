/*
 * LINEAR GraphQL API — Research Notes
 *
 * ENDPOINT:    https://api.linear.app/graphql
 *
 * AUTHENTICATION:
 *   OAuth 2.0:       Authorization: Bearer <ACCESS_TOKEN>
 *   Personal API key: Authorization: <API_KEY>  (no "Bearer" prefix; keys start with "lin_api_")
 *   → When storing from OAuth, we prefix "Bearer " in the CLI connect flow so
 *     graphqlFetch can send the value as-is in both cases.
 *
 * OAUTH 2.0 WITH PKCE:
 *   Authorize URL:  https://linear.app/oauth/authorize
 *   Token URL:      https://api.linear.app/oauth/token
 *   Scopes:         read,write,issues:create  (comma-separated, NOT space-separated)
 *   PKCE:           code_challenge_method=S256; code_verifier replaces client_secret
 *   Refresh:        POST token URL with grant_type=refresh_token; returns NEW refresh_token (rotate!)
 *   Access token lifetime: 24h (with refresh tokens enabled)
 *
 * ISSUES (Issue type):
 *   Scalar:  id, identifier, title, description (markdown), priority (Float! 0-4),
 *            dueDate (YYYY-MM-DD), completedAt, updatedAt, url
 *   Relations: state { id name type }, project { id name }, labels { nodes { id name } },
 *              parent { id }, children { nodes { id } }
 *
 * PRIORITY:  0=None, 1=Urgent, 2=High, 3=Normal, 4=Low  (inverted from typical UI)
 *
 * WORKFLOW STATES (WorkflowState type):
 *   Types: "triage" | "backlog" | "unstarted" | "started" | "completed" | "canceled"
 *   States vary per team — MUST fetch dynamically, never hardcode IDs
 *
 * SUB-ISSUES:  parent { id } / children { nodes { id } } on Issue type
 *
 * PAGINATION:  Relay cursor-based — first/after, pageInfo { hasNextPage endCursor }
 *              Default page size: 50
 *
 * RATE LIMITS:
 *   5,000 requests/hour/user (API key or OAuth)
 *   250,000 complexity points/hour (API key), 2M (OAuth)
 *   Rate limited: HTTP 400 with code "RATELIMITED" in errors — apiFetch handles 429 retries
 *
 * MUTATIONS:
 *   issueCreate(input: IssueCreateInput!)  → { success, issue { … } }
 *   issueUpdate(id: String!, input: IssueUpdateInput!)  → { success, issue { … } }
 *   issueArchive(id: String!)  → { success }
 *   issueLabelCreate(input: IssueLabelCreateInput!)  → { success, issueLabel { id name } }
 *
 * GOTCHAS:
 *   - includeArchived defaults to false on all connections
 *   - priority field is Float!, not Int (values are integers 0-4)
 *   - OAuth refresh tokens rotate: store the new refresh_token on each refresh
 *   - Canceled state type is spelled "canceled" (one l)
 */

import type { Task, TaskPriority, TaskStatus } from "../store/types.ts";
import { graphqlFetch } from "./http.ts";
import type { ExternalTask, SyncProvider } from "./types.ts";
import { sortParentsFirst as genericSortParentsFirst } from "./utils.ts";

// ── OAuth placeholders ──────────────────────────────────────────────────────────

/** @todo Register app at https://linear.app/settings/api/applications */
export const LINEAR_CLIENT_ID = process.env.TSK_LINEAR_CLIENT_ID ?? "TODO_REGISTER_CLIENT_ID";

// ── Constants ───────────────────────────────────────────────────────────────────

const API_URL = "https://api.linear.app/graphql";

// Priority: Linear 0=none, 1=urgent, 2=high, 3=normal, 4=low
const LINEAR_TO_TSK_PRIORITY: Record<number, TaskPriority> = {
  0: "none",
  1: "urgent",
  2: "high",
  3: "medium",
  4: "low",
};

const TSK_TO_LINEAR_PRIORITY: Record<TaskPriority, number> = {
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
  none: 0,
};

// Workflow state type → tsk status
const STATE_TYPE_TO_TSK: Record<string, TaskStatus> = {
  triage: "todo",
  backlog: "todo",
  unstarted: "todo",
  started: "in_progress",
  completed: "done",
  canceled: "archived",
};

// tsk status → preferred workflow state type (for pushing)
const TSK_STATUS_TO_STATE_TYPE: Record<TaskStatus, string> = {
  todo: "unstarted",
  in_progress: "started",
  done: "completed",
  archived: "canceled",
};

// ── GraphQL operations ──────────────────────────────────────────────────────────

const GQL_VIEWER = `query { viewer { id name email } }`;

const GQL_TEAMS = `query { teams { nodes { id name key } } }`;

const GQL_WORKFLOW_STATES = `
  query WorkflowStates($filter: WorkflowStateFilter) {
    workflowStates(filter: $filter) {
      nodes { id name type }
    }
  }
`;

const GQL_LABELS = `
  query Labels($filter: IssueLabelFilter) {
    issueLabels(filter: $filter) {
      nodes { id name color }
    }
  }
`;

const GQL_PROJECTS = `query { projects { nodes { id name } } }`;

const GQL_TEAM_PROJECTS = `
  query TeamProjects($teamId: String!) {
    team(id: $teamId) {
      projects { nodes { id name } }
    }
  }
`;

const ISSUE_FIELDS = `
  id identifier title description priority dueDate
  state { id name type }
  project { id name }
  labels { nodes { id name } }
  parent { id }
  children { nodes { id } }
  completedAt updatedAt url
`;

const GQL_ISSUES = `
  query Issues($filter: IssueFilter, $after: String, $first: Int) {
    issues(filter: $filter, after: $after, first: $first, orderBy: updatedAt) {
      nodes { ${ISSUE_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const GQL_CREATE_ISSUE = `
  mutation CreateIssue($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      issue { ${ISSUE_FIELDS} }
    }
  }
`;

const GQL_UPDATE_ISSUE = `
  mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) {
      success
      issue { ${ISSUE_FIELDS} }
    }
  }
`;

const GQL_ARCHIVE_ISSUE = `
  mutation ArchiveIssue($id: String!) {
    issueArchive(id: $id) { success }
  }
`;

const GQL_CREATE_LABEL = `
  mutation CreateLabel($input: IssueLabelCreateInput!) {
    issueLabelCreate(input: $input) {
      success
      issueLabel { id name }
    }
  }
`;

// ── API response types ──────────────────────────────────────────────────────────

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  priority: number;
  dueDate?: string;
  state: { id: string; name: string; type: string };
  project?: { id: string; name: string } | null;
  labels: { nodes: Array<{ id: string; name: string }> };
  parent?: { id: string } | null;
  children: { nodes: Array<{ id: string }> };
  completedAt?: string | null;
  updatedAt: string;
  url: string;
}

interface LinearWorkflowState {
  id: string;
  name: string;
  type: string;
}

interface LinearLabel {
  id: string;
  name: string;
  color?: string;
}

interface LinearTeam {
  id: string;
  name: string;
  key: string;
}

// ── Provider ────────────────────────────────────────────────────────────────────

export class LinearProvider implements SyncProvider {
  readonly name = "linear" as const;
  readonly supportsSubtasks = true;

  // Caches (populated lazily)
  private _stateMapping: Map<string, string> | null = null; // tsk status → linear state ID
  private _stateIdToType: Map<string, string> | null = null; // state ID → state type
  private _labelsById: Map<string, string> | null = null;
  private _labelsByName: Map<string, string> | null = null;
  private _projectsById: Map<string, string> | null = null;
  private _projectsByName: Map<string, string> | null = null;

  /**
   * @param accessToken  Auth header value: "lin_api_xxx" (API key) or "Bearer xxx" (OAuth)
   * @param teamId       Team UUID — required for creating issues
   * @param stateMapping tsk status → Linear state ID (from config, built during connect)
   */
  constructor(
    private accessToken: string,
    private teamId?: string,
    private configStateMapping?: Record<string, string>,
  ) {
    if (configStateMapping) {
      this._stateMapping = new Map(Object.entries(configStateMapping));
    }
  }

  // ── GraphQL helper ──────────────────────────────────────────────────────────

  private async gql<T>(query: string, variables?: Record<string, unknown>): Promise<T | null> {
    const result = await graphqlFetch<T>(API_URL, {
      query,
      variables,
      token: this.accessToken,
    });
    if ("error" in result) return null;
    return result.data;
  }

  // ── Connection ──────────────────────────────────────────────────────────────

  async isConnected(): Promise<boolean> {
    return this.accessToken.trim().length > 0;
  }

  async testConnection(): Promise<{ ok: boolean; user?: string; error?: string }> {
    if (!(await this.isConnected())) return { ok: false, error: "Missing Linear token" };

    const data = await this.gql<{ viewer: { id: string; name: string; email: string } }>(GQL_VIEWER);
    if (!data) return { ok: false, error: "Failed to connect to Linear" };

    return { ok: true, user: `${data.viewer.name} (${data.viewer.email})` };
  }

  // ── Cache helpers ───────────────────────────────────────────────────────────

  private async ensureWorkflowStates(): Promise<void> {
    if (this._stateMapping) return;
    if (!this.teamId) {
      this._stateMapping = new Map();
      this._stateIdToType = new Map();
      return;
    }

    const data = await this.gql<{ workflowStates: { nodes: LinearWorkflowState[] } }>(
      GQL_WORKFLOW_STATES,
      { filter: { team: { id: { eq: this.teamId } } } },
    );

    const states = data?.workflowStates?.nodes ?? [];
    this._stateIdToType = new Map(states.map((s) => [s.id, s.type]));

    // Build tsk status → first matching state ID
    // Note: This deliberately chooses the first matching state as a default.
    // When teams have multiple states of the same type (e.g., multiple "in progress"
    // states), this will always map to the first one found. Future enhancement
    // could allow selecting a different matching state.
    this._stateMapping = new Map();
    for (const [tskStatus, stateType] of Object.entries(TSK_STATUS_TO_STATE_TYPE)) {
      const match = states.find((s) => s.type === stateType);
      if (match) this._stateMapping.set(tskStatus, match.id);
    }
  }

  private async ensureLabels(): Promise<void> {
    if (this._labelsById) return;

    const filter = this.teamId ? { team: { id: { eq: this.teamId } } } : undefined;
    const data = await this.gql<{ issueLabels: { nodes: LinearLabel[] } }>(GQL_LABELS, { filter });
    const labels = data?.issueLabels?.nodes ?? [];

    this._labelsById = new Map(labels.map((l) => [l.id, l.name]));
    this._labelsByName = new Map(labels.map((l) => [l.name.toLowerCase(), l.id]));
  }

  private async ensureProjects(): Promise<void> {
    if (this._projectsById) return;

    let projects: Array<{ id: string; name: string }> = [];
    if (this.teamId) {
      const data = await this.gql<{ team: { projects: { nodes: Array<{ id: string; name: string }> } } }>(
        GQL_TEAM_PROJECTS,
        { teamId: this.teamId },
      );
      projects = data?.team?.projects?.nodes ?? [];
    } else {
      const data = await this.gql<{ projects: { nodes: Array<{ id: string; name: string }> } }>(GQL_PROJECTS);
      projects = data?.projects?.nodes ?? [];
    }

    this._projectsById = new Map(projects.map((p) => [p.id, p.name]));
    this._projectsByName = new Map(projects.map((p) => [p.name.toLowerCase(), p.id]));
  }

  private async resolveProjectId(name: string): Promise<string | undefined> {
    await this.ensureProjects();
    return this._projectsByName?.get(name.toLowerCase());
  }

  private async resolveLabelIds(names: string[]): Promise<string[]> {
    await this.ensureLabels();
    const ids: string[] = [];
    for (const name of names) {
      const existing = this._labelsByName?.get(name.toLowerCase());
      if (existing) {
        ids.push(existing);
      } else if (this.teamId) {
        // Create missing label
        const created = await this.gql<{ issueLabelCreate: { success: boolean; issueLabel: { id: string; name: string } } }>(
          GQL_CREATE_LABEL,
          { input: { name, teamId: this.teamId } },
        );
        if (created?.issueLabelCreate?.success) {
          const label = created.issueLabelCreate.issueLabel;
          ids.push(label.id);
          this._labelsByName?.set(label.name.toLowerCase(), label.id);
          this._labelsById?.set(label.id, label.name);
        }
      }
    }
    return ids;
  }

  private async resolveStateId(tskStatus: TaskStatus): Promise<string | undefined> {
    await this.ensureWorkflowStates();
    return this._stateMapping?.get(tskStatus);
  }

  // ── Task fetching ───────────────────────────────────────────────────────────

  async fetchTasks(options?: { updatedSince?: string }): Promise<ExternalTask[]> {
    if (!(await this.isConnected())) return [];
    await this.ensureLabels();

    const filter: Record<string, unknown> = {};
    if (this.teamId) filter.team = { id: { eq: this.teamId } };
    if (options?.updatedSince) filter.updatedAt = { gte: options.updatedSince };

    const allIssues = await this.paginateIssues(filter);
    const sorted = sortParentsFirst(allIssues);
    return sorted.map((issue) => this.mapLinearIssue(issue));
  }

  private async paginateIssues(filter: Record<string, unknown>): Promise<LinearIssue[]> {
    const all: LinearIssue[] = [];
    let cursor: string | undefined;

    while (true) {
      const variables: Record<string, unknown> = { filter, first: 50 };
      if (cursor) variables.after = cursor;

      const data = await this.gql<{
        issues: {
          nodes: LinearIssue[];
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      }>(GQL_ISSUES, variables);

      if (!data?.issues) break;

      all.push(...data.issues.nodes);

      if (!data.issues.pageInfo.hasNextPage || !data.issues.pageInfo.endCursor) break;
      cursor = data.issues.pageInfo.endCursor;
    }

    return all;
  }

  // ── CRUD ────────────────────────────────────────────────────────────────────

  async createTask(task: ExternalTask): Promise<ExternalTask | null> {
    if (!this.teamId) return null;

    const input: Record<string, unknown> = {
      teamId: this.teamId,
      title: task.title,
    };

    if (task.description) input.description = task.description;
    if (task.dueDate) input.dueDate = task.dueDate;
    if (task.priority !== undefined) input.priority = task.priority;

    // Resolve project
    if (task.project) {
      const projectId = await this.resolveProjectId(task.project);
      if (projectId) input.projectId = projectId;
    }

    // Resolve labels
    if (task.labels && task.labels.length > 0) {
      const labelIds = await this.resolveLabelIds(task.labels);
      if (labelIds.length > 0) input.labelIds = labelIds;
    }

    // Resolve state
    const status = task.status === "closed" ? "done" : "todo";
    const stateId = await this.resolveStateId(status as TaskStatus);
    if (stateId) input.stateId = stateId;

    // Resolve parent
    if (task.parentExternalId) input.parentId = task.parentExternalId;

    const data = await this.gql<{
      issueCreate: { success: boolean; issue: LinearIssue };
    }>(GQL_CREATE_ISSUE, { input });

    if (!data?.issueCreate?.success) return null;
    return this.mapLinearIssue(data.issueCreate.issue);
  }

  async updateTask(externalId: string, updates: Partial<ExternalTask>): Promise<ExternalTask | null> {
    const input: Record<string, unknown> = {};

    if (updates.title !== undefined) input.title = updates.title;
    if (updates.description !== undefined) input.description = updates.description;
    if (updates.dueDate !== undefined) input.dueDate = updates.dueDate ?? null;
    if (updates.priority !== undefined) input.priority = updates.priority;

    // Resolve project
    if (updates.project !== undefined) {
      if (updates.project) {
        const projectId = await this.resolveProjectId(updates.project);
        if (projectId) input.projectId = projectId;
      } else {
        input.projectId = null;
      }
    }

    // Resolve labels
    if (updates.labels !== undefined) {
      const labelIds = await this.resolveLabelIds(updates.labels);
      input.labelIds = labelIds;
    }

    // Resolve state from status
    if (updates.status !== undefined) {
      const tskStatus = updates.status === "closed" ? "done" : "todo";
      const stateId = await this.resolveStateId(tskStatus as TaskStatus);
      if (stateId) input.stateId = stateId;
    }

    // Resolve parent
    if (updates.parentExternalId !== undefined) {
      input.parentId = updates.parentExternalId ?? null;
    }

    if (Object.keys(input).length === 0) return null;

    const data = await this.gql<{
      issueUpdate: { success: boolean; issue: LinearIssue };
    }>(GQL_UPDATE_ISSUE, { id: externalId, input });

    if (!data?.issueUpdate?.success) return null;
    return this.mapLinearIssue(data.issueUpdate.issue);
  }

  async completeTask(externalId: string): Promise<boolean> {
    const stateId = await this.resolveStateId("done");
    if (!stateId) return false;

    const data = await this.gql<{
      issueUpdate: { success: boolean };
    }>(GQL_UPDATE_ISSUE, { id: externalId, input: { stateId } });

    return !!data?.issueUpdate?.success;
  }

  async reopenTask(externalId: string): Promise<boolean> {
    const stateId = await this.resolveStateId("todo");
    if (!stateId) return false;

    const data = await this.gql<{
      issueUpdate: { success: boolean };
    }>(GQL_UPDATE_ISSUE, { id: externalId, input: { stateId } });

    return !!data?.issueUpdate?.success;
  }

  async deleteTask(externalId: string): Promise<boolean> {
    const data = await this.gql<{
      issueArchive: { success: boolean };
    }>(GQL_ARCHIVE_ISSUE, { id: externalId });

    return !!data?.issueArchive?.success;
  }

  // ── Subtasks ────────────────────────────────────────────────────────────────

  async fetchSubtasks(parentExternalId: string): Promise<ExternalTask[]> {
    const filter: Record<string, unknown> = {
      parent: { id: { eq: parentExternalId } },
    };
    if (this.teamId) filter.team = { id: { eq: this.teamId } };

    const issues = await this.paginateIssues(filter);
    return issues.map((issue) => this.mapLinearIssue(issue));
  }

  async createSubtask(parentExternalId: string, task: ExternalTask): Promise<ExternalTask | null> {
    return this.createTask({ ...task, parentExternalId });
  }

  // ── Project / Label enumeration ─────────────────────────────────────────────

  async fetchProjects(): Promise<Array<{ id: string; name: string }>> {
    await this.ensureProjects();
    if (!this._projectsById) return [];
    return Array.from(this._projectsById.entries()).map(([id, name]) => ({ id, name }));
  }

  async fetchLabels(): Promise<Array<{ id: string; name: string }>> {
    await this.ensureLabels();
    if (!this._labelsById) return [];
    return Array.from(this._labelsById.entries()).map(([id, name]) => ({ id, name }));
  }

  // ── Field mapping ───────────────────────────────────────────────────────────

  mapToLocal(external: ExternalTask): Partial<Task> {
    return {
      title: external.title,
      description: external.description ?? "",
      status: externalStatusToTsk(external),
      priority: LINEAR_TO_TSK_PRIORITY[external.priority ?? 0] ?? "none",
      project: external.project ?? null,
      tags: external.labels ?? [],
      dueDate: external.dueDate ?? null,
      completedAt: external.completedAt ?? null,
      externalId: external.externalId,
      externalSource: "linear",
    };
  }

  mapToExternal(task: Task): Partial<ExternalTask> {
    return {
      title: task.title,
      description: task.description,
      status: task.status === "done" || task.status === "archived" ? "closed" : "open",
      priority: TSK_TO_LINEAR_PRIORITY[task.priority] ?? 0,
      project: task.project ?? undefined,
      labels: task.tags,
      dueDate: task.dueDate ?? undefined,
      parentExternalId: task.parentId ?? null,
      updatedAt: task.updatedAt,
      completedAt: task.completedAt,
    };
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private mapLinearIssue(issue: LinearIssue): ExternalTask {
    const stateType = issue.state?.type ?? "unstarted";
    const tskStatus = STATE_TYPE_TO_TSK[stateType] ?? "todo";

    return {
      externalId: issue.id,
      title: issue.title,
      description: issue.description,
      status: tskStatus === "done" || tskStatus === "archived" ? "closed" : "open",
      priority: issue.priority ?? 0,
      project: issue.project?.name,
      labels: issue.labels?.nodes?.map((l) => l.name) ?? [],
      dueDate: issue.dueDate,
      parentExternalId: issue.parent?.id ?? null,
      subtaskExternalIds: issue.children?.nodes?.map((c) => c.id) ?? [],
      updatedAt: issue.updatedAt,
      completedAt: issue.completedAt ?? null,
      url: issue.url,
    };
  }
}

// ── Status helper ───────────────────────────────────────────────────────────────

/**
 * Map ExternalTask (with embedded state info from labels/status) back to TaskStatus.
 * Since ExternalTask.status is "open"|"closed", and we store the state type info
 * through the priority/labels, we infer from ExternalTask's status field.
 */
function externalStatusToTsk(external: ExternalTask): TaskStatus {
  // ExternalTask.status only has "open" | "closed"
  // We encode richer state info via completedAt
  if (external.status === "closed") {
    return external.completedAt ? "done" : "archived";
  }
  return "todo";
}

// ── Sort parents before children ────────────────────────────────────────────────

function sortParentsFirst(issues: LinearIssue[]): LinearIssue[] {
  return genericSortParentsFirst(
    issues,
    (i: LinearIssue) => i.id,
    (i: LinearIssue) => i.parent?.id ?? null,
  );
}

// ── Setup helpers (used by CLI connect flow) ────────────────────────────────────

/**
 * Verify a Linear token by fetching the authenticated user.
 * @param token  Auth header value ("lin_api_xxx" or "Bearer xxx")
 */
export async function linearVerifyToken(
  token: string,
): Promise<{ id: string; name: string; email: string } | null> {
  const result = await graphqlFetch<{ viewer: { id: string; name: string; email: string } }>(API_URL, {
    query: GQL_VIEWER,
    token,
  });
  if ("error" in result) return null;
  return result.data.viewer;
}

/**
 * Fetch all teams accessible to the token.
 */
export async function linearFetchTeams(token: string): Promise<LinearTeam[]> {
  const result = await graphqlFetch<{ teams: { nodes: LinearTeam[] } }>(API_URL, {
    query: GQL_TEAMS,
    token,
  });
  if ("error" in result) return [];
  return result.data.teams.nodes;
}

/**
 * Fetch workflow states for a team and build tsk status → state ID mapping.
 */
export async function linearBuildStateMapping(
  token: string,
  teamId: string,
): Promise<Record<string, string>> {
  const result = await graphqlFetch<{ workflowStates: { nodes: LinearWorkflowState[] } }>(API_URL, {
    query: GQL_WORKFLOW_STATES,
    variables: { filter: { team: { id: { eq: teamId } } } },
    token,
  });

  if ("error" in result) return {};

  const states = result.data.workflowStates.nodes;
  const mapping: Record<string, string> = {};

  for (const [tskStatus, stateType] of Object.entries(TSK_STATUS_TO_STATE_TYPE)) {
    const match = states.find((s) => s.type === stateType);
    if (match) mapping[tskStatus] = match.id;
  }

  return mapping;
}

// ── Factory (for registry) ──────────────────────────────────────────────────────

export function createLinearProvider(): Promise<SyncProvider> {
  return import("../config/config.ts").then(async ({ ConfigManager }) => {
    const cfg = await ConfigManager.getIntegration("linear");
    if (!cfg?.accessToken) throw new Error("Linear not connected — run: tsk connect linear");
    return new LinearProvider(cfg.accessToken, cfg.teamId, cfg.stateMapping);
  });
}
