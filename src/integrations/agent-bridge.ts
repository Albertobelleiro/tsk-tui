import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TaskStore } from "../store/task-store.ts";
import type { TaskPriority } from "../store/types.ts";
import type { AgentCommand, AgentResponse } from "./types.ts";

const DATA_DIR = join(homedir(), ".tsk");
const INBOX_FILE = join(DATA_DIR, "agent-inbox.json");
const OUTBOX_FILE = join(DATA_DIR, "agent-outbox.json");

export class AgentBridge {
  private store: TaskStore;
  private pollInterval: number;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastProcessedId: string | null = null;

  constructor(store: TaskStore, pollIntervalMs: number = 2000) {
    this.store = store;
    this.pollInterval = pollIntervalMs;
  }

  /** Start listening for agent commands */
  async start(): Promise<void> {
    await mkdir(DATA_DIR, { recursive: true });
    // Create empty inbox if it doesn't exist
    const inboxFile = Bun.file(INBOX_FILE);
    if (!(await inboxFile.exists())) {
      await Bun.write(INBOX_FILE, "[]");
    }

    this.pollTimer = setInterval(() => {
      this.poll().catch((e) => console.error("[agent-bridge] Poll error:", e));
    }, this.pollInterval);

    // Initial poll
    await this.poll();
  }

  /** Stop listening */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  get isActive(): boolean {
    return this.pollTimer !== null;
  }

  /** Process a single command */
  async processCommand(cmd: AgentCommand): Promise<AgentResponse> {
    try {
      switch (cmd.command) {
        case "create": {
          const task = this.store.addTask({
            title: cmd.payload.title ?? "Untitled",
            description: cmd.payload.description,
            priority: (cmd.payload.priority as TaskPriority) ?? "none",
            project: cmd.payload.project ?? null,
          });
          // Create subtasks if provided
          if (cmd.payload.subtasks && cmd.payload.subtasks.length > 0) {
            for (const subtitle of cmd.payload.subtasks) {
              this.store.addSubtask(task.id, { title: subtitle });
            }
          }
          task.externalSource = cmd.source;
          await this.store.save();
          return { commandId: cmd.id, status: "ok", data: task };
        }

        case "update": {
          if (!cmd.payload.taskId) {
            return { commandId: cmd.id, status: "error", error: "Missing taskId" };
          }
          const task = this.store.tasks.find((t) => t.id === cmd.payload.taskId || t.id.startsWith(cmd.payload.taskId!));
          if (!task) {
            return { commandId: cmd.id, status: "error", error: "Task not found" };
          }
          if (cmd.payload.updates) {
            this.store.updateTask(task.id, cmd.payload.updates as Parameters<typeof this.store.updateTask>[1]);
          }
          await this.store.save();
          return { commandId: cmd.id, status: "ok", data: task };
        }

        case "complete": {
          if (!cmd.payload.taskId) {
            return { commandId: cmd.id, status: "error", error: "Missing taskId" };
          }
          const task = this.store.tasks.find((t) => t.id === cmd.payload.taskId || t.id.startsWith(cmd.payload.taskId!));
          if (!task) {
            return { commandId: cmd.id, status: "error", error: "Task not found" };
          }
          this.store.toggleDone(task.id);
          await this.store.save();
          return { commandId: cmd.id, status: "ok", data: task };
        }

        case "query": {
          const tasks = this.store.tasks.filter((t) => t.status !== "archived");
          return { commandId: cmd.id, status: "ok", data: tasks };
        }

        case "bulk-create": {
          if (!cmd.payload.tasks || cmd.payload.tasks.length === 0) {
            return { commandId: cmd.id, status: "error", error: "No tasks provided" };
          }
          const created = [];
          for (const item of cmd.payload.tasks) {
            const task = this.store.addTask({
              title: item.title,
              priority: (item.priority as TaskPriority) ?? "none",
              project: item.project ?? null,
            });
            task.externalSource = cmd.source;
            created.push(task);
          }
          await this.store.save();
          return { commandId: cmd.id, status: "ok", data: created };
        }

        default:
          return { commandId: cmd.id, status: "error", error: `Unknown command: ${cmd.command}` };
      }
    } catch (err) {
      return {
        commandId: cmd.id,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** Poll inbox for new commands */
  private async poll(): Promise<void> {
    const inboxFile = Bun.file(INBOX_FILE);
    if (!(await inboxFile.exists())) return;

    try {
      const text = await inboxFile.text();
      if (!text.trim() || text.trim() === "[]") return;

      let commands: AgentCommand[];
      try {
        const parsed = JSON.parse(text);
        commands = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return; // Invalid JSON, skip
      }

      if (commands.length === 0) return;

      const responses: AgentResponse[] = [];

      for (const cmd of commands) {
        if (!cmd.id || cmd.id === this.lastProcessedId) continue;
        const response = await this.processCommand(cmd);
        responses.push(response);
        this.lastProcessedId = cmd.id;
      }

      if (responses.length > 0) {
        // Write responses to outbox
        await Bun.write(OUTBOX_FILE, JSON.stringify(responses, null, 2));
        // Clear inbox
        await Bun.write(INBOX_FILE, "[]");
      }
    } catch {
      // Silently handle poll errors
    }
  }
}
