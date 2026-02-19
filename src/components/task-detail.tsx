import type { Task } from "../store/types.ts";
import { colors } from "../theme/colors.ts";
import {
  formatFullDate,
  formatRelativeTime,
  isDueOverdue,
  isDueToday,
  isDueThisWeek,
} from "../utils/date.ts";

const STATUS_ICON: Record<Task["status"], string> = {
  todo: "○",
  in_progress: "◉",
  done: "✓",
  archived: "▪",
};

const STATUS_LABEL: Record<Task["status"], string> = {
  todo: "Todo",
  in_progress: "In Progress",
  done: "Done",
  archived: "Archived",
};

const PRIORITY_LABEL: Record<Task["priority"], string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "None",
};

interface TaskDetailPanelProps {
  task: Task | null;
  isFocused: boolean;
}

function getDueDateColor(iso: string): string {
  if (isDueOverdue(iso)) return colors.red;
  if (isDueToday(iso)) return colors.orange;
  if (isDueThisWeek(iso)) return colors.yellow;
  return colors.fg;
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <box flexDirection="row" height={1}>
      <text content={`${label}: `} fg={colors.fgDim} attributes={1} />
      {children}
    </box>
  );
}

export function TaskDetailPanel({ task, isFocused }: TaskDetailPanelProps) {
  if (!task) {
    return (
      <box
        flexGrow={1}
        border={true}
        borderStyle="single"
        borderColor={isFocused ? colors.borderFocus : colors.border}
        title="Task Detail"
        justifyContent="center"
        alignItems="center"
      >
        <text content="Select a task" fg={colors.fgDim} />
      </box>
    );
  }

  const dueDateStr = task.dueDate
    ? `${formatFullDate(task.dueDate)} (${formatRelativeTime(task.dueDate)})`
    : "—";
  const dueFg = task.dueDate ? getDueDateColor(task.dueDate) : colors.fgDim;

  return (
    <box
      flexGrow={1}
      flexDirection="column"
      border={true}
      borderStyle="single"
      borderColor={isFocused ? colors.borderFocus : colors.border}
      title="Task Detail"
      paddingLeft={1}
      paddingRight={1}
    >
      <DetailField label="Title">
        <text content={task.title} fg={colors.fg} />
      </DetailField>

      <DetailField label="Status">
        <text
          content={`${STATUS_ICON[task.status]} ${STATUS_LABEL[task.status]}`}
          fg={colors.status[task.status]}
        />
      </DetailField>

      <DetailField label="Priority">
        <text
          content={PRIORITY_LABEL[task.priority]}
          fg={colors.priority[task.priority]}
        />
      </DetailField>

      {task.project ? (
        <DetailField label="Project">
          <text content={task.project} fg={colors.accentAlt} />
        </DetailField>
      ) : null}

      {task.tags.length > 0 ? (
        <DetailField label="Tags">
          <text
            content={task.tags.map((t) => `#${t}`).join(" ")}
            fg={colors.cyan}
          />
        </DetailField>
      ) : null}

      <DetailField label="Due">
        <text content={dueDateStr} fg={dueFg} />
      </DetailField>

      <DetailField label="Created">
        <text content={formatRelativeTime(task.createdAt)} fg={colors.fg} />
      </DetailField>

      <DetailField label="Updated">
        <text content={formatRelativeTime(task.updatedAt)} fg={colors.fg} />
      </DetailField>

      {task.description ? (
        <box flexDirection="column" marginTop={1}>
          <text content="Description:" fg={colors.fgDim} attributes={1} />
          <text
            content={task.description}
            fg={colors.fg}
            wrapMode="word"
          />
        </box>
      ) : null}
    </box>
  );
}
