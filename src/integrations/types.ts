import type { ExternalSource, Task } from "../store/types.ts";

export interface ExternalTask {
  externalId: string;
  title: string;
  description?: string;
  status: "open" | "closed";
  priority?: number;
  project?: string;
  labels?: string[];
  dueDate?: string;
  parentExternalId?: string | null;
  subtaskExternalIds?: string[];
  updatedAt: string;
  completedAt?: string | null;
  url?: string;
}

export interface SyncProvider {
  readonly name: ExternalSource;

  isConnected(): Promise<boolean>;
  testConnection(): Promise<{ ok: boolean; user?: string; error?: string }>;

  fetchTasks(options?: { updatedSince?: string }): Promise<ExternalTask[]>;
  createTask(task: ExternalTask): Promise<ExternalTask | null>;
  updateTask(externalId: string, updates: Partial<ExternalTask>): Promise<ExternalTask | null>;
  completeTask(externalId: string): Promise<boolean>;
  reopenTask(externalId: string): Promise<boolean>;
  deleteTask(externalId: string): Promise<boolean>;

  supportsSubtasks: boolean;
  fetchSubtasks?(parentExternalId: string): Promise<ExternalTask[]>;
  createSubtask?(parentExternalId: string, task: ExternalTask): Promise<ExternalTask | null>;

  mapToLocal(external: ExternalTask): Partial<Task>;
  mapToExternal(task: Task): Partial<ExternalTask>;

  fetchProjects?(): Promise<Array<{ id: string; name: string }>>;
  fetchLabels?(): Promise<Array<{ id: string; name: string }>>;
}

export interface SyncError {
  taskId?: string;
  externalId?: string;
  operation: "pull" | "push" | "delete" | "map";
  message: string;
}

export interface SyncResult {
  provider: ExternalSource;
  pulled: number;
  pushed: number;
  deleted: number;
  conflicts: number;
  errors: SyncError[];
  timestamp: string;
  durationMs: number;
}

// Legacy compatibility aliases used by current provider stubs.
export type ExternalTaskInput = Partial<ExternalTask>;

export interface AgentCommand {
  id: string;
  timestamp: string;
  source: "claude-code" | "codex";
  command: "create" | "update" | "complete" | "query" | "bulk-create";
  payload: {
    title?: string;
    description?: string;
    project?: string;
    priority?: Task["priority"];
    subtasks?: string[];
    taskId?: string;
    updates?: Partial<Task>;
    filter?: Record<string, unknown>;
    tasks?: Array<{ title: string; priority?: string; project?: string }>;
  };
}

export interface AgentResponse {
  commandId: string;
  status: "ok" | "error";
  data?: Task | Task[];
  error?: string;
}
