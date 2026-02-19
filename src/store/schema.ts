import { z } from "zod";
import type {
  ExternalSource,
  RecurrenceRule,
  Task,
  TaskNote,
  TaskPriority,
  TaskStatus,
} from "./types.ts";

const TASK_STATUS_VALUES: [TaskStatus, ...TaskStatus[]] = [
  "todo",
  "in_progress",
  "done",
  "archived",
];

const TASK_PRIORITY_VALUES: [TaskPriority, ...TaskPriority[]] = [
  "none",
  "low",
  "medium",
  "high",
  "urgent",
];

const EXTERNAL_SOURCE_VALUES: [ExternalSource, ...ExternalSource[]] = [
  "todoist",
  "linear",
  "asana",
  "claude-code",
  "codex",
  "github-issues",
];

const taskNoteSchema = z.object({
  id: z.string().min(1),
  content: z.string(),
  createdAt: z.string(),
  source: z.enum(["user", "sync"]),
});

const recurrenceRuleSchema = z.object({
  frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
  interval: z.number().int().positive(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  endDate: z.string().nullable().optional(),
  nextDue: z.string().optional(),
});

const persistedTaskSchema = z
  .object({
    id: z.string().min(1).optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    status: z.enum(TASK_STATUS_VALUES).optional(),
    priority: z.enum(TASK_PRIORITY_VALUES).optional(),
    project: z.string().nullable().optional(),
    tags: z.array(z.string()).optional(),
    dueDate: z.string().nullable().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    completedAt: z.string().nullable().optional(),
    order: z.number().int().optional(),
    parentId: z.string().nullable().optional(),
    subtaskIds: z.array(z.string()).optional(),
    blockedBy: z.array(z.string()).optional(),
    recurrence: recurrenceRuleSchema.nullable().optional(),
    estimateMinutes: z.number().int().nullable().optional(),
    actualMinutes: z.number().int().nullable().optional(),
    notes: z.array(taskNoteSchema).optional(),
    externalId: z.string().nullable().optional(),
    externalSource: z.enum(EXTERNAL_SOURCE_VALUES).nullable().optional(),
  })
  .passthrough();

const persistedTaskArraySchema = z.array(persistedTaskSchema);

type PersistedTaskInput = z.infer<typeof persistedTaskSchema>;

function normalizeTask(raw: PersistedTaskInput): Task {
  const now = new Date().toISOString();

  return {
    id: raw.id ?? crypto.randomUUID(),
    title: (raw.title ?? "").slice(0, 200),
    description: raw.description ?? "",
    status: raw.status ?? "todo",
    priority: raw.priority ?? "none",
    project: raw.project ?? null,
    tags: raw.tags ?? [],
    dueDate: raw.dueDate ?? null,
    createdAt: raw.createdAt ?? now,
    updatedAt: raw.updatedAt ?? now,
    completedAt: raw.completedAt ?? null,
    order: raw.order ?? 0,
    parentId: raw.parentId ?? null,
    subtaskIds: raw.subtaskIds ?? [],
    blockedBy: raw.blockedBy ?? [],
    recurrence: (raw.recurrence as RecurrenceRule | null | undefined) ?? null,
    estimateMinutes: raw.estimateMinutes ?? null,
    actualMinutes: raw.actualMinutes ?? null,
    notes: (raw.notes as TaskNote[] | undefined) ?? [],
    externalId: raw.externalId ?? null,
    externalSource: raw.externalSource ?? null,
  };
}

export function parsePersistedTasks(input: unknown): Task[] {
  const parsed = persistedTaskArraySchema.parse(input);
  return parsed.map(normalizeTask);
}
