import type { Task, TaskPriority } from "../store/types.ts";
import type { SyncProvider, ExternalTask, ExternalTaskInput, SyncResult } from "./types.ts";

const API_BASE = "https://api.todoist.com/rest/v2";
const TIMEOUT_MS = 10000;

// Todoist priority: 4=urgent, 3=high, 2=medium, 1=none/low
const TSK_TO_TODOIST_PRIORITY: Record<TaskPriority, number> = {
  urgent: 4, high: 3, medium: 2, low: 1, none: 1,
};

const TODOIST_TO_TSK_PRIORITY: Record<number, TaskPriority> = {
  4: "urgent", 3: "high", 2: "medium", 1: "none",
};

export class TodoistProvider implements SyncProvider {
  readonly name = "todoist" as const;
  private apiKey: string;
  private projectFilter?: string;

  constructor(apiKey: string, projectFilter?: string) {
    this.apiKey = apiKey;
    this.projectFilter = projectFilter;
  }

  async pull(): Promise<ExternalTask[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const url = this.projectFilter
        ? `${API_BASE}/tasks?project_id=${this.projectFilter}`
        : `${API_BASE}/tasks`;

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Todoist API error: ${response.status} ${response.statusText}`);
      }

      const tasks = await response.json() as TodoistTask[];
      return tasks.map(this._mapFromTodoist);
    } finally {
      clearTimeout(timeout);
    }
  }

  async push(tasks: Task[]): Promise<SyncResult> {
    const result: SyncResult = { pulled: 0, pushed: 0, conflicts: 0, errors: [] };

    for (const task of tasks) {
      if (task.externalSource === "todoist" && task.externalId) {
        // Update existing Todoist task
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
          try {
            const body = this.mapFromTask(task);
            const response = await fetch(`${API_BASE}/tasks/${task.externalId}`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(body),
              signal: controller.signal,
            });
            if (response.ok) result.pushed++;
            else result.errors.push(`Failed to update Todoist task ${task.externalId}`);
          } finally {
            clearTimeout(timeout);
          }
        } catch (err) {
          result.errors.push(err instanceof Error ? err.message : String(err));
        }
      }
    }

    return result;
  }

  mapToTask(external: ExternalTask): Partial<Task> {
    return {
      title: external.title,
      description: external.description ?? "",
      priority: external.priority as TaskPriority ?? "none",
      dueDate: external.dueDate ?? null,
      tags: external.tags ?? [],
      externalId: external.externalId,
      externalSource: "todoist",
    };
  }

  mapFromTask(task: Task): ExternalTaskInput {
    return {
      title: task.title,
      description: task.description,
      priority: String(TSK_TO_TODOIST_PRIORITY[task.priority]),
      dueDate: task.dueDate,
      tags: task.tags,
    };
  }

  private _mapFromTodoist(t: TodoistTask): ExternalTask {
    return {
      externalId: t.id,
      title: t.content,
      description: t.description ?? "",
      priority: TODOIST_TO_TSK_PRIORITY[t.priority] ?? "none",
      dueDate: t.due?.date ?? null,
      tags: t.labels ?? [],
      completedAt: t.is_completed ? new Date().toISOString() : null,
      status: t.is_completed ? "done" : "todo",
    };
  }
}

// ── Todoist API types ────────────────────────────────

interface TodoistTask {
  id: string;
  content: string;
  description?: string;
  priority: number;
  due?: { date: string; datetime?: string };
  labels?: string[];
  is_completed: boolean;
  project_id?: string;
  created_at?: string;
}
