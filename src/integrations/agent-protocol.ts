import type { Task, TaskPriority } from "../store/types.ts";

// ── Command types ─────────────────────────────────────

export type AgentCommandType =
  | "create"
  | "create-subtask"
  | "bulk-create"
  | "update"
  | "complete"
  | "uncomplete"
  | "delete"
  | "query"
  | "list"
  | "show"
  | "list-projects"
  | "list-tags"
  | "stats"
  | "add-note"
  | "start-timer"
  | "stop-timer";

export type AgentSource = "claude-code" | "codex" | "custom";

export interface AgentCommand {
  id: string;
  timestamp: string;
  source: AgentSource;
  command: AgentCommandType;
  payload: Record<string, unknown>;
}

// ── Typed payloads (for internal use / validation) ────

export interface CreatePayload {
  title: string;
  description?: string;
  priority?: TaskPriority;
  project?: string;
  tags?: string[];
  dueDate?: string;
}

export interface CreateSubtaskPayload {
  parentId: string;
  title: string;
  description?: string;
  priority?: TaskPriority;
}

export interface BulkCreatePayload {
  tasks: Array<{
    title: string;
    priority?: string;
    project?: string;
    tags?: string[];
    dueDate?: string;
  }>;
}

export interface UpdatePayload {
  taskId: string;
  title?: string;
  description?: string;
  priority?: string;
  status?: string;
  project?: string;
  tags?: string[];
  dueDate?: string;
}

export interface TaskIdPayload {
  taskId: string;
}

export interface QueryPayload {
  status?: string | string[];
  priority?: string | string[];
  project?: string;
  tag?: string;
  search?: string;
  limit?: number;
}

export interface ListPayload {
  limit?: number;
}

export interface AddNotePayload {
  taskId: string;
  content: string;
}

// ── Response ──────────────────────────────────────────

export interface AgentResponse {
  commandId: string;
  status: "ok" | "error";
  data?: unknown;
  error?: string;
  timestamp: string;
}

// ── Outbox size limit ─────────────────────────────────

export const OUTBOX_MAX_ENTRIES = 100;
