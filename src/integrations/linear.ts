import type { Task, TaskPriority, TaskStatus } from "../store/types.ts";
import type { SyncProvider, ExternalTask, ExternalTaskInput, SyncResult } from "./types.ts";

const API_URL = "https://api.linear.app/graphql";
const TIMEOUT_MS = 10000;

// Linear priority: 0=none, 1=urgent, 2=high, 3=medium, 4=low
const TSK_TO_LINEAR_PRIORITY: Record<TaskPriority, number> = {
  urgent: 1, high: 2, medium: 3, low: 4, none: 0,
};

const LINEAR_TO_TSK_PRIORITY: Record<number, TaskPriority> = {
  0: "none", 1: "urgent", 2: "high", 3: "medium", 4: "low",
};

const LINEAR_STATUS_MAP: Record<string, TaskStatus> = {
  "Backlog": "todo",
  "Todo": "todo",
  "In Progress": "in_progress",
  "Done": "done",
  "Canceled": "archived",
};

export class LinearProvider implements SyncProvider {
  readonly name = "linear" as const;
  private apiKey: string;
  private teamId?: string;

  constructor(apiKey: string, teamId?: string) {
    this.apiKey = apiKey;
    this.teamId = teamId;
  }

  async pull(): Promise<ExternalTask[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const teamFilter = this.teamId ? `team: { id: { eq: "${this.teamId}" } }` : "";
      const query = `{
        issues(filter: { ${teamFilter} }) {
          nodes {
            id
            title
            description
            priority
            state { name }
            dueDate
            labels { nodes { name } }
            updatedAt
            completedAt
          }
        }
      }`;

      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          Authorization: this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Linear API error: ${response.status}`);
      }

      const json = await response.json() as { data: { issues: { nodes: LinearIssue[] } } };
      return json.data.issues.nodes.map(this._mapFromLinear);
    } finally {
      clearTimeout(timeout);
    }
  }

  async push(tasks: Task[]): Promise<SyncResult> {
    const result: SyncResult = { pulled: 0, pushed: 0, conflicts: 0, errors: [] };

    // TODO: Implement push via Linear's mutation API
    // For now, pull-only integration
    result.errors.push("Linear push not yet implemented — pull-only sync");
    return result;
  }

  mapToTask(external: ExternalTask): Partial<Task> {
    return {
      title: external.title,
      description: external.description ?? "",
      priority: external.priority as TaskPriority ?? "none",
      status: external.status as TaskStatus ?? "todo",
      dueDate: external.dueDate ?? null,
      tags: external.tags ?? [],
      externalId: external.externalId,
      externalSource: "linear",
    };
  }

  mapFromTask(task: Task): ExternalTaskInput {
    return {
      title: task.title,
      description: task.description,
      priority: String(TSK_TO_LINEAR_PRIORITY[task.priority]),
      dueDate: task.dueDate,
    };
  }

  private _mapFromLinear(issue: LinearIssue): ExternalTask {
    const statusName = issue.state?.name ?? "Backlog";
    return {
      externalId: issue.id,
      title: issue.title,
      description: issue.description ?? "",
      priority: LINEAR_TO_TSK_PRIORITY[issue.priority] ?? "none",
      status: LINEAR_STATUS_MAP[statusName] ?? "todo",
      dueDate: issue.dueDate ?? null,
      tags: issue.labels?.nodes?.map((l) => l.name) ?? [],
      completedAt: issue.completedAt ?? null,
      updatedAt: issue.updatedAt,
    };
  }
}

interface LinearIssue {
  id: string;
  title: string;
  description?: string;
  priority: number;
  state?: { name: string };
  dueDate?: string;
  labels?: { nodes: Array<{ name: string }> };
  updatedAt?: string;
  completedAt?: string;
}
