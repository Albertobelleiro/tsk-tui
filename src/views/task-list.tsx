import { useState, useRef, useEffect, useCallback } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { Task, FilterState, SortField, TaskStatus } from "../store/types.ts";
import type { TaskStore } from "../store/task-store.ts";
import { colors } from "../theme/colors.ts";
import { TaskRow } from "../components/task-row.tsx";
import { TaskDetailPanel } from "../components/task-detail.tsx";
import { SearchOverlay } from "../components/search-overlay.tsx";
import { showToast } from "../components/toast.tsx";

interface ModalAdd { type: "add" }
interface ModalEdit { type: "edit"; task: Task }
interface ModalDelete { type: "confirm-delete"; task: Task }
interface ModalPriority { type: "select-priority"; task: Task }
interface ModalProject { type: "select-project"; task: Task }
interface ModalTags { type: "select-tags"; task: Task }
interface ModalDueDate { type: "input-due-date"; task: Task }
interface ModalAddSubtask { type: "add-subtask"; parent: Task }

type ModalType = ModalAdd | ModalEdit | ModalDelete | ModalPriority | ModalProject | ModalTags | ModalDueDate | ModalAddSubtask;

const STATUS_CYCLE: (TaskStatus[] | "all")[] = [
  "all",
  ["todo"],
  ["in_progress"],
  ["done"],
];

const SORT_CYCLE: SortField[] = ["priority", "dueDate", "createdAt", "title", "order"];

const SORT_DEFAULTS: Record<SortField, "asc" | "desc"> = {
  priority: "desc",
  dueDate: "asc",
  createdAt: "asc",
  title: "asc",
  order: "asc",
};

export function shouldCaptureInput(searchOpen: boolean, inlineAdd: boolean): boolean {
  return searchOpen || inlineAdd;
}

export function shouldNotifyUnblocked(wasDone: boolean, hasRecurrence: boolean): boolean {
  return !wasDone && !hasRecurrence;
}

interface TaskListViewProps {
  store: TaskStore;
  tasks: Task[];
  totalCount: number;
  pushModal: (modal: ModalType) => void;
  isModalOpen: boolean;
  filter: FilterState;
  onFilterChange: (update: Partial<FilterState>) => void;
  onVisualCountChange?: (count: number) => void;
  onInputCaptureChange?: (capturing: boolean) => void;
}

export function TaskListView({
  store,
  tasks,
  totalCount,
  pushModal,
  isModalOpen,
  filter,
  onFilterChange,
  onVisualCountChange,
  onInputCaptureChange,
}: TaskListViewProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [focusPanel, setFocusPanel] = useState<"list" | "detail">("list");
  const [searchOpen, setSearchOpen] = useState(false);
  const [visualMode, setVisualMode] = useState(false);
  const [visualSet, setVisualSet] = useState<Set<number>>(new Set());
  const [inlineAdd, setInlineAdd] = useState(false);
  const [inlineText, setInlineText] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const { width } = useTerminalDimensions();
  const isNarrow = width < 80;

  function toggleCollapse(taskId: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  // Build tree-ordered list
  const allTreeItems = store.getFilteredTree(filter);

  // Filter out children of collapsed parents
  const treeItems = allTreeItems.filter(item => {
    if (item.depth === 0) return true;
    let current = item.task;
    while (current.parentId) {
      if (collapsed.has(current.parentId)) return false;
      const parent = store.tasks.find(t => t.id === current.parentId);
      if (!parent || parent.id === current.id) break;
      current = parent;
    }
    return true;
  });

  const flatTasks = treeItems.map((i) => i.task);

  // Clamp selection when visible items change (collapse/filter)
  useEffect(() => {
    if (flatTasks.length === 0) return;
    setSelectedIndex((prev) => Math.min(prev, flatTasks.length - 1));
  }, [flatTasks.length]);

  useEffect(() => {
    const sb = scrollRef.current;
    if (!sb || flatTasks.length === 0) return;
    sb.scrollTo({ x: 0, y: selectedIndex });
  }, [selectedIndex, flatTasks.length]);

  // Notify parent of visual selection count
  useEffect(() => {
    onVisualCountChange?.(visualMode ? visualSet.size : 0);
  }, [visualMode, visualSet.size, onVisualCountChange]);

  useEffect(() => {
    onInputCaptureChange?.(shouldCaptureInput(searchOpen, inlineAdd));
  }, [inlineAdd, onInputCaptureChange, searchOpen]);

  const exitVisualMode = useCallback(() => {
    setVisualMode(false);
    setVisualSet(new Set());
  }, []);

  useKeyboard((e) => {
    if (isModalOpen || searchOpen || inlineAdd) return;

    const selectedTask = flatTasks[selectedIndex] ?? null;
    const last = flatTasks.length - 1;

    // Visual mode keybindings
    if (visualMode) {
      switch (e.name) {
        case "escape":
          e.stopPropagation();
          e.preventDefault();
          exitVisualMode();
          return;
        case "j": case "down":
          setSelectedIndex((i) => {
            const next = Math.min(i + 1, last);
            setVisualSet((s) => new Set([...s, next]));
            return next;
          });
          return;
        case "k": case "up":
          setSelectedIndex((i) => {
            const next = Math.max(i - 1, 0);
            setVisualSet((s) => new Set([...s, next]));
            return next;
          });
          return;
        case "V": // Select all visible
          setVisualSet(new Set(flatTasks.map((_, i) => i)));
          return;
        case "d": { // Mark all done
          const selected = [...visualSet].map((i) => flatTasks[i]).filter((t): t is Task => t != null);
          for (const t of selected) store.toggleDone(t.id);
          showToast(`${selected.length} tasks marked done`, "success");
          exitVisualMode();
          return;
        }
        case "x": { // Delete all
          const selected = [...visualSet].map((i) => flatTasks[i]).filter((t): t is Task => t != null);
          for (const t of selected) store.deleteTask(t.id);
          showToast(`${selected.length} tasks deleted`, "success");
          exitVisualMode();
          return;
        }
        case "!": // Set priority for all
          if (selectedTask) {
            pushModal({ type: "select-priority", task: selectedTask });
          }
          return;
        case "p": // Set project for all
          if (selectedTask) {
            pushModal({ type: "select-project", task: selectedTask });
          }
          return;
      }
      return;
    }

    // Actions that work even with 0 tasks
    switch (e.name) {
      case "return":
      case "enter":
        // Toggle collapse on parent tasks
        if (selectedTask && selectedTask.subtaskIds.length > 0) {
          toggleCollapse(selectedTask.id);
          return;
        }
        break;
      case "a":
        // Add sibling: if selected is a subtask, new task gets same parentId
        if (selectedTask && selectedTask.parentId) {
          pushModal({ type: "add-subtask", parent: store.tasks.find(t => t.id === selectedTask.parentId)! });
        } else {
          pushModal({ type: "add" });
        }
        return;
      case "A": // Inline quick-add or add subtask
        if (selectedTask && selectedTask.subtaskIds.length >= 0) {
          // Add subtask to selected parent
          pushModal({ type: "add-subtask", parent: selectedTask });
        } else {
          setInlineAdd(true);
          setInlineText("");
        }
        return;
      case "u":
        if (store.undo()) showToast("Undo", "info");
        return;
      case "r":
        if (e.ctrl) {
          e.stopPropagation();
          e.preventDefault();
          if (store.redo()) showToast("Redo", "info");
        }
        return;
      case "v": // Enter visual mode
        setVisualMode(true);
        setVisualSet(new Set([selectedIndex]));
        return;
      case "/": {
        e.stopPropagation();
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      case "f": {
        if (e.ctrl) {
          // Ctrl+F as alt for search
          e.stopPropagation();
          e.preventDefault();
          setSearchOpen(true);
          return;
        }
        const curIdx = STATUS_CYCLE.findIndex((s) =>
          JSON.stringify(s) === JSON.stringify(filter.status),
        );
        const nextStatus = STATUS_CYCLE[(curIdx + 1) % STATUS_CYCLE.length]!;
        onFilterChange({ status: nextStatus });
        setSelectedIndex(0);
        return;
      }
      case "s": {
        const curSortIdx = SORT_CYCLE.indexOf(filter.sortBy);
        const nextSort = SORT_CYCLE[(curSortIdx + 1) % SORT_CYCLE.length]!;
        onFilterChange({ sortBy: nextSort, sortDirection: SORT_DEFAULTS[nextSort] });
        return;
      }
    }

    if (flatTasks.length === 0) return;

    // Navigation
    switch (e.name) {
      case "j":
      case "down":
        setSelectedIndex((i) => Math.min(i + 1, last));
        return;
      case "k":
      case "up":
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      case "g":
        setSelectedIndex(0);
        return;
      case "G":
        setSelectedIndex(last);
        return;
      case "J":
        setSelectedIndex((i) => Math.min(i + 10, last));
        return;
      case "K":
        setSelectedIndex((i) => Math.max(i - 10, 0));
        return;
      case "tab":
        if (!isNarrow) setFocusPanel((p) => (p === "list" ? "detail" : "list"));
        return;
      case "l":
      case "right":
        if (e.shift && selectedTask) {
          // Indent: make subtask of task above (max depth 5)
          if (selectedIndex > 0) {
            const above = flatTasks[selectedIndex - 1]!;
            const aboveItem = treeItems[selectedIndex - 1]!;
            if (aboveItem.depth >= 5) {
              showToast("Max nesting depth (5) reached", "info");
              return;
            }
            if (store.indentTask(selectedTask.id, above.id)) {
              showToast(`Indented under "${above.title}"`, "info");
            }
          }
          return;
        }
        // → on parent: expand (if collapsed)
        if (selectedTask && selectedTask.subtaskIds.length > 0 && collapsed.has(selectedTask.id)) {
          toggleCollapse(selectedTask.id);
          return;
        }
        if (!isNarrow) setFocusPanel("detail");
        return;
      case "h":
      case "left":
        if (e.shift && selectedTask && selectedTask.parentId) {
          // Promote: un-indent
          if (store.promoteSubtask(selectedTask.id)) {
            showToast("Promoted to top level", "info");
          }
          return;
        }
        // ← on subtask: jump to parent
        if (selectedTask && selectedTask.parentId) {
          const parentIdx = flatTasks.findIndex(t => t.id === selectedTask.parentId);
          if (parentIdx >= 0) {
            setSelectedIndex(parentIdx);
            return;
          }
        }
        // ← on expanded parent: collapse
        if (selectedTask && selectedTask.subtaskIds.length > 0 && !collapsed.has(selectedTask.id)) {
          toggleCollapse(selectedTask.id);
          return;
        }
        setFocusPanel("list");
        return;
    }

    // Actions that need a selected task
    if (!selectedTask) return;
    switch (e.name) {
      case "e":
        pushModal({ type: "edit", task: selectedTask });
        break;
      case "d":
        if (selectedTask.recurrence) {
          const next = store.completeRecurring(selectedTask.id);
          if (next) showToast(`Next: ${next.dueDate}`, "info");
        } else {
          const wasDone = selectedTask.status === "done";
          store.toggleDone(selectedTask.id);
          // Check unblocked tasks
          if (shouldNotifyUnblocked(wasDone, selectedTask.recurrence !== null)) {
            const unblocked = store.getUnblockedTasks(selectedTask.id);
            for (const uid of unblocked) {
              const ut = store.tasks.find((t) => t.id === uid);
              if (ut) showToast(`Unblocked: ${ut.title}`, "success");
            }
          }
        }
        break;
      case "x":
        pushModal({ type: "confirm-delete", task: selectedTask });
        break;
      case "!":
        pushModal({ type: "select-priority", task: selectedTask });
        break;
      case "p":
        pushModal({ type: "select-project", task: selectedTask });
        break;
      case "t":
        pushModal({ type: "select-tags", task: selectedTask });
        break;
      case "D":
        pushModal({ type: "input-due-date", task: selectedTask });
        break;
      case "n": // Notes — use edit modal for now
        // Could open a notes panel; for v0.2 we use a simple toast
        showToast(`${selectedTask.notes.length} notes — press 'e' to edit`, "info");
        break;
      case "T":
        // Time tracking: toggle timer
        if (store.activeTimerTaskId === selectedTask.id) {
          const elapsed = store.stopTimer();
          showToast(`Timer stopped: ${elapsed}m logged`, "success");
        } else {
          store.startTimer(selectedTask.id);
          showToast(`Timer started for "${selectedTask.title}"`, "info");
        }
        break;
    }
  });

  // Inline add keyboard handler
  useKeyboard((e) => {
    if (!inlineAdd) return;
    // Handled by <input> component, but Esc cancels
    if (e.name === "escape") {
      e.stopPropagation();
      e.preventDefault();
      setInlineAdd(false);
      setInlineText("");
    }
  });

  // Empty states
  if (flatTasks.length === 0 && !inlineAdd) {
    const hasTasksButFiltered = totalCount > 0;
    return (
      <>
        <box flexGrow={1} justifyContent="center" alignItems="center">
          <text
            content={
              hasTasksButFiltered
                ? "No matching tasks. Press [f] to change filter or [/] to search."
                : "No tasks yet. Press [a] to add one."
            }
            fg={colors.fgDim}
          />
        </box>
        {searchOpen && (
          <SearchOverlay
            initialQuery={filter.search}
            results={[]}
            onQueryChange={(q) => onFilterChange({ search: q })}
            onSelect={() => {}}
            onClose={() => {
              onFilterChange({ search: "" });
              setSearchOpen(false);
            }}
          />
        )}
      </>
    );
  }

  const selectedTask = flatTasks[selectedIndex] ?? null;
  const listFocused = focusPanel === "list";

  return (
    <box flexDirection="row" flexGrow={1}>
      <box flexDirection="column" width={isNarrow ? "100%" : "60%"}>
        <scrollbox
          ref={scrollRef}
          scrollY={true}
          viewportCulling={true}
          flexGrow={1}
        >
          {treeItems.map((item, i) => {
            // Build ancestorIsLast by walking up parents
            const ancestorIsLast: boolean[] = [];
            if (item.depth > 1) {
              let cur = item.task;
              const stack: boolean[] = [];
              // Walk through prior items to find ancestors
              for (let d = item.depth - 1; d >= 1; d--) {
                // Find the ancestor at this depth by scanning backwards
                for (let j = i - 1; j >= 0; j--) {
                  if (treeItems[j]!.depth === d) {
                    stack.unshift(treeItems[j]!.isLast);
                    break;
                  }
                  if (treeItems[j]!.depth < d) break;
                }
              }
              ancestorIsLast.push(...stack);
            }
            return (
              <TaskRow
                key={item.task.id}
                task={item.task}
                isSelected={i === selectedIndex}
                isFocused={listFocused && i === selectedIndex}
                depth={item.depth}
                isLast={item.isLast}
                isBlocked={store.isBlocked(item.task.id)}
                isCollapsed={collapsed.has(item.task.id)}
                hasChildren={item.task.subtaskIds.length > 0}
                progress={item.task.subtaskIds.length > 0 ? store.getProgress(item.task.id) : null}
                isVisualSelected={visualMode && visualSet.has(i)}
                ancestorIsLast={ancestorIsLast}
              />
            );
          })}
          {/* Inline quick-add row */}
          {inlineAdd ? (
            <box flexDirection="row" height={1} backgroundColor={colors.bgHighlight}>
              <text content="▎" fg={colors.accent} />
              <text content="+ " fg={colors.green} />
              <input
                focused={true}
                value={inlineText}
                onInput={setInlineText}
                onSubmit={() => {
                  if (inlineText.trim()) {
                    store.addTask({ title: inlineText.trim() });
                    showToast(`Added: "${inlineText.trim()}"`, "success");
                  }
                  setInlineAdd(false);
                  setInlineText("");
                }}
                placeholder="New task..."
                flexGrow={1}
                textColor={colors.fg}
                backgroundColor={colors.bgHighlight}
              />
            </box>
          ) : null}
        </scrollbox>
        <box height={1} backgroundColor={colors.bgDark}>
          <text
            content=" [a]dd [e]dit [d]one [x]del [/]search [f]ilter [s]ort [v]isual [T]imer"
            fg={colors.fgDim}
          />
        </box>
      </box>

      {!isNarrow ? (
        <TaskDetailPanel
          task={selectedTask}
          isFocused={focusPanel === "detail"}
          store={store}
        />
      ) : null}

      {searchOpen && (
        <SearchOverlay
          initialQuery={filter.search}
          results={flatTasks}
          onQueryChange={(q) => onFilterChange({ search: q })}
          onSelect={(task) => {
            const idx = flatTasks.findIndex((t) => t.id === task.id);
            if (idx >= 0) setSelectedIndex(idx);
            setSearchOpen(false);
          }}
          onClose={() => {
            onFilterChange({ search: "" });
            setSearchOpen(false);
          }}
        />
      )}
    </box>
  );
}
