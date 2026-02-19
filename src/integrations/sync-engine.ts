import type { Task } from "../store/types.ts";
import type { TaskStore } from "../store/task-store.ts";
import type { SyncProvider, SyncResult, ExternalTask } from "./types.ts";

export class SyncEngine {
  constructor(
    private store: TaskStore,
    private provider: SyncProvider,
  ) {}

  /** Full bidirectional sync */
  async sync(): Promise<SyncResult> {
    const result: SyncResult = { pulled: 0, pushed: 0, conflicts: 0, errors: [] };

    try {
      // Pull external tasks
      const externalTasks = await this.provider.pull();

      // Process each external task
      for (const ext of externalTasks) {
        const existing = this.store.tasks.find(
          (t) => t.externalId === ext.externalId && t.externalSource === this.provider.name
        );

        if (existing) {
          // Conflict resolution: last-write-wins based on updatedAt
          const extUpdated = ext.updatedAt ?? "";
          if (extUpdated > existing.updatedAt) {
            const mapped = this.provider.mapToTask(ext);
            this.store.updateTask(existing.id, mapped as Partial<Pick<Task, "title" | "description" | "priority" | "project" | "tags" | "dueDate" | "status">>);
            result.pulled++;
          } else if (existing.updatedAt > extUpdated) {
            result.conflicts++;
          }
        } else {
          // New task from external
          const mapped = this.provider.mapToTask(ext);
          this.store.addTask({
            title: mapped.title ?? ext.title,
            description: mapped.description,
            priority: mapped.priority,
            project: mapped.project,
            tags: mapped.tags,
            dueDate: mapped.dueDate,
          });
          // Set external tracking on the newly created task
          const newTask = this.store.tasks[this.store.tasks.length - 1]!;
          newTask.externalId = ext.externalId;
          newTask.externalSource = this.provider.name;
          result.pulled++;
        }
      }

      // Push local changes
      const localTasks = this.store.tasks.filter(
        (t) => t.externalSource === this.provider.name || t.externalSource === null
      );
      const pushResult = await this.provider.push(localTasks);
      result.pushed = pushResult.pushed;
      result.errors.push(...pushResult.errors);

      await this.store.save();
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err));
    }

    return result;
  }

  /** Import only — pull from external */
  async pullOnly(): Promise<SyncResult> {
    const result: SyncResult = { pulled: 0, pushed: 0, conflicts: 0, errors: [] };

    try {
      const externalTasks = await this.provider.pull();
      for (const ext of externalTasks) {
        const existing = this.store.tasks.find(
          (t) => t.externalId === ext.externalId && t.externalSource === this.provider.name
        );
        if (!existing) {
          const mapped = this.provider.mapToTask(ext);
          this.store.addTask({
            title: mapped.title ?? ext.title,
            description: mapped.description,
            priority: mapped.priority,
            project: mapped.project,
            tags: mapped.tags,
            dueDate: mapped.dueDate,
          });
          const newTask = this.store.tasks[this.store.tasks.length - 1]!;
          newTask.externalId = ext.externalId;
          newTask.externalSource = this.provider.name;
          result.pulled++;
        }
      }
      await this.store.save();
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err));
    }

    return result;
  }

  /** Export only — push to external */
  async pushOnly(): Promise<SyncResult> {
    const result: SyncResult = { pulled: 0, pushed: 0, conflicts: 0, errors: [] };

    try {
      const localTasks = this.store.tasks.filter((t) => t.status !== "archived");
      const pushResult = await this.provider.push(localTasks);
      result.pushed = pushResult.pushed;
      result.errors.push(...pushResult.errors);
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err));
    }

    return result;
  }
}
