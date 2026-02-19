import { useState, useEffect, useRef } from "react";
import type { Task } from "../store/types.ts";
import { colors } from "../theme/colors.ts";
import { formatShortDate, isDueOverdue, isDueToday, isDueThisWeek } from "../utils/date.ts";

const STATUS_ICON: Record<Task["status"], string> = {
  todo: "○",
  in_progress: "◉",
  done: "✓",
  archived: "▪",
};

const PRIORITY_BADGE: Record<Task["priority"], string> = {
  urgent: "U",
  high: "H",
  medium: "M",
  low: "L",
  none: "-",
};

interface TaskRowProps {
  task: Task;
  isSelected: boolean;
  isFocused: boolean;
  depth?: number;
  isLast?: boolean;
  isBlocked?: boolean;
  isCollapsed?: boolean;
  hasChildren?: boolean;
  progress?: { done: number; total: number } | null;
  isVisualSelected?: boolean;
  ancestorIsLast?: boolean[];  // Track which ancestors are "last" for continuation lines
}

function getDueDateColor(iso: string): string {
  if (isDueOverdue(iso)) return colors.red;
  if (isDueToday(iso)) return colors.orange;
  if (isDueThisWeek(iso)) return colors.yellow;
  return colors.fgDim;
}

export function TaskRow({
  task,
  isSelected,
  isFocused,
  depth = 0,
  isLast = true,
  isBlocked = false,
  isCollapsed = false,
  hasChildren = false,
  progress = null,
  isVisualSelected = false,
  ancestorIsLast = [],
}: TaskRowProps) {
  const isDone = task.status === "done";
  const prevStatusRef = useRef(task.status);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (task.status === "done" && prevStatusRef.current !== "done") {
      setFlash(true);
      const timer = setTimeout(() => setFlash(false), 150);
      return () => clearTimeout(timer);
    }
    prevStatusRef.current = task.status;
  }, [task.status]);

  const isSubtask = depth > 0;
  const titleFg = isDone ? colors.fgDim : isSubtask ? colors.fgBright : colors.fg;
  const titleAttr = isDone ? 130 : isSubtask ? 2 : 0; // dim attribute for subtasks

  const highlighted = isSelected || isVisualSelected;
  const bg = flash ? colors.green : highlighted ? colors.bgHighlight : undefined;

  const project = task.project
    ? task.project.length > 8 ? task.project.slice(0, 7) + "…" : task.project
    : "";

  const dueStr = task.dueDate ? formatShortDate(task.dueDate) : "";
  const dueFg = task.dueDate ? getDueDateColor(task.dueDate) : colors.fgDim;

  const accentColor = isSelected
    ? isFocused ? colors.accent : colors.border
    : isVisualSelected ? colors.accentAlt
    : "transparent";

  // Tree indentation with proper continuation lines
  let indent = "";
  if (depth > 0) {
    // Build continuation lines for ancestors
    for (let i = 0; i < depth - 1; i++) {
      indent += ancestorIsLast[i] ? "  " : "│ ";
    }
    indent += isLast ? "└─ " : "├─ ";
  }

  // Collapse indicator for parent tasks
  const collapseIcon = hasChildren
    ? (isCollapsed ? "▸ " : "▾ ")
    : (depth === 0 ? "  " : "");

  // Progress suffix
  const progressStr = progress && progress.total > 0
    ? ` [${progress.done}/${progress.total}]`
    : "";

  const progressColor = progress && progress.total > 0
    ? (progress.done === progress.total ? colors.green
      : progress.done > 0 ? colors.yellow
      : colors.fgDim)
    : colors.fgDim;

  // Recurrence icon
  const recurIcon = task.recurrence ? "🔄" : "";

  return (
    <box
      flexDirection="row"
      height={1}
      backgroundColor={bg}
    >
      {/* Left accent bar */}
      <text
        content={highlighted ? "▎" : " "}
        fg={accentColor}
      />
      {/* Tree indent */}
      {indent ? <text content={indent} fg={colors.fgDim} /> : null}
      {/* Collapse indicator */}
      {collapseIcon ? <text content={collapseIcon} fg={colors.fgDim} /> : null}
      <text
        content={isBlocked ? "🔒" : STATUS_ICON[task.status]}
        fg={isBlocked ? colors.fgDim : colors.status[task.status]}
      />
      <text content=" " />
      <text
        content={task.title}
        fg={titleFg}
        attributes={titleAttr}
        flexGrow={1}
        overflow="hidden"
      />
      {progressStr ? (
        <text content={progressStr} fg={progressColor} />
      ) : null}
      {recurIcon ? (
        <text content={` ${recurIcon}`} fg={colors.fgDim} />
      ) : null}
      {project ? (
        <text
          content={`  ${project}`}
          fg={colors.accentAlt}
        />
      ) : null}
      <text
        content={`  ${PRIORITY_BADGE[task.priority]}`}
        fg={colors.priority[task.priority]}
      />
      {dueStr ? (
        <text
          content={`  ${dueStr}`}
          fg={dueFg}
        />
      ) : null}
      <text content=" " />
    </box>
  );
}
