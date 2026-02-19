# tsk — Terminal Task Manager

## Product Requirements Document (PRD)

> **Target builder:** Claude Code (or any AI coding agent)
> **Framework:** OpenTUI (`@opentui/react`)
> **Runtime:** Bun
> **Language:** TypeScript (strict mode)

---

## 1. Product Overview

**tsk** is a keyboard-driven, visually polished terminal task manager built with OpenTUI and React. It runs entirely in the terminal, stores data locally in JSON, and is designed to feel as fluid as Vim — every action is reachable without a mouse.

### Design Philosophy

- **Zero mouse** — every interaction is keyboard-driven
- **Instant feedback** — actions reflect immediately, no loading states
- **Visual clarity** — colors, borders, and spacing make hierarchy obvious at a glance
- **Vim-inspired navigation** — `j/k` to move, single-key actions, modal editing
- **Minimal footprint** — single JSON file for persistence, no external database

---

## 2. Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Runtime** | Bun ≥ 1.2.0 | Required by OpenTUI, fast startup |
| **UI Framework** | `@opentui/react` | Declarative JSX for terminal UIs |
| **Core Library** | `@opentui/core` | Flexbox layout, keyboard handling, components |
| **Language** | TypeScript (strict) | Type safety, better DX |
| **Persistence** | Local JSON file | `~/.tsk/tasks.json` |
| **ID Generation** | `crypto.randomUUID()` | Built into Bun, no deps |

### Project Structure

```
tsk/
├── package.json
├── tsconfig.json
├── bin/
│   └── tsk.ts          # Entry point (CLI launcher)
├── src/
│   ├── app.tsx               # Root <App /> component, view router
│   ├── store/
│   │   ├── task-store.ts     # In-memory state + JSON persistence
│   │   └── types.ts          # Task, Project, Tag interfaces
│   ├── hooks/
│   │   ├── use-navigation.ts # j/k/g/G navigation logic
│   │   ├── use-modal.ts      # Modal open/close state
│   │   └── use-filter.ts     # Filter/search state
│   ├── views/
│   │   ├── task-list.tsx      # Main task list view
│   │   ├── task-detail.tsx    # Task detail/edit panel
│   │   ├── project-view.tsx   # Kanban-style project board
│   │   ├── calendar-view.tsx  # Calendar with due dates
│   │   └── help-view.tsx      # Keybinding reference overlay
│   ├── components/
│   │   ├── status-bar.tsx     # Bottom bar: mode, filters, counts
│   │   ├── header.tsx         # Top bar: view name, clock, shortcuts hint
│   │   ├── task-row.tsx       # Single task row (reusable)
│   │   ├── modal.tsx          # Generic modal wrapper
│   │   ├── input-modal.tsx    # Text input modal (add/edit/search)
│   │   ├── confirm-modal.tsx  # Yes/No confirmation dialog
│   │   ├── select-modal.tsx   # Select from list (priority, project, tags)
│   │   ├── tag-badge.tsx      # Colored tag pill
│   │   └── progress-bar.tsx   # Visual completion bar
│   ├── theme/
│   │   └── colors.ts          # Color palette constants
│   └── utils/
│       ├── date.ts            # Date formatting helpers
│       └── keybindings.ts     # Centralized keymap definitions
└── README.md
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "lib": ["ESNext", "DOM"],
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "jsxImportSource": "@opentui/react",
    "strict": true,
    "skipLibCheck": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

### package.json (key fields)

```json
{
  "name": "tsk",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "tsk": "./bin/tsk.ts"
  },
  "dependencies": {
    "@opentui/core": "latest",
    "@opentui/react": "latest"
  }
}
```

---

## 3. Installation & Launch Commands

```bash
# Install globally
bun install -g tsk

# Launch (two aliases)
tsk

# Or run from source during development
bun run bin/tsk.ts
```

The entry point (`bin/tsk.ts`) must:
1. Initialize the `CliRenderer` with `useAlternateScreen: true` and `exitOnCtrlC: true`
2. Load tasks from `~/.tsk/tasks.json` (create dir + file if missing)
3. Render `<App />` via `createRoot(renderer).render(<App />)`
4. Call `renderer.start()`

---

## 4. Data Model

### Task

```typescript
interface Task {
  id: string                          // crypto.randomUUID()
  title: string                       // Required, max 200 chars
  description: string                 // Optional, multiline
  status: "todo" | "in_progress" | "done" | "archived"
  priority: "none" | "low" | "medium" | "high" | "urgent"
  project: string | null              // Project name or null
  tags: string[]                      // Freeform string tags
  dueDate: string | null              // ISO date string (YYYY-MM-DD)
  createdAt: string                   // ISO datetime
  updatedAt: string                   // ISO datetime
  completedAt: string | null          // ISO datetime when marked done
  order: number                       // Sort order within status group
}
```

### AppState

```typescript
interface AppState {
  tasks: Task[]
  projects: string[]                  // Derived from unique task.project values
  tags: string[]                      // Derived from unique tag values across tasks
  activeView: "list" | "project" | "calendar" | "help"
  activeFilter: FilterState
  selectedTaskId: string | null
  modalStack: ModalState[]            // Stack-based modal management
}

interface FilterState {
  status: Task["status"][] | "all"
  priority: Task["priority"][] | "all"
  project: string | null
  tag: string | null
  search: string                      // Fuzzy search on title + description
  sortBy: "priority" | "dueDate" | "createdAt" | "title" | "order"
  sortDirection: "asc" | "desc"
}
```

### Persistence

- **Location:** `~/.tsk/tasks.json`
- **Format:** Pretty-printed JSON (`JSON.stringify(tasks, null, 2)`)
- **Write strategy:** Debounced write (300ms) after any mutation — prevents rapid I/O
- **Read:** Load once at startup, keep in memory
- **Error handling:** If file is corrupted, backup to `tasks.json.bak` and start fresh

---

## 5. Color Theme

```typescript
// theme/colors.ts — Tokyo Night inspired palette
const colors = {
  bg:           "#1a1b26",   // Main background
  bgDark:       "#16161e",   // Sidebar / panels
  bgHighlight:  "#292e42",   // Selected row
  bgModal:      "#24283b",   // Modal background
  
  fg:           "#c0caf5",   // Default text
  fgDim:        "#565f89",   // Secondary text, hints
  fgBright:     "#e0e6ff",   // Emphasized text
  
  accent:       "#7aa2f7",   // Primary accent (blue)
  accentAlt:    "#bb9af7",   // Secondary accent (purple)
  
  green:        "#9ece6a",   // Done, success
  yellow:       "#e0af68",   // In progress, warnings
  red:          "#f7768e",   // Urgent, errors, delete
  orange:       "#ff9e64",   // High priority
  cyan:         "#7dcfff",   // Tags, info
  
  border:       "#3b4261",   // Default borders
  borderFocus:  "#7aa2f7",   // Focused panel borders
  
  // Priority colors (used in task rows and badges)
  priority: {
    urgent:  "#f7768e",
    high:    "#ff9e64",
    medium:  "#e0af68",
    low:     "#7dcfff",
    none:    "#565f89",
  },
  
  // Status colors
  status: {
    todo:        "#565f89",
    in_progress: "#e0af68",
    done:        "#9ece6a",
    archived:    "#3b4261",
  }
}
```

---

## 6. Views & Layouts

### 6.1 Main Layout (Shared Shell)

All views share this outer structure:

```
┌─ Header Bar ─────────────────────────────────────────────┐
│  tsk    [1] List  [2] Board  [3] Cal  [?] Help      │
├──────────────────────────────────────────────────────────┤
│                                                          │
│                    Active View                           │
│                (fills remaining space)                    │
│                                                          │
├─ Status Bar ─────────────────────────────────────────────┤
│  NORMAL │ 12 tasks │ Filter: all │ Sort: priority ↓      │
└──────────────────────────────────────────────────────────┘
```

- **Header:** Fixed 1 row. Shows app name, tab-style view selector (active tab highlighted), quick help hint.
- **Status Bar:** Fixed 1 row. Shows current mode (NORMAL/INSERT/SEARCH), task count, active filters, sort info.
- **Active View:** Fills all remaining vertical space via `flexGrow: 1`.

### 6.2 Task List View (Default — Key: `1`)

The primary view. Two-panel layout:

```
┌─────────────────────────────────┬───────────────────────┐
│  ● Buy groceries          H  !  │  Task Detail           │
│  ○ Write docs             M  📅 │                        │
│  ◉ Fix login bug     dev  H  !  │  Title: Fix login bug  │
│  ○ Send invoice           L     │  Status: ● In Progress │
│  ○ Plan sprint      work  M  📅 │  Priority: 🔴 High     │
│  ○ Review PR         dev  -     │  Project: dev          │
│    ✓ Deploy v2.1     dev  -     │  Tags: #backend #auth  │
│    ✓ Update README        -     │  Due: 2026-02-20       │
│                                 │  Created: 2d ago       │
│                                 │                        │
│                                 │  Description:          │
│                                 │  Users report 500 err  │
│                                 │  on /api/login when... │
├─────────────────────────────────┤                        │
│  [a]dd [e]dit [d]one [x]del    │                        │
│  [/]search [p]riority [s]ort   │                        │
└─────────────────────────────────┴───────────────────────┘
```

**Left Panel (Task List — 60% width):**
- Scrollable list of tasks via `<scrollbox>`
- Each row shows: status icon, title (truncated), project tag, priority badge, due indicator
- Selected row has `bgHighlight` background and `borderFocus` left accent bar
- Done tasks show with strikethrough text and dimmed colors
- Group by status: "In Progress" → "To Do" → "Done" (collapsed by default)
- Bottom area shows contextual keybinding hints

**Right Panel (Task Detail — 40% width):**
- Shows full details of the currently selected task
- Visible only when a task is selected; otherwise shows empty state message
- Scrollable for long descriptions
- The panel can be toggled with `Tab` or `l` (right) to focus it

**Responsive behavior:**
- If terminal width < 80 columns: hide detail panel, show detail as overlay on `Enter`
- Use `useTerminalDimensions()` hook to detect

### 6.3 Project Board View (Key: `2`)

Kanban-style columns grouped by status:

```
┌─── To Do ────────┬─── In Progress ──┬─── Done ──────────┐
│                   │                   │                   │
│  Buy groceries    │  Fix login bug    │  ✓ Deploy v2.1   │
│  Write docs       │                   │  ✓ Update README │
│  Send invoice     │                   │                   │
│  Plan sprint      │                   │                   │
│  Review PR        │                   │                   │
│                   │                   │                   │
└───────────────────┴───────────────────┴───────────────────┘
```

- Three columns: `todo`, `in_progress`, `done`
- Navigate between columns with `h/l` (left/right)
- Navigate within column with `j/k` (up/down)
- Move task between columns: `Shift+H` (move left), `Shift+L` (move right)
- Each column header shows count
- Active column border changes to `borderFocus`
- Filter by project: `p` opens project selector — shows only that project's tasks

### 6.4 Calendar View (Key: `3`)

Monthly calendar highlighting days with due tasks:

```
┌─ February 2026 ──────────────────────────────────────────┐
│  Mo  Tu  We  Th  Fr  Sa  Su                              │
│                               1                          │
│   2   3   4   5   6   7   8                              │
│   9  10  11  12  13  14  15                              │
│  16  17  18 [19] 20● 21  22                              │
│  23  24  25  26  27  28                                  │
├──────────────────────────────────────────────────────────┤
│  Due on Feb 20:                                          │
│    ● Fix login bug (High)                                │
│    ○ Send invoice (Low)                                  │
└──────────────────────────────────────────────────────────┘
```

- Current day highlighted with `[brackets]`
- Days with due tasks show a colored dot (color = highest priority on that day)
- Navigate days with `h/j/k/l` (left/down/up/right)
- Navigate months with `H/L` (prev/next month)
- Bottom panel shows tasks due on selected day
- `Enter` on a day with tasks focuses the task list filtered to that day
- `a` on any day opens the add task modal with that date pre-filled as due date

### 6.5 Help View (Key: `?`)

Full-screen overlay showing all keybindings organized by context:

```
┌─ tsk Keybindings ───────────────────────────────────┐
│                                                          │
│  NAVIGATION                    ACTIONS                   │
│  j/↓    Move down              a     Add new task        │
│  k/↑    Move up                e     Edit task           │
│  g      Go to top              d     Mark done/undone    │
│  G      Go to bottom           x     Delete task         │
│  Enter  Open / Select          /     Search              │
│  Esc    Back / Close           !     Set priority        │
│  Tab    Switch panel            p     Set project         │
│                                t     Add/remove tag      │
│  VIEWS                         D     Set due date        │
│  1      Task List              s     Cycle sort           │
│  2      Project Board          f     Cycle filter         │
│  3      Calendar                                          │
│  ?      This help              BOARD VIEW                │
│                                H/L   Move task ←/→       │
│  GENERAL                       h/l   Switch column       │
│  Ctrl+S Force save                                       │
│  Ctrl+C Quit                                             │
│  q      Quit (from any view)                             │
│                                                          │
│  Press Esc or ? to close                                 │
└──────────────────────────────────────────────────────────┘
```

- Rendered as a centered modal overlay with semi-transparent background
- Scrollable if terminal is small
- Dismiss with `Esc` or `?`

---

## 7. Keyboard Controls (Complete Keymap)

### 7.1 Global Keys (Work in every view, every mode)

| Key | Action |
|-----|--------|
| `1` | Switch to Task List view |
| `2` | Switch to Project Board view |
| `3` | Switch to Calendar view |
| `?` | Toggle Help overlay |
| `Ctrl+C` | Quit application |
| `q` | Quit application (when not in input mode) |
| `Ctrl+S` | Force save to disk |

### 7.2 Navigation (NORMAL mode)

| Key | Action |
|-----|--------|
| `j` or `↓` | Move selection down |
| `k` or `↑` | Move selection up |
| `h` or `←` | Move left (switch panel / column) |
| `l` or `→` | Move right (switch panel / column) |
| `g` | Jump to first item |
| `G` | Jump to last item |
| `J` (Shift+J) | Page down (jump 10 items) |
| `K` (Shift+K) | Page up (jump 10 items) |
| `Enter` | Open/select focused item |
| `Esc` | Close modal / go back / deselect |
| `Tab` | Switch focus between panels |

### 7.3 Task Actions (NORMAL mode, Task List & Board views)

| Key | Action |
|-----|--------|
| `a` | **Add** new task → opens Input Modal |
| `e` | **Edit** selected task → opens Edit Modal |
| `d` | Toggle **done** ↔ todo on selected task |
| `x` | **Delete** selected task → opens Confirm Modal |
| `!` | Set **priority** → opens Select Modal (none/low/medium/high/urgent) |
| `p` | Set **project** → opens Select Modal (existing projects + new) |
| `t` | Toggle **tag** → opens Select Modal (existing tags + new) |
| `D` | Set **due date** → opens Input Modal (YYYY-MM-DD) |
| `/` | **Search** → opens search Input Modal, filters in real-time |
| `s` | Cycle **sort**: priority → due → created → title → manual |
| `f` | Cycle **status filter**: all → todo → in_progress → done |
| `Shift+↑` | Move task **up** in order (manual sort) |
| `Shift+↓` | Move task **down** in order (manual sort) |
| `u` | **Undo** last action (single level) |

### 7.4 Input Mode (Inside modals with text input)

| Key | Action |
|-----|--------|
| Any character | Type into input field |
| `Backspace` | Delete character before cursor |
| `←` / `→` | Move cursor within input |
| `Enter` | Confirm / Submit |
| `Esc` | Cancel and close modal |
| `Tab` | Move to next field (in multi-field modals) |

### 7.5 Select Mode (Inside select modals)

| Key | Action |
|-----|--------|
| `j` / `↓` | Move selection down |
| `k` / `↑` | Move selection up |
| `Enter` | Confirm selection |
| `Esc` | Cancel |
| `Space` | Toggle item (multi-select for tags) |

---

## 8. Modals

All modals render as centered overlays on top of the current view. They use a stack-based system — opening a modal pushes to `modalStack`, closing pops.

### 8.1 Input Modal (Add/Edit Task)

```
┌─ Add New Task ──────────────────────────┐
│                                          │
│  Title:  [                            ]  │
│                                          │
│  Description: (optional)                 │
│  [                                    ]  │
│  [                                    ]  │
│                                          │
│  Priority:  ○ None  ● Medium  ○ High    │
│  Project:   [dev           ]            │
│  Due Date:  [2026-02-25    ]            │
│  Tags:      [backend, auth ]            │
│                                          │
│        [Enter] Save    [Esc] Cancel      │
└──────────────────────────────────────────┘
```

- When **adding**: all fields empty except priority defaults to "none"
- When **editing**: all fields pre-filled from selected task
- `Tab` cycles through fields
- Priority field uses inline selection (arrow keys to pick)
- Tags field accepts comma-separated values
- Title is required — show red border if empty on submit attempt
- Auto-focus title field on open

### 8.2 Confirm Modal

```
┌─ Delete Task ───────────────────┐
│                                  │
│  Delete "Fix login bug"?        │
│  This cannot be undone.         │
│                                  │
│      [y] Yes    [n/Esc] No      │
└──────────────────────────────────┘
```

- Single key response: `y` confirms, `n` or `Esc` cancels
- Used for: delete, bulk actions

### 8.3 Select Modal (Priority / Project / Tags)

```
┌─ Set Priority ──────────┐
│                          │
│    None                  │
│    Low                   │
│  ▸ Medium      ← current│
│    High                  │
│    Urgent                │
│                          │
│  [Enter] Select  [Esc]  │
└──────────────────────────┘
```

- Navigable with `j/k`
- Current value marked with `▸`
- For tags: multi-select with `Space` to toggle, `Enter` to confirm
- For project: show existing projects + "New project..." option at bottom

### 8.4 Search Overlay

```
┌─ Search ─────────────────────────────────┐
│  🔍 [login bug                        ]  │
│                                          │
│  3 results:                              │
│  ● Fix login bug           dev     High  │
│  ○ Login page redesign     design  Med   │
│  ✓ Login rate limiting     dev     Low   │
│                                          │
│  [Enter] Go to  [Esc] Clear & Close     │
└──────────────────────────────────────────┘
```

- Real-time fuzzy search on `title` + `description` fields
- Results update as you type
- Navigate results with `j/k` while still in search input
- `Enter` closes search and selects that task in the list
- `Esc` clears search and closes overlay

---

## 9. Interaction Flows

### 9.1 Adding a Task

1. User presses `a` → Input Modal opens, title field focused
2. User types title, presses `Tab` → cursor moves to description
3. User optionally fills description, `Tab` → priority selector
4. User picks priority with `←/→`, `Tab` → project field
5. User types project name (autocomplete from existing), `Tab` → due date
6. User types date or leaves empty, `Tab` → tags
7. User types comma-separated tags
8. `Enter` → Task created with `status: "todo"`, modal closes, list scrolls to new task
9. `Esc` at any point → Cancel, nothing saved

### 9.2 Completing a Task

1. User navigates to task with `j/k`
2. User presses `d`
3. Task status toggles: `todo`/`in_progress` → `done` (sets `completedAt`), `done` → `todo` (clears `completedAt`)
4. Task moves to appropriate group with subtle animation
5. Status bar updates count

### 9.3 Quick Priority Change

1. User selects task, presses `!`
2. Select Modal opens showing priority options
3. User presses `j/k` to navigate, `Enter` to select
4. Task priority updates, row color changes immediately
5. If sorted by priority, task reorders

### 9.4 Searching and Filtering

1. User presses `/` → Search overlay opens
2. User types query → results filter in real-time
3. User presses `j/k` to navigate within results
4. `Enter` → jumps to that task, search closes
5. Or: `Esc` → clears search, returns to full list

### 9.5 Moving Tasks on the Board

1. User is in Project Board view (press `2`)
2. User navigates to task with `j/k` within a column
3. User presses `Shift+L` → task moves from "To Do" to "In Progress"
4. Column counts update, task appears in new column
5. `Shift+H` moves it back

---

## 10. State Management

### Task Store (`store/task-store.ts`)

Implement as a simple reactive store (no external library). The store exposes:

```typescript
interface TaskStore {
  // State
  tasks: Task[]
  
  // CRUD
  addTask(input: Omit<Task, "id" | "createdAt" | "updatedAt" | "completedAt" | "order">): Task
  updateTask(id: string, updates: Partial<Task>): Task | null
  deleteTask(id: string): boolean
  
  // Status transitions
  toggleDone(id: string): void
  moveToStatus(id: string, status: Task["status"]): void
  
  // Ordering
  reorder(id: string, direction: "up" | "down"): void
  
  // Queries
  getFiltered(filter: FilterState): Task[]
  getByProject(project: string): Task[]
  getByDate(date: string): Task[]
  getProjects(): string[]
  getTags(): string[]
  getStats(): { total: number; todo: number; inProgress: number; done: number }
  
  // Persistence
  save(): Promise<void>     // Write to disk (debounced)
  load(): Promise<void>     // Read from disk
  
  // Undo
  undo(): boolean
}
```

**Undo system:** Keep a single-level snapshot. Before any mutation, save `structuredClone(tasks)` to `previousState`. `undo()` swaps current with previous.

**Sorting logic for `getFiltered()`:**
- Priority sort order: urgent > high > medium > low > none
- Within same priority: sort by due date (earliest first), then by creation date
- Done tasks always sort to the bottom unless status filter is specifically "done"

---

## 11. Animations & Visual Polish

Use OpenTUI's `useTimeline` hook for subtle animations:

- **Task completion:** Brief green flash on the row when marked done
- **Task deletion:** Row fades out (opacity animation) before removal
- **Modal open/close:** Quick slide-in from center (scale from 0.95 → 1.0)
- **View transitions:** Crossfade between views (opacity swap)
- **Selection movement:** Smooth highlight transition between rows

Keep all animations under 200ms — terminal UIs must feel instant.

### Visual Details

- **Priority indicators:** Colored dots (●) before task title — red for urgent, orange for high, yellow for medium, cyan for low, gray for none
- **Status icons:** `○` todo, `◉` in progress (filled), `✓` done (green), `▪` archived (dim)
- **Due date warnings:** Red text if overdue, orange if due today, yellow if due this week
- **Tag badges:** Cyan text with `#` prefix
- **Selected row:** Full-width highlight bar with left border accent
- **Focused panel:** Brighter border color

---

## 12. Edge Cases & Error Handling

| Scenario | Behavior |
|----------|----------|
| Empty task list | Show centered message: "No tasks yet. Press **a** to add one." |
| Corrupted JSON file | Backup to `.bak`, start with empty list, show warning in status bar |
| Very long task title | Truncate with `…` in list view, show full in detail panel |
| Terminal too narrow (<40 cols) | Show single-column layout, hide detail panel |
| Terminal too short (<10 rows) | Hide status bar, compact header |
| Duplicate project names | Case-insensitive matching |
| Date validation | Accept YYYY-MM-DD only, show red border on invalid input |
| No tasks match filter | Show "No matching tasks" with current filter info |
| Rapid key presses | Debounce persistence (300ms), but update UI immediately |

---

## 13. Implementation Order

Build in this exact sequence to have a working app at every step:

### Phase 1: Foundation (Get something on screen)
1. Initialize project: `bun init`, install `@opentui/core` and `@opentui/react`
2. Create `bin/tsk.ts` entry point with renderer setup
3. Create `<App />` with header + empty content area + status bar
4. Implement color theme constants
5. Verify it runs: `bun run bin/tsk.ts`

### Phase 2: Data Layer
6. Define TypeScript types (`Task`, `AppState`, `FilterState`)
7. Implement `TaskStore` with in-memory CRUD operations
8. Add JSON persistence (load/save to `~/.tsk/tasks.json`)
9. Add debounced auto-save

### Phase 3: Task List View (Core UX)
10. Implement `<TaskRow />` component with proper styling
11. Implement `<TaskListView />` with scrollable list
12. Add `j/k` navigation with `useKeyboard` hook
13. Add selected row highlighting
14. Implement `<TaskDetailPanel />` (right panel)
15. Add `Tab` to switch focus between panels

### Phase 4: Task Actions
16. Implement `<Modal />` wrapper component
17. Implement `<InputModal />` for adding tasks (`a` key)
18. Implement editing tasks (`e` key) reusing InputModal
19. Implement toggle done (`d` key)
20. Implement delete with `<ConfirmModal />` (`x` key)
21. Implement `<SelectModal />` for priority (`!` key)
22. Implement project assignment (`p` key)
23. Implement tag management (`t` key)
24. Implement due date setting (`D` key)

### Phase 5: Search & Filter
25. Implement search overlay (`/` key) with real-time filtering
26. Implement status filter cycling (`f` key)
27. Implement sort cycling (`s` key)
28. Add filter/sort indicators to status bar

### Phase 6: Additional Views
29. Implement Project Board view (3-column kanban)
30. Add column navigation (`h/l`) and task movement (`Shift+H/L`)
31. Implement Calendar view with month grid
32. Implement Help overlay (`?` key)

### Phase 7: Polish
33. Add animations (completion flash, deletion fade, modal transitions)
34. Add undo system (`u` key)
35. Handle responsive layouts (`useTerminalDimensions`)
36. Add edge case handling (empty states, validation, error recovery)
37. Manual testing across different terminal sizes
38. Write README with install instructions and feature overview

---

## 14. Key Technical Decisions for the Builder

1. **Use `@opentui/react` (not core imperative API)** — React's declarative model with hooks (`useState`, `useEffect`, `useKeyboard`) is cleaner for managing complex UI state like modals, filters, and view switching.

2. **`useAlternateScreen: true`** — Essential. This ensures the app takes over the full terminal and restores the previous screen on exit.

3. **`useKeyboard` for all input** — Register a single global keyboard handler in `<App />` that routes to the active view/modal. Modals should capture keys and prevent propagation.

4. **State lives in React `useState`** — The `TaskStore` can be a plain class, but the app state (selected index, active view, modal stack) should be React state so the UI re-renders on change.

5. **Flexbox layout everywhere** — OpenTUI uses Yoga. Use `flexDirection: "column"` for the shell, `flexDirection: "row"` for panels, `flexGrow: 1` for the content area.

6. **`<scrollbox>` for long lists** — Wrap the task list in `<scrollbox>` with keyboard-controlled scrolling. Auto-scroll to keep the selected item visible.

7. **Modal stack pattern** — `modalStack: ModalState[]` in state. Opening a modal pushes, closing pops. Keyboard handler checks `modalStack.length > 0` to route keys to modal instead of the view.

8. **Never call `process.exit()` directly** — Use `renderer.destroy()` for clean shutdown, as recommended by OpenTUI docs.

9. **Color as constants, not magic strings** — All colors from `theme/colors.ts`. This makes theme changes trivial.

10. **Test with the OpenTUI debug console** — Toggle with backtick key during development. Use `console.log` for debugging state changes.

---

## 15. Acceptance Criteria

The app is considered complete when:

- [ ] Launches with `bun run bin/tsk.ts` without errors
- [ ] Shows header, content area, and status bar on launch
- [ ] Can add a new task with title, description, priority, project, tags, and due date
- [ ] Can edit any field of an existing task
- [ ] Can mark tasks as done/undone with `d`
- [ ] Can delete tasks with confirmation
- [ ] `j/k` navigation works smoothly with visible selection
- [ ] Search with `/` filters tasks in real-time
- [ ] Sort and filter cycling works (`s` and `f`)
- [ ] Project Board view shows kanban columns with task movement
- [ ] Calendar view shows due dates on a month grid
- [ ] Help overlay shows all keybindings
- [ ] Data persists between sessions (`~/.tsk/tasks.json`)
- [ ] Undo works for the last action
- [ ] App looks visually polished with consistent colors and spacing
- [ ] Responsive behavior for narrow terminals
- [ ] Clean exit with `q` or `Ctrl+C` (no orphaned processes)