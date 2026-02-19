// ── Subtask & external types ─────────────────────────

export interface TaskNote {
  id: string;
  content: string;
  createdAt: string;
  source: "user" | "sync";
}

export interface RecurrenceRule {
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  interval: number;
  daysOfWeek?: number[];      // 0=Mon..6=Sun
  dayOfMonth?: number;        // 1-31
  endDate?: string | null;
  nextDue?: string;
}

export type ExternalSource = "todoist" | "linear" | "asana" | "claude-code" | "codex" | "github-issues";

// ── Task interface ───────────────────────────────────

export interface Task {
  id: string;
  title: string;
  description: string;
  status: "todo" | "in_progress" | "done" | "archived";
  priority: "none" | "low" | "medium" | "high" | "urgent";
  project: string | null;
  tags: string[];
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  order: number;

  // v0.2 — Subtask support
  parentId: string | null;
  subtaskIds: string[];

  // v0.2 — Dependencies
  blockedBy: string[];

  // v0.2 — Recurrence
  recurrence: RecurrenceRule | null;

  // v0.2 — Time estimates
  estimateMinutes: number | null;
  actualMinutes: number | null;

  // v0.2 — Notes/comments
  notes: TaskNote[];

  // v0.2 — External sync
  externalId: string | null;
  externalSource: ExternalSource | null;
}

export type TaskStatus = Task["status"];
export type TaskPriority = Task["priority"];

// ── Task tree node (for rendering) ──────────────────

export interface TaskTreeNode {
  task: Task;
  children: TaskTreeNode[];
  depth: number;
}

// ── Filter state ─────────────────────────────────────

export interface FilterState {
  status: TaskStatus[] | "all";
  priority: TaskPriority[] | "all";
  project: string | null;
  tag: string | null;
  search: string;
  sortBy: "priority" | "dueDate" | "createdAt" | "title" | "order";
  sortDirection: "asc" | "desc";
  showSubtasks?: boolean;      // true = nested, false = flat top-level only
}

export type SortField = FilterState["sortBy"];

export const DEFAULT_FILTER: FilterState = {
  status: "all",
  priority: "all",
  project: null,
  tag: null,
  search: "",
  sortBy: "priority",
  sortDirection: "desc",
  showSubtasks: true,
};

// ── Undo entry ───────────────────────────────────────

export interface UndoEntry {
  description: string;
  snapshot: Task[];
}
