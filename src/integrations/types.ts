import type { Task, TaskPriority, ExternalSource } from "../store/types.ts";

// ── External task representation ─────────────────────

export interface ExternalTask {
  externalId: string;
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  project?: string;
  tags?: string[];
  dueDate?: string | null;
  completedAt?: string | null;
  updatedAt?: string;
  subtasks?: ExternalTask[];
}

export interface ExternalTaskInput {
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  project?: string;
  tags?: string[];
  dueDate?: string | null;
}

// ── Sync results ─────────────────────────────────────

export interface SyncResult {
  pulled: number;
  pushed: number;
  conflicts: number;
  errors: string[];
}

// ── Sync provider interface ──────────────────────────

export interface SyncProvider {
  name: ExternalSource;
  pull(): Promise<ExternalTask[]>;
  push(tasks: Task[]): Promise<SyncResult>;
  mapToTask(external: ExternalTask): Partial<Task>;
  mapFromTask(task: Task): ExternalTaskInput;
}

// ── Sync config ──────────────────────────────────────

export interface SyncConfig {
  provider: ExternalSource;
  lastSyncAt: string | null;
  autoSync: boolean;
  syncIntervalMinutes: number;
}

// ── Agent bridge protocol ────────────────────────────

export interface AgentCommand {
  id: string;
  timestamp: string;
  source: "claude-code" | "codex";
  command: "create" | "update" | "complete" | "query" | "bulk-create";
  payload: {
    title?: string;
    description?: string;
    project?: string;
    priority?: TaskPriority;
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
