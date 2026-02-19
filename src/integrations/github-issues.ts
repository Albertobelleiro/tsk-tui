/**
 * GitHub Issues Integration — Bidirectional Sync Provider
 *
 * ## GitHub REST API Notes
 *
 * **Issues endpoints:**
 * - GET  /repos/{owner}/{repo}/issues          — list (includes PRs; filter with pull_request == null)
 * - POST /repos/{owner}/{repo}/issues          — create (title required, body/labels/milestone optional)
 * - PATCH /repos/{owner}/{repo}/issues/{number} — update (state, title, body, labels, milestone)
 *
 * **State model:** "open" | "closed" — no "in_progress". We map open→todo, closed→done.
 *
 * **Authentication (priority order):**
 * 1. `gh auth token` (zero-config, best UX)
 * 2. Stored PAT from config
 * 3. Device flow OAuth (fallback)
 *
 * **Labels as priority:** Convention "priority:urgent/high/medium/low". Auto-created on first push.
 * **Milestones as project:** milestone.title maps to Task.project.
 * **Due date:** GitHub Issues lack a due date field. We embed `<!-- tsk:due:YYYY-MM-DD -->` in issue body.
 * **Task lists:** `- [ ] item` / `- [x] item` in body parsed as pseudo-subtasks (display-only).
 *
 * **Pagination:** Link header with rel="next". Fetch all pages until exhausted.
 * **Rate limits:** 5000 req/hr with token. Check X-RateLimit-Remaining, back off at <100.
 * **Required headers:** Accept: application/vnd.github+json, X-GitHub-Api-Version: 2022-11-28
 *
 * **"Delete":** GitHub doesn't hard-delete issues. We close + add "wontfix" label.
 */

import type { Task, TaskPriority } from "../store/types.ts";
import type { ExternalTask, SyncProvider } from "./types.ts";

const API_BASE = "https://api.github.com";

const GITHUB_HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "tsk-cli",
  "X-GitHub-Api-Version": "2022-11-28",
};

// --- Priority label convention ---

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  urgent: "priority:urgent",
  high: "priority:high",
  medium: "priority:medium",
  low: "priority:low",
  none: "",
};

const PRIORITY_LABEL_COLORS: Record<string, string> = {
  "priority:urgent": "f7768e",
  "priority:high": "ff9e64",
  "priority:medium": "e0af68",
  "priority:low": "7dcfff",
};

const PRIORITY_LABEL_SET = new Set(
  Object.values(PRIORITY_LABELS).filter((l) => l.length > 0),
);

// --- Due date via HTML comment ---

const DUE_DATE_RE = /<!-- tsk:due:(\d{4}-\d{2}-\d{2}) -->/;

function extractDueDate(body: string | undefined): string | undefined {
  if (!body) return undefined;
  const match = body.match(DUE_DATE_RE);
  return match?.[1];
}

function injectDueDate(body: string, dueDate: string | null | undefined): string {
  const cleaned = body.replace(DUE_DATE_RE, "").trimEnd();
  if (!dueDate) return cleaned;
  return `${cleaned}\n<!-- tsk:due:${dueDate} -->`;
}

// --- Task list (pseudo-subtask) parsing ---

const TASK_ITEM_RE = /^- \[([ xX])\] (.+)$/gm;

export interface TaskListItem {
  title: string;
  completed: boolean;
}

function parseTaskList(body: string | undefined): TaskListItem[] {
  if (!body) return [];
  const items: TaskListItem[] = [];
  let match: RegExpExecArray | null;
  TASK_ITEM_RE.lastIndex = 0;
  while ((match = TASK_ITEM_RE.exec(body)) !== null) {
    items.push({ title: match[2]!.trim(), completed: match[1] !== " " });
  }
  return items;
}

function generateSubtaskList(subtasks: Array<{ title: string; done: boolean }>): string {
  if (subtasks.length === 0) return "";
  const lines = subtasks.map(
    (s) => `- [${s.done ? "x" : " "}] ${s.title} (tsk)`,
  );
  return `\n\n## Subtasks\n${lines.join("\n")}`;
}

// --- Link header pagination ---

function parseLinkHeader(header: string | null): { next?: string; last?: string } {
  if (!header) return {};
  const links: Record<string, string> = {};
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="(\w+)"/);
    if (match) links[match[2]!] = match[1]!;
  }
  return links;
}

// --- Label helpers ---

function extractPriorityFromLabels(labels: string[]): TaskPriority {
  for (const [priority, label] of Object.entries(PRIORITY_LABELS)) {
    if (label && labels.includes(label)) return priority as TaskPriority;
  }
  return "none";
}

function separateLabels(labels: string[]): { priority: TaskPriority; tags: string[] } {
  return {
    priority: extractPriorityFromLabels(labels),
    tags: labels.filter((l) => !PRIORITY_LABEL_SET.has(l)),
  };
}

// --- Auth resolution ---

export async function resolveGitHubToken(config: {
  accessToken?: string;
  useGhCli?: boolean;
}): Promise<string | null> {
  // 1. Try gh CLI (zero-config — best UX)
  if (config.useGhCli !== false) {
    try {
      const proc = Bun.spawn(["gh", "auth", "token"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const text = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      const token = text.trim();
      if (exitCode === 0 && token.length > 10) return token;
    } catch {
      /* gh not installed or not authed */
    }
  }

  // 2. Use stored token
  if (config.accessToken && config.accessToken.trim().length > 0) {
    return config.accessToken;
  }

  // 3. No auth available
  return null;
}

// --- Raw fetch with rate limit awareness ---

interface RawResponse<T> {
  data: T;
  status: number;
  headers: Headers;
}

interface RawError {
  error: string;
  status: number;
}

const MAX_RETRIES = 3;
const TIMEOUT_MS = 10_000;
const RETRY_ON = new Set([429, 500, 502, 503]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ghFetch<T>(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  },
): Promise<RawResponse<T> | RawError> {
  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    attempt++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const body =
        options.body === undefined
          ? undefined
          : typeof options.body === "string"
            ? options.body
            : JSON.stringify(options.body);

      const response = await fetch(url, {
        method: options.method ?? "GET",
        headers: {
          ...GITHUB_HEADERS,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(options.headers ?? {}),
        },
        body,
        signal: controller.signal,
      });

      const status = response.status;

      // Rate limit check
      const remaining = response.headers.get("X-RateLimit-Remaining");
      if (remaining !== null && parseInt(remaining, 10) < 100) {
        const resetStr = response.headers.get("X-RateLimit-Reset");
        if (resetStr) {
          const resetMs = parseInt(resetStr, 10) * 1000 - Date.now();
          if (resetMs > 0 && resetMs < 60_000) {
            await sleep(Math.min(resetMs + 1000, 30_000));
          }
        }
      }

      if (status === 401) {
        return { error: "Unauthorized (401)", status };
      }

      const text = await response.text();
      if (!response.ok) {
        if (RETRY_ON.has(status) && attempt < MAX_RETRIES) {
          const backoff = Math.pow(2, attempt - 1) * 1000;
          await sleep(backoff);
          continue;
        }
        return { error: text || `HTTP ${status}`, status };
      }

      let data: T;
      if (!text) {
        data = {} as T;
      } else {
        try {
          data = JSON.parse(text) as T;
        } catch {
          data = text as T;
        }
      }
      return { data, status, headers: response.headers };
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        const backoff = Math.pow(2, attempt - 1) * 1000;
        await sleep(backoff);
        continue;
      }
      return {
        error: error instanceof Error ? error.message : String(error),
        status: 0,
      };
    } finally {
      clearTimeout(timer);
    }
  }
  return { error: "Request failed", status: 0 };
}

// --- GitHub Issues types ---

interface GitHubLabel {
  name: string;
  color?: string;
}

interface GitHubMilestone {
  number: number;
  title: string;
  due_on?: string | null;
}

interface GitHubIssue {
  number: number;
  title: string;
  body?: string | null;
  state: "open" | "closed";
  labels: Array<string | GitHubLabel>;
  milestone?: GitHubMilestone | null;
  updated_at: string;
  closed_at?: string | null;
  html_url: string;
  pull_request?: unknown;
}

// --- Provider ---

export class GitHubIssuesProvider implements SyncProvider {
  readonly name = "github-issues" as const;
  readonly supportsSubtasks = false;

  private token: string | null = null;
  private labelsEnsured = false;

  constructor(
    private repo: string,
    private options?: {
      accessToken?: string;
      useGhCli?: boolean;
      labelFilter?: string[];
    },
  ) {}

  private authHeaders(): Record<string, string> {
    if (!this.token) return {};
    return { Authorization: `Bearer ${this.token}` };
  }

  private repoUrl(path = ""): string {
    return `${API_BASE}/repos/${this.repo}${path}`;
  }

  // --- Connection ---

  async isConnected(): Promise<boolean> {
    if (!this.token) {
      this.token = await resolveGitHubToken({
        accessToken: this.options?.accessToken,
        useGhCli: this.options?.useGhCli,
      });
    }
    return this.token !== null && this.repo.trim().length > 0;
  }

  async testConnection(): Promise<{ ok: boolean; user?: string; error?: string }> {
    if (!(await this.isConnected())) {
      return { ok: false, error: "No GitHub token available" };
    }

    const response = await ghFetch<{ full_name?: string }>(this.repoUrl(), {
      headers: this.authHeaders(),
    });

    if ("error" in response) return { ok: false, error: response.error };
    return { ok: true, user: response.data.full_name ?? this.repo };
  }

  // --- Fetch (pull) ---

  async fetchTasks(options?: { updatedSince?: string }): Promise<ExternalTask[]> {
    if (!(await this.isConnected())) return [];

    const allIssues: GitHubIssue[] = [];
    const labelParam =
      this.options?.labelFilter && this.options.labelFilter.length > 0
        ? `&labels=${encodeURIComponent(this.options.labelFilter.join(","))}`
        : "";
    const sinceParam = options?.updatedSince
      ? `&since=${encodeURIComponent(options.updatedSince)}`
      : "";

    let url: string | undefined =
      this.repoUrl(`/issues?state=all&per_page=100${labelParam}${sinceParam}`);

    while (url) {
      const response = await ghFetch<GitHubIssue[]>(url, {
        headers: this.authHeaders(),
      });

      if ("error" in response) break;

      allIssues.push(...response.data);

      const links = parseLinkHeader(response.headers.get("Link"));
      url = links.next;
    }

    return allIssues
      .filter((issue) => issue.pull_request == null)
      .map((issue) => this.mapIssue(issue));
  }

  // --- Create (push new) ---

  async createTask(task: ExternalTask): Promise<ExternalTask | null> {
    if (!(await this.isConnected())) return null;
    await this.ensurePriorityLabels();

    const { priority, tags } = separateLabels(task.labels ?? []);
    const priorityLabel = PRIORITY_LABELS[priority];
    const allLabels = [...tags, ...(priorityLabel ? [priorityLabel] : [])];

    let body = task.description ?? "";
    body = injectDueDate(body, task.dueDate);

    const payload: Record<string, unknown> = {
      title: task.title,
      body,
      labels: allLabels,
    };

    if (task.status === "closed") {
      payload.state = "closed";
    }

    const response = await ghFetch<GitHubIssue>(this.repoUrl("/issues"), {
      method: "POST",
      headers: this.authHeaders(),
      body: payload,
    });

    if ("error" in response) return null;
    return this.mapIssue(response.data);
  }

  // --- Update (push changes) ---

  async updateTask(
    externalId: string,
    updates: Partial<ExternalTask>,
  ): Promise<ExternalTask | null> {
    if (!(await this.isConnected())) return null;
    await this.ensurePriorityLabels();

    const payload: Record<string, unknown> = {};

    if (updates.title !== undefined) payload.title = updates.title;

    if (updates.status !== undefined) {
      payload.state = updates.status === "closed" ? "closed" : "open";
    }

    // Build labels array: merge priority + tags
    if (updates.labels !== undefined || updates.priority !== undefined) {
      const currentLabels = updates.labels ?? [];
      const { tags } = separateLabels(currentLabels);

      // Determine priority — if explicit numeric priority provided, convert; otherwise extract from labels
      let priorityKey: TaskPriority = "none";
      if (updates.priority !== undefined) {
        priorityKey = numericToTaskPriority(updates.priority);
      } else {
        priorityKey = extractPriorityFromLabels(currentLabels);
      }

      const priorityLabel = PRIORITY_LABELS[priorityKey];
      payload.labels = [...tags, ...(priorityLabel ? [priorityLabel] : [])];
    }

    // Handle body: inject due date if changed
    if (updates.description !== undefined || updates.dueDate !== undefined) {
      let body = updates.description ?? "";
      body = injectDueDate(body, updates.dueDate);
      payload.body = body;
    }

    if (Object.keys(payload).length === 0) return null;

    const response = await ghFetch<GitHubIssue>(
      this.repoUrl(`/issues/${externalId}`),
      {
        method: "PATCH",
        headers: this.authHeaders(),
        body: payload,
      },
    );

    if ("error" in response) return null;
    return this.mapIssue(response.data);
  }

  // --- Complete (close) ---

  async completeTask(externalId: string): Promise<boolean> {
    if (!(await this.isConnected())) return false;

    const response = await ghFetch<GitHubIssue>(
      this.repoUrl(`/issues/${externalId}`),
      {
        method: "PATCH",
        headers: this.authHeaders(),
        body: { state: "closed" },
      },
    );
    return !("error" in response);
  }

  // --- Reopen ---

  async reopenTask(externalId: string): Promise<boolean> {
    if (!(await this.isConnected())) return false;

    const response = await ghFetch<GitHubIssue>(
      this.repoUrl(`/issues/${externalId}`),
      {
        method: "PATCH",
        headers: this.authHeaders(),
        body: { state: "open" },
      },
    );
    return !("error" in response);
  }

  // --- "Delete" (close + wontfix label) ---

  async deleteTask(externalId: string): Promise<boolean> {
    if (!(await this.isConnected())) return false;

    // First get current labels
    const getResp = await ghFetch<GitHubIssue>(
      this.repoUrl(`/issues/${externalId}`),
      { headers: this.authHeaders() },
    );

    if ("error" in getResp) return false;

    const currentLabels = getResp.data.labels.map((l) =>
      typeof l === "string" ? l : l.name,
    );

    const response = await ghFetch<GitHubIssue>(
      this.repoUrl(`/issues/${externalId}`),
      {
        method: "PATCH",
        headers: this.authHeaders(),
        body: {
          state: "closed",
          labels: [...currentLabels.filter((l) => l !== "wontfix"), "wontfix"],
        },
      },
    );
    return !("error" in response);
  }

  // --- Field mapping ---

  mapToLocal(external: ExternalTask): Partial<Task> {
    const { priority, tags } = separateLabels(external.labels ?? []);
    return {
      title: external.title,
      description: stripTskMetadata(external.description ?? ""),
      status: external.status === "closed" ? "done" : "todo",
      priority,
      project: external.project ?? null,
      tags,
      dueDate: external.dueDate ?? null,
      externalId: external.externalId,
      externalSource: "github-issues",
      completedAt: external.completedAt ?? null,
    };
  }

  mapToExternal(task: Task): Partial<ExternalTask> {
    const priorityLabel = PRIORITY_LABELS[task.priority];
    const allLabels = [
      ...task.tags,
      ...(priorityLabel ? [priorityLabel] : []),
    ];

    let description = task.description;
    description = injectDueDate(description, task.dueDate);

    return {
      title: task.title,
      description,
      status: task.status === "done" ? "closed" : "open",
      priority: taskPriorityToNumeric(task.priority),
      project: task.project ?? undefined,
      labels: allLabels,
      dueDate: task.dueDate ?? undefined,
      updatedAt: task.updatedAt,
      completedAt: task.completedAt,
    };
  }

  // --- Optional: fetch labels ---

  async fetchLabels(): Promise<Array<{ id: string; name: string }>> {
    if (!(await this.isConnected())) return [];
    const response = await ghFetch<Array<{ id: number; name: string }>>(
      this.repoUrl("/labels?per_page=100"),
      { headers: this.authHeaders() },
    );
    if ("error" in response) return [];
    return response.data.map((l) => ({ id: String(l.id), name: l.name }));
  }

  // --- Optional: fetch milestones as projects ---

  async fetchProjects(): Promise<Array<{ id: string; name: string }>> {
    if (!(await this.isConnected())) return [];
    const response = await ghFetch<GitHubMilestone[]>(
      this.repoUrl("/milestones?state=open&per_page=100"),
      { headers: this.authHeaders() },
    );
    if ("error" in response) return [];
    return response.data.map((m) => ({
      id: String(m.number),
      name: m.title,
    }));
  }

  // --- Internal helpers ---

  private mapIssue(issue: GitHubIssue): ExternalTask {
    const labelNames = issue.labels.map((l) =>
      typeof l === "string" ? l : l.name,
    );
    const dueDate = extractDueDate(issue.body ?? undefined) ??
      (issue.milestone?.due_on ? issue.milestone.due_on.split("T")[0] : undefined);

    return {
      externalId: String(issue.number),
      title: issue.title,
      description: issue.body ?? undefined,
      status: issue.state === "closed" ? "closed" : "open",
      priority: taskPriorityToNumeric(extractPriorityFromLabels(labelNames)),
      project: issue.milestone?.title,
      labels: labelNames,
      dueDate,
      updatedAt: issue.updated_at,
      completedAt: issue.closed_at ?? null,
      url: issue.html_url,
    };
  }

  /** Ensure priority labels exist in the repo. Runs once per session. */
  private async ensurePriorityLabels(): Promise<void> {
    if (this.labelsEnsured) return;
    this.labelsEnsured = true;

    const existing = await this.fetchLabels();
    const existingNames = new Set(existing.map((l) => l.name));

    for (const [label, color] of Object.entries(PRIORITY_LABEL_COLORS)) {
      if (existingNames.has(label)) continue;

      await ghFetch<unknown>(this.repoUrl("/labels"), {
        method: "POST",
        headers: this.authHeaders(),
        body: { name: label, color, description: `tsk priority: ${label.split(":")[1]}` },
      });
    }
  }
}

// --- Utility functions ---

function stripTskMetadata(body: string): string {
  return body.replace(DUE_DATE_RE, "").trimEnd();
}

function taskPriorityToNumeric(priority: TaskPriority): number {
  switch (priority) {
    case "urgent": return 4;
    case "high": return 3;
    case "medium": return 2;
    case "low": return 1;
    default: return 0;
  }
}

function numericToTaskPriority(priority: number): TaskPriority {
  if (priority >= 4) return "urgent";
  if (priority === 3) return "high";
  if (priority === 2) return "medium";
  if (priority === 1) return "low";
  return "none";
}

// --- Exported utilities for CLI connect flow ---

export { parseTaskList, generateSubtaskList, parseLinkHeader };
