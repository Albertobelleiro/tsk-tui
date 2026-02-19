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
}

function getDueDateColor(iso: string): string {
  if (isDueOverdue(iso)) return colors.red;
  if (isDueToday(iso)) return colors.orange;
  if (isDueThisWeek(iso)) return colors.yellow;
  return colors.fgDim;
}

export function TaskRow({ task, isSelected, isFocused }: TaskRowProps) {
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

  const titleFg = isDone ? colors.fgDim : colors.fg;
  const titleAttr = isDone ? 130 : 0;

  const bg = flash ? colors.green : isSelected ? colors.bgHighlight : undefined;

  const project = task.project
    ? task.project.length > 8 ? task.project.slice(0, 7) + "…" : task.project
    : "";

  const dueStr = task.dueDate ? formatShortDate(task.dueDate) : "";
  const dueFg = task.dueDate ? getDueDateColor(task.dueDate) : colors.fgDim;

  const accentColor = isSelected
    ? isFocused ? colors.accent : colors.border
    : "transparent";

  return (
    <box
      flexDirection="row"
      height={1}
      backgroundColor={bg}
    >
      {/* Left accent bar */}
      <text
        content={isSelected ? "▎" : " "}
        fg={accentColor}
      />
      <text
        content={STATUS_ICON[task.status]}
        fg={colors.status[task.status]}
      />
      <text content=" " />
      <text
        content={task.title}
        fg={titleFg}
        attributes={titleAttr}
        flexGrow={1}
        overflow="hidden"
      />
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
