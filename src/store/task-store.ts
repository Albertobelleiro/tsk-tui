import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  Task, TaskStatus, TaskPriority, FilterState,
  TaskNote, RecurrenceRule, TaskTreeNode, UndoEntry,
} from "./types.ts";

const DATA_DIR = join(homedir(), ".tsk");
const DATA_FILE = join(DATA_DIR, "tasks.json");

const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  urgent: 4,
};

const MAX_UNDO = 50;

export class TaskStore {
  tasks: Task[] = [];

  private _undoStack: UndoEntry[] = [];
  private _redoStack: UndoEntry[] = [];
  private _saveTimer: ReturnType<typeof setTimeout> | null = null;
  private _listeners = new Set<() => void>();

  // v0.2 — Active timer state (not persisted)
  activeTimerTaskId: string | null = null;
  activeTimerStart: number | null = null;

  private constructor() {}

  static async create(): Promise<TaskStore> {
    const store = new TaskStore();
    await store.load();
    return store;
  }

  // ── CRUD ──────────────────────────────────────────────

  addTask(input: {
    title: string;
    description?: string;
    priority?: TaskPriority;
    project?: string | null;
    tags?: string[];
    dueDate?: string | null;
    parentId?: string | null;
    recurrence?: RecurrenceRule | null;
    estimateMinutes?: number | null;
  }): Task {
    this._snapshot("Add task");
    const now = new Date().toISOString();
    const task: Task = {
      id: crypto.randomUUID(),
      title: input.title.slice(0, 200),
      description: input.description ?? "",
      status: "todo",
      priority: input.priority ?? "none",
      project: input.project ?? null,
      tags: input.tags ?? [],
      dueDate: input.dueDate ?? null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      order: this.tasks.reduce((max, t) => Math.max(max, t.order), -1) + 1,
      parentId: input.parentId ?? null,
      subtaskIds: [],
      blockedBy: [],
      recurrence: input.recurrence ?? null,
      estimateMinutes: input.estimateMinutes ?? null,
      actualMinutes: null,
      notes: [],
      externalId: null,
      externalSource: null,
    };
    this.tasks.push(task);

    // If parent specified, add to parent's subtaskIds
    if (task.parentId) {
      const parent = this.tasks.find((t) => t.id === task.parentId);
      if (parent) {
        parent.subtaskIds.push(task.id);
        parent.updatedAt = now;
      }
    }

    this._notify();
    this._scheduleSave();
    return task;
  }

  updateTask(
    id: string,
    updates: Partial<Pick<Task, "title" | "description" | "priority" | "project" | "tags" | "dueDate" | "status">>,
  ): Task | null {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) return null;
    this._snapshot("Update task");
    if (updates.title !== undefined) task.title = updates.title.slice(0, 200);
    if (updates.description !== undefined) task.description = updates.description;
    if (updates.priority !== undefined) task.priority = updates.priority;
    if (updates.project !== undefined) task.project = updates.project;
    if (updates.tags !== undefined) task.tags = updates.tags;
    if (updates.dueDate !== undefined) task.dueDate = updates.dueDate;
    if (updates.status !== undefined) task.status = updates.status;
    task.updatedAt = new Date().toISOString();
    this._notify();
    this._scheduleSave();
    return task;
  }

  deleteTask(id: string): boolean {
    const idx = this.tasks.findIndex((t) => t.id === id);
    if (idx === -1) return false;
    this._snapshot("Delete task");
    const task = this.tasks[idx]!;

    // Remove from parent's subtaskIds
    if (task.parentId) {
      const parent = this.tasks.find((t) => t.id === task.parentId);
      if (parent) {
        parent.subtaskIds = parent.subtaskIds.filter((sid) => sid !== id);
        parent.updatedAt = new Date().toISOString();
      }
    }

    // Also delete subtasks recursively
    const toDelete = this._collectSubtreeIds(id);
    this.tasks = this.tasks.filter((t) => !toDelete.has(t.id));

    this._notify();
    this._scheduleSave();
    return true;
  }

  // ── Status transitions ────────────────────────────────

  toggleDone(id: string): void {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) return;
    this._snapshot("Toggle done");
    if (task.status === "done") {
      task.status = "todo";
      task.completedAt = null;
    } else {
      task.status = "done";
      task.completedAt = new Date().toISOString();
    }
    task.updatedAt = new Date().toISOString();
    this._notify();
    this._scheduleSave();
  }

  moveToStatus(id: string, status: TaskStatus): void {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) return;
    this._snapshot("Change status");
    task.status = status;
    task.updatedAt = new Date().toISOString();
    if (status === "done") {
      task.completedAt = new Date().toISOString();
    } else {
      task.completedAt = null;
    }
    this._notify();
    this._scheduleSave();
  }

  // ── Ordering ──────────────────────────────────────────

  reorder(id: string, direction: "up" | "down"): void {
    const idx = this.tasks.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= this.tasks.length) return;
    this._snapshot("Reorder");
    const a = this.tasks[idx]!;
    const b = this.tasks[swapIdx]!;
    [a.order, b.order] = [b.order, a.order];
    this._notify();
    this._scheduleSave();
  }

  // ── Subtask operations ────────────────────────────────

  addSubtask(parentId: string, input: {
    title: string;
    description?: string;
    priority?: TaskPriority;
    project?: string | null;
    tags?: string[];
    dueDate?: string | null;
  }): Task | null {
    const parent = this.tasks.find((t) => t.id === parentId);
    if (!parent) return null;
    return this.addTask({ ...input, parentId });
  }

  removeSubtask(parentId: string, subtaskId: string): boolean {
    const parent = this.tasks.find((t) => t.id === parentId);
    if (!parent) return false;
    if (!parent.subtaskIds.includes(subtaskId)) return false;
    return this.deleteTask(subtaskId);
  }

  promoteSubtask(subtaskId: string): boolean {
    const task = this.tasks.find((t) => t.id === subtaskId);
    if (!task || !task.parentId) return false;
    this._snapshot("Promote subtask");
    const parent = this.tasks.find((t) => t.id === task.parentId);
    if (parent) {
      parent.subtaskIds = parent.subtaskIds.filter((sid) => sid !== subtaskId);
      parent.updatedAt = new Date().toISOString();
    }
    task.parentId = null;
    task.updatedAt = new Date().toISOString();
    this._notify();
    this._scheduleSave();
    return true;
  }

  indentTask(taskId: string, newParentId: string): boolean {
    const task = this.tasks.find((t) => t.id === taskId);
    const newParent = this.tasks.find((t) => t.id === newParentId);
    if (!task || !newParent) return false;
    if (taskId === newParentId) return false;
    // Prevent circular: newParent can't be a descendant of taskId
    if (this._isDescendant(newParentId, taskId)) return false;

    this._snapshot("Indent task");
    const now = new Date().toISOString();

    // Remove from old parent
    if (task.parentId) {
      const oldParent = this.tasks.find((t) => t.id === task.parentId);
      if (oldParent) {
        oldParent.subtaskIds = oldParent.subtaskIds.filter((sid) => sid !== taskId);
        oldParent.updatedAt = now;
      }
    }

    task.parentId = newParentId;
    task.updatedAt = now;
    newParent.subtaskIds.push(taskId);
    newParent.updatedAt = now;
    this._notify();
    this._scheduleSave();
    return true;
  }

  getSubtasks(parentId: string): Task[] {
    const parent = this.tasks.find((t) => t.id === parentId);
    if (!parent) return [];
    return parent.subtaskIds
      .map((sid) => this.tasks.find((t) => t.id === sid))
      .filter((t): t is Task => t != null);
  }

  getProgress(taskId: string): { done: number; total: number } {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task || task.subtaskIds.length === 0) return { done: 0, total: 0 };
    const subtasks = this.getSubtasks(taskId);
    return {
      done: subtasks.filter((t) => t.status === "done").length,
      total: subtasks.length,
    };
  }

  getTopLevelTasks(): Task[] {
    return this.tasks.filter((t) => t.parentId === null);
  }

  getTaskTree(rootId?: string): TaskTreeNode[] {
    const build = (parentId: string | null, depth: number): TaskTreeNode[] => {
      const children = this.tasks.filter((t) => t.parentId === parentId);
      return children.map((task) => ({
        task,
        children: build(task.id, depth + 1),
        depth,
      }));
    };
    if (rootId) {
      const root = this.tasks.find((t) => t.id === rootId);
      if (!root) return [];
      return [{
        task: root,
        children: build(root.id, 1),
        depth: 0,
      }];
    }
    return build(null, 0);
  }

  // ── Notes ──────────────────────────────────────────────

  addNote(taskId: string, content: string, source: "user" | "sync" = "user"): TaskNote | null {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) return null;
    this._snapshot("Add note");
    const note: TaskNote = {
      id: crypto.randomUUID(),
      content,
      createdAt: new Date().toISOString(),
      source,
    };
    task.notes.push(note);
    task.updatedAt = new Date().toISOString();
    this._notify();
    this._scheduleSave();
    return note;
  }

  deleteNote(taskId: string, noteId: string): boolean {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) return false;
    const idx = task.notes.findIndex((n) => n.id === noteId);
    if (idx === -1) return false;
    this._snapshot("Delete note");
    task.notes.splice(idx, 1);
    task.updatedAt = new Date().toISOString();
    this._notify();
    this._scheduleSave();
    return true;
  }

  // ── Recurrence ─────────────────────────────────────────

  setRecurrence(taskId: string, rule: RecurrenceRule | null): boolean {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) return false;
    this._snapshot("Set recurrence");
    task.recurrence = rule;
    task.updatedAt = new Date().toISOString();
    this._notify();
    this._scheduleSave();
    return true;
  }

  completeRecurring(taskId: string): Task | null {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task || !task.recurrence) return null;

    // Mark current as done
    this._snapshot("Complete recurring");
    task.status = "done";
    task.completedAt = new Date().toISOString();
    task.updatedAt = new Date().toISOString();

    // Compute next due date
    const nextDue = this._computeNextDue(task.dueDate, task.recurrence);
    if (task.recurrence.endDate && nextDue > task.recurrence.endDate) {
      // Past end date, no new occurrence
      this._notify();
      this._scheduleSave();
      return null;
    }

    // Create next occurrence
    const nextTask = this.addTask({
      title: task.title,
      description: task.description,
      priority: task.priority,
      project: task.project,
      tags: [...task.tags],
      dueDate: nextDue,
      parentId: task.parentId,
      recurrence: { ...task.recurrence, nextDue },
      estimateMinutes: task.estimateMinutes,
    });

    return nextTask;
  }

  // ── Time tracking ──────────────────────────────────────

  setEstimate(taskId: string, minutes: number | null): boolean {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) return false;
    this._snapshot("Set estimate");
    task.estimateMinutes = minutes;
    task.updatedAt = new Date().toISOString();
    this._notify();
    this._scheduleSave();
    return true;
  }

  logTime(taskId: string, minutes: number): boolean {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) return false;
    this._snapshot("Log time");
    task.actualMinutes = (task.actualMinutes ?? 0) + minutes;
    task.updatedAt = new Date().toISOString();
    this._notify();
    this._scheduleSave();
    return true;
  }

  startTimer(taskId: string): boolean {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) return false;
    if (this.activeTimerTaskId === taskId) return false; // already running
    // Stop existing timer if running
    if (this.activeTimerTaskId) {
      this.stopTimer();
    }
    this.activeTimerTaskId = taskId;
    this.activeTimerStart = Date.now();
    // Auto-set to in_progress
    if (task.status === "todo") {
      task.status = "in_progress";
      task.updatedAt = new Date().toISOString();
    }
    this._notify();
    return true;
  }

  stopTimer(): number {
    if (!this.activeTimerTaskId || !this.activeTimerStart) return 0;
    const elapsed = Math.round((Date.now() - this.activeTimerStart) / 60000);
    if (elapsed > 0) {
      this.logTime(this.activeTimerTaskId, elapsed);
    }
    this.activeTimerTaskId = null;
    this.activeTimerStart = null;
    this._notify();
    return elapsed;
  }

  // ── Dependencies ───────────────────────────────────────

  addBlocker(taskId: string, blockerId: string): boolean {
    const task = this.tasks.find((t) => t.id === taskId);
    const blocker = this.tasks.find((t) => t.id === blockerId);
    if (!task || !blocker) return false;
    if (task.blockedBy.includes(blockerId)) return false;
    this._snapshot("Add blocker");
    task.blockedBy.push(blockerId);
    task.updatedAt = new Date().toISOString();
    this._notify();
    this._scheduleSave();
    return true;
  }

  removeBlocker(taskId: string, blockerId: string): boolean {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) return false;
    const idx = task.blockedBy.indexOf(blockerId);
    if (idx === -1) return false;
    this._snapshot("Remove blocker");
    task.blockedBy.splice(idx, 1);
    task.updatedAt = new Date().toISOString();
    this._notify();
    this._scheduleSave();
    return true;
  }

  isBlocked(taskId: string): boolean {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task || task.blockedBy.length === 0) return false;
    return task.blockedBy.some((bid) => {
      const blocker = this.tasks.find((t) => t.id === bid);
      return blocker && blocker.status !== "done" && blocker.status !== "archived";
    });
  }

  getUnblockedTasks(taskId: string): string[] {
    // Returns task IDs that were just unblocked by completing taskId
    return this.tasks
      .filter((t) => t.blockedBy.includes(taskId) && !this.isBlocked(t.id))
      .map((t) => t.id);
  }

  // ── Queries ───────────────────────────────────────────

  getFiltered(filter: FilterState): Task[] {
    let result = this.tasks.filter((t) => {
      // Status filter
      if (filter.status !== "all") {
        if (!filter.status.includes(t.status)) return false;
      } else {
        if (t.status === "archived") return false;
      }
      // Priority filter
      if (filter.priority !== "all") {
        if (!filter.priority.includes(t.priority)) return false;
      }
      // Project filter
      if (filter.project !== null && t.project !== filter.project) return false;
      // Tag filter
      if (filter.tag !== null && !t.tags.includes(filter.tag)) return false;
      // Search
      if (filter.search) {
        const q = filter.search.toLowerCase();
        const searchIn = [t.title, t.description, t.project ?? "", ...t.tags, ...t.notes.map((n) => n.content)].join(" ").toLowerCase();
        if (!searchIn.includes(q)) return false;
      }
      return true;
    });

    // Filter by top-level vs all
    if (filter.showSubtasks === false) {
      result = result.filter((t) => t.parentId === null);
    }

    const onlyDone =
      Array.isArray(filter.status) &&
      filter.status.length === 1 &&
      filter.status[0] === "done";

    result.sort((a, b) => {
      // Done tasks to bottom unless filtering specifically for done
      if (!onlyDone) {
        if (a.status === "done" && b.status !== "done") return 1;
        if (a.status !== "done" && b.status === "done") return -1;
      }

      // Primary sort
      let cmp = 0;
      switch (filter.sortBy) {
        case "priority":
          cmp = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
          if (filter.sortDirection === "asc") cmp = -cmp;
          break;
        case "dueDate": {
          const ad = a.dueDate;
          const bd = b.dueDate;
          if (ad && bd) cmp = ad < bd ? -1 : ad > bd ? 1 : 0;
          else if (ad) cmp = -1;
          else if (bd) cmp = 1;
          if (filter.sortDirection === "desc") cmp = -cmp;
          break;
        }
        case "createdAt":
          cmp = a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
          if (filter.sortDirection === "desc") cmp = -cmp;
          break;
        case "title":
          cmp = a.title.localeCompare(b.title);
          if (filter.sortDirection === "desc") cmp = -cmp;
          break;
        case "order":
          cmp = a.order - b.order;
          if (filter.sortDirection === "desc") cmp = -cmp;
          break;
      }
      if (cmp !== 0) return cmp;

      // Secondary: dueDate earliest first, then createdAt oldest first
      const ad = a.dueDate;
      const bd = b.dueDate;
      if (ad && bd) {
        if (ad < bd) return -1;
        if (ad > bd) return 1;
      } else if (ad) return -1;
      else if (bd) return 1;

      return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
    });

    return result;
  }

  /** Get filtered tasks as a flat list with tree ordering (parents before children, indented) */
  getFilteredTree(filter: FilterState): Array<{ task: Task; depth: number; isLast: boolean }> {
    const filtered = this.getFiltered(filter);
    const filteredIds = new Set(filtered.map((t) => t.id));

    const result: Array<{ task: Task; depth: number; isLast: boolean }> = [];

    const addWithChildren = (parentId: string | null, depth: number) => {
      const children = filtered.filter((t) => t.parentId === parentId);
      children.forEach((task, i) => {
        result.push({ task, depth, isLast: i === children.length - 1 });
        addWithChildren(task.id, depth + 1);
      });
    };

    addWithChildren(null, 0);

    // Add orphaned subtasks (parent not in filtered set) at top level
    for (const task of filtered) {
      if (task.parentId && !filteredIds.has(task.parentId) && !result.some((r) => r.task.id === task.id)) {
        result.push({ task, depth: 0, isLast: true });
      }
    }

    return result;
  }

  getByProject(project: string): Task[] {
    return this.tasks.filter((t) => t.project === project);
  }

  getByDate(date: string): Task[] {
    return this.tasks.filter((t) => t.dueDate === date);
  }

  getProjects(): string[] {
    const set = new Set<string>();
    for (const t of this.tasks) {
      if (t.project) set.add(t.project);
    }
    return [...set].sort();
  }

  getTags(): string[] {
    const set = new Set<string>();
    for (const t of this.tasks) {
      for (const tag of t.tags) set.add(tag);
    }
    return [...set].sort();
  }

  getStats(): { total: number; todo: number; inProgress: number; done: number } {
    let todo = 0;
    let inProgress = 0;
    let done = 0;
    for (const t of this.tasks) {
      if (t.status === "todo") todo++;
      else if (t.status === "in_progress") inProgress++;
      else if (t.status === "done") done++;
    }
    return { total: todo + inProgress + done, todo, inProgress, done };
  }

  // ── Persistence ───────────────────────────────────────

  async save(): Promise<void> {
    await mkdir(DATA_DIR, { recursive: true });
    await Bun.write(DATA_FILE, JSON.stringify(this.tasks, null, 2));
  }

  async load(): Promise<void> {
    await mkdir(DATA_DIR, { recursive: true });
    const file = Bun.file(DATA_FILE);
    if (!(await file.exists())) {
      this.tasks = [];
      await this.save();
      return;
    }
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error("Expected array");
      // Migrate v0.1 tasks to v0.2
      this.tasks = (parsed as Record<string, unknown>[]).map(migrateTask);
    } catch {
      console.error("[tsk] Corrupted tasks.json — backing up and starting fresh.");
      try {
        const raw = await Bun.file(DATA_FILE).arrayBuffer();
        await Bun.write(DATA_FILE + ".bak", raw);
      } catch { /* backup failed, continue anyway */ }
      this.tasks = [];
      await this.save();
    }
  }

  // ── Undo / Redo ────────────────────────────────────────

  undo(): boolean {
    if (this._undoStack.length === 0) return false;
    const entry = this._undoStack.pop()!;
    this._redoStack.push({
      description: entry.description,
      snapshot: structuredClone(this.tasks),
    });
    this.tasks = entry.snapshot;
    this._notify();
    this._scheduleSave();
    return true;
  }

  redo(): boolean {
    if (this._redoStack.length === 0) return false;
    const entry = this._redoStack.pop()!;
    this._undoStack.push({
      description: entry.description,
      snapshot: structuredClone(this.tasks),
    });
    this.tasks = entry.snapshot;
    this._notify();
    this._scheduleSave();
    return true;
  }

  get undoCount(): number {
    return this._undoStack.length;
  }

  get redoCount(): number {
    return this._redoStack.length;
  }

  get undoHistory(): UndoEntry[] {
    return this._undoStack;
  }

  // ── Subscription (useSyncExternalStore) ───────────────

  subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };

  getSnapshot = (): Task[] => {
    return this.tasks;
  };

  // ── Private ───────────────────────────────────────────

  private _snapshot(description: string = "action"): void {
    this._undoStack.push({
      description,
      snapshot: structuredClone(this.tasks),
    });
    if (this._undoStack.length > MAX_UNDO) {
      this._undoStack.shift();
    }
    // New mutation clears redo stack
    this._redoStack = [];
  }

  private _notify(): void {
    for (const fn of this._listeners) fn();
  }

  private _scheduleSave(): void {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this.save().catch((e) => console.error("[tsk] Save failed:", e));
    }, 300);
  }

  private _collectSubtreeIds(id: string): Set<string> {
    const ids = new Set<string>([id]);
    const queue = [id];
    while (queue.length > 0) {
      const current = queue.pop()!;
      const task = this.tasks.find((t) => t.id === current);
      if (task) {
        for (const sid of task.subtaskIds) {
          if (!ids.has(sid)) {
            ids.add(sid);
            queue.push(sid);
          }
        }
      }
    }
    return ids;
  }

  private _isDescendant(potentialDescendant: string, ancestorId: string): boolean {
    const task = this.tasks.find((t) => t.id === potentialDescendant);
    if (!task) return false;
    let current = task;
    while (current.parentId) {
      if (current.parentId === ancestorId) return true;
      const parent = this.tasks.find((t) => t.id === current.parentId);
      if (!parent) break;
      current = parent;
    }
    return false;
  }

  private _computeNextDue(currentDue: string | null, rule: RecurrenceRule): string {
    const base = currentDue ? new Date(currentDue) : new Date();
    const interval = rule.interval || 1;

    switch (rule.frequency) {
      case "daily":
        base.setDate(base.getDate() + interval);
        break;
      case "weekly":
        base.setDate(base.getDate() + (7 * interval));
        break;
      case "monthly":
        base.setMonth(base.getMonth() + interval);
        if (rule.dayOfMonth) {
          base.setDate(Math.min(rule.dayOfMonth, new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate()));
        }
        break;
      case "yearly":
        base.setFullYear(base.getFullYear() + interval);
        break;
    }

    const m = String(base.getMonth() + 1).padStart(2, "0");
    const d = String(base.getDate()).padStart(2, "0");
    return `${base.getFullYear()}-${m}-${d}`;
  }
}

// ── Migration: v0.1 → v0.2 ──────────────────────────

function migrateTask(raw: Record<string, unknown>): Task {
  return {
    id: (raw.id as string) ?? crypto.randomUUID(),
    title: (raw.title as string) ?? "",
    description: (raw.description as string) ?? "",
    status: (raw.status as TaskStatus) ?? "todo",
    priority: (raw.priority as TaskPriority) ?? "none",
    project: (raw.project as string | null) ?? null,
    tags: (raw.tags as string[]) ?? [],
    dueDate: (raw.dueDate as string | null) ?? null,
    createdAt: (raw.createdAt as string) ?? new Date().toISOString(),
    updatedAt: (raw.updatedAt as string) ?? new Date().toISOString(),
    completedAt: (raw.completedAt as string | null) ?? null,
    order: (raw.order as number) ?? 0,
    // v0.2 fields with defaults
    parentId: (raw.parentId as string | null) ?? null,
    subtaskIds: (raw.subtaskIds as string[]) ?? [],
    blockedBy: (raw.blockedBy as string[]) ?? [],
    recurrence: (raw.recurrence as RecurrenceRule | null) ?? null,
    estimateMinutes: (raw.estimateMinutes as number | null) ?? null,
    actualMinutes: (raw.actualMinutes as number | null) ?? null,
    notes: (raw.notes as TaskNote[]) ?? [],
    externalId: (raw.externalId as string | null) ?? null,
    externalSource: (raw.externalSource as Task["externalSource"]) ?? null,
  };
}
