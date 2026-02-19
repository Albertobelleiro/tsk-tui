# tsk -- Terminal Task Manager

> A keyboard-driven, visually polished task manager that runs entirely in your terminal. Built with OpenTUI and Bun.

## Features

- Keyboard-driven with Vim-style navigation (j/k, h/l)
- 4 views: Task List, Project Board (kanban), Calendar, Help
- Real-time search, filter by status, and sort cycling
- Full CLI interface for scripting and automation
- Local JSON persistence (`~/.tsk/tasks.json`)
- Tokyo Night color theme
- Compiled single-binary distribution (no runtime dependencies)

## Installation

### Quick install (macOS / Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/Albertobelleiro/tsk-tui/main/install.sh | sh
```

### From source (requires Bun >= 1.2)

```bash
git clone https://github.com/Albertobelleiro/tsk-tui.git
cd tsk-tui
bun install
bun run start
```

## Usage

### TUI mode

```bash
tsk                 # Open interactive terminal UI
```

### CLI commands

```bash
tsk add "Buy milk" -p high --tag groceries --due 2026-03-01
tsk list --status todo --sort priority
tsk list --json | jq '.[].title'
tsk show a1b2
tsk edit a1b2 --priority urgent --project dev
tsk done a1b2
tsk start a1b2
tsk archive a1b2
tsk rm a1b2 --force
tsk search "login"
tsk projects
tsk tags
```

### Bulk operations

```bash
tsk done --all --project dev         # Mark all dev tasks as done
tsk rm --all --status archived       # Remove all archived tasks
```

### Partial ID matching

Task IDs are UUIDs, but you only need to type enough characters to be unique:

```bash
tsk show a1       # Matches a1b2c3d4-...
tsk done a1b2     # Works with any unique prefix
```

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error (unknown command, I/O error) |
| 2 | Task not found |
| 3 | Ambiguous ID (prefix matches multiple tasks) |
| 4 | Validation error (missing title, bad date, etc.) |

## Keyboard shortcuts

### Navigation

| Key | Action |
|-----|--------|
| `j` / Down | Move down |
| `k` / Up | Move up |
| `g` | Go to top |
| `G` | Go to bottom |
| `J` / `K` | Jump 10 up/down |
| `Tab` | Switch panel focus |
| `Enter` | Open / Select |
| `Esc` | Back / Close |

### Views

| Key | Action |
|-----|--------|
| `1` | Task List view |
| `2` | Project Board view |
| `3` | Calendar view |
| `?` | Help overlay |

### Actions

| Key | Action |
|-----|--------|
| `a` | Add new task |
| `e` | Edit task |
| `d` | Mark done / undone |
| `x` | Delete task |
| `/` | Search |
| `!` | Set priority |
| `p` | Set project |
| `t` | Add/remove tag |
| `D` | Set due date |
| `s` | Cycle sort |
| `f` | Cycle status filter |
| `u` | Undo |

### Board view

| Key | Action |
|-----|--------|
| `h` / `l` | Switch column |
| `H` / `L` | Move task left/right |

### Calendar view

| Key | Action |
|-----|--------|
| `h/j/k/l` | Navigate days |
| `H` / `L` | Previous/Next month |
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
bun run dev          # Watch mode with hot reload
bun run start        # Run directly
bun run typecheck    # TypeScript type checking
bun run build        # Compile binary for current platform
bun run build:all    # Compile for all platforms (macOS + Linux, arm64 + x64)
```

The compiled binary is output to `./dist/tsk`.

## Tech stack

- **Runtime:** Bun
- **UI framework:** @opentui/react
- **Language:** TypeScript (strict mode)
- **Storage:** Local JSON file (`~/.tsk/tasks.json`)

## License

MIT
