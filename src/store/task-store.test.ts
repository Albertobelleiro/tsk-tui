import { afterEach, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "./task-store.ts";
import { DEFAULT_FILTER } from "./types.ts";

const createdDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tsk-store-test-"));
  createdDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of createdDirs.splice(0)) {
    await chmod(dir, 0o700).catch(() => undefined);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

describe("TaskStore persistence hardening", () => {
  it("retries failed debounced writes and clears error after recovery", async () => {
    const dir = await makeTempDir();
    const store = await TaskStore.create({ dataDir: dir });

    await chmod(dir, 0o500);
    store.addTask({ title: "retry me" });

    await Bun.sleep(450);
    expect(store.persistenceError).not.toBeNull();
    expect(store.hasPendingSave).toBe(true);

    await chmod(dir, 0o700);
    await Bun.sleep(1400);
    await store.flushPendingSave();

    expect(store.persistenceError).toBeNull();
    expect(store.hasPendingSave).toBe(false);

    const data = JSON.parse(await Bun.file(join(dir, "tasks.json")).text()) as unknown[];
    expect(data.length).toBe(1);
  });

  it("keeps existing tasks.json valid when a save fails", async () => {
    const dir = await makeTempDir();
    const store = await TaskStore.create({ dataDir: dir });

    store.addTask({ title: "stable" });
    await store.flushPendingSave();

    const filePath = join(dir, "tasks.json");
    const before = await Bun.file(filePath).text();

    await chmod(dir, 0o500);
    store.addTask({ title: "should not corrupt" });
    await Bun.sleep(450);

    const duringFailure = await Bun.file(filePath).text();
    expect(() => JSON.parse(duringFailure)).not.toThrow();
    expect(duringFailure).toBe(before);

    await chmod(dir, 0o700);
    await store.flushPendingSave();
  });

  it("backs up invalid data and resets to empty state", async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, "tasks.json"), JSON.stringify([{ id: "a", title: "bad", tags: "oops" }]));

    const store = await TaskStore.create({ dataDir: dir });
    expect(store.tasks.length).toBe(0);

    const files = await readdir(dir);
    expect(files.some((f) => f.startsWith("tasks.json.invalid.") && f.endsWith(".bak"))).toBe(true);

    const resetText = await Bun.file(join(dir, "tasks.json")).text();
    expect(JSON.parse(resetText)).toEqual([]);
  });

  it("returns deterministic order for equal sort keys", async () => {
    const dir = await makeTempDir();
    const store = await TaskStore.create({ dataDir: dir });

    const a = store.addTask({ title: "A", priority: "medium" });
    const b = store.addTask({ title: "B", priority: "medium" });

    // Make all sort keys except ID equal.
    a.createdAt = "2026-01-01T00:00:00.000Z";
    b.createdAt = "2026-01-01T00:00:00.000Z";
    a.dueDate = null;
    b.dueDate = null;

    const filter = { ...DEFAULT_FILTER, sortBy: "priority", sortDirection: "desc" } as const;
    const first = store.getFiltered(filter).map((t) => t.id);
    const second = store.getFiltered(filter).map((t) => t.id);
    const third = store.getFiltered(filter).map((t) => t.id);

    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });
});
