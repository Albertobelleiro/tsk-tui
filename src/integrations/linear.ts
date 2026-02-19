import type { Task } from "../store/types.ts";
import { graphqlFetch } from "./http.ts";
import type { ExternalTask, SyncProvider } from "./types.ts";

const API_URL = "https://api.linear.app/graphql";

export class LinearProvider implements SyncProvider {
  readonly name = "linear" as const;
  readonly supportsSubtasks = false;

  constructor(private accessToken: string, private teamId?: string) {}

  async isConnected(): Promise<boolean> {
    return this.accessToken.trim().length > 0;
  }

  async testConnection(): Promise<{ ok: boolean; user?: string; error?: string }> {
    if (!(await this.isConnected())) return { ok: false, error: "Missing Linear token" };
    const query = "query { viewer { name } }";
    const result = await graphqlFetch<{ viewer?: { name?: string } }>(API_URL, {
      query,
      token: this.accessToken,
    });
    if ("error" in result) return { ok: false, error: result.error };
    return { ok: true, user: result.data.viewer?.name };
  }

  async fetchTasks(_options?: { updatedSince?: string }): Promise<ExternalTask[]> {
    const filter = this.teamId ? `team: { id: { eq: \"${this.teamId}\" } }` : "";
    const query = `query { issues(filter: { ${filter} }) { nodes { id title description priority updatedAt completedAt dueDate state { type } labels { nodes { name } } } } }`;
    const result = await graphqlFetch<{ issues?: { nodes?: LinearIssue[] } }>(API_URL, {
      query,
      token: this.accessToken,
    });
    if ("error" in result) return [];
    return (result.data.issues?.nodes ?? []).map((issue) => this.mapIssue(issue));
  }

  async createTask(_task: ExternalTask): Promise<ExternalTask | null> {
    return null;
  }

  async updateTask(_externalId: string, _updates: Partial<ExternalTask>): Promise<ExternalTask | null> {
    return null;
  }

  async completeTask(_externalId: string): Promise<boolean> {
    return false;
  }

  async reopenTask(_externalId: string): Promise<boolean> {
    return false;
  }

  async deleteTask(_externalId: string): Promise<boolean> {
    return false;
  }

  mapToLocal(external: ExternalTask): Partial<Task> {
    return {
      title: external.title,
      description: external.description ?? "",
      status: external.status === "closed" ? "done" : "todo",
      priority: toLocalPriority(external.priority),
      tags: external.labels ?? [],
      dueDate: external.dueDate ?? null,
      externalId: external.externalId,
      externalSource: "linear",
      completedAt: external.completedAt ?? null,
    };
  }

  mapToExternal(task: Task): Partial<ExternalTask> {
    return {
      title: task.title,
      description: task.description,
      status: task.status === "done" ? "closed" : "open",
      priority: toExternalPriority(task.priority),
      labels: task.tags,
      dueDate: task.dueDate ?? undefined,
      updatedAt: task.updatedAt,
      completedAt: task.completedAt,
    };
  }

  async fetchProjects(): Promise<Array<{ id: string; name: string }>> {
    const query = this.teamId
      ? `query { team(id: \"${this.teamId}\") { projects { nodes { id name } } } }`
      : "query { projects { nodes { id name } } }";
    const result = await graphqlFetch<{ team?: { projects?: { nodes?: Array<{ id: string; name: string }> } }; projects?: { nodes?: Array<{ id: string; name: string }> } }>(API_URL, {
      query,
      token: this.accessToken,
    });
    if ("error" in result) return [];
    return result.data.team?.projects?.nodes ?? result.data.projects?.nodes ?? [];
  }

  private mapIssue(issue: LinearIssue): ExternalTask {
    return {
      externalId: issue.id,
      title: issue.title,
      description: issue.description,
      status: issue.state?.type === "completed" ? "closed" : "open",
      priority: typeof issue.priority === "number" ? Math.max(0, 4 - issue.priority) : 0,
      labels: issue.labels?.nodes?.map((label) => label.name) ?? [],
      dueDate: issue.dueDate,
      updatedAt: issue.updatedAt,
      completedAt: issue.completedAt ?? null,
    };
  }
}

function toLocalPriority(priority?: number): Task["priority"] {
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

function toExternalPriority(priority: Task["priority"]): number {
  switch (priority) {
    case "urgent":
      return 1;
    case "high":
      return 2;
    case "medium":
      return 3;
    case "low":
      return 4;
    default:
      return 0;
  }
}

interface LinearIssue {
  id: string;
  title: string;
  description?: string;
  priority?: number;
  updatedAt: string;
  completedAt?: string;
  dueDate?: string;
  state?: { type?: string };
  labels?: { nodes?: Array<{ name: string }> };
}
