import { describe, expect, it } from "bun:test";
import type { Task } from "../store/types.ts";
import { buildDayTaskMap } from "./calendar-view.tsx";

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    title: overrides.title ?? "task",
    description: overrides.description ?? "",
    status: overrides.status ?? "todo",
    priority: overrides.priority ?? "none",
    project: overrides.project ?? null,
    tags: overrides.tags ?? [],
    dueDate: overrides.dueDate ?? null,
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00.000Z",
    completedAt: overrides.completedAt ?? null,
    order: overrides.order ?? 0,
    parentId: overrides.parentId ?? null,
    subtaskIds: overrides.subtaskIds ?? [],
    blockedBy: overrides.blockedBy ?? [],
    recurrence: overrides.recurrence ?? null,
    estimateMinutes: overrides.estimateMinutes ?? null,
    actualMinutes: overrides.actualMinutes ?? null,
    notes: overrides.notes ?? [],
    externalId: overrides.externalId ?? null,
    externalSource: overrides.externalSource ?? null,
  };
}

describe("calendar day task map", () => {
  it("maps only tasks due in the visible month", () => {
    const tasks = [
      makeTask({ dueDate: "2026-02-10", title: "in month" }),
      makeTask({ dueDate: "2026-03-10", title: "out of month" }),
      makeTask({ dueDate: null, title: "undated" }),
    ];

    const map = buildDayTaskMap(tasks, 2026, 1, 28);

    expect(map.get(10)?.length).toBe(1);
    expect(map.has(3)).toBe(false);
    expect(map.has(0)).toBe(false);
  });

  it("supports leap-year day 29 and reflects updated task collections", () => {
    const before = [makeTask({ dueDate: "2024-02-29", title: "leap" })];
    const after = [...before, makeTask({ dueDate: "2024-02-15", title: "new" })];

    const firstMap = buildDayTaskMap(before, 2024, 1, 29);
    expect(firstMap.get(29)?.[0]?.title).toBe("leap");
    expect(firstMap.has(15)).toBe(false);

    const secondMap = buildDayTaskMap(after, 2024, 1, 29);
    expect(secondMap.get(29)?.[0]?.title).toBe("leap");
    expect(secondMap.get(15)?.[0]?.title).toBe("new");
  });
});
