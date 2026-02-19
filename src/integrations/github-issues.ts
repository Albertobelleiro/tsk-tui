import type { Task } from "../store/types.ts";
import { apiFetch } from "./http.ts";
import type { ExternalTask, SyncProvider } from "./types.ts";

const API_BASE = "https://api.github.com";

export class GitHubIssuesProvider implements SyncProvider {
  readonly name = "github-issues" as const;
  readonly supportsSubtasks = false;

  constructor(
    private repo: string,
    private options?: { accessToken?: string; useGhCli?: boolean; labelFilter?: string[] },
  ) {}

  async isConnected(): Promise<boolean> {
    if (this.options?.useGhCli) return true;
    return this.repo.trim().length > 0 && (this.options?.accessToken ?? "").trim().length > 0;
  }

  async testConnection(): Promise<{ ok: boolean; user?: string; error?: string }> {
    if (this.options?.useGhCli) {
      try {
        const proc = Bun.spawn(["gh", "auth", "status"], { stdout: "pipe", stderr: "pipe" });
        const exitCode = await proc.exited;
        return exitCode === 0 ? { ok: true, user: "gh-cli" } : { ok: false, error: "gh auth status failed" };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    const response = await apiFetch<{ login?: string }>(`${API_BASE}/user`, {
      headers: {
        Accept: "application/vnd.github+json",
        ...(this.options?.accessToken ? { Authorization: `Bearer ${this.options.accessToken}` } : {}),
      },
    });

    if ("error" in response) return { ok: false, error: response.error };
    return { ok: true, user: response.data.login };
  }

  async fetchTasks(_options?: { updatedSince?: string }): Promise<ExternalTask[]> {
    if (this.options?.useGhCli) {
      return this.fetchViaGhCli();
    }

    const response = await apiFetch<GitHubIssue[]>(`${API_BASE}/repos/${this.repo}/issues?state=all&per_page=100`, {
      headers: {
        Accept: "application/vnd.github+json",
        ...(this.options?.accessToken ? { Authorization: `Bearer ${this.options.accessToken}` } : {}),
      },
    });

    if ("error" in response) return [];

    const labelFilter = this.options?.labelFilter ?? [];
    return response.data
      .filter((issue) => issue.pull_request == null)
      .map((issue) => this.mapIssue(issue))
      .filter((issue) => {
        if (labelFilter.length === 0) return true;
        const labels = new Set(issue.labels ?? []);
        return labelFilter.every((label) => labels.has(label));
      });
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
      project: external.project ?? null,
      tags: external.labels ?? [],
      dueDate: external.dueDate ?? null,
      externalId: external.externalId,
      externalSource: "github-issues",
      completedAt: external.completedAt ?? null,
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
    };
  }

  private async fetchViaGhCli(): Promise<ExternalTask[]> {
    try {
      const proc = Bun.spawn(
        ["gh", "issue", "list", "--repo", this.repo, "--state", "all", "--json", "number,title,body,state,labels,milestone,updatedAt,closedAt", "--limit", "100"],
        { stdout: "pipe", stderr: "pipe" },
      );
      const text = await new Response(proc.stdout).text();
      const code = await proc.exited;
      if (code !== 0) return [];
      const issues = JSON.parse(text) as GitHubIssue[];
      return issues.map((issue) => this.mapIssue(issue));
    } catch {
      return [];
    }
  }

  private mapIssue(issue: GitHubIssue): ExternalTask {
    return {
      externalId: String(issue.number),
      title: issue.title,
      description: issue.body,
      status: issue.state === "closed" ? "closed" : "open",
      priority: 0,
      project: issue.milestone?.title,
      labels: issue.labels?.map((label) => typeof label === "string" ? label : label.name) ?? [],
      updatedAt: issue.updated_at ?? issue.updatedAt ?? new Date().toISOString(),
      completedAt: issue.closedAt ?? null,
      url: issue.html_url,
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

interface GitHubIssue {
  number: number;
  title: string;
  body?: string;
  state: "open" | "closed";
  labels?: Array<string | { name: string }>;
  milestone?: { title: string };
  updated_at?: string;
  updatedAt?: string;
  closedAt?: string;
  html_url?: string;
  pull_request?: unknown;
}
