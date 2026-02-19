import type { Task } from "../store/types.ts";
import type { TaskStore } from "../store/task-store.ts";
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
  store?: TaskStore;
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

function formatMinutes(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return min > 0 ? `${h}h ${min}m` : `${h}h`;
}

export function TaskDetailPanel({ task, isFocused, store }: TaskDetailPanelProps) {
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

  // Subtask progress
  const subtasks = store ? store.getSubtasks(task.id) : [];
  const hasSubtasks = subtasks.length > 0;
  const progress = store ? store.getProgress(task.id) : { done: 0, total: 0 };

  // Blocked status
  const isBlocked = store ? store.isBlocked(task.id) : false;

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
          content={`${STATUS_ICON[task.status]} ${STATUS_LABEL[task.status]}${isBlocked ? " 🔒 Blocked" : ""}`}
          fg={isBlocked ? colors.fgDim : colors.status[task.status]}
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

      {task.recurrence ? (
        <DetailField label="Recur">
          <text
            content={`🔄 Every ${task.recurrence.interval > 1 ? task.recurrence.interval + " " : ""}${task.recurrence.frequency}`}
            fg={colors.cyan}
          />
        </DetailField>
      ) : null}

      <DetailField label="Created">
        <text content={formatRelativeTime(task.createdAt)} fg={colors.fg} />
      </DetailField>

      <DetailField label="Updated">
        <text content={formatRelativeTime(task.updatedAt)} fg={colors.fg} />
      </DetailField>

      {/* Time tracking */}
      {(task.estimateMinutes || task.actualMinutes) ? (
        <box flexDirection="column" marginTop={1}>
          <text content="Time Tracking:" fg={colors.fgDim} attributes={1} />
          {task.estimateMinutes ? (
            <box flexDirection="row" height={1} paddingLeft={1}>
              <text content={`Est: ${formatMinutes(task.estimateMinutes)}`} fg={colors.fg} />
              {task.actualMinutes ? (
                <text
                  content={` | Act: ${formatMinutes(task.actualMinutes)}`}
                  fg={task.actualMinutes > task.estimateMinutes ? colors.red : colors.green}
                />
              ) : null}
            </box>
          ) : task.actualMinutes ? (
            <box flexDirection="row" height={1} paddingLeft={1}>
              <text content={`Actual: ${formatMinutes(task.actualMinutes)}`} fg={colors.fg} />
            </box>
          ) : null}
        </box>
      ) : null}

      {/* Subtask checklist */}
      {hasSubtasks ? (
        <box flexDirection="column" marginTop={1}>
          <text
            content={`Subtasks [${progress.done}/${progress.total}]:`}
            fg={colors.fgDim}
            attributes={1}
          />
          {subtasks.map((st) => (
            <box key={st.id} flexDirection="row" height={1} paddingLeft={1}>
              <text
                content={st.status === "done" ? "✓ " : "○ "}
                fg={st.status === "done" ? colors.green : colors.fgDim}
              />
              <text
                content={st.title}
                fg={st.status === "done" ? colors.fgDim : colors.fg}
                attributes={st.status === "done" ? 130 : 0}
              />
            </box>
          ))}
        </box>
      ) : null}

      {/* Notes */}
      {task.notes.length > 0 ? (
        <box flexDirection="column" marginTop={1}>
          <text content={`Notes (${task.notes.length}):`} fg={colors.fgDim} attributes={1} />
          {task.notes.slice(0, 5).map((note) => (
            <box key={note.id} flexDirection="column" paddingLeft={1}>
              <box flexDirection="row" height={1}>
                <text content={note.createdAt.slice(0, 10)} fg={colors.fgDim} />
                <text content={` ${note.content}`} fg={colors.fg} />
              </box>
            </box>
          ))}
          {task.notes.length > 5 ? (
            <text content={`  ... and ${task.notes.length - 5} more`} fg={colors.fgDim} />
          ) : null}
        </box>
      ) : null}

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
