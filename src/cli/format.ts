import type { Task, TaskPriority, TaskStatus } from "../store/types.ts";
import { formatShortDate, formatFullDate, formatRelativeTime, isDueOverdue } from "../utils/date.ts";

// ── ANSI color helpers ───────────────────────────────

let _color = true;

export function setColorEnabled(enabled: boolean): void {
  _color = enabled;
}

const esc = (code: string) => (s: string) => _color ? `\x1b[${code}m${s}\x1b[0m` : s;

export const red = (s: string) => esc("31")(s);
export const green = (s: string) => esc("32")(s);
export const yellow = (s: string) => esc("33")(s);
export const cyan = (s: string) => esc("36")(s);
export const dim = (s: string) => esc("2")(s);
export const bold = (s: string) => esc("1")(s);
export const magenta = (s: string) => esc("35")(s);

// ── Status / priority display ────────────────────────

const STATUS_ICON: Record<TaskStatus, string> = {
  todo: "\u25cf todo",
  in_progress: "\u25c9 prog",
  done: "\u2713 done",
  archived: "\u25cb arch",
};

function colorStatus(status: TaskStatus): string {
  const label = STATUS_ICON[status];
  switch (status) {
    case "todo": return cyan(label);
    case "in_progress": return yellow(label);
    case "done": return green(label);
    case "archived": return dim(label);
  }
}

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  none: "—",
  low: "low",
  medium: "med",
  high: "high",
  urgent: "URGENT",
};

function colorPriority(p: TaskPriority): string {
  const label = PRIORITY_LABEL[p];
  switch (p) {
    case "urgent": return red(bold(label));
    case "high": return red(label);
    case "medium": return yellow(label);
    case "low": return dim(label);
    case "none": return dim(label);
  }
}

// ── Table formatting ─────────────────────────────────

function pad(s: string, len: number): string {
  // Strip ANSI to calculate visible length
  const visible = s.replace(/\x1b\[[0-9;]*m/g, "");
  const diff = len - visible.length;
  return diff > 0 ? s + " ".repeat(diff) : s;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "\u2026" : s;
}

export function formatTaskTable(tasks: Task[]): string {
  if (tasks.length === 0) return dim("  No tasks found.");

  const cols = process.stdout.columns || 80;
  // Reserve space for fixed columns: ID(8) + gap(3) + Status(8) + gap(3) + Pri(6) + gap(3) + Project(10) + gap(3) + Due(8) = ~52
  const titleMax = Math.max(10, cols - 58);

  const header = dim(
    `  ${pad("ID", 8)}   ${pad("Status", 8)}   ${pad("Pri", 6)}   ${pad("Title", titleMax)}   ${pad("Project", 10)}   Due`
  );

  const rows = tasks.map((t) => {
    const id = dim(t.id.slice(0, 8));
    const status = colorStatus(t.status);
    const pri = colorPriority(t.priority);
    const title = truncate(t.title, titleMax);
    const project = t.project ? t.project : dim("\u2014");
    const due = t.dueDate
      ? (isDueOverdue(t.dueDate) ? red(formatShortDate(t.dueDate)) : formatShortDate(t.dueDate))
      : dim("\u2014");

    return `  ${pad(id, 8)}   ${pad(status, 8)}   ${pad(pri, 6)}   ${pad(title, titleMax)}   ${pad(project, 10)}   ${due}`;
  });

  return [header, ...rows].join("\n");
}

// ── Detail formatting ────────────────────────────────

export function formatTaskDetail(task: Task): string {
  const lines: string[] = [];
  lines.push(`  ${bold("Task:")}    ${task.title}`);
  lines.push(`  ${bold("ID:")}      ${task.id}`);
  lines.push(`  ${bold("Status:")}  ${colorStatus(task.status)}`);
  lines.push(`  ${bold("Priority:")} ${colorPriority(task.priority)}`);
  lines.push(`  ${bold("Project:")} ${task.project ?? dim("\u2014")}`);
  lines.push(`  ${bold("Tags:")}    ${task.tags.length ? task.tags.map(t => cyan("#" + t)).join(" ") : dim("\u2014")}`);
  lines.push(`  ${bold("Due:")}     ${task.dueDate ? formatFullDate(task.dueDate) : dim("\u2014")}`);
  lines.push(`  ${bold("Created:")} ${formatFullDate(task.createdAt)} (${formatRelativeTime(task.createdAt)})`);
  lines.push(`  ${bold("Updated:")} ${formatFullDate(task.updatedAt)} (${formatRelativeTime(task.updatedAt)})`);

  if (task.description) {
    lines.push("");
    lines.push(`  ${bold("Description:")}`);
    lines.push(`  ${task.description}`);
  }

  return lines.join("\n");
}

// ── Success / error helpers ──────────────────────────

export function success(msg: string): void {
  console.log(green("\u2713") + " " + msg);
}

export function error(msg: string): void {
  console.error(red("error:") + " " + msg);
}
