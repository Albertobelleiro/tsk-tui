# Session 6 — Agent Bridge (Claude Code / Codex IPC)

> **Prerequisite**: Session 1 (config, sync engine) must be complete.

<context>
- Project: tsk — terminal task manager
- Stack: TypeScript strict, Bun, @opentui/react
- Session 1 artifacts available:
  - `src/config/config.ts` — ConfigManager
  - `src/config/types.ts` — AgentConfig interface (enabled, pollIntervalMs)
  - `src/store/task-store.ts` — TaskStore with full CRUD + subtasks + notes
  - `src/integrations/types.ts` — ExternalSource includes "claude-code" and "codex"
  - `src/cli/index.ts` — CLI command dispatcher
- Data dir: ~/.tsk/
- Task type has all v0.2 fields including subtaskIds, notes, externalId, externalSource
</context>

<role>
You are a senior TypeScript developer building a file-based IPC bridge that allows AI coding agents (Claude Code, Codex, or any tool) to create, query, update, and complete tasks in tsk without needing the TUI open. You design for simplicity, reliability, and zero-config operation.
</role>

<task>
Implement a file-based agent bridge that allows external agents to interact with tsk via JSON files, plus a CLI interface for controlling the bridge and sending commands.
</task>

<requirements>

## 1. Architecture

The bridge uses two JSON files for communication:

```
~/.tsk/agent-inbox.json   — Agents WRITE commands here
~/.tsk/agent-outbox.json  — tsk WRITES responses here
```

**Why file-based IPC?**
- Works with ANY agent (Claude Code, Codex, Cursor, custom scripts)
- No network setup, no ports, no WebSocket
- Agent just needs to write a JSON file and read another
- Works across terminal sessions
- Trivially debuggable (`cat ~/.tsk/agent-inbox.json`)

## 2. Protocol: `src/integrations/agent-protocol.ts`

### 2.1 Command format

```typescript
interface AgentCommand {
  id: string;                        // UUID for response correlation
  timestamp: string;                 // ISO timestamp
  source: "claude-code" | "codex" | "custom";
  command: AgentCommandType;
  payload: Record<string, unknown>;
}

type AgentCommandType =
  | "create"           // Create a task
  | "create-subtask"   // Create a subtask under a parent
  | "bulk-create"      // Create multiple tasks at once
  | "update"           // Update a task
  | "complete"         // Mark task as done
  | "uncomplete"       // Mark task as todo
  | "delete"           // Delete a task
  | "query"            // Query tasks with filters
  | "list"             // List all tasks (shorthand)
  | "show"             // Get single task by ID (supports partial ID)
  | "list-projects"    // List all projects
  | "list-tags"        // List all tags
  | "stats"            // Get task statistics
  | "add-note"         // Add a note to a task
  | "start-timer"      // Start time tracking
  | "stop-timer"       // Stop time tracking
  ;
```

### 2.2 Command payloads

```typescript
// create
{ title: string; description?: string; priority?: TaskPriority; project?: string; tags?: string[]; dueDate?: string }

// create-subtask
{ parentId: string; title: string; description?: string; priority?: TaskPriority }

// bulk-create
{ tasks: Array<{ title: string; priority?: string; project?: string; tags?: string[]; dueDate?: string }> }

// update
{ taskId: string; title?: string; description?: string; priority?: string; status?: string; project?: string; tags?: string[]; dueDate?: string }

// complete / uncomplete / delete / show
{ taskId: string }  // Supports partial ID (same as CLI)

// query
{ status?: string | string[]; priority?: string | string[]; project?: string; tag?: string; search?: string; limit?: number }

// list
{ limit?: number }  // Default: all

// add-note
{ taskId: string; content: string }

// start-timer / stop-timer
{ taskId: string }
```

### 2.3 Response format

```typescript
interface AgentResponse {
  commandId: string;                 // Matches AgentCommand.id
  status: "ok" | "error";
  data?: unknown;                    // Task, Task[], stats object, etc.
  error?: string;                    // Error message if status === "error"
  timestamp: string;
}
```

### 2.4 Inbox/Outbox file format

```typescript
// agent-inbox.json — array of pending commands
AgentCommand[]

// agent-outbox.json — array of responses (append-only)
AgentResponse[]
```

## 3. Bridge: `src/integrations/agent-bridge.ts`

```typescript
class AgentBridge {
  constructor(
    private store: TaskStore,
    private config: AgentConfig,
  ) {}

  // Lifecycle
  start(): void;                    // Begin polling inbox
  stop(): void;                     // Stop polling, clean up
  isRunning(): boolean;

  // Core processing
  async processInbox(): Promise<number>;  // Read inbox, process all, write responses, clear inbox. Returns count processed.
  async processCommand(cmd: AgentCommand): Promise<AgentResponse>;

  // File watching
  private _pollTimer: ReturnType<typeof setInterval> | null;
  private _inboxPath: string;       // ~/.tsk/agent-inbox.json
  private _outboxPath: string;      // ~/.tsk/agent-outbox.json
}
```

### 3.1 Polling mechanism

```typescript
start(): void {
  if (this._pollTimer) return;
  this._pollTimer = setInterval(async () => {
    try {
      await this.processInbox();
    } catch (e) {
      console.error("[agent-bridge] Error processing inbox:", e);
    }
  }, this.config.pollIntervalMs);
  // Process immediately on start
  void this.processInbox();
}
```

### 3.2 Inbox processing

```typescript
async processInbox(): Promise<number> {
  const file = Bun.file(this._inboxPath);
  if (!(await file.exists())) return 0;

  const text = await file.text();
  if (!text.trim() || text.trim() === "[]") return 0;

  let commands: AgentCommand[];
  try {
    commands = JSON.parse(text);
    if (!Array.isArray(commands)) commands = [commands];  // Allow single command
  } catch {
    // Invalid JSON — clear inbox, write error response
    await Bun.write(this._inboxPath, "[]");
    return 0;
  }

  const responses: AgentResponse[] = [];
  for (const cmd of commands) {
    const response = await this.processCommand(cmd);
    responses.push(response);
  }

  // Append to outbox
  await this._appendToOutbox(responses);

  // Clear inbox
  await Bun.write(this._inboxPath, "[]");

  return commands.length;
}
```

### 3.3 Command handlers

Each command type maps to a store operation:

```typescript
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
        return this._ok(cmd.id, this.store.getProjects());
      case "list-tags":
        return this._ok(cmd.id, this.store.getTags());
      case "stats":
        return this._ok(cmd.id, this.store.getStats());
      case "add-note":
        return this._handleAddNote(cmd);
      default:
        return this._error(cmd.id, `Unknown command: ${cmd.command}`);
    }
  } catch (e) {
    return this._error(cmd.id, e instanceof Error ? e.message : String(e));
  }
}
```

**Partial ID resolution**: The `show`, `complete`, `uncomplete`, `delete`, `update` commands accept partial task IDs (same logic as CLI — find unique task matching prefix).

### 3.4 Outbox management

- Append responses (don't overwrite — agent may read async)
- Limit outbox size: keep last 100 responses, prune older
- Agent is responsible for reading and clearing entries it has consumed

## 4. CLI Commands

```bash
# Start bridge (foreground — blocks terminal)
tsk agent start
# Shows: "Agent bridge listening... (poll: 2s)"
# Shows: "Processing: create 'Fix login bug' → ok"
# Ctrl+C to stop

# Start bridge (background via config — auto-start when TUI launches)
tsk config set integrations.agent.enabled true

# Stop background bridge
tsk agent stop

# Check status
tsk agent status
# Output: "Agent bridge: running (poll: 2s, processed: 23 commands)"
# Or: "Agent bridge: stopped"

# Send a command directly (for testing)
tsk agent send '{"command":"create","payload":{"title":"Fix bug","priority":"high"}}'
# Output: "✓ Task created: Fix bug (id: a1b2c3d4)"

# View recent outbox
tsk agent outbox
# Shows last 10 responses

# Clear outbox
tsk agent clear
```

### 4.1 `tsk agent send` implementation

Quick way to test without editing files:
```typescript
// 1. Generate command with ID
// 2. Write to inbox
// 3. Wait for response in outbox (poll for matching commandId, timeout 5s)
// 4. Print response
```

## 5. CLAUDE.md Integration Snippet

Generate a snippet that users can add to their project's `CLAUDE.md` so Claude Code knows how to use tsk:

```bash
tsk agent snippet
```

Output:
```markdown
## Task Management with tsk

This project uses `tsk` for task tracking. You can manage tasks via CLI or the agent bridge.

### CLI Commands (preferred)
\`\`\`bash
tsk add "task title" -p high -P project-name
tsk list --json                    # See current tasks
tsk list --status todo --json      # Only pending tasks
tsk done <id>                      # Mark complete (accepts partial ID)
tsk show <id>                      # Task details
\`\`\`

### Agent Bridge (for automated workflows)
Write commands to `~/.tsk/agent-inbox.json`:
\`\`\`json
[{"id":"uuid","timestamp":"...","source":"claude-code","command":"create","payload":{"title":"Fix bug","priority":"high","project":"dev"}}]
\`\`\`

Read responses from `~/.tsk/agent-outbox.json`.

Available commands: create, create-subtask, bulk-create, update, complete, delete, query, list, show, list-projects, list-tags, stats, add-note.
```

## 6. TUI Integration

When agent bridge is active (config `integrations.agent.enabled = true`):
- Auto-start bridge when TUI launches (in app.tsx)
- Auto-stop bridge when TUI exits
- Show indicator in header: `⚡ Agent` (cyan)
- When a command is processed, show toast: "Agent: created 'Fix bug'"
- Task list auto-refreshes when agent creates/updates tasks (already reactive via useSyncExternalStore)

</requirements>

<implementation>

## Step 1: Protocol types
1. Create `src/integrations/agent-protocol.ts` with AgentCommand, AgentResponse types, all command type definitions and payload schemas

## Step 2: Bridge implementation
2. Create `src/integrations/agent-bridge.ts`
3. Implement start/stop/isRunning lifecycle
4. Implement processInbox (read, parse, process, respond, clear)
5. Implement all command handlers (create, update, complete, delete, query, list, show, bulk-create, create-subtask, add-note, stats, etc.)
6. Implement partial ID resolution (reuse logic from cli/index.ts)
7. Implement outbox append with size limit (100 entries)

## Step 3: CLI commands
8. Add `tsk agent start` — foreground bridge with live logging
9. Add `tsk agent stop` — clear running flag
10. Add `tsk agent status` — show bridge state
11. Add `tsk agent send <json>` — write to inbox, wait for response
12. Add `tsk agent outbox` — show last 10 responses
13. Add `tsk agent clear` — clear outbox
14. Add `tsk agent snippet` — print CLAUDE.md integration snippet

## Step 4: TUI integration
15. In `src/app.tsx`: if agent config enabled, start bridge on mount, stop on unmount
16. Show `⚡ Agent` indicator in header when bridge is running

## Step 5: Test and verify
17. `tsk agent start` in one terminal → `tsk agent send '{"command":"list"}'` in another
18. Verify response appears in outbox
19. `bun run tsc --noEmit` — zero errors

</implementation>

<constraints>
- File-based IPC ONLY — no WebSocket, no HTTP server, no IPC sockets
- Inbox/outbox files in ~/.tsk/ alongside tasks.json
- Polling interval configurable (default 2s) — not a file watcher (those are unreliable cross-platform)
- Process commands sequentially (not parallel) to avoid race conditions
- Partial ID resolution must match CLI behavior exactly
- Outbox is append-only with 100-entry limit
- Agent bridge must not interfere with normal TUI/CLI operation
- The bridge reads from the SAME TaskStore as the TUI — changes are immediately visible
- Invalid JSON in inbox → clear and skip (don't crash)
- Unknown commands → return error response (don't crash)
- Single command object (not array) in inbox → wrap in array automatically
- NEVER expose internal errors in responses — sanitize messages
- Run `bun run tsc --noEmit` after implementation
</constraints>
