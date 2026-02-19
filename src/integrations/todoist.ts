import type { Task } from "../store/types.ts";
import { apiFetch } from "./http.ts";
import type { ExternalTask, SyncProvider } from "./types.ts";

const API_BASE = "https://api.todoist.com/rest/v2";

export class TodoistProvider implements SyncProvider {
  readonly name = "todoist" as const;
  readonly supportsSubtasks = true;

  constructor(private accessToken: string, private projectId?: string) {}

  async isConnected(): Promise<boolean> {
    return this.accessToken.trim().length > 0;
  }

  async testConnection(): Promise<{ ok: boolean; user?: string; error?: string }> {
    if (!(await this.isConnected())) return { ok: false, error: "Missing Todoist token" };
    const response = await apiFetch<{ email?: string }>(`${API_BASE}/user`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if ("error" in response) return { ok: false, error: response.error };
    return { ok: true, user: response.data.email };
  }

  async fetchTasks(_options?: { updatedSince?: string }): Promise<ExternalTask[]> {
    if (!(await this.isConnected())) return [];
    const query = this.projectId ? `?project_id=${encodeURIComponent(this.projectId)}` : "";
    const response = await apiFetch<TodoistTask[]>(`${API_BASE}/tasks${query}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if ("error" in response) return [];
    return response.data.map((task) => this.mapTodoistTask(task));
  }

  async createTask(task: ExternalTask): Promise<ExternalTask | null> {
    const response = await apiFetch<TodoistTask>(`${API_BASE}/tasks`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.accessToken}` },
      body: {
        content: task.title,
        description: task.description ?? "",
        due_date: task.dueDate,
        labels: task.labels ?? [],
      },
    });
    if ("error" in response) return null;
    return this.mapTodoistTask(response.data);
  }

  async updateTask(externalId: string, updates: Partial<ExternalTask>): Promise<ExternalTask | null> {
    const response = await apiFetch<unknown>(`${API_BASE}/tasks/${externalId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.accessToken}` },
      body: {
        content: updates.title,
        description: updates.description,
        due_date: updates.dueDate,
        labels: updates.labels,
      },
    });
    if ("error" in response) return null;
    return {
      externalId,
      title: updates.title ?? "",
      description: updates.description,
      status: updates.status ?? "open",
      priority: updates.priority,
      project: updates.project,
      labels: updates.labels,
      dueDate: updates.dueDate,
      parentExternalId: updates.parentExternalId,
      subtaskExternalIds: updates.subtaskExternalIds,
      updatedAt: new Date().toISOString(),
      completedAt: updates.completedAt,
      url: updates.url,
    };
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

  async fetchSubtasks(parentExternalId: string): Promise<ExternalTask[]> {
    const all = await this.fetchTasks();
    return all.filter((task) => task.parentExternalId === parentExternalId);
  }

  async createSubtask(parentExternalId: string, task: ExternalTask): Promise<ExternalTask | null> {
    return this.createTask({ ...task, parentExternalId });
  }

  mapToLocal(external: ExternalTask): Partial<Task> {
    return {
      title: external.title,
      description: external.description ?? "",
      status: external.status === "closed" ? "done" : "todo",
      priority: mapPriorityToLocal(external.priority),
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
      priority: mapPriorityToExternal(task.priority),
      project: task.project ?? undefined,
      labels: task.tags,
      dueDate: task.dueDate ?? undefined,
      parentExternalId: task.parentId ?? null,
      updatedAt: task.updatedAt,
      completedAt: task.completedAt,
    };
  }

  private mapTodoistTask(task: TodoistTask): ExternalTask {
    return {
      externalId: task.id,
      title: task.content,
      description: task.description,
      status: task.is_completed ? "closed" : "open",
      priority: mapPriorityFromTodoist(task.priority),
      labels: task.labels,
      dueDate: task.due?.date,
      parentExternalId: task.parent_id ?? null,
      updatedAt: task.created_at ?? new Date().toISOString(),
      completedAt: task.is_completed ? new Date().toISOString() : null,
      url: task.url,
    };
  }
}

function mapPriorityFromTodoist(priority: number | undefined): number {
  if (priority === 4) return 4;
  if (priority === 3) return 3;
  if (priority === 2) return 2;
  if (priority === 1) return 1;
  return 0;
}

function mapPriorityToLocal(priority: number | undefined): Task["priority"] {
  switch (priority) {
    case 4:
      return "urgent";
    case 3:
      return "high";
    case 2:
      return "medium";
    case 1:
      return "low";
    default:
      return "none";
  }
}

function mapPriorityToExternal(priority: Task["priority"]): number {
  switch (priority) {
    case "urgent":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

interface TodoistTask {
  id: string;
  content: string;
  description?: string;
  is_completed: boolean;
  priority?: number;
  labels?: string[];
  due?: { date?: string };
  parent_id?: string;
  created_at?: string;
  url?: string;
}
