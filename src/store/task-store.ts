import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Task, TaskStatus, TaskPriority, FilterState } from "./types.ts";

const DATA_DIR = join(homedir(), ".tsk");
const DATA_FILE = join(DATA_DIR, "tasks.json");

const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  urgent: 4,
};

export class TaskStore {
  tasks: Task[] = [];

  private _previousState: Task[] | null = null;
  private _saveTimer: ReturnType<typeof setTimeout> | null = null;
  private _listeners = new Set<() => void>();

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
  }): Task {
    this._snapshot();
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
    };
    this.tasks.push(task);
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
    this._snapshot();
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
    this._snapshot();
    this.tasks.splice(idx, 1);
    this._notify();
    this._scheduleSave();
    return true;
  }

  // ── Status transitions ────────────────────────────────

  toggleDone(id: string): void {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) return;
    this._snapshot();
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
    this._snapshot();
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
    this._snapshot();
    const a = this.tasks[idx]!;
    const b = this.tasks[swapIdx]!;
    [a.order, b.order] = [b.order, a.order];
    this._notify();
    this._scheduleSave();
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
        if (!t.title.toLowerCase().includes(q) && !t.description.toLowerCase().includes(q)) return false;
      }
      return true;
    });

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
      this.tasks = parsed as Task[];
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

  // ── Undo ──────────────────────────────────────────────

  undo(): boolean {
    if (!this._previousState) return false;
    const current = this.tasks;
    this.tasks = this._previousState;
    this._previousState = current;
    this._notify();
    this._scheduleSave();
    return true;
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

  private _snapshot(): void {
    this._previousState = structuredClone(this.tasks);
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
}
