import type { Task, TaskPriority } from "../store/types.ts";
import type { SyncProvider, ExternalTask, ExternalTaskInput, SyncResult } from "./types.ts";

const API_BASE = "https://app.asana.com/api/1.0";
const TIMEOUT_MS = 10000;

export class AsanaProvider implements SyncProvider {
  readonly name = "asana" as const;
  private token: string;
  private workspaceId?: string;
  private projectId?: string;

  constructor(token: string, workspaceId?: string, projectId?: string) {
    this.token = token;
    this.workspaceId = workspaceId;
    this.projectId = projectId;
  }

  async pull(): Promise<ExternalTask[]> {
    if (!this.projectId) {
      throw new Error("Asana project ID is required. Run: tsk connect asana --workspace <id> --project <id>");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(
        `${API_BASE}/projects/${this.projectId}/tasks?opt_fields=name,notes,due_on,completed,completed_at,tags.name`,
        {
          headers: { Authorization: `Bearer ${this.token}` },
          signal: controller.signal,
        }
      );

      if (!response.ok) throw new Error(`Asana API error: ${response.status}`);

      const json = await response.json() as { data: AsanaTask[] };
      return json.data.map(this._mapFromAsana);
    } finally {
      clearTimeout(timeout);
    }
  }

  async push(tasks: Task[]): Promise<SyncResult> {
    // TODO: Implement Asana push
    return { pulled: 0, pushed: 0, conflicts: 0, errors: ["Asana push not yet implemented"] };
  }

  mapToTask(external: ExternalTask): Partial<Task> {
    return {
      title: external.title,
      description: external.description ?? "",
      dueDate: external.dueDate ?? null,
      tags: external.tags ?? [],
      externalId: external.externalId,
      externalSource: "asana",
    };
  }

  mapFromTask(task: Task): ExternalTaskInput {
    return {
      title: task.title,
      description: task.description,
      dueDate: task.dueDate,
      tags: task.tags,
    };
  }

  private _mapFromAsana(t: AsanaTask): ExternalTask {
    return {
      externalId: t.gid,
      title: t.name,
      description: t.notes ?? "",
      dueDate: t.due_on ?? null,
      status: t.completed ? "done" : "todo",
      tags: t.tags?.map((tag) => tag.name) ?? [],
      completedAt: t.completed_at ?? null,
    };
  }
}

interface AsanaTask {
  gid: string;
  name: string;
  notes?: string;
  due_on?: string;
  completed: boolean;
  completed_at?: string;
  tags?: Array<{ name: string }>;
}
