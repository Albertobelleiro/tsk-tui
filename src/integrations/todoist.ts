/*
 * TODOIST REST API v2 — Research Notes
 *
 * BASE URL:  https://api.todoist.com/rest/v2
 *
 * AUTHENTICATION:
 *   Bearer token: Authorization: Bearer <token>
 *   Personal tokens: Todoist Settings → Integrations → Developer
 *   OAuth authorize:   https://todoist.com/oauth/authorize
 *   OAuth token URL:   https://todoist.com/oauth/access_token
 *   PKCE: NOT supported — client_secret REQUIRED
 *   Scopes: data:read_write  (includes data:read + task:add + data:delete)
 *
 * TASKS ENDPOINTS:
 *   GET    /tasks           — Active tasks only; completed excluded (use Sync API for history)
 *   POST   /tasks           — Create task; returns created task
 *   GET    /tasks/{id}      — Get single active task
 *   POST   /tasks/{id}      — Update task; returns updated task
 *   POST   /tasks/{id}/close   — Mark complete (recurring → schedules next occurrence)
 *   POST   /tasks/{id}/reopen  — Restore task from history
 *   DELETE /tasks/{id}      — Delete permanently (cascades to subtasks)
 *
 * TASK FIELDS: id, content, description, project_id, parent_id, labels[],
 *   priority (1-4), is_completed, order, due{date,string,...}, created_at, url
 *
 * PRIORITY (inverted vs UI — p1 in UI = 4 in API):
 *   API 4 = Urgent  (UI p1) — highest
 *   API 3 = High    (UI p2)
 *   API 2 = Medium  (UI p3)
 *   API 1 = Normal  (UI p4) — lowest / default
 *
 * SUBTASKS: parent_id field; deleting parent cascades to all children
 *
 * PROJECTS: GET /projects — id, name, parent_id, is_inbox_project, url
 * LABELS:   GET /labels   — id, name, color, order, is_favorite
 *
 * RATE LIMITS: Not publicly documented; apiFetch handles 429 with exponential backoff
 *
 * COMPLETED TASKS LIMITATION:
 *   REST v2 GET /tasks returns ACTIVE tasks only. Completed tasks require the
 *   Sync API (/completed/get_all). Chosen approach: track completions via sync
 *   engine — when a local task is marked done, call POST /tasks/{id}/close.
 *   Tasks completed on the Todoist side will appear "missing" in the next sync
 *   and will be removed from the local sync mapping (not deleted from local store
 *   because the sync engine guards by externalSource match).
 *
 * NO updated_at IN REST v2:
 *   Task objects only expose created_at. We use it as updatedAt.
 *   The updatedSince option in fetchTasks is ignored; full list is always fetched.
 */

import type { Task, TaskPriority } from "../store/types.ts";
import { apiFetch } from "./http.ts";
import type { ExternalTask, SyncProvider } from "./types.ts";
import { sortParentsFirst } from "./utils.ts";

// ── OAuth credentials accessor — throws if env vars not set ───────────────────

function getTodoistCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.TSK_TODOIST_CLIENT_ID;
  const clientSecret = process.env.TSK_TODOIST_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Todoist OAuth credentials not configured: set TSK_TODOIST_CLIENT_ID and TSK_TODOIST_CLIENT_SECRET");
  }
  return { clientId, clientSecret };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const API_BASE = "https://api.todoist.com/rest/v2";

// Priority mapping (Todoist 4=urgent … 1=normal/low, inverted from display)
// TSK_TO_TODOIST: low/none both map to 1 (Todoist's lowest priority)
// TODOIST_TO_TSK: 1 maps to "low" to preserve identity on round-trip
const TSK_TO_TODOIST_PRIORITY: Record<TaskPriority, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
  none: 1,
};

const TODOIST_TO_TSK_PRIORITY: Record<number, TaskPriority> = {
  4: "urgent",
  3: "high",
  2: "medium",
  1: "low",
};

// ── Todoist API shapes ────────────────────────────────────────────────────────

interface TodoistTask {
  id: string;
  content: string;
  description?: string;
  project_id?: string;
  parent_id?: string | null;
  is_completed: boolean;
  priority?: number;
  labels?: string[];
  order?: number;
  due?: { date?: string; string?: string; is_recurring?: boolean };
  created_at?: string;
  url?: string;
}

interface TodoistProject {
  id: string;
  name: string;
  parent_id?: string | null;
  is_inbox_project?: boolean;
  url?: string;
}

interface TodoistLabel {
  id: string;
  name: string;
  color?: string;
  order?: number;
  is_favorite?: boolean;
}

// ── Provider ──────────────────────────────────────────────────────────────────

export class TodoistProvider implements SyncProvider {
  readonly name = "todoist" as const;
  readonly supportsSubtasks = true;

  /** Cache of project id → name, populated on first use. */
  private projectsById: Map<string, string> | null = null;
  /** Cache of project name → id */
  private projectsByName: Map<string, string> | null = null;

  /**
   * @param accessToken  Bearer token (personal or OAuth access token)
   * @param projectId    Optional Todoist project ID to scope syncs to
   */
  constructor(private accessToken: string, private projectId?: string) {}

  // ── Connection ─────────────────────────────────────────────────────────────

  async isConnected(): Promise<boolean> {
    return this.accessToken.trim().length > 0;
  }

  async testConnection(): Promise<{ ok: boolean; user?: string; error?: string }> {
    if (!(await this.isConnected())) return { ok: false, error: "Missing Todoist access token" };

    const response = await apiFetch<TodoistProject[]>(`${API_BASE}/projects`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });

    if ("error" in response) return { ok: false, error: response.error };

    // Warm up the project cache
    this.warmProjectCache(response.data);

    const projectNames = response.data.slice(0, 5).map((p) => p.name).join(", ");
    const count = response.data.length;
    return {
      ok: true,
      user: `${count} project${count !== 1 ? "s" : ""}: ${projectNames}${count > 5 ? " …" : ""}`,
    };
  }

  // ── Project helpers ────────────────────────────────────────────────────────

  private warmProjectCache(projects: TodoistProject[]): void {
    this.projectsById = new Map(projects.map((p) => [p.id, p.name]));
    this.projectsByName = new Map(projects.map((p) => [p.name.toLowerCase(), p.id]));
  }

  private async ensureProjectCache(): Promise<void> {
    if (this.projectsById) return;
    const response = await apiFetch<TodoistProject[]>(`${API_BASE}/projects`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if ("error" in response) {
      this.projectsById = new Map();
      this.projectsByName = new Map();
    } else {
      this.warmProjectCache(response.data);
    }
  }

  private async resolveProjectId(projectName: string): Promise<string | undefined> {
    await this.ensureProjectCache();
    return this.projectsByName?.get(projectName.toLowerCase());
  }

  private resolveProjectName(projectId: string): string | undefined {
    return this.projectsById?.get(projectId);
  }

  // ── Task fetching ──────────────────────────────────────────────────────────

  async fetchTasks(_options?: { updatedSince?: string }): Promise<ExternalTask[]> {
    if (!(await this.isConnected())) return [];

    // Warm project cache before mapping (needed for project name resolution)
    await this.ensureProjectCache();

    const url = new URL(`${API_BASE}/tasks`);
    if (this.projectId) url.searchParams.set("project_id", this.projectId);

    const response = await apiFetch<TodoistTask[]>(url.toString(), {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });

    if ("error" in response) return [];

    // Sort: parents before children so parent IDs resolve correctly in sync engine
    const tasks = response.data;
    const parentFirst = sortParentsBeforeChildren(tasks);
    return parentFirst.map((t) => this.mapTodoistTask(t));
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  async createTask(task: ExternalTask): Promise<ExternalTask | null> {
    // Resolve parent project if known
    let projectId = this.projectId;
    if (!projectId && task.project) {
      projectId = await this.resolveProjectId(task.project);
    }

    // Resolve parent external ID for subtasks
    const parentId = task.parentExternalId ?? undefined;

    const body: Record<string, unknown> = {
      content: task.title,
    };
    if (task.description) body.description = task.description;
    if (task.dueDate) body.due_date = task.dueDate;
    if (task.labels && task.labels.length > 0) body.labels = task.labels;
    if (task.priority !== undefined) body.priority = clampTodoistPriority(task.priority);
    if (projectId) body.project_id = projectId;
    if (parentId) body.parent_id = parentId;

    const response = await apiFetch<TodoistTask>(`${API_BASE}/tasks`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.accessToken}` },
      body,
    });

    if ("error" in response) return null;
    return this.mapTodoistTask(response.data);
  }

  async updateTask(externalId: string, updates: Partial<ExternalTask>): Promise<ExternalTask | null> {
    const body: Record<string, unknown> = {};

    if (updates.title !== undefined) body.content = updates.title;
    if (updates.description !== undefined) body.description = updates.description;
    if (updates.dueDate !== undefined) {
      body.due_date = updates.dueDate ?? null;
    }
    if (updates.labels !== undefined) body.labels = updates.labels;
    if (updates.priority !== undefined) body.priority = clampTodoistPriority(updates.priority);

    if (updates.project !== undefined && updates.project !== null) {
      const pid = await this.resolveProjectId(updates.project);
      if (pid) body.project_id = pid;
    }

    const response = await apiFetch<TodoistTask>(`${API_BASE}/tasks/${externalId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.accessToken}` },
      body,
    });

    if ("error" in response) return null;
    return this.mapTodoistTask(response.data);
  }

  async completeTask(externalId: string): Promise<boolean> {
    const response = await apiFetch<unknown>(`${API_BASE}/tasks/${externalId}/close`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    return !("error" in response);
  }

  async reopenTask(externalId: string): Promise<boolean> {
    const response = await apiFetch<unknown>(`${API_BASE}/tasks/${externalId}/reopen`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    return !("error" in response);
  }

  async deleteTask(externalId: string): Promise<boolean> {
    const response = await apiFetch<unknown>(`${API_BASE}/tasks/${externalId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    return !("error" in response);
  }

  // ── Subtasks ───────────────────────────────────────────────────────────────

  async fetchSubtasks(parentExternalId: string): Promise<ExternalTask[]> {
    if (!(await this.isConnected())) return [];

    const url = new URL(`${API_BASE}/tasks`);
    url.searchParams.set("parent_id", parentExternalId);

    const response = await apiFetch<TodoistTask[]>(url.toString(), {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });

    if ("error" in response) return [];
    return response.data.map((t) => this.mapTodoistTask(t));
  }

  async createSubtask(parentExternalId: string, task: ExternalTask): Promise<ExternalTask | null> {
    return this.createTask({ ...task, parentExternalId });
  }

  // ── Project / Label enumeration ────────────────────────────────────────────

  async fetchProjects(): Promise<Array<{ id: string; name: string }>> {
    const response = await apiFetch<TodoistProject[]>(`${API_BASE}/projects`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if ("error" in response) return [];
    this.warmProjectCache(response.data);
    return response.data.map((p) => ({ id: p.id, name: p.name }));
  }

  async fetchLabels(): Promise<Array<{ id: string; name: string }>> {
    const response = await apiFetch<TodoistLabel[]>(`${API_BASE}/labels`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if ("error" in response) return [];
    return response.data.map((l) => ({ id: l.id, name: l.name }));
  }

  // ── Field mapping ──────────────────────────────────────────────────────────

  mapToLocal(external: ExternalTask): Partial<Task> {
    return {
      title: external.title,
      description: external.description ?? "",
      status: external.status === "closed" ? "done" : "todo",
      priority: todoistNumToTaskPriority(external.priority),
      project: external.project ?? null,
      tags: external.labels ?? [],
      dueDate: external.dueDate ?? null,
      completedAt: external.completedAt ?? null,
      externalId: external.externalId,
      externalSource: "todoist",
    };
  }

  mapToExternal(task: Task): Partial<ExternalTask> {
    return {
      title: task.title,
      description: task.description,
      status: task.status === "done" ? "closed" : "open",
      priority: taskPriorityToTodoistNum(task.priority),
      project: task.project ?? undefined,
      labels: task.tags,
      dueDate: task.dueDate ?? undefined,
      parentExternalId: null,
      updatedAt: task.updatedAt,
      completedAt: task.completedAt,
    };
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private mapTodoistTask(task: TodoistTask): ExternalTask {
    const projectName = task.project_id ? this.resolveProjectName(task.project_id) : undefined;

    return {
      externalId: task.id,
      title: task.content,
      description: task.description,
      status: task.is_completed ? "closed" : "open",
      priority: todoistApiPriorityToNum(task.priority),
      project: projectName,
      labels: task.labels ?? [],
      dueDate: task.due?.date,
      parentExternalId: task.parent_id ?? null,
      subtaskExternalIds: [],
      updatedAt: task.created_at ?? new Date().toISOString(),
      completedAt: task.is_completed ? new Date().toISOString() : null,
      url: task.url,
    };
  }
}

// ── Priority conversion helpers ───────────────────────────────────────────────

/**
 * Convert Todoist API priority (1-4) to an internal number stored in ExternalTask.
 * We keep the same numeric range so mapToLocal / mapToExternal can use it directly.
 */
function todoistApiPriorityToNum(priority: number | undefined): number {
  if (priority === 4 || priority === 3 || priority === 2 || priority === 1) return priority;
  return 1; // default to normal
}

/** Convert ExternalTask.priority (1-4) to TaskPriority string. */
function todoistNumToTaskPriority(priority: number | undefined): TaskPriority {
  return TODOIST_TO_TSK_PRIORITY[priority ?? 1] ?? "none";
}

/** Convert TaskPriority string to Todoist API priority number (1-4). */
function taskPriorityToTodoistNum(priority: TaskPriority): number {
  return TSK_TO_TODOIST_PRIORITY[priority] ?? 1;
}

/** Ensure a priority value is in the valid Todoist range [1-4]. */
function clampTodoistPriority(p: number | undefined): number {
  const n = p ?? 1;
  if (n < 1 || n > 4 || !Number.isInteger(n)) return 1;
  return n;
}

// ── Subtask ordering ──────────────────────────────────────────────────────────

/**
 * Sort tasks so that parents always appear before their children.
 * This ensures the sync engine can resolve parent IDs during pull.
 */
function sortParentsBeforeChildren(tasks: TodoistTask[]): TodoistTask[] {
  return sortParentsFirst(
    tasks,
    (t: TodoistTask) => t.id,
    (t: TodoistTask) => t.parent_id ?? null,
  );
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createTodoistProvider(): Promise<SyncProvider> {
  // Lazy-load config to avoid circular deps at module level
  return import("../config/config.ts").then(async ({ ConfigManager }) => {
    const cfg = await ConfigManager.getIntegration("todoist");
    if (!cfg?.accessToken) throw new Error("Todoist not connected — run: tsk connect todoist");
    return new TodoistProvider(cfg.accessToken, cfg.projectId);
  });
}
