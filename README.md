# tsk

A fast, keyboard-driven task manager for the terminal. No browser, no Electron, no mouse required.

![tsk — Task List view with detail panel](assets/screenshots/tsk-task-list.png)

## Why tsk

- **Instant.** Launches in under 100ms. CLI commands finish before your shell prompt redraws.
- **Keyboard-only.** Vim-style navigation everywhere. One key to add, edit, complete, or delete.
- **Three views.** Task list with detail panel, kanban project board, and monthly calendar.
- **CLI + TUI.** `tsk add "Buy milk" -p high` from scripts, `tsk` for the full interactive UI.
- **Local-first.** All data lives in `~/.tsk/tasks.json`. No accounts, no sync, no cloud.
- **Single binary.** Compiles to a standalone executable via `bun build --compile`.

## Install

### Binary (macOS / Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/Albertobelleiro/tsk-tui/main/install.sh | sh
```

### From source

```bash
git clone https://github.com/Albertobelleiro/tsk-tui.git
cd tsk-tui
bun install
bun run start
```

Requires [Bun](https://bun.sh) >= 1.2.

## Quick start

```bash
tsk                          # Launch the TUI
tsk add "Fix login bug" -p urgent -P backend --tag auth --due 2026-03-01
tsk list                     # Formatted table
tsk list --json              # Machine-readable output
tsk done a1b2                # Partial ID match — no need to type the full UUID
tsk search "login"           # Fuzzy search across title + description
```

## CLI reference

```
tsk                          Open interactive TUI
tsk add <title> [flags]      Add a new task
tsk list [flags]             List tasks
tsk show <id>                Show task details
tsk edit <id> [flags]        Update a task
tsk done <id>                Toggle done/todo
tsk start <id>               Set task to in-progress
tsk archive <id>             Archive a task
tsk rm <id> [--force]        Delete a task
tsk search <query>           Search tasks
tsk projects                 List projects with task counts
tsk tags                     List tags with task counts
```

### Flags

**`tsk add`**: `-p` priority (none/low/medium/high/urgent), `-P` project, `-t` tags (comma-separated), `-d` due date (YYYY-MM-DD), `--desc` description.

**`tsk list`**: `--status` (todo/in_progress/done/archived), `--priority`, `--project`, `--tag`, `--due` (today/overdue/week/YYYY-MM-DD), `--sort` (priority/due/created/title), `--json`.

**`tsk edit`**: `--title`, `--desc`, `--priority`, `--project`, `--tag`, `--due`, `--status`.

**Bulk operations:**

```bash
tsk done --all --project dev         # Complete all tasks in a project
tsk rm --all --status archived       # Clean up archived tasks
```

### Partial ID matching

Task IDs are UUIDs. You only need enough characters for a unique prefix:

```bash
tsk show a1       # Matches a1b2c3d4-...
tsk done c08      # Any unique prefix works
```

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Task not found |
| 3 | Ambiguous ID |
| 4 | Validation error |

## Keyboard shortcuts

### Navigation

| Key | Action |
|-----|--------|
| `j` / `k` | Move down / up |
| `g` / `G` | Jump to top / bottom |
| `J` / `K` | Jump 10 items |
| `Tab` | Switch panel focus |
| `Esc` | Back / Close |

### Actions

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
| `s` | Cycle sort |
| `f` | Cycle status filter |
| `u` | Undo |

### Views

| Key | Action |
|-----|--------|
| `1` | Task List |
| `2` | Project Board (kanban) |
| `3` | Calendar |
| `?` | Help overlay |

### Board view specific

| Key | Action |
|-----|--------|
| `h` / `l` | Switch column |
| `H` / `L` | Move task between columns |

### Calendar view specific

| Key | Action |
|-----|--------|
| `h/j/k/l` | Navigate days |
| `H` / `L` | Previous / Next month |
| `t` | Jump to today |

### General

| Key | Action |
|-----|--------|
| `q` | Quit |
| `Ctrl+C` | Quit |
| `Ctrl+S` | Force save |

## Development

```bash
bun install          # Install dependencies
bun run dev          # Watch mode
bun run typecheck    # Type check
bun run build        # Compile binary (current platform)
bun run build:all    # Cross-compile (macOS + Linux, arm64 + x64)
```

Output binary: `./dist/tsk`

## Architecture

```
bin/tsk.tsx          CLI router — subcommands run headless, no args launches TUI
src/cli/             Headless CLI (format.ts, index.ts)
src/store/           TaskStore — in-memory + JSON persistence with debounced save
src/views/           Task list, project board, calendar, help overlay
src/components/      Reusable UI — modal, task row, status bar, header
src/theme/           Tokyo Night color palette
src/utils/           Date formatting and due-date helpers
```

## Tech stack

- **Runtime:** [Bun](https://bun.sh)
- **TUI framework:** [@opentui/react](https://opentui.dev)
- **Language:** TypeScript (strict)
- **Storage:** `~/.tsk/tasks.json`

## License

MIT
