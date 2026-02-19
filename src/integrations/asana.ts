/**
 * Asana REST API Integration for tsk
 *
 * === API Research Notes ===
 *
 * Base URL: https://app.asana.com/api/1.0
 * Auth: Bearer token in Authorization header
 * Response envelope: { "data": { ... } } (single) or { "data": [ ... ] } (collection)
 * Error envelope: { "errors": [{ "message": "..." }] }
 * Write body envelope: { "data": { ...fields } }
 *
 * OAuth:
 *   Authorize: GET https://app.asana.com/-/oauth_authorize
 *   Token:     POST https://app.asana.com/-/oauth_token (form-encoded)
 *   Grant types: authorization_code, refresh_token
 *   Tokens expire in ~1 hour — MUST refresh before expiry
 *   Refresh tokens rotate: new refresh_token returned on each refresh
 *   PKCE supported (code_challenge + code_challenge_method=S256)
 *
 * Tasks:
 *   GET    /tasks?project={gid}&opt_fields=...&limit=100  (list in project)
 *   POST   /tasks            { data: { name, notes, due_on, projects, parent } }
 *   PUT    /tasks/{gid}      { data: { name, notes, due_on, completed } }
 *   DELETE /tasks/{gid}
 *
 * Subtasks (native — key differentiator):
 *   GET  /tasks/{gid}/subtasks?opt_fields=...&limit=100
 *   POST /tasks/{gid}/subtasks  { data: { name, notes, ... } }
 *   POST /tasks/{gid}/setParent { data: { parent: gid | null } }
 *   Unlimited nesting depth; tsk handles up to 3 levels
 *
 * Tags (separate API calls required):
 *   GET  /workspaces/{gid}/tags?opt_fields=name&limit=100
 *   POST /workspaces/{gid}/tags  { data: { name } }
 *   POST /tasks/{gid}/addTag     { data: { tag: gid } }
 *   POST /tasks/{gid}/removeTag  { data: { tag: gid } }
 *   addTag/removeTag return empty { "data": {} }
 *
 * Workspaces: GET /workspaces (compact: gid, name)
 * Projects:   GET /workspaces/{gid}/projects?opt_fields=name,archived&limit=100
 *
 * opt_fields: CRITICAL — without it, only gid+name returned.
 *   Always pass opt_fields on every GET request.
 *
 * Pagination: offset-based
 *   ?limit=100&offset=<token>
 *   Response: { "data": [...], "next_page": { "offset": "...", "path": "...", "uri": "..." } | null }
 *   Loop until next_page is null. Max limit=100.
 *
 * Rate limits:
 *   Free: 150 req/min | Paid: 1500 req/min
 *   On 429: read Retry-After header, back off (apiFetch handles this)
 *   GET concurrency: 50 | Write concurrency: 15
 *
 * Priority: Asana has NO built-in priority field.
 *   Priority is NOT synced to/from Asana. This is a known limitation.
 *   Users can add a custom field in Asana for priority, but mapping is not implemented.
 */

import { ConfigManager } from "../config/config.ts";
import type { AsanaConfig } from "../config/types.ts";
import type { Task } from "../store/types.ts";
import { apiFetch } from "./http.ts";
import { refreshAccessToken } from "./oauth-helpers.ts";
import type { ExternalTask, SyncProvider } from "./types.ts";

const API_BASE = "https://app.asana.com/api/1.0";

/** Fields requested on every task fetch — never rely on Asana defaults. */
const TASK_OPT_FIELDS = [
  "name",
  "notes",
  "completed",
  "completed_at",
  "due_on",
  "parent",
  "parent.gid",
  "tags",
  "tags.name",
  "memberships.project",
  "memberships.project.name",
  "modified_at",
  "created_at",
  "permalink_url",
].join(",");

const PAGE_LIMIT = 100;
const MAX_SUBTASK_DEPTH = 3;

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

/**
 * Ensures the stored Asana access token is valid.
 * If within 60s of expiry and a refresh token exists, performs a refresh
 * and persists the new tokens to config.
 *
 * Returns the valid access token string.
 */
export async function ensureValidToken(config: AsanaConfig): Promise<string> {
  // PATs don't expire — no refreshToken means PAT path
  if (!config.tokenExpiresAt || !config.refreshToken) {
    return config.accessToken;
  }

  const expiresAt = new Date(config.tokenExpiresAt).getTime();
  const now = Date.now();

  // Still valid with 60s buffer
  if (now < expiresAt - 60_000) {
    return config.accessToken;
  }

  // Refresh the token
  const clientId = process.env.TSK_ASANA_CLIENT_ID ?? "";
  const clientSecret = process.env.TSK_ASANA_CLIENT_SECRET ?? "";

  if (!clientId) {
    // Can't refresh without client credentials — return current token and hope
    return config.accessToken;
  }

  try {
    const result = await refreshAccessToken({
      tokenUrl: "https://app.asana.com/-/oauth_token",
      refreshToken: config.refreshToken,
      clientId,
      clientSecret: clientSecret || undefined,
    });

    const updated: AsanaConfig = {
      ...config,
      accessToken: result.access_token,
      refreshToken: result.refresh_token ?? config.refreshToken,
      tokenExpiresAt: new Date(
        Date.now() + (result.expires_in ?? 3600) * 1000,
      ).toISOString(),
    };

    await ConfigManager.setIntegration("asana", updated);

    return result.access_token;
  } catch (err) {
    console.error("Failed to refresh Asana token:", err);
    return config.accessToken;
  }
}

// ---------------------------------------------------------------------------
// Asana response types
// ---------------------------------------------------------------------------

interface AsanaTask {
  gid: string;
  name: string;
  notes?: string;
  completed: boolean;
  completed_at?: string | null;
  due_on?: string | null;
  modified_at?: string;
  created_at?: string;
  parent?: { gid: string } | null;
  tags?: Array<{ gid: string; name: string }>;
  memberships?: Array<{
    project?: { gid: string; name: string };
  }>;
  permalink_url?: string;
}

interface AsanaPaginatedResponse<T> {
  data?: T[];
  next_page?: { offset: string; path: string; uri: string } | null;
}

interface AsanaTag {
  gid: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class AsanaProvider implements SyncProvider {
  readonly name = "asana" as const;
  readonly supportsSubtasks = true;

  /** Tag name → GID cache (populated lazily, avoids repeated lookups). */
  private tagCache = new Map<string, string>();
  private tagCacheLoaded = false;

  constructor(
    private accessToken: string,
    private workspaceId?: string,
    private projectId?: string,
  ) {}

  // -- Auth helpers --

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.accessToken}` };
  }

  // -- Connection --

  async isConnected(): Promise<boolean> {
    return this.accessToken.trim().length > 0;
  }

  async testConnection(): Promise<{
    ok: boolean;
    user?: string;
    error?: string;
  }> {
    if (!(await this.isConnected())) {
      return { ok: false, error: "Missing Asana token" };
    }
    const res = await apiFetch<{ data?: { name?: string; email?: string } }>(
      `${API_BASE}/users/me`,
      { headers: this.headers() },
    );
    if ("error" in res) return { ok: false, error: res.error };
    return { ok: true, user: res.data.data?.name };
  }

  // -- Paginated fetch helper --

  private async fetchPaginated<T>(
    baseUrl: string,
    extraParams?: Record<string, string>,
  ): Promise<T[]> {
    const results: T[] = [];
    let offset: string | undefined;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const url = new URL(baseUrl);
      url.searchParams.set("limit", String(PAGE_LIMIT));
      if (offset) url.searchParams.set("offset", offset);
      if (extraParams) {
        for (const [k, v] of Object.entries(extraParams)) {
          url.searchParams.set(k, v);
        }
      }

      const res = await apiFetch<AsanaPaginatedResponse<T>>(url.toString(), {
        headers: this.headers(),
      });

      if ("error" in res) {
        console.error(`[Asana] Pagination error at offset ${offset}:`, res.error);
        throw new Error(`Asana API error: ${JSON.stringify(res.error)}`);
      }
      const page = res.data;
      if (page.data) results.push(...page.data);

      if (!page.next_page?.offset) break;
      offset = page.next_page.offset;
    }

    return results;
  }

  // -- Core CRUD --

  async fetchTasks(
    _options?: { updatedSince?: string },
  ): Promise<ExternalTask[]> {
    if (!this.projectId) return [];

    const params: Record<string, string> = { opt_fields: TASK_OPT_FIELDS };
    if (_options?.updatedSince) {
      params.modified_since = _options.updatedSince;
    }

    const tasks = await this.fetchPaginated<AsanaTask>(
      `${API_BASE}/projects/${this.projectId}/tasks`,
      params,
    );

    return tasks.map((t) => this.mapAsanaTask(t));
  }

  async createTask(task: ExternalTask): Promise<ExternalTask | null> {
    if (!this.projectId && !task.parentExternalId) return null;

    const body: Record<string, unknown> = {
      name: task.title,
      notes: task.description ?? "",
      due_on: task.dueDate ?? null,
    };

    // Assign to project only for top-level tasks
    if (!task.parentExternalId && this.projectId) {
      body.projects = [this.projectId];
    }
    if (task.parentExternalId) {
      body.parent = task.parentExternalId;
    }

    const res = await apiFetch<{ data?: AsanaTask }>(`${API_BASE}/tasks`, {
      method: "POST",
      headers: this.headers(),
      body: { data: body },
    });
    if ("error" in res || !res.data.data) return null;

    const created = this.mapAsanaTask(res.data.data);

    // Sync tags after creation (requires separate API calls)
    if (task.labels?.length) {
      await this.syncTagsForTask(res.data.data.gid, [], task.labels);
      created.labels = task.labels;
    }

    return created;
  }

  async updateTask(
    externalId: string,
    updates: Partial<ExternalTask>,
  ): Promise<ExternalTask | null> {
    const body: Record<string, unknown> = {};
    if (updates.title !== undefined) body.name = updates.title;
    if (updates.description !== undefined) body.notes = updates.description;
    if (updates.dueDate !== undefined) body.due_on = updates.dueDate ?? null;
    if (updates.status !== undefined) {
      body.completed = updates.status === "closed";
    }

    const res = await apiFetch<{ data?: AsanaTask }>(
      `${API_BASE}/tasks/${externalId}`,
      {
        method: "PUT",
        headers: this.headers(),
        body: { data: body },
      },
    );
    if ("error" in res || !res.data.data) return null;

    const result = this.mapAsanaTask(res.data.data);

    // Sync tags if labels changed
    if (updates.labels !== undefined) {
      const currentTags = (res.data.data.tags ?? []).map((t) => t.name);
      await this.syncTagsForTask(externalId, currentTags, updates.labels ?? []);
      result.labels = updates.labels;
    }

    return result;
  }

  async completeTask(externalId: string): Promise<boolean> {
    const res = await apiFetch<{ data?: AsanaTask }>(
      `${API_BASE}/tasks/${externalId}`,
      {
        method: "PUT",
        headers: this.headers(),
        body: { data: { completed: true } },
      },
    );
    return !("error" in res);
  }

  async reopenTask(externalId: string): Promise<boolean> {
    const res = await apiFetch<{ data?: AsanaTask }>(
      `${API_BASE}/tasks/${externalId}`,
      {
        method: "PUT",
        headers: this.headers(),
        body: { data: { completed: false } },
      },
    );
    return !("error" in res);
  }

  async deleteTask(externalId: string): Promise<boolean> {
    const res = await apiFetch<Record<string, unknown>>(
      `${API_BASE}/tasks/${externalId}`,
      {
        method: "DELETE",
        headers: this.headers(),
      },
    );
    return !("error" in res);
  }

  // -- Subtasks (native — recursive up to MAX_SUBTASK_DEPTH levels) --

  async fetchSubtasks(parentExternalId: string): Promise<ExternalTask[]> {
    return this.fetchSubtasksRecursive(parentExternalId, 1);
  }

  private async fetchSubtasksRecursive(
    parentGid: string,
    depth: number,
  ): Promise<ExternalTask[]> {
    const tasks = await this.fetchPaginated<AsanaTask>(
      `${API_BASE}/tasks/${parentGid}/subtasks`,
      { opt_fields: TASK_OPT_FIELDS },
    );

    const result: ExternalTask[] = [];

    // Map tasks to their mapped results and nested fetch promises
    const taskPromises = tasks.map(async (task) => {
      const mapped = this.mapAsanaTask(task);

      // Recurse into nested subtasks up to MAX_SUBTASK_DEPTH
      let nested: ExternalTask[] = [];
      if (depth < MAX_SUBTASK_DEPTH) {
        nested = await this.fetchSubtasksRecursive(task.gid, depth + 1);
      }

      return { mapped, nested };
    });

    // Fetch all siblings in parallel
    const taskResults = await Promise.all(taskPromises);

    // Process results
    for (const { mapped, nested } of taskResults) {
      result.push(mapped);
      if (nested.length > 0) {
        mapped.subtaskExternalIds = nested.map((n) => n.externalId);
        result.push(...nested);
      }
    }

    return result;
  }

  async createSubtask(
    parentExternalId: string,
    task: ExternalTask,
  ): Promise<ExternalTask | null> {
    return this.createTask({ ...task, parentExternalId });
  }

  /**
   * Reparent a task under a new parent (or make it top-level with parent=null).
   * Uses POST /tasks/{gid}/setParent.
   */
  async setParent(
    taskGid: string,
    parentGid: string | null,
  ): Promise<boolean> {
    const res = await apiFetch<{ data?: AsanaTask }>(
      `${API_BASE}/tasks/${taskGid}/setParent`,
      {
        method: "POST",
        headers: this.headers(),
        body: { data: { parent: parentGid } },
      },
    );
    return !("error" in res);
  }

  // -- Tag sync --

  /**
   * Ensures the tag cache is loaded from the workspace.
   * Maps tag name (lowercase) → GID for fast lookups.
   */
  private async loadTagCache(): Promise<void> {
    if (this.tagCacheLoaded || !this.workspaceId) return;

    const tags = await this.fetchPaginated<AsanaTag>(
      `${API_BASE}/workspaces/${this.workspaceId}/tags`,
      { opt_fields: "name" },
    );

    for (const tag of tags) {
      this.tagCache.set(tag.name.toLowerCase(), tag.gid);
    }
    this.tagCacheLoaded = true;
  }

  /**
   * Resolves a tag name to its GID, creating the tag if it doesn't exist.
   */
  private async resolveTagGid(tagName: string): Promise<string | null> {
    await this.loadTagCache();

    const cached = this.tagCache.get(tagName.toLowerCase());
    if (cached) return cached;

    if (!this.workspaceId) return null;

    // Create the tag
    const res = await apiFetch<{ data?: AsanaTag }>(
      `${API_BASE}/workspaces/${this.workspaceId}/tags`,
      {
        method: "POST",
        headers: this.headers(),
        body: { data: { name: tagName } },
      },
    );

    if ("error" in res || !res.data.data) return null;

    const gid = res.data.data.gid;
    this.tagCache.set(tagName.toLowerCase(), gid);
    return gid;
  }

  /**
   * Syncs tags on a task: adds missing tags and removes stale ones.
   * Both addTag and removeTag are POST endpoints returning empty data.
   */
  private async syncTagsForTask(
    taskGid: string,
    currentTagNames: string[],
    desiredTagNames: string[],
  ): Promise<void> {
    const currentSet = new Set(currentTagNames.map((n) => n.toLowerCase()));
    const desiredSet = new Set(desiredTagNames.map((n) => n.toLowerCase()));

    // Tags to add
    const toAdd = desiredTagNames.filter(
      (name) => !currentSet.has(name.toLowerCase()),
    );

    // Tags to remove (need GID lookup)
    const toRemove = currentTagNames.filter(
      (name) => !desiredSet.has(name.toLowerCase()),
    );

    // Execute adds
    for (const name of toAdd) {
      const gid = await this.resolveTagGid(name);
      if (!gid) continue;
      await apiFetch<Record<string, unknown>>(
        `${API_BASE}/tasks/${taskGid}/addTag`,
        {
          method: "POST",
          headers: this.headers(),
          body: { data: { tag: gid } },
        },
      );
    }

    // Execute removes
    for (const name of toRemove) {
      const gid = await this.resolveTagGid(name);
      if (!gid) continue;
      await apiFetch<Record<string, unknown>>(
        `${API_BASE}/tasks/${taskGid}/removeTag`,
        {
          method: "POST",
          headers: this.headers(),
          body: { data: { tag: gid } },
        },
      );
    }
  }

  // -- Metadata --

  async fetchProjects(): Promise<Array<{ id: string; name: string }>> {
    if (!this.workspaceId) return [];

    const projects = await this.fetchPaginated<{
      gid: string;
      name: string;
      archived?: boolean;
    }>(`${API_BASE}/workspaces/${this.workspaceId}/projects`, {
      opt_fields: "name,archived",
    });

    return projects
      .filter((p) => !p.archived)
      .map((p) => ({ id: p.gid, name: p.name }));
  }

  async fetchLabels(): Promise<Array<{ id: string; name: string }>> {
    if (!this.workspaceId) return [];

    const tags = await this.fetchPaginated<AsanaTag>(
      `${API_BASE}/workspaces/${this.workspaceId}/tags`,
      { opt_fields: "name" },
    );

    return tags.map((t) => ({ id: t.gid, name: t.name }));
  }

  /**
   * Fetch all workspaces visible to the authenticated user.
   * Used during `tsk connect asana` for workspace selection.
   */
  async fetchWorkspaces(): Promise<Array<{ id: string; name: string }>> {
    const workspaces = await this.fetchPaginated<{
      gid: string;
      name: string;
    }>(`${API_BASE}/workspaces`, { opt_fields: "name" });

    return workspaces.map((w) => ({ id: w.gid, name: w.name }));
  }

  // -- Field mapping --

  /**
   * Maps an Asana ExternalTask → local Task fields.
   *
   * NOTE: Priority is NOT mapped from Asana because Asana has no built-in
   * priority field. Priority will default to "none" for all Asana tasks.
   */
  mapToLocal(external: ExternalTask): Partial<Task> {
    return {
      title: external.title,
      description: external.description ?? "",
      status: external.status === "closed" ? "done" : "todo",
      priority: "none", // Asana has no built-in priority
      project: external.project ?? null,
      tags: external.labels ?? [],
      dueDate: external.dueDate ?? null,
      parentId: null, // Resolved by sync engine via ID mapping
      completedAt: external.completedAt ?? null,
      externalId: external.externalId,
      externalSource: "asana",
    };
  }

  /**
   * Maps a local Task → Asana ExternalTask fields.
   *
   * NOTE: Priority is NOT synced to Asana (no built-in field).
   */
  mapToExternal(task: Task): Partial<ExternalTask> {
    return {
      title: task.title,
      description: task.description,
      status: task.status === "done" ? "closed" : "open",
      // priority intentionally omitted — Asana has no built-in priority
      project: task.project ?? undefined,
      labels: task.tags,
      dueDate: task.dueDate ?? undefined,
      updatedAt: task.updatedAt,
      completedAt: task.completedAt,
      parentExternalId: null,
    };
  }

  // -- Internal mapping --

  private mapAsanaTask(task: AsanaTask): ExternalTask {
    const projectName =
      task.memberships?.[0]?.project?.name ?? undefined;
    const tagNames = (task.tags ?? []).map((t) => t.name);

    return {
      externalId: task.gid,
      title: task.name,
      description: task.notes ?? undefined,
      status: task.completed ? "closed" : "open",
      // priority: not set — Asana has no built-in priority
      project: projectName,
      labels: tagNames.length > 0 ? tagNames : undefined,
      dueDate: task.due_on ?? undefined,
      parentExternalId: task.parent?.gid ?? null,
      updatedAt: task.modified_at ?? new Date().toISOString(),
      completedAt: task.completed_at ?? null,
      url: task.permalink_url,
    };
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createAsanaProvider(): Promise<SyncProvider> {
  return import("../config/config.ts").then(async ({ ConfigManager }) => {
    const cfg = await ConfigManager.getIntegration("asana");
    if (!cfg?.accessToken) throw new Error("Asana not connected — run: tsk connect asana");
    return new AsanaProvider(cfg.accessToken, cfg.workspaceId, cfg.projectId);
  });
}
