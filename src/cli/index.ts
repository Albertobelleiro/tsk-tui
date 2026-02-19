import { TaskStore } from "../store/task-store.ts";
import type { Task, TaskStatus, TaskPriority } from "../store/types.ts";
import { formatRelativeTime, isDueOverdue, isDueToday, isDueThisWeek } from "../utils/date.ts";
import {
  ConfigManager,
  getConfigPath,
  getConfigValue,
  loadConfig,
  maskSecrets,
  parseConfigValue,
  resetConfig,
  saveConfig,
  setConfigValue,
} from "../config/config.ts";
import { SyncEngine, providerKeyToSource } from "../integrations/sync-engine.ts";
import { SyncStateManager } from "../integrations/sync-state.ts";
import { TodoistProvider } from "../integrations/todoist.ts";
import { LinearProvider } from "../integrations/linear.ts";
import { AsanaProvider } from "../integrations/asana.ts";
import { GitHubIssuesProvider } from "../integrations/github-issues.ts";
import { runOAuthFlow } from "../integrations/oauth-helpers.ts";
import { runDeviceFlow } from "../integrations/oauth-device-flow.ts";
import type { SyncProvider } from "../integrations/types.ts";
import {
  setColorEnabled, bold, dim, cyan, green, red,
  formatTaskTable, formatTaskDetail, success, error,
} from "./format.ts";

// ── Exit codes ───────────────────────────────────────

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_NOT_FOUND = 2;
const EXIT_AMBIGUOUS = 3;
const EXIT_VALIDATION = 4;

// ── Arg parsing helpers ──────────────────────────────

const FLAGS_WITH_VALUE = new Set([
  "--priority", "-p", "--project", "-P", "--tag", "-t",
  "--due", "-d", "--desc", "--title", "--status", "--sort",
  "--subtask-of", "--under", "--format", "--recur",
  "--estimate", "--api-key", "--token", "--repo", "--team",
  "--workspace", "--label",
  "--client-id", "--client-secret",
]);

type FlagReadResult =
  | { state: "absent" }
  | { state: "missing" }
  | { state: "value"; value: string };

function readFlag(args: string[], long: string, short?: string): FlagReadResult {
  for (let i = 0; i < args.length; i++) {
    const token = args[i]!;
    if (token === long || (short && token === short)) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("-")) {
        return { state: "missing" };
      }
      return { state: "value", value };
    }
    if (token.startsWith(long + "=")) {
      return { state: "value", value: token.slice(long.length + 1) };
    }
    if (short && token.startsWith(short + "=")) {
      return { state: "value", value: token.slice(short.length + 1) };
    }
  }
  return { state: "absent" };
}

function getFlag(args: string[], long: string, short?: string): string | undefined {
  const result = readFlag(args, long, short);
  return result.state === "value" ? result.value : undefined;
}

function findFirstMissingFlagValue(args: string[]): string | null {
  const subcommand = args.find((a) => !a.startsWith("-"));
  const valueLessForSubcommand = new Set<string>();
  if (subcommand === "sync") {
    valueLessForSubcommand.add("--status");
  }

  for (let i = 0; i < args.length; i++) {
    const token = args[i]!;
    if (!FLAGS_WITH_VALUE.has(token)) continue;
    if (valueLessForSubcommand.has(token)) continue;
    if (token.includes("=")) continue;
    const value = args[i + 1];
    if (value === undefined || value.startsWith("-")) {
      return token;
    }
  }
  return null;
}

function hasFlag(args: string[], long: string, short?: string): boolean {
  return args.some((a) => a === long || (short != null && a === short));
}

function positionalArgs(args: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("-")) {
      // skip flag value if it takes one
      if (FLAGS_WITH_VALUE.has(a) && !a.includes("=")) i++;
      continue;
    }
    result.push(a);
  }
  return result;
}

// ── Partial ID resolution ────────────────────────────

type ResolveResult =
  | { ok: true; task: Task }
  | { ok: false; code: number };

function resolveTaskId(tasks: Task[], partial: string): ResolveResult {
  if (partial.trim() === "") {
    error("Task ID cannot be empty");
    return { ok: false, code: EXIT_VALIDATION };
  }
  const matches = tasks.filter((t) => t.id.startsWith(partial));
  if (matches.length === 1) return { ok: true, task: matches[0]! };
  if (matches.length === 0) {
    error(`Task not found: "${partial}"`);
    return { ok: false, code: EXIT_NOT_FOUND };
  }
  error(`Ambiguous ID "${partial}" matches ${matches.length} tasks:`);
  for (const m of matches) {
    console.error(`  ${dim(m.id.slice(0, 12))}  ${m.title}`);
  }
  return { ok: false, code: EXIT_AMBIGUOUS };
}

// ── Validators ───────────────────────────────────────

const VALID_PRIORITIES = new Set<string>(["none", "low", "medium", "high", "urgent"]);
const VALID_STATUSES = new Set<string>(["todo", "in_progress", "done", "archived"]);

function validatePriority(val: string): val is TaskPriority {
  return VALID_PRIORITIES.has(val);
}

function validateStatus(val: string): val is TaskStatus {
  return VALID_STATUSES.has(val);
}

function validateDate(val: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(val) && !isNaN(Date.parse(val));
}

// ── Due date filter ──────────────────────────────────

function filterByDue(tasks: Task[], due: string): Task[] {
  switch (due) {
    case "today":
      return tasks.filter((t) => t.dueDate && isDueToday(t.dueDate));
    case "overdue":
      return tasks.filter((t) => t.dueDate && isDueOverdue(t.dueDate));
    case "week":
      return tasks.filter((t) => t.dueDate && isDueThisWeek(t.dueDate));
    default:
      if (validateDate(due)) {
        return tasks.filter((t) => t.dueDate === due);
      }
      return tasks;
  }
}

// ── Sort ─────────────────────────────────────────────

const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  none: 0, low: 1, medium: 2, high: 3, urgent: 4,
};

function sortTasks(tasks: Task[], sortBy: string): Task[] {
  const sorted = [...tasks];
  switch (sortBy) {
    case "priority":
      sorted.sort((a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority]);
      break;
    case "due":
      sorted.sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      });
      break;
    case "created":
      sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      break;
    case "title":
      sorted.sort((a, b) => a.title.localeCompare(b.title));
      break;
  }
  return sorted;
}

// ── Time format helpers ─────────────────────────────

function parseTimeInput(val: string): number | null {
  // Accepts: "2h", "2h30m", "45m", "90" (minutes), "1.5h"
  const hMatch = val.match(/^(\d+(?:\.\d+)?)\s*h$/i);
  if (hMatch) return Math.round(parseFloat(hMatch[1]!) * 60);
  const hmMatch = val.match(/^(\d+)\s*h\s*(\d+)\s*m$/i);
  if (hmMatch) return parseInt(hmMatch[1]!) * 60 + parseInt(hmMatch[2]!);
  const mMatch = val.match(/^(\d+)\s*m$/i);
  if (mMatch) return parseInt(mMatch[1]!);
  const num = parseInt(val);
  if (!isNaN(num)) return num;
  return null;
}

function formatMinutes(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return min > 0 ? `${h}h ${min}m` : `${h}h`;
}

// ── Help texts ───────────────────────────────────────

const HELP_MAIN = `tsk — terminal task manager v0.2.0

Usage:
  tsk                          Open interactive TUI
  tsk add <title> [flags]      Add a new task
  tsk list [flags]             List tasks
  tsk show <id>                Show task details
  tsk edit <id> [flags]        Update a task
  tsk done <id>                Toggle done/todo
  tsk start <id>               Set task to in-progress
  tsk archive <id>             Archive a task
  tsk rm <id> [--force]        Delete a task
  tsk search <query>           Search tasks
  tsk projects                 List projects
  tsk tags                     List tags
  tsk subtasks <id>            List subtasks
  tsk indent <id> --under <id> Make task a subtask
  tsk promote <id>             Make subtask top-level
  tsk estimate <id> <time>     Set time estimate
  tsk log <id> <time>          Log time spent
  tsk config <list|get|set|reset|edit|path>  Manage config
  tsk connect <provider>       Connect provider (todoist|linear|asana|github)
  tsk disconnect <provider>    Disconnect provider
  tsk sync [provider]          Sync integrations
  tsk export [--format json|csv|markdown]

Flags:
  -h, --help                   Show this help
  -v, --version                Show version
  --no-color                   Disable color output

Run 'tsk <command> --help' for command-specific flags.`;

const HELP_ADD = `Usage: tsk add <title> [flags]

Flags:
  -p, --priority <level>   none|low|medium|high|urgent (default: none)
  -P, --project <name>     Project name
  -t, --tag <tags>         Comma-separated tags
  -d, --due <date>         Due date: YYYY-MM-DD
      --desc <text>        Description text
      --subtask-of <id>    Create as subtask of <id>
      --recur <freq>       daily|weekly|monthly|yearly
      --estimate <time>    Time estimate: 2h, 45m, 1h30m`;

const HELP_LIST = `Usage: tsk list [flags]

Flags:
  --status <s>      Filter: todo,in_progress,done,archived (comma-separated)
  --priority <p>    Filter: none,low,medium,high,urgent (comma-separated)
  --project <name>  Filter by project
  --tag <tag>       Filter by tag
  --due <when>      today|overdue|week|YYYY-MM-DD
  --sort <field>    priority|due|created|title (default: priority)
  --json            Output as JSON`;

const HELP_EDIT = `Usage: tsk edit <id> [flags]

Flags:
  --title <text>       New title
  --desc <text>        New description
  --priority <level>   New priority
  --project <name>     New project (empty string = clear)
  --tag <tags>         Replace tags (comma-separated)
  --due <date>         New due date (empty string = clear)
  --status <status>    New status`;

// ── Subcommand handlers ──────────────────────────────

async function cmdAdd(args: string[]): Promise<number> {
  if (hasFlag(args, "--help", "-h")) { console.log(HELP_ADD); return EXIT_OK; }

  const pos = positionalArgs(args);
  const title = pos[0];
  if (!title) {
    error("Missing required argument: <title>");
    console.error("Usage: tsk add <title> [flags]");
    return EXIT_VALIDATION;
  }

  const priorityVal = getFlag(args, "--priority", "-p") ?? "none";
  if (!validatePriority(priorityVal)) {
    error(`Invalid priority: "${priorityVal}". Must be none|low|medium|high|urgent`);
    return EXIT_VALIDATION;
  }

  const dueVal = getFlag(args, "--due", "-d") ?? null;
  if (dueVal && !validateDate(dueVal)) {
    error(`Invalid date: "${dueVal}". Use YYYY-MM-DD format`);
    return EXIT_VALIDATION;
  }

  const project = getFlag(args, "--project", "-P") ?? null;
  const tagStr = getFlag(args, "--tag", "-t");
  const tags = tagStr ? tagStr.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const description = getFlag(args, "--desc") ?? "";

  // Subtask support
  const subtaskOfFlag = readFlag(args, "--subtask-of");

  // Recurrence
  const recurVal = getFlag(args, "--recur");
  let recurrence = null;
  if (recurVal) {
    const validFreq = ["daily", "weekly", "monthly", "yearly"] as const;
    if (!validFreq.includes(recurVal as typeof validFreq[number])) {
      error(`Invalid recurrence: "${recurVal}". Must be daily|weekly|monthly|yearly`);
      return EXIT_VALIDATION;
    }
    recurrence = { frequency: recurVal as typeof validFreq[number], interval: 1 };
  }

  // Estimate
  const estimateVal = getFlag(args, "--estimate");
  let estimateMinutes: number | null = null;
  if (estimateVal) {
    estimateMinutes = parseTimeInput(estimateVal);
    if (estimateMinutes === null) {
      error(`Invalid time format: "${estimateVal}". Use 2h, 45m, 1h30m`);
      return EXIT_VALIDATION;
    }
  }

  const store = await TaskStore.create();

  // Resolve parent if subtask
  let parentId: string | null = null;
  if (subtaskOfFlag.state === "value") {
    const partial = subtaskOfFlag.value.trim();
    if (partial === "") {
      error("Task ID cannot be empty");
      return EXIT_VALIDATION;
    }
    const result = resolveTaskId(store.tasks, partial);
    if (!result.ok) return result.code;
    parentId = result.task.id;
  }

  const task = store.addTask({
    title,
    description,
    priority: priorityVal as TaskPriority,
    project,
    tags,
    dueDate: dueVal,
    parentId,
    recurrence,
    estimateMinutes,
  });
  await store.save();

  success(`Added: "${task.title}" (id: ${task.id.slice(0, 8)})`);
  return EXIT_OK;
}

async function cmdList(args: string[]): Promise<number> {
  if (hasFlag(args, "--help", "-h")) { console.log(HELP_LIST); return EXIT_OK; }

  const store = await TaskStore.create();
  let tasks = [...store.tasks];

  // Status filter
  const statusVal = getFlag(args, "--status");
  if (statusVal) {
    const statuses = statusVal.split(",").map((s) => s.trim());
    for (const s of statuses) {
      if (!validateStatus(s)) {
        error(`Invalid status: "${s}"`);
        return EXIT_VALIDATION;
      }
    }
    tasks = tasks.filter((t) => statuses.includes(t.status));
  }

  // Priority filter
  const priVal = getFlag(args, "--priority");
  if (priVal) {
    const priorities = priVal.split(",").map((s) => s.trim());
    for (const p of priorities) {
      if (!validatePriority(p)) {
        error(`Invalid priority: "${p}"`);
        return EXIT_VALIDATION;
      }
    }
    tasks = tasks.filter((t) => priorities.includes(t.priority));
  }

  // Project filter
  const projectVal = getFlag(args, "--project");
  if (projectVal) {
    tasks = tasks.filter((t) => t.project === projectVal);
  }

  // Tag filter
  const tagVal = getFlag(args, "--tag");
  if (tagVal) {
    tasks = tasks.filter((t) => t.tags.includes(tagVal));
  }

  // Due filter
  const dueVal = getFlag(args, "--due");
  if (dueVal) {
    tasks = filterByDue(tasks, dueVal);
  }

  // Sort
  const sortVal = getFlag(args, "--sort") ?? "priority";
  tasks = sortTasks(tasks, sortVal);

  // Output
  if (hasFlag(args, "--json")) {
    console.log(JSON.stringify(tasks, null, 2));
  } else {
    console.log(formatTaskTable(tasks));
  }

  return EXIT_OK;
}

async function cmdShow(args: string[]): Promise<number> {
  if (hasFlag(args, "--help", "-h")) {
    console.log("Usage: tsk show <id>");
    return EXIT_OK;
  }

  const pos = positionalArgs(args);
  const partial = pos[0];
  if (!partial) {
    error("Missing required argument: <id>");
    return EXIT_VALIDATION;
  }

  const store = await TaskStore.create();
  const result = resolveTaskId(store.tasks, partial);
  if (!result.ok) return result.code;

  console.log(formatTaskDetail(result.task));

  // Show subtasks if any
  const subtasks = store.getSubtasks(result.task.id);
  if (subtasks.length > 0) {
    const progress = store.getProgress(result.task.id);
    console.log(`\n  ${bold("Subtasks")} [${progress.done}/${progress.total}]:`);
    for (const st of subtasks) {
      const icon = st.status === "done" ? green("✓") : dim("○");
      console.log(`    ${icon} ${st.title}`);
    }
  }

  // Show time tracking
  if (result.task.estimateMinutes || result.task.actualMinutes) {
    console.log("");
    if (result.task.estimateMinutes) {
      console.log(`  ${bold("Estimate:")} ${formatMinutes(result.task.estimateMinutes)}`);
    }
    if (result.task.actualMinutes) {
      console.log(`  ${bold("Actual:")}   ${formatMinutes(result.task.actualMinutes)}`);
    }
    if (result.task.estimateMinutes && result.task.actualMinutes) {
      const remaining = result.task.estimateMinutes - result.task.actualMinutes;
      console.log(`  ${bold("Remaining:")} ${remaining > 0 ? formatMinutes(remaining) : green("complete")}`);
    }
  }

  // Show notes
  if (result.task.notes.length > 0) {
    console.log(`\n  ${bold("Notes")} (${result.task.notes.length}):`);
    for (const note of result.task.notes) {
      console.log(`    ${dim(note.createdAt.slice(0, 10))} ${note.content}`);
    }
  }

  return EXIT_OK;
}

async function cmdEdit(args: string[]): Promise<number> {
  if (hasFlag(args, "--help", "-h")) { console.log(HELP_EDIT); return EXIT_OK; }

  const pos = positionalArgs(args);
  const partial = pos[0];
  if (!partial) {
    error("Missing required argument: <id>");
    return EXIT_VALIDATION;
  }

  const store = await TaskStore.create();
  const result = resolveTaskId(store.tasks, partial);
  if (!result.ok) return result.code;

  const updates: Record<string, unknown> = {};
  let hasUpdates = false;

  const titleVal = getFlag(args, "--title");
  if (titleVal !== undefined) { updates.title = titleVal; hasUpdates = true; }

  const descVal = getFlag(args, "--desc");
  if (descVal !== undefined) { updates.description = descVal; hasUpdates = true; }

  const priVal = getFlag(args, "--priority");
  if (priVal !== undefined) {
    if (!validatePriority(priVal)) {
      error(`Invalid priority: "${priVal}"`);
      return EXIT_VALIDATION;
    }
    updates.priority = priVal;
    hasUpdates = true;
  }

  const projectVal = getFlag(args, "--project");
  if (projectVal !== undefined) {
    updates.project = projectVal === "" ? null : projectVal;
    hasUpdates = true;
  }

  const tagVal = getFlag(args, "--tag");
  if (tagVal !== undefined) {
    updates.tags = tagVal === "" ? [] : tagVal.split(",").map((s) => s.trim()).filter(Boolean);
    hasUpdates = true;
  }

  const dueVal = getFlag(args, "--due");
  if (dueVal !== undefined) {
    if (dueVal !== "" && !validateDate(dueVal)) {
      error(`Invalid date: "${dueVal}"`);
      return EXIT_VALIDATION;
    }
    updates.dueDate = dueVal === "" ? null : dueVal;
    hasUpdates = true;
  }

  const statusVal = getFlag(args, "--status");
  if (statusVal !== undefined) {
    if (!validateStatus(statusVal)) {
      error(`Invalid status: "${statusVal}"`);
      return EXIT_VALIDATION;
    }
    updates.status = statusVal;
    hasUpdates = true;
  }

  if (!hasUpdates) {
    error("No flags provided. Use --title, --desc, --priority, --project, --tag, --due, or --status");
    return EXIT_VALIDATION;
  }

  store.updateTask(result.task.id, updates as Partial<Task>);
  await store.save();

  const updatedTitle = (updates.title as string) ?? result.task.title;
  success(`Updated: "${updatedTitle}"`);
  return EXIT_OK;
}

async function cmdDone(args: string[]): Promise<number> {
  // Bulk: tsk done --all [--project X] [--status Y] [--tag Z]
  if (hasFlag(args, "--all")) {
    return cmdBulkDone(args);
  }

  const pos = positionalArgs(args);
  const partial = pos[0];
  if (!partial) {
    error("Missing required argument: <id>");
    return EXIT_VALIDATION;
  }

  const store = await TaskStore.create();
  const result = resolveTaskId(store.tasks, partial);
  if (!result.ok) return result.code;

  // Handle recurring tasks
  if (result.task.recurrence) {
    const nextTask = store.completeRecurring(result.task.id);
    await store.save();
    success(`Marked done: "${result.task.title}"`);
    if (nextTask) {
      console.log(`  Next occurrence: ${nextTask.dueDate}`);
    }
    return EXIT_OK;
  }

  const wasDone = result.task.status === "done";
  store.toggleDone(result.task.id);
  await store.save();

  if (wasDone) {
    success(`Marked todo: "${result.task.title}"`);
  } else {
    success(`Marked done: "${result.task.title}"`);
    // Check if this unblocked anything
    const unblocked = store.getUnblockedTasks(result.task.id);
    for (const uid of unblocked) {
      const ut = store.tasks.find((t) => t.id === uid);
      if (ut) console.log(`  Unblocked: ${ut.title}`);
    }
  }
  return EXIT_OK;
}

async function cmdStart(args: string[]): Promise<number> {
  const pos = positionalArgs(args);
  const partial = pos[0];
  if (!partial) {
    error("Missing required argument: <id>");
    return EXIT_VALIDATION;
  }

  const store = await TaskStore.create();
  const result = resolveTaskId(store.tasks, partial);
  if (!result.ok) return result.code;

  store.moveToStatus(result.task.id, "in_progress");
  await store.save();

  success(`Started: "${result.task.title}"`);
  return EXIT_OK;
}

async function cmdArchive(args: string[]): Promise<number> {
  const pos = positionalArgs(args);
  const partial = pos[0];
  if (!partial) {
    error("Missing required argument: <id>");
    return EXIT_VALIDATION;
  }

  const store = await TaskStore.create();
  const result = resolveTaskId(store.tasks, partial);
  if (!result.ok) return result.code;

  store.moveToStatus(result.task.id, "archived");
  await store.save();

  success(`Archived: "${result.task.title}"`);
  return EXIT_OK;
}

async function cmdRm(args: string[]): Promise<number> {
  // Bulk: tsk rm --all [--status X] [--project X] [--tag X] [--force]
  if (hasFlag(args, "--all")) {
    return cmdBulkRm(args);
  }

  const pos = positionalArgs(args);
  const partial = pos[0];
  if (!partial) {
    error("Missing required argument: <id>");
    return EXIT_VALIDATION;
  }

  const store = await TaskStore.create();
  const result = resolveTaskId(store.tasks, partial);
  if (!result.ok) return result.code;

  if (!hasFlag(args, "--force")) {
    process.stdout.write(`Delete "${result.task.title}"? [y/N] `);
    const answer = await readLine();
    if (answer.toLowerCase() !== "y") {
      console.log("Cancelled.");
      return EXIT_OK;
    }
  }

  store.deleteTask(result.task.id);
  await store.save();

  success(`Deleted: "${result.task.title}"`);
  return EXIT_OK;
}

async function cmdSearch(args: string[]): Promise<number> {
  if (hasFlag(args, "--help", "-h")) {
    console.log("Usage: tsk search <query> [--json]");
    return EXIT_OK;
  }

  const pos = positionalArgs(args);
  const query = pos[0];
  if (!query) {
    error("Missing required argument: <query>");
    return EXIT_VALIDATION;
  }

  const store = await TaskStore.create();
  const q = query.toLowerCase();
  const tasks = store.tasks.filter(
    (t) => t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
  );

  if (hasFlag(args, "--json")) {
    console.log(JSON.stringify(tasks, null, 2));
  } else {
    console.log(formatTaskTable(tasks));
  }

  return EXIT_OK;
}

async function cmdProjects(args: string[]): Promise<number> {
  const store = await TaskStore.create();
  const projectMap = new Map<string, number>();

  for (const t of store.tasks) {
    if (t.project) {
      projectMap.set(t.project, (projectMap.get(t.project) ?? 0) + 1);
    }
  }

  if (hasFlag(args, "--json")) {
    const data = Array.from(projectMap.entries()).map(([name, count]) => ({ name, count }));
    console.log(JSON.stringify(data, null, 2));
    return EXIT_OK;
  }

  if (projectMap.size === 0) {
    console.log(dim("  No projects found."));
    return EXIT_OK;
  }

  for (const [name, count] of [...projectMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const label = count === 1 ? "task" : "tasks";
    console.log(`  ${pad(name, 14)} (${count} ${label})`);
  }

  return EXIT_OK;
}

async function cmdTags(args: string[]): Promise<number> {
  const store = await TaskStore.create();
  const tagMap = new Map<string, number>();

  for (const t of store.tasks) {
    for (const tag of t.tags) {
      tagMap.set(tag, (tagMap.get(tag) ?? 0) + 1);
    }
  }

  if (hasFlag(args, "--json")) {
    const data = Array.from(tagMap.entries()).map(([name, count]) => ({ name, count }));
    console.log(JSON.stringify(data, null, 2));
    return EXIT_OK;
  }

  if (tagMap.size === 0) {
    console.log(dim("  No tags found."));
    return EXIT_OK;
  }

  for (const [name, count] of [...tagMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const label = count === 1 ? "task" : "tasks";
    console.log(`  ${cyan("#" + name)}${" ".repeat(Math.max(1, 14 - name.length - 1))}(${count} ${label})`);
  }

  return EXIT_OK;
}

// ── Subtask commands ─────────────────────────────────

async function cmdSubtasks(args: string[]): Promise<number> {
  const pos = positionalArgs(args);
  const partial = pos[0];
  if (!partial) {
    error("Missing required argument: <parent-id>");
    return EXIT_VALIDATION;
  }

  const store = await TaskStore.create();
  const result = resolveTaskId(store.tasks, partial);
  if (!result.ok) return result.code;

  const subtasks = store.getSubtasks(result.task.id);
  if (subtasks.length === 0) {
    console.log(dim("  No subtasks."));
    return EXIT_OK;
  }

  const progress = store.getProgress(result.task.id);
  console.log(bold(`  ${result.task.title} [${progress.done}/${progress.total}]`));
  console.log("");

  if (hasFlag(args, "--json")) {
    console.log(JSON.stringify(subtasks, null, 2));
  } else {
    console.log(formatTaskTable(subtasks));
  }

  return EXIT_OK;
}

async function cmdIndent(args: string[]): Promise<number> {
  const pos = positionalArgs(args);
  const partial = pos[0];
  if (!partial) {
    error("Missing required argument: <task-id>");
    return EXIT_VALIDATION;
  }

  const underVal = getFlag(args, "--under");
  if (!underVal) {
    error("Missing required flag: --under <parent-id>");
    return EXIT_VALIDATION;
  }

  const store = await TaskStore.create();
  const taskResult = resolveTaskId(store.tasks, partial);
  if (!taskResult.ok) return taskResult.code;

  const parentResult = resolveTaskId(store.tasks, underVal);
  if (!parentResult.ok) return parentResult.code;

  const ok = store.indentTask(taskResult.task.id, parentResult.task.id);
  if (!ok) {
    error("Could not indent task (circular reference or invalid)");
    return EXIT_ERROR;
  }

  await store.save();
  success(`"${taskResult.task.title}" is now a subtask of "${parentResult.task.title}"`);
  return EXIT_OK;
}

async function cmdPromote(args: string[]): Promise<number> {
  const pos = positionalArgs(args);
  const partial = pos[0];
  if (!partial) {
    error("Missing required argument: <task-id>");
    return EXIT_VALIDATION;
  }

  const store = await TaskStore.create();
  const result = resolveTaskId(store.tasks, partial);
  if (!result.ok) return result.code;

  const ok = store.promoteSubtask(result.task.id);
  if (!ok) {
    error("Task is not a subtask or could not be promoted");
    return EXIT_ERROR;
  }

  await store.save();
  success(`Promoted: "${result.task.title}" to top level`);
  return EXIT_OK;
}

// ── Time tracking commands ───────────────────────────

async function cmdEstimate(args: string[]): Promise<number> {
  const pos = positionalArgs(args);
  if (pos.length < 2) {
    error("Usage: tsk estimate <id> <time>");
    return EXIT_VALIDATION;
  }

  const store = await TaskStore.create();
  const result = resolveTaskId(store.tasks, pos[0]!);
  if (!result.ok) return result.code;

  const minutes = parseTimeInput(pos[1]!);
  if (minutes === null) {
    error(`Invalid time format: "${pos[1]}". Use 2h, 45m, 1h30m`);
    return EXIT_VALIDATION;
  }

  store.setEstimate(result.task.id, minutes);
  await store.save();
  success(`Estimate set: ${formatMinutes(minutes)} for "${result.task.title}"`);
  return EXIT_OK;
}

async function cmdLogTime(args: string[]): Promise<number> {
  const pos = positionalArgs(args);
  if (pos.length < 2) {
    error("Usage: tsk log <id> <time>");
    return EXIT_VALIDATION;
  }

  const store = await TaskStore.create();
  const result = resolveTaskId(store.tasks, pos[0]!);
  if (!result.ok) return result.code;

  const minutes = parseTimeInput(pos[1]!);
  if (minutes === null) {
    error(`Invalid time format: "${pos[1]}". Use 2h, 45m, 1h30m`);
    return EXIT_VALIDATION;
  }

  store.logTime(result.task.id, minutes);
  await store.save();
  success(`Logged ${formatMinutes(minutes)} for "${result.task.title}"`);
  return EXIT_OK;
}

// ── Config commands ──────────────────────────────────

async function cmdConfig(args: string[]): Promise<number> {
  const pos = positionalArgs(args);
  const sub = pos[0];

  switch (sub) {
    case "get": {
      const key = pos[1];
      if (!key) { error("Usage: tsk config get <key>"); return EXIT_VALIDATION; }
      const val = await getConfigValue(key);
      if (val === undefined) {
        console.log(dim("(not set)"));
        return EXIT_OK;
      }
      const masked = /token|secret|apikey|api_key/i.test(key) ? "****" : val;
      console.log(JSON.stringify(masked, null, 2));
      return EXIT_OK;
    }
    case "set": {
      const key = pos[1];
      const value = pos[2];
      if (!key || value === undefined) { error("Usage: tsk config set <key> <value>"); return EXIT_VALIDATION; }
      await setConfigValue(key, parseConfigValue(value));
      success(`Set ${key} = ${value}`);
      return EXIT_OK;
    }
    case "list": {
      const config = await loadConfig();
      console.log(JSON.stringify(maskSecrets(config), null, 2));
      return EXIT_OK;
    }
    case "reset": {
      process.stdout.write("Reset config to defaults? [y/N] ");
      const answer = await readLine();
      if (answer.toLowerCase() !== "y") {
        console.log("Cancelled.");
        return EXIT_OK;
      }
      await resetConfig();
      success("Config reset to defaults");
      return EXIT_OK;
    }
    case "edit": {
      const editor = process.env.EDITOR || "vim";
      const configPath = getConfigPath();
      // Ensure config file exists
      const config = await loadConfig();
      await saveConfig(config);
      const proc = Bun.spawn([editor, configPath], { stdio: ["inherit", "inherit", "inherit"] });
      await proc.exited;
      return EXIT_OK;
    }
    case "path":
      console.log(getConfigPath());
      return EXIT_OK;
    default:
      error("Usage: tsk config <list|get|set|reset|edit|path>");
      return EXIT_VALIDATION;
  }
}

type ConnectProvider = "todoist" | "linear" | "asana" | "github";

function parseConnectProvider(value: string | undefined): ConnectProvider | null {
  if (value === "todoist" || value === "linear" || value === "asana" || value === "github") return value;
  return null;
}

async function getGhCliToken(): Promise<string | null> {
  try {
    const proc = Bun.spawn(["gh", "auth", "token"], { stdout: "pipe", stderr: "pipe" });
    const token = (await new Response(proc.stdout).text()).trim();
    const code = await proc.exited;
    if (code !== 0 || !token) return null;
    return token;
  } catch {
    return null;
  }
}

async function createProviderForKey(provider: ConnectProvider, config: Awaited<ReturnType<typeof loadConfig>>): Promise<SyncProvider | null> {
  switch (provider) {
    case "todoist": {
      const cfg = config.integrations.todoist;
      if (!cfg?.accessToken) return null;
      return new TodoistProvider(cfg.accessToken, cfg.projectId);
    }
    case "linear": {
      const cfg = config.integrations.linear;
      if (!cfg?.accessToken) return null;
      return new LinearProvider(cfg.accessToken, cfg.teamId);
    }
    case "asana": {
      const cfg = config.integrations.asana;
      if (!cfg?.accessToken) return null;
      return new AsanaProvider(cfg.accessToken, cfg.workspaceId, cfg.projectId);
    }
    case "github": {
      const cfg = config.integrations.github;
      if (!cfg?.repo) return null;
      return new GitHubIssuesProvider(cfg.repo, {
        accessToken: cfg.accessToken,
        useGhCli: cfg.useGhCli,
        labelFilter: cfg.labelFilter,
      });
    }
  }
}

async function cmdConnect(args: string[]): Promise<number> {
  const pos = positionalArgs(args);
  const provider = parseConnectProvider(pos[0]);
  if (!provider) {
    error("Usage: tsk connect <todoist|linear|asana|github> [--token ...] [--api-key ...]");
    return EXIT_VALIDATION;
  }

  const config = await loadConfig();
  const alreadyConnected = (
    (provider === "todoist" && !!config.integrations.todoist?.accessToken) ||
    (provider === "linear" && !!config.integrations.linear?.accessToken) ||
    (provider === "asana" && !!config.integrations.asana?.accessToken) ||
    (provider === "github" && !!config.integrations.github?.repo && (!!config.integrations.github?.accessToken || !!config.integrations.github?.useGhCli))
  );

  if (alreadyConnected) {
    process.stdout.write(`Already connected to ${provider}. Reconnect? [y/N] `);
    const answer = await readLine();
    if (answer.toLowerCase() !== "y") {
      console.log("Cancelled.");
      return EXIT_OK;
    }
  }

  const tokenFlag = getFlag(args, "--token");
  const apiKeyFlag = getFlag(args, "--api-key");
  const repoFlag = getFlag(args, "--repo");
  const clientId = getFlag(args, "--client-id");
  const clientSecret = getFlag(args, "--client-secret");

  try {
    switch (provider) {
      case "todoist": {
        let accessToken = tokenFlag ?? apiKeyFlag ?? "";
        let refreshToken: string | undefined;

        if (!accessToken) {
          const cid = clientId ?? process.env.TSK_TODOIST_CLIENT_ID;
          const secret = clientSecret ?? process.env.TSK_TODOIST_CLIENT_SECRET;
          if (!cid || !secret) {
            error("Missing token and OAuth client credentials for Todoist");
            return EXIT_VALIDATION;
          }
          const oauth = await runOAuthFlow({
            authorizeUrl: "https://todoist.com/oauth/authorize",
            tokenUrl: "https://todoist.com/oauth/access_token",
            clientId: cid,
            clientSecret: secret,
            scopes: ["data:read_write"],
            usePkce: true,
          });
          accessToken = oauth.accessToken;
          refreshToken = oauth.refreshToken;
        }

        config.integrations.todoist = {
          accessToken,
          refreshToken,
          projectFilter: getFlag(args, "--project"),
        };
        break;
      }
      case "linear": {
        let accessToken = tokenFlag ?? apiKeyFlag ?? "";
        if (!accessToken) {
          const cid = clientId ?? process.env.TSK_LINEAR_CLIENT_ID;
          const secret = clientSecret ?? process.env.TSK_LINEAR_CLIENT_SECRET;
          if (!cid) {
            error("Missing token/api-key and OAuth client id for Linear");
            return EXIT_VALIDATION;
          }
          const oauth = await runOAuthFlow({
            authorizeUrl: "https://linear.app/oauth/authorize",
            tokenUrl: "https://api.linear.app/oauth/token",
            clientId: cid,
            clientSecret: secret,
            scopes: ["read", "write"],
            usePkce: true,
          });
          accessToken = oauth.accessToken;
        }

        config.integrations.linear = {
          accessToken,
          teamId: getFlag(args, "--team"),
          projectId: getFlag(args, "--project"),
        };
        break;
      }
      case "asana": {
        let accessToken = tokenFlag ?? "";
        let refreshToken: string | undefined;
        let tokenExpiresAt: string | undefined;

        if (!accessToken) {
          const cid = clientId ?? process.env.TSK_ASANA_CLIENT_ID;
          const secret = clientSecret ?? process.env.TSK_ASANA_CLIENT_SECRET;
          if (!cid || !secret) {
            error("Missing token and OAuth client credentials for Asana");
            return EXIT_VALIDATION;
          }
          const oauth = await runOAuthFlow({
            authorizeUrl: "https://app.asana.com/-/oauth_authorize",
            tokenUrl: "https://app.asana.com/-/oauth_token",
            clientId: cid,
            clientSecret: secret,
            scopes: ["default"],
            usePkce: true,
          });
          accessToken = oauth.accessToken;
          refreshToken = oauth.refreshToken;
          tokenExpiresAt = oauth.expiresIn ? new Date(Date.now() + oauth.expiresIn * 1000).toISOString() : undefined;
        }

        config.integrations.asana = {
          accessToken,
          refreshToken,
          tokenExpiresAt,
          workspaceId: getFlag(args, "--workspace"),
          projectId: getFlag(args, "--project"),
        };
        break;
      }
      case "github": {
        const repo = repoFlag ?? config.integrations.github?.repo;
        if (!repo) {
          error("GitHub requires --repo owner/repo");
          return EXIT_VALIDATION;
        }

        let accessToken = tokenFlag;
        let useGhCli = false;

        if (!accessToken) {
          const ghToken = await getGhCliToken();
          if (ghToken) {
            accessToken = ghToken;
            useGhCli = true;
          }
        }

        if (!accessToken) {
          const cid = clientId ?? process.env.TSK_GITHUB_CLIENT_ID;
          if (!cid) {
            error("Missing --token and GitHub OAuth client id");
            return EXIT_VALIDATION;
          }
          const device = await runDeviceFlow({
            deviceCodeUrl: "https://github.com/login/device/code",
            tokenUrl: "https://github.com/login/oauth/access_token",
            clientId: cid,
            scopes: ["repo"],
          });
          accessToken = device.accessToken;
        }

        config.integrations.github = {
          accessToken,
          repo,
          useGhCli,
          labelFilter: getFlag(args, "--label")
            ? getFlag(args, "--label")!.split(",").map((s) => s.trim()).filter(Boolean)
            : undefined,
        };
        break;
      }
    }

    await saveConfig(config);

    const providerInstance = await createProviderForKey(provider, config);
    if (!providerInstance) {
      error(`Failed to initialize ${provider} provider`);
      return EXIT_ERROR;
    }

    const connection = await providerInstance.testConnection();
    if (!connection.ok) {
      if (tokenFlag || apiKeyFlag) {
        console.log(dim(`Warning: saved credentials but test failed (${connection.error ?? "unknown error"})`));
        success(`Connected to ${provider}`);
        return EXIT_OK;
      }
      error(`Failed: ${connection.error ?? "connection test failed"}`);
      return EXIT_ERROR;
    }

    success(`Connected to ${provider}${connection.user ? ` as ${connection.user}` : ""}`);
    return EXIT_OK;
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    return EXIT_ERROR;
  }
}

async function cmdDisconnect(args: string[]): Promise<number> {
  const pos = positionalArgs(args);
  const provider = parseConnectProvider(pos[0]);
  if (!provider) {
    error("Usage: tsk disconnect <todoist|linear|asana|github>");
    return EXIT_VALIDATION;
  }

  const source = providerKeyToSource(provider);
  if (!source) {
    error(`Unsupported provider: ${provider}`);
    return EXIT_VALIDATION;
  }

  const config = await loadConfig();
  if (provider === "github") delete config.integrations.github;
  else if (provider === "todoist") delete config.integrations.todoist;
  else if (provider === "linear") delete config.integrations.linear;
  else if (provider === "asana") delete config.integrations.asana;
  await saveConfig(config);

  const store = await TaskStore.create();
  for (const task of store.tasks) {
    if (task.externalSource === source) {
      task.externalSource = null;
      task.externalId = null;
    }
  }
  await store.save();

  const state = await SyncStateManager.load();
  delete state.lastSyncAt[source];
  for (const [localId, externalId] of Object.entries({ ...state.idMap })) {
    const task = store.tasks.find((t) => t.id === localId);
    if (!task || task.externalSource === source) {
      SyncStateManager.removeMapping(state, localId);
      state.deletedRemotely = state.deletedRemotely.filter((id) => id !== externalId);
    }
  }
  await SyncStateManager.save(state);

  success(`Disconnected ${provider}`);
  return EXIT_OK;
}

function formatLastSync(iso?: string): string {
  if (!iso) return "never";
  return formatRelativeTime(iso);
}

async function cmdSyncStatus(): Promise<number> {
  const config = await loadConfig();
  const state = await SyncStateManager.load();
  const store = await TaskStore.create();

  const rows = [
    {
      label: "Todoist",
      connected: !!config.integrations.todoist?.accessToken,
      source: "todoist" as const,
    },
    {
      label: "Linear",
      connected: !!config.integrations.linear?.accessToken,
      source: "linear" as const,
    },
    {
      label: "Asana",
      connected: !!config.integrations.asana?.accessToken,
      source: "asana" as const,
    },
    {
      label: "GitHub",
      connected: !!config.integrations.github?.repo && (!!config.integrations.github?.accessToken || !!config.integrations.github?.useGhCli),
      source: "github-issues" as const,
    },
  ];

  console.log("Integration Status:");
  for (const row of rows) {
    const indicator = row.connected ? green("✓ Connected") : red("✗ Not connected");
    const lastSync = formatLastSync(state.lastSyncAt[row.source]);
    const syncedCount = store.tasks.filter((task) => task.externalSource === row.source).length;
    console.log(`  ${pad(row.label, 10)} ${indicator}    Last sync: ${pad(lastSync, 10)}    Tasks: ${syncedCount} synced`);
  }
  const agentEnabled = config.integrations.agent?.enabled ?? false;
  console.log(`  ${pad("Agent", 10)} ${agentEnabled ? cyan("○ Enabled") : dim("○ Disabled")}`);
  return EXIT_OK;
}

async function cmdSync(args: string[]): Promise<number> {
  if (hasFlag(args, "--status")) {
    return cmdSyncStatus();
  }

  if (hasFlag(args, "--reset")) {
    await SyncStateManager.save(SyncStateManager.defaults());
    success("Sync state reset");
    return EXIT_OK;
  }

  const pos = positionalArgs(args);
  const providerArg = pos[0];
  const providers: ConnectProvider[] = providerArg
    ? (() => {
      const single = parseConnectProvider(providerArg);
      return single ? [single] : [];
    })()
    : ["todoist", "linear", "asana", "github"];

  if (providers.length === 0) {
    error("Usage: tsk sync [todoist|linear|asana|github] [--pull-only|--push-only|--dry-run|--status|--reset]");
    return EXIT_VALIDATION;
  }

  const pullOnly = hasFlag(args, "--pull-only");
  const pushOnly = hasFlag(args, "--push-only");
  const dryRun = hasFlag(args, "--dry-run");
  if (pullOnly && pushOnly) {
    error("Cannot use --pull-only and --push-only together");
    return EXIT_VALIDATION;
  }

  const config = await loadConfig();
  const store = await TaskStore.create();
  const state = await SyncStateManager.load();
  let ran = 0;

  for (const providerKey of providers) {
    const provider = await createProviderForKey(providerKey, config);
    if (!provider) continue;
    const engine = new SyncEngine(store, provider, state, config.sync);
    const result = await engine.sync({ pullOnly, pushOnly, dryRun });
    ran += 1;
    console.log(`${providerKey}: pulled=${result.pulled} pushed=${result.pushed} deleted=${result.deleted} conflicts=${result.conflicts} errors=${result.errors.length}`);
    for (const err of result.errors) {
      console.log(dim(`  - ${err.operation}: ${err.message}`));
    }
  }

  if (ran === 0) {
    console.log(dim("No connected providers."));
    return EXIT_OK;
  }

  if (dryRun) {
    console.log("No changes applied.");
  }
  return EXIT_OK;
}

// ── Export command ────────────────────────────────────

async function cmdExport(args: string[]): Promise<number> {
  const format = getFlag(args, "--format") ?? "json";
  const store = await TaskStore.create();
  const tasks = store.tasks.filter((t) => t.status !== "archived");

  switch (format) {
    case "json":
      console.log(JSON.stringify(tasks, null, 2));
      break;
    case "csv": {
      console.log("id,title,status,priority,project,due_date,created_at,completed_at,tags");
      for (const t of tasks) {
        const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
        console.log([
          t.id.slice(0, 8),
          escape(t.title),
          t.status,
          t.priority,
          t.project ?? "",
          t.dueDate ?? "",
          t.createdAt.slice(0, 10),
          t.completedAt?.slice(0, 10) ?? "",
          t.tags.join(";"),
        ].join(","));
      }
      break;
    }
    case "markdown": {
      console.log("# Tasks\n");
      const grouped = new Map<string, Task[]>();
      for (const t of tasks) {
        const key = t.project ?? "(No Project)";
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(t);
      }
      for (const [project, projectTasks] of grouped) {
        console.log(`## ${project}\n`);
        for (const t of projectTasks) {
          const check = t.status === "done" ? "x" : " ";
          const pri = t.priority !== "none" ? ` [${t.priority}]` : "";
          const due = t.dueDate ? ` (due: ${t.dueDate})` : "";
          console.log(`- [${check}] ${t.title}${pri}${due}`);
        }
        console.log("");
      }
      break;
    }
    default:
      error(`Unknown format: "${format}". Use json, csv, or markdown`);
      return EXIT_VALIDATION;
  }
  return EXIT_OK;
}

// ── Bulk operations ──────────────────────────────────

function filterBulk(tasks: Task[], args: string[]): Task[] {
  let result = [...tasks];

  const statusVal = getFlag(args, "--status");
  if (statusVal) {
    const statuses = statusVal.split(",").map((s) => s.trim());
    result = result.filter((t) => statuses.includes(t.status));
  }

  const projectVal = getFlag(args, "--project");
  if (projectVal) {
    result = result.filter((t) => t.project === projectVal);
  }

  const tagVal = getFlag(args, "--tag");
  if (tagVal) {
    result = result.filter((t) => t.tags.includes(tagVal));
  }

  return result;
}

async function cmdBulkDone(args: string[]): Promise<number> {
  const store = await TaskStore.create();
  const targets = filterBulk(store.tasks, args);

  if (targets.length === 0) {
    console.log(dim("No matching tasks."));
    return EXIT_OK;
  }

  for (const t of targets) {
    if (t.status !== "done") {
      store.moveToStatus(t.id, "done");
    }
  }
  await store.save();

  success(`Marked ${targets.length} task${targets.length === 1 ? "" : "s"} as done`);
  return EXIT_OK;
}

async function cmdBulkRm(args: string[]): Promise<number> {
  const store = await TaskStore.create();
  const targets = filterBulk(store.tasks, args);

  if (targets.length === 0) {
    console.log(dim("No matching tasks."));
    return EXIT_OK;
  }

  if (!hasFlag(args, "--force")) {
    process.stdout.write(`Delete ${targets.length} task${targets.length === 1 ? "" : "s"}? [y/N] `);
    const answer = await readLine();
    if (answer.toLowerCase() !== "y") {
      console.log("Cancelled.");
      return EXIT_OK;
    }
  }

  for (const t of targets) {
    store.deleteTask(t.id);
  }
  await store.save();

  success(`Deleted ${targets.length} task${targets.length === 1 ? "" : "s"}`);
  return EXIT_OK;
}

// ── Stdin helper ─────────────────────────────────────

function readLine(): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setEncoding("utf8");
    stdin.resume();
    stdin.once("data", (data: string) => {
      stdin.pause();
      resolve(data.trim());
    });
  });
}

function pad(s: string, len: number): string {
  return s.length >= len ? s : s + " ".repeat(len - s.length);
}

// ── Main entry ───────────────────────────────────────

export async function runCLI(args: string[]): Promise<number> {
  // Global flags
  const noColor = hasFlag(args, "--no-color") || !!process.env.NO_COLOR;
  setColorEnabled(!noColor);

  const missingFlag = findFirstMissingFlagValue(args);
  if (missingFlag) {
    error(`Missing value for ${missingFlag}`);
    return EXIT_VALIDATION;
  }

  if (hasFlag(args, "--version", "-v")) {
    console.log("tsk v0.2.0");
    return EXIT_OK;
  }

  if (hasFlag(args, "--help", "-h") && !args.some((a) => !a.startsWith("-"))) {
    console.log(HELP_MAIN);
    return EXIT_OK;
  }

  const subcommand = args.find((a) => !a.startsWith("-"));
  if (!subcommand) {
    console.log(HELP_MAIN);
    return EXIT_OK;
  }

  // Remove subcommand from args for sub-handlers
  const subIdx = args.indexOf(subcommand);
  const handlerArgs = [...args.slice(0, subIdx), ...args.slice(subIdx + 1)];

  try {
    switch (subcommand) {
      case "add": return await cmdAdd(handlerArgs);
      case "list": case "ls": return await cmdList(handlerArgs);
      case "show": return await cmdShow(handlerArgs);
      case "edit": return await cmdEdit(handlerArgs);
      case "done": return await cmdDone(handlerArgs);
      case "start": return await cmdStart(handlerArgs);
      case "archive": return await cmdArchive(handlerArgs);
      case "rm": case "remove": case "delete": return await cmdRm(handlerArgs);
      case "search": return await cmdSearch(handlerArgs);
      case "projects": return await cmdProjects(handlerArgs);
      case "tags": return await cmdTags(handlerArgs);
      case "subtasks": return await cmdSubtasks(handlerArgs);
      case "indent": return await cmdIndent(handlerArgs);
      case "promote": return await cmdPromote(handlerArgs);
      case "estimate": return await cmdEstimate(handlerArgs);
      case "log": return await cmdLogTime(handlerArgs);
      case "config": return await cmdConfig(handlerArgs);
      case "connect": return await cmdConnect(handlerArgs);
      case "disconnect": return await cmdDisconnect(handlerArgs);
      case "sync": return await cmdSync(handlerArgs);
      case "export": return await cmdExport(handlerArgs);
      default:
        error(`Unknown command: "${subcommand}"`);
        console.error("Run 'tsk --help' for usage.");
        return EXIT_ERROR;
    }
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    return EXIT_ERROR;
  }
}
