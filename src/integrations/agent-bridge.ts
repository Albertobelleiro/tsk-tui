import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TaskStore } from "../store/task-store.ts";
import type { Task, TaskPriority, TaskStatus } from "../store/types.ts";
import type { AgentConfig } from "../config/types.ts";
import type {
  AgentCommand,
  AgentResponse,
  CreatePayload,
  CreateSubtaskPayload,
  BulkCreatePayload,
  UpdatePayload,
  TaskIdPayload,
  QueryPayload,
  ListPayload,
  AddNotePayload,
} from "./agent-protocol.ts";
import { OUTBOX_MAX_ENTRIES } from "./agent-protocol.ts";

const DATA_DIR = join(homedir(), ".tsk");
const INBOX_FILE = join(DATA_DIR, "agent-inbox.json");
const OUTBOX_FILE = join(DATA_DIR, "agent-outbox.json");

// ── Partial ID resolution (mirrors CLI logic) ─────────

type ResolveResult =
  | { ok: true; task: Task }
  | { ok: false; error: string };

function resolveTaskId(tasks: Task[], partial: string): ResolveResult {
  if (!partial || partial.trim() === "") {
    return { ok: false, error: "Task ID cannot be empty" };
  }
  const matches = tasks.filter((t) => t.id.startsWith(partial));
  if (matches.length === 1) return { ok: true, task: matches[0]! };
  if (matches.length === 0) return { ok: false, error: `Task not found: "${partial}"` };
  return { ok: false, error: `Ambiguous ID "${partial}" matches ${matches.length} tasks` };
}

// ── Validators ────────────────────────────────────────

const VALID_PRIORITIES = new Set(["none", "low", "medium", "high", "urgent"]);
const VALID_STATUSES = new Set(["todo", "in_progress", "done", "archived"]);

// ── Event callback type ───────────────────────────────

export type AgentEventCallback = (event: {
  command: string;
  summary: string;
  status: "ok" | "error";
}) => void;

// ── Bridge ────────────────────────────────────────────

export class AgentBridge {
  private _store: TaskStore;
  private _pollIntervalMs: number;
  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _processedCount = 0;
  private _onEvent: AgentEventCallback | null = null;

  constructor(store: TaskStore, config: AgentConfig) {
    this._store = store;
    this._pollIntervalMs = config.pollIntervalMs ?? 2000;
  }

  // ── Lifecycle ─────────────────────────────────────

  async start(): Promise<void> {
    if (this._pollTimer) return;
    await mkdir(DATA_DIR, { recursive: true });

    // Ensure inbox exists
    const inboxFile = Bun.file(INBOX_FILE);
    if (!(await inboxFile.exists())) {
      await Bun.write(INBOX_FILE, "[]");
    }

    this._pollTimer = setInterval(async () => {
      try {
        await this.processInbox();
      } catch (e) {
        // Silently handle poll errors — don't crash
      }
    }, this._pollIntervalMs);

    // Process immediately on start
    await this.processInbox();
  }

  stop(): void {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  isRunning(): boolean {
    return this._pollTimer !== null;
  }

  get processedCount(): number {
    return this._processedCount;
  }

  get pollIntervalMs(): number {
    return this._pollIntervalMs;
  }

  /** Register a callback for processed commands (used by TUI for toasts) */
  onEvent(cb: AgentEventCallback): void {
    this._onEvent = cb;
  }

  // ── Inbox processing ──────────────────────────────

  async processInbox(): Promise<number> {
    const file = Bun.file(INBOX_FILE);
    if (!(await file.exists())) return 0;

    const text = await file.text();
    if (!text.trim() || text.trim() === "[]") return 0;

    let commands: AgentCommand[];
    try {
      const parsed = JSON.parse(text);
      commands = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      // Invalid JSON — clear inbox
      await Bun.write(INBOX_FILE, "[]");
      return 0;
    }

    if (commands.length === 0) return 0;

    const responses: AgentResponse[] = [];
    for (const cmd of commands) {
      if (!cmd || typeof cmd !== "object") continue;
      const response = await this.processCommand(cmd);
      responses.push(response);
      this._processedCount++;

      // Emit event
      if (this._onEvent) {
        const summary = this._summarize(cmd, response);
        this._onEvent({
          command: cmd.command,
          summary,
          status: response.status,
        });
      }
    }

    // Append to outbox
    if (responses.length > 0) {
      await this._appendToOutbox(responses);
    }

    // Clear inbox
    await Bun.write(INBOX_FILE, "[]");

    return commands.length;
  }

  // ── Command dispatch ──────────────────────────────

  async processCommand(cmd: AgentCommand): Promise<AgentResponse> {
    try {
      switch (cmd.command) {
        case "create":
          return this._handleCreate(cmd);
        case "create-subtask":
          return this._handleCreateSubtask(cmd);
        case "bulk-create":
          return this._handleBulkCreate(cmd);
        case "update":
          return this._handleUpdate(cmd);
        case "complete":
          return this._handleComplete(cmd);
        case "uncomplete":
          return this._handleUncomplete(cmd);
        case "delete":
          return this._handleDelete(cmd);
        case "query":
          return this._handleQuery(cmd);
        case "list":
          return this._handleList(cmd);
        case "show":
          return this._handleShow(cmd);
        case "list-projects":
          return this._ok(cmd.id, this._store.getProjects());
        case "list-tags":
          return this._ok(cmd.id, this._store.getTags());
        case "stats":
          return this._ok(cmd.id, this._store.getStats());
        case "add-note":
          return this._handleAddNote(cmd);
        case "start-timer":
          return this._handleStartTimer(cmd);
        case "stop-timer":
          return this._handleStopTimer(cmd);
        default:
          return this._error(cmd.id, `Unknown command: ${cmd.command}`);
      }
    } catch (e) {
      return this._error(cmd.id, e instanceof Error ? e.message : String(e));
    }
  }

  // ── Command handlers ──────────────────────────────

  private _handleCreate(cmd: AgentCommand): AgentResponse {
    const p = cmd.payload as unknown as CreatePayload;
    if (!p.title) return this._error(cmd.id, "Missing required field: title");

    const task = this._store.addTask({
      title: p.title,
      description: p.description,
      priority: p.priority && VALID_PRIORITIES.has(p.priority) ? p.priority : "none",
      project: p.project ?? null,
      tags: p.tags ?? [],
      dueDate: p.dueDate ?? null,
    });
    task.externalSource = cmd.source === "custom" ? null : cmd.source;
    this._store.flushPendingSave();
    return this._ok(cmd.id, this._taskSummary(task));
  }

  private _handleCreateSubtask(cmd: AgentCommand): AgentResponse {
    const p = cmd.payload as unknown as CreateSubtaskPayload;
    if (!p.parentId) return this._error(cmd.id, "Missing required field: parentId");
    if (!p.title) return this._error(cmd.id, "Missing required field: title");

    const resolved = resolveTaskId(this._store.tasks, String(p.parentId));
    if (!resolved.ok) return this._error(cmd.id, resolved.error);

    const subtask = this._store.addSubtask(resolved.task.id, {
      title: p.title,
      description: p.description,
      priority: p.priority && VALID_PRIORITIES.has(p.priority) ? p.priority : "none",
    });
    if (!subtask) return this._error(cmd.id, "Failed to create subtask");
    this._store.flushPendingSave();
    return this._ok(cmd.id, this._taskSummary(subtask));
  }

  private _handleBulkCreate(cmd: AgentCommand): AgentResponse {
    const p = cmd.payload as unknown as BulkCreatePayload;
    if (!p.tasks || !Array.isArray(p.tasks) || p.tasks.length === 0) {
      return this._error(cmd.id, "Missing or empty tasks array");
    }

    const created: ReturnType<typeof this._taskSummary>[] = [];
    for (const item of p.tasks) {
      if (!item.title) continue;
      const task = this._store.addTask({
        title: item.title,
        priority: item.priority && VALID_PRIORITIES.has(item.priority) ? item.priority as TaskPriority : "none",
        project: item.project ?? null,
        tags: item.tags ?? [],
        dueDate: item.dueDate ?? null,
      });
      task.externalSource = cmd.source === "custom" ? null : cmd.source;
      created.push(this._taskSummary(task));
    }
    this._store.flushPendingSave();
    return this._ok(cmd.id, { created: created.length, tasks: created });
  }

  private _handleUpdate(cmd: AgentCommand): AgentResponse {
    const p = cmd.payload as unknown as UpdatePayload;
    if (!p.taskId) return this._error(cmd.id, "Missing required field: taskId");

    const resolved = resolveTaskId(this._store.tasks, String(p.taskId));
    if (!resolved.ok) return this._error(cmd.id, resolved.error);

    const updates: Partial<Pick<Task, "title" | "description" | "priority" | "project" | "tags" | "dueDate" | "status">> = {};
    if (p.title !== undefined) updates.title = p.title;
    if (p.description !== undefined) updates.description = p.description;
    if (p.priority !== undefined && VALID_PRIORITIES.has(p.priority)) updates.priority = p.priority as TaskPriority;
    if (p.status !== undefined && VALID_STATUSES.has(p.status)) updates.status = p.status as TaskStatus;
    if (p.project !== undefined) updates.project = p.project || null;
    if (p.tags !== undefined) updates.tags = p.tags;
    if (p.dueDate !== undefined) updates.dueDate = p.dueDate || null;

    const updated = this._store.updateTask(resolved.task.id, updates);
    if (!updated) return this._error(cmd.id, "Failed to update task");
    this._store.flushPendingSave();
    return this._ok(cmd.id, this._taskSummary(updated));
  }

  private _handleComplete(cmd: AgentCommand): AgentResponse {
    const p = cmd.payload as unknown as TaskIdPayload;
    if (!p.taskId) return this._error(cmd.id, "Missing required field: taskId");

    const resolved = resolveTaskId(this._store.tasks, String(p.taskId));
    if (!resolved.ok) return this._error(cmd.id, resolved.error);

    if (resolved.task.status === "done") {
      return this._ok(cmd.id, { message: "Task already done", task: this._taskSummary(resolved.task) });
    }

    // Handle recurring tasks
    if (resolved.task.recurrence) {
      const nextTask = this._store.completeRecurring(resolved.task.id);
      this._store.flushPendingSave();
      return this._ok(cmd.id, {
        completed: this._taskSummary(resolved.task),
        nextOccurrence: nextTask ? this._taskSummary(nextTask) : null,
      });
    }

    this._store.moveToStatus(resolved.task.id, "done");
    this._store.flushPendingSave();
    return this._ok(cmd.id, this._taskSummary(resolved.task));
  }

  private _handleUncomplete(cmd: AgentCommand): AgentResponse {
    const p = cmd.payload as unknown as TaskIdPayload;
    if (!p.taskId) return this._error(cmd.id, "Missing required field: taskId");

    const resolved = resolveTaskId(this._store.tasks, String(p.taskId));
    if (!resolved.ok) return this._error(cmd.id, resolved.error);

    if (resolved.task.status !== "done") {
      return this._ok(cmd.id, { message: "Task is not done", task: this._taskSummary(resolved.task) });
    }

    this._store.moveToStatus(resolved.task.id, "todo");
    this._store.flushPendingSave();
    return this._ok(cmd.id, this._taskSummary(resolved.task));
  }

  private _handleDelete(cmd: AgentCommand): AgentResponse {
    const p = cmd.payload as unknown as TaskIdPayload;
    if (!p.taskId) return this._error(cmd.id, "Missing required field: taskId");

    const resolved = resolveTaskId(this._store.tasks, String(p.taskId));
    if (!resolved.ok) return this._error(cmd.id, resolved.error);

    const title = resolved.task.title;
    const ok = this._store.deleteTask(resolved.task.id);
    if (!ok) return this._error(cmd.id, "Failed to delete task");
    this._store.flushPendingSave();
    return this._ok(cmd.id, { deleted: true, title });
  }

  private _handleQuery(cmd: AgentCommand): AgentResponse {
    const p = cmd.payload as unknown as QueryPayload;
    let tasks = this._store.tasks.filter((t) => t.status !== "archived");

    // Status filter
    if (p.status) {
      const statuses = Array.isArray(p.status) ? p.status : [p.status];
      tasks = tasks.filter((t) => statuses.includes(t.status));
    }

    // Priority filter
    if (p.priority) {
      const priorities = Array.isArray(p.priority) ? p.priority : [p.priority];
      tasks = tasks.filter((t) => priorities.includes(t.priority));
    }

    // Project filter
    if (p.project) {
      tasks = tasks.filter((t) => t.project === p.project);
    }

    // Tag filter
    if (p.tag) {
      tasks = tasks.filter((t) => t.tags.includes(p.tag!));
    }

    // Search
    if (p.search) {
      const q = p.search.toLowerCase();
      tasks = tasks.filter((t) => {
        const searchIn = [t.title, t.description, t.project ?? "", ...t.tags].join(" ").toLowerCase();
        return searchIn.includes(q);
      });
    }

    // Limit
    if (p.limit && p.limit > 0) {
      tasks = tasks.slice(0, p.limit);
    }

    return this._ok(cmd.id, tasks.map((t) => this._taskSummary(t)));
  }

  private _handleList(cmd: AgentCommand): AgentResponse {
    const p = cmd.payload as unknown as ListPayload;
    let tasks = this._store.tasks.filter((t) => t.status !== "archived");
    if (p.limit && p.limit > 0) {
      tasks = tasks.slice(0, p.limit);
    }
    return this._ok(cmd.id, tasks.map((t) => this._taskSummary(t)));
  }

  private _handleShow(cmd: AgentCommand): AgentResponse {
    const p = cmd.payload as unknown as TaskIdPayload;
    if (!p.taskId) return this._error(cmd.id, "Missing required field: taskId");

    const resolved = resolveTaskId(this._store.tasks, String(p.taskId));
    if (!resolved.ok) return this._error(cmd.id, resolved.error);

    const task = resolved.task;
    const subtasks = this._store.getSubtasks(task.id);
    const progress = this._store.getProgress(task.id);

    return this._ok(cmd.id, {
      ...task,
      subtasks: subtasks.map((st) => this._taskSummary(st)),
      progress: subtasks.length > 0 ? progress : undefined,
    });
  }

  private _handleAddNote(cmd: AgentCommand): AgentResponse {
    const p = cmd.payload as unknown as AddNotePayload;
    if (!p.taskId) return this._error(cmd.id, "Missing required field: taskId");
    if (!p.content) return this._error(cmd.id, "Missing required field: content");

    const resolved = resolveTaskId(this._store.tasks, String(p.taskId));
    if (!resolved.ok) return this._error(cmd.id, resolved.error);

    const note = this._store.addNote(resolved.task.id, p.content, "sync");
    if (!note) return this._error(cmd.id, "Failed to add note");
    this._store.flushPendingSave();
    return this._ok(cmd.id, { taskId: resolved.task.id, note });
  }

  private _handleStartTimer(cmd: AgentCommand): AgentResponse {
    const p = cmd.payload as unknown as TaskIdPayload;
    if (!p.taskId) return this._error(cmd.id, "Missing required field: taskId");

    const resolved = resolveTaskId(this._store.tasks, String(p.taskId));
    if (!resolved.ok) return this._error(cmd.id, resolved.error);

    const ok = this._store.startTimer(resolved.task.id);
    if (!ok) return this._error(cmd.id, "Timer already running for this task");
    return this._ok(cmd.id, { taskId: resolved.task.id, message: "Timer started" });
  }

  private _handleStopTimer(cmd: AgentCommand): AgentResponse {
    const elapsed = this._store.stopTimer();
    this._store.flushPendingSave();
    return this._ok(cmd.id, { elapsed, message: `Timer stopped (${elapsed} minutes logged)` });
  }

  // ── Response helpers ──────────────────────────────

  private _ok(commandId: string, data: unknown): AgentResponse {
    return {
      commandId,
      status: "ok",
      data,
      timestamp: new Date().toISOString(),
    };
  }

  private _error(commandId: string, error: string): AgentResponse {
    return {
      commandId,
      status: "error",
      error,
      timestamp: new Date().toISOString(),
    };
  }

  /** Compact task summary for responses */
  private _taskSummary(task: Task) {
    return {
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      project: task.project,
      tags: task.tags,
      dueDate: task.dueDate,
      createdAt: task.createdAt,
      completedAt: task.completedAt,
    };
  }

  /** Human-readable summary for events */
  private _summarize(cmd: AgentCommand, response: AgentResponse): string {
    if (response.status === "error") return response.error ?? "Error";
    const title = (cmd.payload as Record<string, unknown>).title as string | undefined;
    switch (cmd.command) {
      case "create": return `created "${title}"`;
      case "create-subtask": return `added subtask "${title}"`;
      case "bulk-create": {
        const data = response.data as { created?: number } | undefined;
        return `created ${data?.created ?? 0} tasks`;
      }
      case "update": return "updated task";
      case "complete": return "completed task";
      case "uncomplete": return "reopened task";
      case "delete": return "deleted task";
      case "query": return "queried tasks";
      case "list": return "listed tasks";
      case "show": return "showed task";
      case "add-note": return "added note";
      case "start-timer": return "started timer";
      case "stop-timer": return "stopped timer";
      default: return cmd.command;
    }
  }

  // ── Outbox ────────────────────────────────────────

  private async _appendToOutbox(responses: AgentResponse[]): Promise<void> {
    let existing: AgentResponse[] = [];
    const outboxFile = Bun.file(OUTBOX_FILE);
    if (await outboxFile.exists()) {
      try {
        const text = await outboxFile.text();
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) existing = parsed;
      } catch {
        // Corrupted outbox — start fresh
      }
    }

    existing.push(...responses);

    // Enforce size limit — keep latest entries
    if (existing.length > OUTBOX_MAX_ENTRIES) {
      existing = existing.slice(existing.length - OUTBOX_MAX_ENTRIES);
    }

    await Bun.write(OUTBOX_FILE, JSON.stringify(existing, null, 2));
  }

  // ── Static paths (for CLI use) ────────────────────

  static get inboxPath(): string { return INBOX_FILE; }
  static get outboxPath(): string { return OUTBOX_FILE; }
  static get dataDir(): string { return DATA_DIR; }
}
