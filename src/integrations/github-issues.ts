import type { Task } from "../store/types.ts";
import type { SyncProvider, ExternalTask, ExternalTaskInput, SyncResult } from "./types.ts";

const API_BASE = "https://api.github.com";
const TIMEOUT_MS = 10000;

export class GitHubIssuesProvider implements SyncProvider {
  readonly name = "github-issues" as const;
  private repo: string; // "owner/repo"
  private useGhCli: boolean;

  constructor(repo: string, useGhCli: boolean = false) {
    this.repo = repo;
    this.useGhCli = useGhCli;
  }

  async pull(): Promise<ExternalTask[]> {
    if (this.useGhCli) {
      return this._pullViaGhCli();
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(
        `${API_BASE}/repos/${this.repo}/issues?state=all&per_page=100`,
        {
          headers: { Accept: "application/vnd.github.v3+json" },
          signal: controller.signal,
        }
      );

      if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);

      const issues = await response.json() as GitHubIssue[];
      // Filter out pull requests
      return issues
        .filter((i) => !i.pull_request)
        .map(this._mapFromGitHub);
    } finally {
      clearTimeout(timeout);
    }
  }

  async push(tasks: Task[]): Promise<SyncResult> {
    // TODO: Implement GitHub Issues push (create/update issues)
    return { pulled: 0, pushed: 0, conflicts: 0, errors: ["GitHub push not yet implemented"] };
  }

  mapToTask(external: ExternalTask): Partial<Task> {
    return {
      title: external.title,
      description: external.description ?? "",
      tags: external.tags ?? [],
      project: external.project ?? null,
      externalId: external.externalId,
      externalSource: "github-issues",
    };
  }

  mapFromTask(task: Task): ExternalTaskInput {
    return {
      title: task.title,
      description: task.description,
      tags: task.tags,
    };
  }

  private _mapFromGitHub(issue: GitHubIssue): ExternalTask {
    return {
      externalId: String(issue.number),
      title: issue.title,
      description: issue.body ?? "",
      status: issue.state === "closed" ? "done" : "todo",
      tags: issue.labels?.map((l) => typeof l === "string" ? l : l.name) ?? [],
      project: issue.milestone?.title ?? undefined,
      updatedAt: issue.updated_at,
    };
  }

  private async _pullViaGhCli(): Promise<ExternalTask[]> {
    try {
      const proc = Bun.spawn(
        ["gh", "issue", "list", "--repo", this.repo, "--json", "number,title,body,state,labels,milestone,updatedAt", "--limit", "100"],
        { stdout: "pipe", stderr: "pipe" }
      );
      const text = await new Response(proc.stdout).text();
      await proc.exited;
      const issues = JSON.parse(text) as GitHubIssue[];
      return issues.map(this._mapFromGitHub);
    } catch (err) {
      throw new Error(`gh CLI error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

interface GitHubIssue {
  number: number;
  title: string;
  body?: string;
  state: "open" | "closed";
  labels?: Array<string | { name: string }>;
  milestone?: { title: string };
  updated_at: string;
  pull_request?: unknown;
}
