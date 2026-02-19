# Session 7 — Subtask TUI Rendering

> **Prerequisite**: None — this session is independent (store subtask support already exists).

<context>
- Project: tsk — terminal task manager
- Stack: TypeScript strict, Bun, @opentui/react
- Store already has full subtask support:
  - `addSubtask(parentId, input)`, `removeSubtask()`, `promoteSubtask()`, `indentTask()`
  - `getSubtasks(parentId)`, `getProgress(taskId)`, `getTopLevelTasks()`
  - `getTaskTree(rootId?)`, `getFilteredTree(filter)` — returns `{ task, depth, isLast }[]`
- Task type has: parentId (string|null), subtaskIds (string[])
- Views that need updating:
  - `src/views/task-list.tsx` — main list view (two-panel)
  - `src/components/task-row.tsx` — single row component
  - `src/components/task-detail.tsx` — right detail panel
  - `src/views/project-view.tsx` — kanban board
- Current task-list.tsx uses `store.getFiltered(filter)` which returns flat list
- `store.getFilteredTree(filter)` is available but not used in views yet
</context>

<role>
You are a senior React/terminal UI developer completing the subtask rendering for a terminal task manager. You will update multiple view components to show task hierarchies with tree characters, collapse/expand, indent/promote keybindings, and progress indicators.
</role>

<task>
Complete the subtask TUI: tree rendering in task list, collapse/expand, indent/promote keybindings, progress display, and kanban subtask counts.
</task>

<requirements>

## 1. Task List View — Tree Rendering (`src/views/task-list.tsx`)

### 1.1 Switch to tree-ordered data

Replace:
```typescript
const tasks = store.getFiltered(filter);
```

With:
```typescript
const treeItems = store.getFilteredTree(filter);
// treeItems: Array<{ task: Task; depth: number; isLast: boolean }>
```

This returns tasks in tree order: parent, then children (indented), then next parent.

### 1.2 Collapse/expand state

Add per-parent collapse state:

```typescript
const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

function toggleCollapse(taskId: string) {
  setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(taskId)) next.delete(taskId);
    else next.add(taskId);
    return next;
  });
}

// Filter out children of collapsed parents
const visibleItems = treeItems.filter(item => {
  if (item.depth === 0) return true;
  // Walk up parents — if any ancestor is collapsed, hide this item
  let current = item.task;
  while (current.parentId) {
    if (collapsed.has(current.parentId)) return false;
    current = store.tasks.find(t => t.id === current.parentId) ?? current;
    if (current.id === item.task.id) break; // safety
  }
  return true;
});
```

### 1.3 Visual rendering

Pass depth and tree info to `<TaskRow />`:

```
  ▾ ● Fix authentication system       dev    [2/4]  H  !
  │ ├─ ○ Audit current JWT flow                      M
  │ ├─ ✓ Write migration script                      M
  │ ├─ ○ Update API endpoints                        H
  │ └─ ○ Write tests                                 M
  ○ Write documentation                —             L
  ▸ ● Deploy new API version           dev    [0/2]  H
  ○ Update billing system              —             M
```

**Tree character rules:**
- Depth 0: no prefix
- Depth 1+: use box-drawing characters
  - `├─ ` for non-last children
  - `└─ ` for last child
  - `│ ` continuation line for siblings that follow
  - Indent: 2 chars per depth level

**Collapse indicators on parents:**
- `▾` = expanded (has visible children)
- `▸` = collapsed (children hidden)
- No indicator on leaf tasks

**Progress on parents:**
- `[2/4]` after title showing `[done/total]` subtask count
- Color: green if all done, yellow if partial, dim if 0 done

### 1.4 New keybindings

Add to the keyboard handler in task-list.tsx:

| Key | Condition | Action |
|-----|-----------|--------|
| `Enter` or `→` | Selected task has subtaskIds.length > 0 | Toggle collapse/expand |
| `←` | Selected task has parentId | Jump selection to parent task |
| `Shift+→` | Selected task is top-level or has a different parent | Indent: make subtask of the task directly above in the list |
| `Shift+←` | Selected task has parentId | Promote: make top-level (call store.promoteSubtask) |
| `A` (Shift+A) | Any task selected | Add subtask under selected task (open input modal with parentId) |
| `a` | Any | Add task as sibling (same level as selected — if selected has parentId, new task gets same parentId) |

**Indent logic** (`Shift+→`):
```typescript
function handleIndent(selectedTask: Task, visibleItems: TreeItem[]) {
  // Find the task directly above in the visible list
  const currentIdx = visibleItems.findIndex(i => i.task.id === selectedTask.id);
  if (currentIdx <= 0) return;
  const taskAbove = visibleItems[currentIdx - 1].task;

  // Can't indent under itself or its own children
  // Can't indent if already a subtask of taskAbove
  if (selectedTask.parentId === taskAbove.id) return;

  store.indentTask(selectedTask.id, taskAbove.id);
}
```

**Promote logic** (`Shift+←`):
```typescript
function handlePromote(selectedTask: Task) {
  if (!selectedTask.parentId) return;
  store.promoteSubtask(selectedTask.id);
}
```

### 1.5 Selection behavior with tree

- `j/k` moves through **visible** items (skipping collapsed children)
- `g/G` goes to first/last visible item
- `J/K` page jumps through visible items
- When collapsing a parent: if selected item was a hidden child, move selection to parent
- When deleting a parent: selection moves to next visible item

## 2. Task Row Component (`src/components/task-row.tsx`)

### 2.1 New props

```typescript
interface TaskRowProps {
  task: Task;
  isSelected: boolean;
  width: number;
  // NEW
  depth?: number;           // 0 = top-level, 1+ = subtask
  isLast?: boolean;         // Last child at this depth
  isCollapsed?: boolean;    // Only for parents: true = collapsed
  hasChildren?: boolean;    // true if task.subtaskIds.length > 0
  progress?: { done: number; total: number } | null;  // Subtask progress
}
```

### 2.2 Tree prefix rendering

Build the tree prefix string based on depth:

```typescript
function buildTreePrefix(depth: number, isLast: boolean): string {
  if (depth === 0) return "";
  // For depth 1: "├─ " or "└─ "
  // For deeper: add "│ " for each ancestor level
  const connector = isLast ? "└─ " : "├─ ";
  const padding = "│ ".repeat(Math.max(0, depth - 1));
  return padding + connector;
}
```

Apply tree prefix before the status icon:
```
[accent bar][tree prefix][collapse icon][status icon] [title] [progress] [project] [priority] [due]
```

### 2.3 Collapse indicator

For parent tasks (hasChildren === true):
```typescript
const collapseIcon = hasChildren
  ? (isCollapsed ? "▸ " : "▾ ")
  : "  ";
```

### 2.4 Progress badge

For parent tasks with subtasks:
```typescript
if (progress && progress.total > 0) {
  const color = progress.done === progress.total
    ? colors.green
    : progress.done > 0
    ? colors.yellow
    : colors.fgDim;
  // Render [done/total] after title
  progressText = `[${progress.done}/${progress.total}]`;
}
```

### 2.5 Subtask dimming

Subtasks (depth > 0) should have slightly dimmer styling than top-level tasks to create visual hierarchy. Don't go too dim — they should still be readable.

## 3. Task Detail Panel (`src/components/task-detail.tsx`)

### 3.1 Subtask checklist

When viewing a task that has subtasks, show a checklist section:

```
  ─── Details ───────────────
  Title: Fix authentication system
  Status: ◉ In Progress
  Priority: 🔴 High
  Project: dev
  ...

  ─── Subtasks [2/4] ───────
  ✓ Audit current JWT flow
  ✓ Write migration script
  ○ Update API endpoints
  ○ Write tests

  [A] Add subtask
```

Implementation:
```typescript
const subtasks = store.getSubtasks(task.id);
const progress = store.getProgress(task.id);

// Render subtask section if any exist
if (subtasks.length > 0) {
  // Section header with progress
  // List each subtask with status icon + title
  // Hint: [A] to add subtask
}
```

### 3.2 Parent reference

When viewing a subtask, show which parent it belongs to:

```
  Parent: Fix authentication system
```

Render as a dim label with the parent's title. Clicking/pressing Enter on it could jump to the parent.

## 4. Kanban Board (`src/views/project-view.tsx`)

### 4.1 Subtask counts on cards

In the kanban board, parent tasks should show subtask progress:

```
  Fix authentication [2/4]
```

Modify the card rendering to include `[done/total]` when `task.subtaskIds.length > 0`.

### 4.2 Filter subtasks from columns

In kanban view, only show **top-level tasks** in columns (not subtasks):
```typescript
const columnTasks = tasks.filter(t => t.parentId === null && t.status === columnStatus);
```

Subtasks are visible via the progress count and detail panel.

## 5. Help View (`src/views/help-view.tsx`)

Add subtask keybindings to the help overlay:

```
  SUBTASKS
  A         Add subtask under selected
  a         Add sibling task
  Shift+→   Indent (make subtask of task above)
  Shift+←   Promote (make top-level)
  Enter/→   Expand/collapse subtasks
  ←         Jump to parent task
```

</requirements>

<implementation>

## Step 1: Task row tree rendering
1. Read `src/components/task-row.tsx` — understand current layout
2. Add new props: depth, isLast, isCollapsed, hasChildren, progress
3. Implement buildTreePrefix with box-drawing characters
4. Add collapse icon (▸/▾) for parent tasks
5. Add progress badge [done/total] after title
6. Add subtle dimming for subtask rows

## Step 2: Task list view — tree data source
7. Read `src/views/task-list.tsx` — understand current data flow
8. Switch from `store.getFiltered()` to `store.getFilteredTree()`
9. Add collapsed state (Set<string>)
10. Implement visible items filtering (hide children of collapsed parents)
11. Pass depth/isLast/isCollapsed/hasChildren/progress to each TaskRow

## Step 3: Task list view — keybindings
12. Add `Enter`/`→` on parent → toggleCollapse
13. Add `←` on subtask → jump to parent
14. Add `Shift+→` → indent (make subtask of task above)
15. Add `Shift+←` → promote (call store.promoteSubtask)
16. Add `A` (Shift+A) → add subtask modal (open input modal with parentId preset)
17. Modify `a` → add sibling (inherit parentId from selected task)
18. Fix selection behavior: when collapsing, ensure selected is visible

## Step 4: Task detail panel
19. Read `src/components/task-detail.tsx`
20. Add subtask checklist section with progress header
21. Add parent reference for subtasks
22. Add [A] hint for adding subtasks

## Step 5: Kanban board
23. Read `src/views/project-view.tsx`
24. Filter to top-level tasks only in columns
25. Add [done/total] progress on parent task cards

## Step 6: Help view
26. Add SUBTASKS section to help-view.tsx with all new keybindings

## Step 7: Verify
27. Run `bun run tsc --noEmit` — zero errors
28. Manual testing: create parent → add subtasks → collapse/expand → indent/promote

</implementation>

<constraints>
- Do NOT modify src/store/task-store.ts or src/store/types.ts — they're complete
- Only modify view and component files
- Preserve ALL existing keybindings — only ADD new ones
- Tree characters must use Unicode box-drawing: │ ├ └ ─ (safe across terminals)
- Collapse state is ephemeral (not persisted) — reset on app restart
- Default: all parents expanded
- Selection must never point to a hidden (collapsed) item
- Kanban shows top-level only — subtasks visible via progress count
- Keep all animations under 200ms
- Subtask indent limit: prevent nesting deeper than 5 levels
- Run `bun run tsc --noEmit` after implementation
</constraints>
