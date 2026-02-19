import { useState, useRef, useEffect } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { Task, FilterState, SortField, TaskStatus } from "../store/types.ts";
import type { TaskStore } from "../store/task-store.ts";
import { colors } from "../theme/colors.ts";
import { TaskRow } from "../components/task-row.tsx";
import { TaskDetailPanel } from "../components/task-detail.tsx";
import { SearchOverlay } from "../components/search-overlay.tsx";

interface ModalAdd { type: "add" }
interface ModalEdit { type: "edit"; task: Task }
interface ModalDelete { type: "confirm-delete"; task: Task }
interface ModalPriority { type: "select-priority"; task: Task }
interface ModalProject { type: "select-project"; task: Task }
interface ModalTags { type: "select-tags"; task: Task }
interface ModalDueDate { type: "input-due-date"; task: Task }

type ModalType = ModalAdd | ModalEdit | ModalDelete | ModalPriority | ModalProject | ModalTags | ModalDueDate;

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

interface TaskListViewProps {
  store: TaskStore;
  tasks: Task[];
  totalCount: number;
  pushModal: (modal: ModalType) => void;
  isModalOpen: boolean;
  filter: FilterState;
  onFilterChange: (update: Partial<FilterState>) => void;
}

export function TaskListView({
  store,
  tasks,
  totalCount,
  pushModal,
  isModalOpen,
  filter,
  onFilterChange,
}: TaskListViewProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [focusPanel, setFocusPanel] = useState<"list" | "detail">("list");
  const [searchOpen, setSearchOpen] = useState(false);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const { width } = useTerminalDimensions();
  const isNarrow = width < 80;

  useEffect(() => {
    if (tasks.length === 0) return;
    setSelectedIndex((prev) => Math.min(prev, tasks.length - 1));
  }, [tasks.length]);

  useEffect(() => {
    const sb = scrollRef.current;
    if (!sb || tasks.length === 0) return;
    sb.scrollTo({ x: 0, y: selectedIndex });
  }, [selectedIndex, tasks.length]);

  useKeyboard((e) => {
    if (isModalOpen || searchOpen) return;

    const selectedTask = tasks[selectedIndex] ?? null;
    const last = tasks.length - 1;

    // Actions that work even with 0 tasks
    switch (e.name) {
      case "a":
        pushModal({ type: "add" });
        return;
      case "u":
        store.undo();
        return;
      case "/": {
        e.stopPropagation();
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      case "f": {
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

    if (tasks.length === 0) return;

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
        if (!isNarrow) setFocusPanel("detail");
        return;
      case "h":
      case "left":
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
        store.toggleDone(selectedTask.id);
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
    }
  });

  // Empty states
  if (tasks.length === 0) {
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

  const selectedTask = tasks[selectedIndex] ?? null;
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
          {tasks.map((task, i) => (
            <TaskRow
              key={task.id}
              task={task}
              isSelected={i === selectedIndex}
              isFocused={listFocused && i === selectedIndex}
            />
          ))}
        </scrollbox>
        <box height={1} backgroundColor={colors.bgDark}>
          <text
            content=" [a]dd [e]dit [d]one [x]del [/]search [f]ilter [s]ort [!]pri"
            fg={colors.fgDim}
          />
        </box>
      </box>

      {!isNarrow ? (
        <TaskDetailPanel
          task={selectedTask}
          isFocused={focusPanel === "detail"}
        />
      ) : null}

      {searchOpen && (
        <SearchOverlay
          initialQuery={filter.search}
          results={tasks}
          onQueryChange={(q) => onFilterChange({ search: q })}
          onSelect={(task) => {
            const idx = tasks.findIndex((t) => t.id === task.id);
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
