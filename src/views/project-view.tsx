import { useState, useEffect, useMemo } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { Task, TaskStatus } from "../store/types.ts";
import type { TaskStore } from "../store/task-store.ts";
import { colors } from "../theme/colors.ts";

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "todo", label: "To Do" },
  { status: "in_progress", label: "In Progress" },
  { status: "done", label: "Done" },
];

const STATUS_ICON: Record<TaskStatus, string> = {
  todo: "○", in_progress: "◉", done: "✓", archived: "▪",
};

const PRIORITY_BADGE: Record<Task["priority"], string> = {
  urgent: "U", high: "H", medium: "M", low: "L", none: "-",
};

const PRIORITY_WEIGHT: Record<Task["priority"], number> = {
  none: 0, low: 1, medium: 2, high: 3, urgent: 4,
};

const NEXT_STATUS: Record<string, TaskStatus> = {
  todo: "in_progress", in_progress: "done",
};
const PREV_STATUS: Record<string, TaskStatus> = {
  in_progress: "todo", done: "in_progress",
};

interface ModalAdd { type: "add" }
interface ModalEdit { type: "edit"; task: Task }
interface ModalDelete { type: "confirm-delete"; task: Task }
type ModalType = ModalAdd | ModalEdit | ModalDelete;

interface ProjectViewProps {
  store: TaskStore;
  tasks: Task[];
  pushModal: (modal: ModalType) => void;
  isModalOpen: boolean;
}

export function ProjectView({ store, tasks, pushModal, isModalOpen }: ProjectViewProps) {
  const { width } = useTerminalDimensions();
  const isNarrow = width < 100;
  const [activeCol, setActiveCol] = useState(0);
  const [colIndices, setColIndices] = useState<[number, number, number]>([0, 0, 0]);

  const columns = useMemo(() => COLUMNS.map(({ status }) => {
    // Only show top-level tasks in kanban columns
    const col = tasks.filter((t) => t.parentId === null && t.status === status);
    if (status === "done") {
      col.sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
    } else {
      col.sort((a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority]);
    }
    return col;
  }), [tasks]);

  // Clamp indices when column sizes change
  useEffect(() => {
    setColIndices((prev) => [
      Math.min(prev[0], Math.max(0, columns[0]!.length - 1)),
      Math.min(prev[1], Math.max(0, columns[1]!.length - 1)),
      Math.min(prev[2], Math.max(0, columns[2]!.length - 1)),
    ]);
  }, [columns]);

  useKeyboard((e) => {
    if (isModalOpen) return;
    const col = columns[activeCol]!;
    const idx = colIndices[activeCol]!;
    const last = col.length - 1;
    const selectedTask = col[idx] ?? null;

    switch (e.name) {
      case "h": case "left":
        setActiveCol((c) => Math.max(0, c - 1));
        return;
      case "l": case "right":
        setActiveCol((c) => Math.min(2, c + 1));
        return;
      case "j": case "down":
        setColIndices((p) => {
          const n = [...p] as [number, number, number];
          n[activeCol] = Math.min(idx + 1, last);
          return n;
        });
        return;
      case "k": case "up":
        setColIndices((p) => {
          const n = [...p] as [number, number, number];
          n[activeCol] = Math.max(idx - 1, 0);
          return n;
        });
        return;
      case "g":
        setColIndices((p) => {
          const n = [...p] as [number, number, number];
          n[activeCol] = 0;
          return n;
        });
        return;
      case "G":
        setColIndices((p) => {
          const n = [...p] as [number, number, number];
          n[activeCol] = last;
          return n;
        });
        return;

      // Move task to next/prev column
      case "L":
        if (selectedTask) {
          const next = NEXT_STATUS[selectedTask.status];
          if (next) store.moveToStatus(selectedTask.id, next);
        }
        return;
      case "H":
        if (selectedTask) {
          const prev = PREV_STATUS[selectedTask.status];
          if (prev) store.moveToStatus(selectedTask.id, prev);
        }
        return;

      case "d":
        if (selectedTask) store.toggleDone(selectedTask.id);
        return;
      case "a":
        pushModal({ type: "add" });
        return;
      case "e":
        if (selectedTask) pushModal({ type: "edit", task: selectedTask });
        return;
      case "x":
        if (selectedTask) pushModal({ type: "confirm-delete", task: selectedTask });
        return;
      case "u":
        store.undo();
        return;
    }
  });

  const visibleColumns = isNarrow
    ? [{ def: COLUMNS[activeCol]!, ci: activeCol }]
    : COLUMNS.map((def, ci) => ({ def, ci }));

  return (
    <box flexDirection="row" flexGrow={1}>
      {visibleColumns.map(({ def, ci }) => {
        const col = columns[ci]!;
        const isActive = ci === activeCol;
        const selIdx = colIndices[ci];
        return (
          <box
            key={def.status}
            flexDirection="column"
            width={isNarrow ? "100%" : "33%"}
            borderStyle="single"
            border={true}
            borderColor={isActive ? colors.borderFocus : colors.border}
            title={`${def.label} (${col.length})`}
          >
            <scrollbox scrollY={true} flexGrow={1}>
              {col.length === 0 ? (
                <box justifyContent="center" alignItems="center" flexGrow={1}>
                  <text content="No tasks" fg={colors.fgDim} />
                </box>
              ) : col.map((task, i) => {
                const isSel = isActive && i === selIdx;
                const isDone = task.status === "done";
                const hasSubtasks = task.subtaskIds.length > 0;
                const progress = hasSubtasks ? store.getProgress(task.id) : null;
                const progressStr = progress && progress.total > 0
                  ? ` [${progress.done}/${progress.total}]`
                  : "";
                const progressColor = progress && progress.total > 0
                  ? (progress.done === progress.total ? colors.green
                    : progress.done > 0 ? colors.yellow
                    : colors.fgDim)
                  : colors.fgDim;
                return (
                  <box
                    key={task.id}
                    flexDirection="row"
                    height={1}
                    backgroundColor={isSel ? colors.bgHighlight : undefined}
                  >
                    <text content={isSel ? "▎" : " "} fg={isActive ? colors.accent : colors.border} />
                    <text content={STATUS_ICON[task.status]} fg={colors.status[task.status]} />
                    <text content=" " />
                    <text
                      content={task.title}
                      fg={isDone ? colors.fgDim : colors.fg}
                      attributes={isDone ? 130 : 0}
                      flexGrow={1}
                      overflow="hidden"
                    />
                    {progressStr ? (
                      <text content={progressStr} fg={progressColor} />
                    ) : null}
                    <text
                      content={` ${PRIORITY_BADGE[task.priority]}`}
                      fg={colors.priority[task.priority]}
                    />
                    <text content=" " />
                  </box>
                );
              })}
            </scrollbox>
          </box>
        );
      })}
    </box>
  );
}
