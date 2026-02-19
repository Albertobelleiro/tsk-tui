# tsk

**A fast, keyboard-driven task manager for the terminal.**
No browser. No Electron. No mouse required.

![tsk — Task List view with detail panel](assets/screenshots/tsk-task-list.png)

---

## Why tsk

- **Instant.** Launches in under 100ms. CLI commands finish before your shell prompt redraws.
- **Keyboard-only.** Vim-style navigation everywhere. One key to add, edit, complete, or delete.
- **Three views.** Task list with detail panel, kanban board, and monthly calendar.
- **CLI + TUI.** `tsk add "Fix bug" -p urgent` from scripts — `tsk` for the full interactive UI.
- **Subtasks.** Native hierarchy up to 3 levels deep, synced with Asana.
- **Time tracking.** Estimates and logged time, right in the terminal.
- **Four integrations.** Bidirectional sync with Todoist, Linear, Asana, and GitHub Issues.
- **Agent bridge.** Let Claude Code, Codex, or any AI agent manage your tasks via JSON.
- **Local-first.** All data lives in `~/.tsk/tasks.json`. No accounts, no cloud, no latency.
- **Single binary.** One self-contained executable — no runtime, no dependencies.

---

## Install

### Binary (macOS / Linux) — recommended

```bash
curl -fsSL https://raw.githubusercontent.com/Albertobelleiro/tsk-tui/main/install.sh | sh
```

Installs the binary to `/usr/local/bin/tsk`.

### From source

```bash
git clone https://github.com/Albertobelleiro/tsk-tui.git
cd tsk-tui
bun install
bun run start
```

Requires [Bun](https://bun.sh) >= 1.2.

---

## Quick start

```bash
tsk                                                        # Open the interactive TUI
tsk add "Fix login bug" -p urgent -P backend --tag auth --due 2026-03-01
tsk list                                                   # Formatted table
tsk list --status todo --priority urgent                   # Filter
tsk list --json                                            # Machine-readable output
tsk done a1b2                                              # Partial ID — no need to type the full UUID
tsk search "login"                                         # Fuzzy search across title + description
```

---

## CLI reference

### Core commands

```
tsk                            Open interactive TUI
tsk add <title> [flags]        Add a new task
tsk list [flags]               List tasks
tsk show <id>                  Show full task details
tsk edit <id> [flags]          Update a task
tsk done <id>                  Toggle done / todo
tsk start <id>                 Set task to in-progress
tsk archive <id>               Archive a task
tsk rm <id> [--force]          Delete a task
tsk search <query>             Fuzzy search across title + description
tsk projects                   List projects with task counts
tsk tags                       List tags with task counts
```

### `tsk add` flags

| Flag | Short | Description |
|------|-------|-------------|
| `--priority <level>` | `-p` | `none` / `low` / `medium` / `high` / `urgent` |
| `--project <name>` | `-P` | Assign to a project |
| `--tag <tags>` | `-t` | Comma-separated tags |
| `--due <date>` | `-d` | Due date: `YYYY-MM-DD` or `today`, `tomorrow` |
| `--desc <text>` | | Full description |
| `--subtask-of <id>` | | Create as subtask of an existing task |

### `tsk list` flags

| Flag | Description |
|------|-------------|
| `--status <s>` | Filter: `todo`, `in_progress`, `done`, `archived` |
| `--priority <p>` | Filter by priority |
| `--project <name>` | Filter by project |
| `--tag <tag>` | Filter by tag |
| `--due <filter>` | `today`, `overdue`, `week`, or `YYYY-MM-DD` |
| `--sort <field>` | `priority`, `due`, `created`, `title` |
| `--json` | Output raw JSON |

### `tsk edit` flags

`--title`, `--desc`, `--priority`, `--project`, `--tag`, `--due`, `--status`

### Bulk operations

```bash
tsk done --all --project backend          # Complete all tasks in a project
tsk done --all --tag auth                 # Complete all tasks with a tag
tsk rm --all --status archived            # Delete all archived tasks
tsk rm --all --project old --force        # Force-delete without prompt
```

### Partial ID matching

Task IDs are full UUIDs. You only need a unique prefix:

```bash
tsk show a1           # Matches a1b2c3d4-...
tsk done c08          # Any unique prefix works
tsk edit ff2 --priority high
```

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error |
| `2` | Task not found |
| `3` | Ambiguous ID prefix |
| `4` | Validation error |

---

## Subtasks

tsk supports native task hierarchy up to 3 levels deep.

```bash
# Create a subtask directly
tsk add "Write unit tests" --subtask-of a1b2

# Move an existing task under a parent
tsk indent c3d4 --under a1b2

# Promote a subtask back to top level
tsk promote c3d4

# List subtasks with progress
tsk subtasks a1b2
# → Fix login bug [1/3]
#   ✓ Write unit tests
#   ○ Update snapshots
#   ○ Review PR
```

Subtasks are synced natively with **Asana** (which has first-class subtask support).

---

## Time tracking

```bash
# Set an estimate
tsk estimate a1b2 2h
tsk estimate a1b2 1h30m
tsk estimate a1b2 45m

# Log actual time spent
tsk log a1b2 1h15m

# View estimate vs logged time in task detail
tsk show a1b2
```

Time format: `2h`, `45m`, `1h30m` — any combination of hours and minutes.

---

## Export

```bash
tsk export                        # JSON (default)
tsk export --format json
tsk export --format csv
tsk export --format markdown
```

Exports all non-archived tasks. Redirect to a file:

```bash
tsk export --format csv > tasks.csv
tsk export --format markdown > tasks.md
```

---

## Integrations

tsk syncs bidirectionally with four external services. Your local tasks stay authoritative — the sync engine resolves conflicts automatically.

### Connect

#### Todoist

```bash
# OAuth (recommended — opens browser)
tsk connect todoist

# Or with a personal API token
tsk connect todoist --token YOUR_API_TOKEN
```

#### Linear

```bash
# OAuth (recommended — opens browser)
tsk connect linear

# Or with a personal access token
tsk connect linear --token YOUR_PAT

# Optionally scope to a team
tsk connect linear --token YOUR_PAT --team "Engineering"
```

#### Asana

```bash
# With a Personal Access Token (simplest)
tsk connect asana --token YOUR_PAT

# OAuth — requires an Asana app (client ID + secret)
TSK_ASANA_CLIENT_ID=xxx TSK_ASANA_CLIENT_SECRET=yyy tsk connect asana

# Optionally specify workspace and project directly
tsk connect asana --token YOUR_PAT --workspace <workspace-id> --project <project-id>
```

tsk auto-discovers your workspaces and projects and prompts you to select if there are multiple.

> **Note:** Asana has no built-in priority field. Priorities set in tsk are not synced to Asana.

#### GitHub Issues

```bash
# Using the gh CLI (no token needed if already authenticated)
tsk connect github --repo owner/repo

# With a personal access token
tsk connect github --repo owner/repo --token YOUR_PAT

# Filter issues by label
tsk connect github --repo owner/repo --label "task"
```

---

### Sync

```bash
tsk sync                          # Sync all connected providers
tsk sync asana                    # Sync a specific provider
tsk sync linear --pull-only       # Only pull remote changes
tsk sync todoist --push-only      # Only push local changes
tsk sync github --dry-run         # Preview without applying changes
tsk sync --status                 # Show connection and last-sync status
tsk sync --reset                  # Reset sync state (full re-sync on next run)
```

**Sync output:**

```
asana: pulled=3 pushed=1 deleted=0 conflicts=0 errors=0
```

**Conflict resolution** (set in config):

| Strategy | Behavior |
|----------|----------|
| `newest-wins` | Most recently updated side wins (default) |
| `remote-wins` | External service always wins |
| `local-wins` | tsk always wins |

```bash
tsk config set sync.conflictStrategy remote-wins
```

---

### Disconnect

```bash
tsk disconnect asana
tsk disconnect linear
tsk disconnect todoist
tsk disconnect github
```

---

## Agent bridge

The agent bridge lets AI coding agents (Claude Code, Codex, or any custom agent) read and manage your tasks without running the TUI.

tsk watches `~/.tsk/agent-inbox.json` for commands and writes responses to `~/.tsk/agent-outbox.json`.

### Setup

```bash
# Enable auto-start (bridge runs when TUI is open)
tsk config set integrations.agent.enabled true

# Or start manually in the foreground
tsk agent start

# Print the CLAUDE.md snippet to add to your project
tsk agent snippet
```

### Commands

```bash
tsk agent start          # Start bridge (foreground, Ctrl+C to stop)
tsk agent status         # Show config, inbox/outbox state
tsk agent send <json>    # Send a command and wait for response
tsk agent outbox         # Show last 10 responses
tsk agent clear          # Clear outbox
tsk agent clear-inbox    # Clear inbox
tsk agent snippet        # Print CLAUDE.md integration snippet
```

### Supported agent commands

| Command | Description |
|---------|-------------|
| `create` | Create a task |
| `create-subtask` | Create a subtask under a parent |
| `bulk-create` | Create multiple tasks at once |
| `update` | Update title, description, priority, status, project, tags, due date |
| `complete` | Mark a task done |
| `uncomplete` | Unmark a task |
| `delete` | Delete a task |
| `query` | Filter tasks by status, priority, project, tag, or search string |
| `list` | List tasks |
| `show` | Show a single task |
| `list-projects` | List all projects |
| `list-tags` | List all tags |
| `stats` | Counts by status and priority |
| `add-note` | Append a note to a task |
| `start-timer` | Start a timer on a task |
| `stop-timer` | Stop and log the elapsed time |

### Example inbox command

```json
[
  {
    "id": "cmd-001",
    "timestamp": "2026-03-01T10:00:00Z",
    "source": "claude-code",
    "command": "create",
    "payload": {
      "title": "Investigate flaky test in auth suite",
      "priority": "high",
      "project": "backend",
      "tags": ["tests", "auth"]
    }
  }
]
```

---

## Config

```bash
tsk config list                              # Show full config (secrets masked)
tsk config get sync.conflictStrategy         # Read a value
tsk config set sync.conflictStrategy local-wins   # Write a value
tsk config reset                             # Reset to defaults (prompts confirmation)
tsk config edit                              # Open config file in $EDITOR
tsk config path                              # Print config file path
```

Config file location: `~/.tsk/config.json`

---

## Keyboard shortcuts

### Navigation

| Key | Action |
|-----|--------|
| `j` / `k` | Move down / up |
| `g` / `G` | Jump to top / bottom |
| `J` / `K` | Jump 10 items |
| `Tab` | Switch panel focus |
| `Esc` | Back / close modal |

### Task actions

| Key | Action |
|-----|--------|
| `a` | Add task |
| `e` | Edit task |
| `d` | Toggle done |
| `x` | Delete task |
| `/` | Search |
| `!` | Set priority |
| `p` | Set project |
| `t` | Manage tags |
| `D` | Set due date |
| `s` | Cycle sort order |
| `f` | Cycle status filter |
| `u` | Undo last action |

### Views

| Key | Action |
|-----|--------|
| `1` | Task list |
| `2` | Project board (kanban) |
| `3` | Calendar |
| `?` | Help overlay |

### Board view

| Key | Action |
|-----|--------|
| `h` / `l` | Switch column |
| `H` / `L` | Move task between columns |

### Calendar view

| Key | Action |
|-----|--------|
| `h` / `j` / `k` / `l` | Navigate days |
| `H` / `L` | Previous / next month |
| `t` | Jump to today |

### General

| Key | Action |
|-----|--------|
| `q` | Quit |
| `Ctrl+C` | Quit |
| `Ctrl+S` | Force save |

---

## Development

```bash
bun install          # Install dependencies
bun run dev          # Watch mode with hot reload
bun run typecheck    # TypeScript check
bun test             # Run tests
bun run build        # Compile binary for current platform → dist/tsk
bun run build:all    # Cross-compile: darwin-arm64, linux-x64, linux-arm64
```

### Project structure

```
bin/tsk.tsx                  Entry point — routes subcommands or launches TUI
src/cli/                     Headless CLI (index.ts, format.ts)
src/store/                   TaskStore — in-memory + JSON persistence, debounced save
src/views/                   Task list, project board, calendar, help overlay
src/components/              Modal, task row, status bar, header
src/integrations/
  asana.ts                   Asana REST API provider
  linear.ts                  Linear GraphQL provider
  todoist.ts                 Todoist REST API provider
  github-issues.ts           GitHub Issues REST API provider
  sync-engine.ts             Bidirectional sync with conflict resolution
  sync-state.ts              Persists last-sync timestamps and hashes
  agent-bridge.ts            File-based agent command loop
  agent-protocol.ts          Agent command/response type definitions
  oauth-helpers.ts           PKCE OAuth flow (opens browser, local callback)
  oauth-device-flow.ts       Device flow for headless environments
src/config/                  Config types and manager
src/theme/                   Tokyo Night color palette
src/utils/                   Date formatting and due-date helpers
```

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Runtime | [Bun](https://bun.sh) |
| TUI framework | [@opentui/react](https://opentui.dev) |
| Language | TypeScript (strict) |
| Storage | `~/.tsk/tasks.json` |
| Config | `~/.tsk/config.json` |
| Agent inbox | `~/.tsk/agent-inbox.json` |
| Agent outbox | `~/.tsk/agent-outbox.json` |

---

## License

MIT
