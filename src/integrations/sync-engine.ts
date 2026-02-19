import type { TaskStore } from "../store/task-store.ts";
import type { Task, ExternalSource } from "../store/types.ts";
import type { TskConfig } from "../config/types.ts";
import type { ExternalTask, SyncError, SyncProvider, SyncResult } from "./types.ts";
import { SyncStateManager, type SyncState } from "./sync-state.ts";

function toMillis(iso: string | null | undefined): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function hashExternalTask(task: ExternalTask): string {
  return JSON.stringify({
    title: task.title,
    description: task.description ?? "",
    status: task.status,
    priority: task.priority ?? null,
    project: task.project ?? null,
    labels: task.labels ?? [],
    dueDate: task.dueDate ?? null,
    parentExternalId: task.parentExternalId ?? null,
    subtaskExternalIds: task.subtaskExternalIds ?? [],
    updatedAt: task.updatedAt,
    completedAt: task.completedAt ?? null,
  });
}

function applyLocalUpdate(store: TaskStore, localTask: Task, mapped: Partial<Task>): void {
  const updates: Partial<Pick<Task, "title" | "description" | "priority" | "project" | "tags" | "dueDate" | "status">> = {};

  if (typeof mapped.title === "string") updates.title = mapped.title;
  if (typeof mapped.description === "string") updates.description = mapped.description;
  if (mapped.priority) updates.priority = mapped.priority;
  if (mapped.project !== undefined) updates.project = mapped.project;
  if (Array.isArray(mapped.tags)) updates.tags = mapped.tags;
  if (mapped.dueDate !== undefined) updates.dueDate = mapped.dueDate;
  if (mapped.status) updates.status = mapped.status;

  if (Object.keys(updates).length > 0) {
    store.updateTask(localTask.id, updates);
  }

  localTask.externalId = localTask.externalId ?? mapped.externalId ?? localTask.externalId;
  localTask.externalSource = localTask.externalSource ?? mapped.externalSource ?? localTask.externalSource;

  if (mapped.parentId !== undefined) {
    localTask.parentId = mapped.parentId;
  }
}

function shouldPullUpdate(
  strategy: TskConfig["sync"]["conflictStrategy"],
  remoteUpdatedAt: string,
  localUpdatedAt: string,
): boolean {
  if (strategy === "remote-wins") return true;
  if (strategy === "local-wins") return false;
  return toMillis(remoteUpdatedAt) > toMillis(localUpdatedAt);
}

export class SyncEngine {
  constructor(
    private store: TaskStore,
    private provider: SyncProvider,
    private syncState: SyncState,
    private config: TskConfig["sync"],
  ) {}

  async sync(options?: { pullOnly?: boolean; pushOnly?: boolean; dryRun?: boolean }): Promise<SyncResult> {
    const startedAt = Date.now();
    const errors: SyncError[] = [];
    let pulled = 0;
    let pushed = 0;
    let deleted = 0;
    let conflicts = 0;

    const providerName = this.provider.name;
    const lastSyncAt = this.syncState.lastSyncAt[providerName];

    let remoteTasks: ExternalTask[] = [];
    if (!options?.pushOnly) {
      try {
        remoteTasks = await this.provider.fetchTasks({ updatedSince: lastSyncAt });
      } catch (error) {
        errors.push({
          operation: "pull",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const remoteById = new Map(remoteTasks.map((task) => [task.externalId, task]));

    if (!options?.pushOnly) {
      for (const remoteTask of remoteTasks) {
        const localId = SyncStateManager.getLocalId(this.syncState, remoteTask.externalId);

        if (localId) {
          const localTask = this.store.tasks.find((task) => task.id === localId);

          if (!localTask) {
            if (!options?.dryRun) {
              SyncStateManager.removeMapping(this.syncState, localId);
            }
            continue;
          }

          if (this.syncState.deletedLocally.includes(localId)) {
            if (!options?.dryRun) {
              const deletedRemote = await this.provider.deleteTask(remoteTask.externalId);
              if (deletedRemote) {
                deleted += 1;
                this.syncState.deletedLocally = this.syncState.deletedLocally.filter((id) => id !== localId);
              }
            }
            continue;
          }

          const shouldUpdate = shouldPullUpdate(
            this.config.conflictStrategy,
            remoteTask.updatedAt,
            localTask.updatedAt,
          );

          if (!shouldUpdate) {
            conflicts += 1;
            continue;
          }

          if (!options?.dryRun) {
            try {
              const mapped = this.provider.mapToLocal(remoteTask);
              applyLocalUpdate(this.store, localTask, mapped);
              this.syncState.lastPullHashes[remoteTask.externalId] = hashExternalTask(remoteTask);
              pulled += 1;
            } catch (error) {
              errors.push({
                taskId: localTask.id,
                externalId: remoteTask.externalId,
                operation: "map",
                message: error instanceof Error ? error.message : String(error),
              });
            }
          } else {
            pulled += 1;
          }
        } else {
          if (!options?.dryRun) {
            try {
              const mapped = this.provider.mapToLocal(remoteTask);
              const local = this.store.addTask({
                title: mapped.title ?? remoteTask.title,
                description: mapped.description ?? "",
                priority: mapped.priority ?? "none",
                project: mapped.project ?? remoteTask.project ?? null,
                tags: mapped.tags ?? remoteTask.labels ?? [],
                dueDate: mapped.dueDate ?? remoteTask.dueDate ?? null,
                parentId: null,
              });
              local.externalId = remoteTask.externalId;
              local.externalSource = providerName;

              if (remoteTask.parentExternalId) {
                const parentLocalId = SyncStateManager.getLocalId(this.syncState, remoteTask.parentExternalId);
                if (parentLocalId) {
                  local.parentId = parentLocalId;
                }
              }

              SyncStateManager.addMapping(this.syncState, local.id, remoteTask.externalId);
              this.syncState.lastPullHashes[remoteTask.externalId] = hashExternalTask(remoteTask);
              pulled += 1;
            } catch (error) {
              errors.push({
                externalId: remoteTask.externalId,
                operation: "pull",
                message: error instanceof Error ? error.message : String(error),
              });
            }
          } else {
            pulled += 1;
          }
        }
      }
    }

    if (!options?.pullOnly) {
      const changedLocalTasks = this.store.tasks.filter((task) => {
        if (task.status === "archived") return false;

        if (task.externalSource === providerName && task.externalId) {
          return toMillis(task.updatedAt) > toMillis(lastSyncAt);
        }

        if (task.externalSource === null && task.externalId === null) {
          return true;
        }

        return false;
      });

      for (const localTask of changedLocalTasks) {
        if (options?.dryRun) {
          pushed += 1;
          continue;
        }

        try {
          if (localTask.externalId) {
            const updates = this.provider.mapToExternal(localTask);
            const updated = await this.provider.updateTask(localTask.externalId, updates);
            if (updated) {
              pushed += 1;
              this.syncState.lastPullHashes[localTask.externalId] = hashExternalTask(updated);
            } else {
              errors.push({ taskId: localTask.id, externalId: localTask.externalId, operation: "push", message: "Update failed" });
            }
          } else {
            const payload = this.provider.mapToExternal(localTask);
            const created = await this.provider.createTask({
              externalId: "",
              title: payload.title ?? localTask.title,
              description: payload.description ?? localTask.description,
              status: payload.status ?? (localTask.status === "done" ? "closed" : "open"),
              priority: payload.priority,
              project: payload.project,
              labels: payload.labels,
              dueDate: payload.dueDate,
              parentExternalId: payload.parentExternalId ?? null,
              subtaskExternalIds: payload.subtaskExternalIds ?? [],
              updatedAt: localTask.updatedAt,
              completedAt: payload.completedAt,
              url: payload.url,
            });

            if (created?.externalId) {
              localTask.externalId = created.externalId;
              localTask.externalSource = providerName;
              SyncStateManager.addMapping(this.syncState, localTask.id, created.externalId);
              pushed += 1;
            } else {
              errors.push({ taskId: localTask.id, operation: "push", message: "Create failed" });
            }
          }
        } catch (error) {
          errors.push({
            taskId: localTask.id,
            externalId: localTask.externalId ?? undefined,
            operation: "push",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    if (!options?.pushOnly) {
      const knownExternalIds = Object.keys(this.syncState.reverseIdMap);
      const remoteIds = new Set(remoteById.keys());

      for (const externalId of knownExternalIds) {
        if (remoteIds.has(externalId)) continue;

        const localId = SyncStateManager.getLocalId(this.syncState, externalId);
        if (!localId) continue;

        const localTask = this.store.tasks.find((task) => task.id === localId);
        if (!localTask || localTask.externalSource !== providerName) continue;

        if (options?.dryRun) {
          deleted += 1;
          continue;
        }

        const removed = this.store.deleteTask(localTask.id);
        if (removed) {
          deleted += 1;
          SyncStateManager.removeMapping(this.syncState, localTask.id);
          this.syncState.deletedRemotely = this.syncState.deletedRemotely.filter((id) => id !== externalId);
        }
      }
    }

    const nowIso = new Date().toISOString();
    if (!options?.dryRun) {
      this.syncState.lastSyncAt[providerName] = nowIso;
      await SyncStateManager.save(this.syncState);
      await this.store.save();
    }

    return {
      provider: providerName,
      pulled,
      pushed,
      deleted,
      conflicts,
      errors,
      timestamp: nowIso,
      durationMs: Date.now() - startedAt,
    };
  }

  async pullOnly(): Promise<SyncResult> {
    return this.sync({ pullOnly: true });
  }

  async pushOnly(): Promise<SyncResult> {
    return this.sync({ pushOnly: true });
  }
}

export function providerKeyToSource(provider: string): ExternalSource | null {
  switch (provider) {
    case "todoist":
    case "linear":
    case "asana":
    case "claude-code":
    case "codex":
    case "github-issues":
      return provider;
    case "github":
      return "github-issues";
    default:
      return null;
  }
}
