import type { Task } from "../store/types.ts";
import { apiFetch } from "./http.ts";
import type { ExternalTask, SyncProvider } from "./types.ts";

const API_BASE = "https://app.asana.com/api/1.0";

export class AsanaProvider implements SyncProvider {
  readonly name = "asana" as const;
  readonly supportsSubtasks = true;

  constructor(
    private accessToken: string,
    private workspaceId?: string,
    private projectId?: string,
  ) {}

  async isConnected(): Promise<boolean> {
    return this.accessToken.trim().length > 0;
  }

  async testConnection(): Promise<{ ok: boolean; user?: string; error?: string }> {
    if (!(await this.isConnected())) return { ok: false, error: "Missing Asana token" };
    const response = await apiFetch<{ data?: { name?: string } }>(`${API_BASE}/users/me`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if ("error" in response) return { ok: false, error: response.error };
    return { ok: true, user: response.data.data?.name };
  }

  async fetchTasks(_options?: { updatedSince?: string }): Promise<ExternalTask[]> {
    if (!this.projectId) return [];
    const response = await apiFetch<{ data?: AsanaTask[] }>(
      `${API_BASE}/projects/${this.projectId}/tasks?opt_fields=gid,name,notes,completed,completed_at,due_on,modified_at,parent.gid`,
      {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      },
    );
    if ("error" in response) return [];
    return (response.data.data ?? []).map((task) => this.mapAsanaTask(task));
  }

  async createTask(task: ExternalTask): Promise<ExternalTask | null> {
    if (!this.projectId) return null;
    const response = await apiFetch<{ data?: AsanaTask }>(`${API_BASE}/tasks`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.accessToken}` },
      body: {
        data: {
          name: task.title,
          notes: task.description ?? "",
          due_on: task.dueDate,
          projects: [this.projectId],
          parent: task.parentExternalId ?? undefined,
        },
      },
    });
    if ("error" in response || !response.data.data) return null;
    return this.mapAsanaTask(response.data.data);
  }

  async updateTask(externalId: string, updates: Partial<ExternalTask>): Promise<ExternalTask | null> {
    const response = await apiFetch<{ data?: AsanaTask }>(`${API_BASE}/tasks/${externalId}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${this.accessToken}` },
      body: {
        data: {
          name: updates.title,
          notes: updates.description,
          due_on: updates.dueDate,
          completed: updates.status ? updates.status === "closed" : undefined,
        },
      },
    });
    if ("error" in response || !response.data.data) return null;
    return this.mapAsanaTask(response.data.data);
  }

  async completeTask(externalId: string): Promise<boolean> {
    const response = await apiFetch<{ data?: AsanaTask }>(`${API_BASE}/tasks/${externalId}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${this.accessToken}` },
      body: { data: { completed: true } },
    });
    return !("error" in response);
  }

  async reopenTask(externalId: string): Promise<boolean> {
    const response = await apiFetch<{ data?: AsanaTask }>(`${API_BASE}/tasks/${externalId}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${this.accessToken}` },
      body: { data: { completed: false } },
    });
    return !("error" in response);
  }

  async deleteTask(externalId: string): Promise<boolean> {
    const response = await apiFetch<{ data?: AsanaTask }>(`${API_BASE}/tasks/${externalId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    return !("error" in response);
  }

  async fetchSubtasks(parentExternalId: string): Promise<ExternalTask[]> {
    const response = await apiFetch<{ data?: AsanaTask[] }>(
      `${API_BASE}/tasks/${parentExternalId}/subtasks?opt_fields=gid,name,notes,completed,completed_at,due_on,modified_at,parent.gid`,
      { headers: { Authorization: `Bearer ${this.accessToken}` } },
    );
    if ("error" in response) return [];
    return (response.data.data ?? []).map((task) => this.mapAsanaTask(task));
  }

  async createSubtask(parentExternalId: string, task: ExternalTask): Promise<ExternalTask | null> {
    return this.createTask({ ...task, parentExternalId });
  }

  mapToLocal(external: ExternalTask): Partial<Task> {
    return {
      title: external.title,
      description: external.description ?? "",
      status: external.status === "closed" ? "done" : "todo",
      priority: toLocalPriority(external.priority),
      project: external.project ?? null,
      tags: external.labels ?? [],
      dueDate: external.dueDate ?? null,
      parentId: null,
      completedAt: external.completedAt ?? null,
      externalId: external.externalId,
      externalSource: "asana",
    };
  }

  mapToExternal(task: Task): Partial<ExternalTask> {
    return {
      title: task.title,
      description: task.description,
      status: task.status === "done" ? "closed" : "open",
      priority: toExternalPriority(task.priority),
      project: task.project ?? undefined,
      labels: task.tags,
      dueDate: task.dueDate ?? undefined,
      updatedAt: task.updatedAt,
      completedAt: task.completedAt,
      parentExternalId: task.parentId ?? null,
    };
  }

  async fetchProjects(): Promise<Array<{ id: string; name: string }>> {
    if (!this.workspaceId) return [];
    const response = await apiFetch<{ data?: Array<{ gid: string; name: string }> }>(
      `${API_BASE}/workspaces/${this.workspaceId}/projects`,
      { headers: { Authorization: `Bearer ${this.accessToken}` } },
    );
    if ("error" in response) return [];
    return (response.data.data ?? []).map((project) => ({ id: project.gid, name: project.name }));
  }

  private mapAsanaTask(task: AsanaTask): ExternalTask {
    return {
      externalId: task.gid,
      title: task.name,
      description: task.notes,
      status: task.completed ? "closed" : "open",
      priority: 0,
      dueDate: task.due_on,
      parentExternalId: task.parent?.gid ?? null,
      updatedAt: task.modified_at ?? new Date().toISOString(),
      completedAt: task.completed_at ?? null,
    };
  }
}

function toLocalPriority(priority?: number): Task["priority"] {
  if (priority === 4) return "urgent";
  if (priority === 3) return "high";
  if (priority === 2) return "medium";
  if (priority === 1) return "low";
  return "none";
}

function toExternalPriority(priority: Task["priority"]): number {
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

interface AsanaTask {
  gid: string;
  name: string;
  notes?: string;
  completed: boolean;
  completed_at?: string;
  due_on?: string;
  modified_at?: string;
  parent?: { gid: string };
}
