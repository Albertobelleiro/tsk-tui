import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCLI } from "./index.ts";

let testDataDir = "";
let previousDataDir: string | undefined;

beforeEach(async () => {
  testDataDir = await mkdtemp(join(tmpdir(), "tsk-cli-test-"));
  previousDataDir = process.env.TSK_DATA_DIR;
  process.env.TSK_DATA_DIR = testDataDir;
});

afterEach(async () => {
  if (previousDataDir === undefined) {
    delete process.env.TSK_DATA_DIR;
  } else {
    process.env.TSK_DATA_DIR = previousDataDir;
  }
  await chmod(testDataDir, 0o700).catch(() => undefined);
  await rm(testDataDir, { recursive: true, force: true }).catch(() => undefined);
});

describe("CLI parsing hardening", () => {
  it("returns validation error for missing flag values", async () => {
    const code = await runCLI(["add", "foo", "--priority", "--due", "2026-01-01"]);
    expect(code).toBe(4);
  });

  it("returns validation error for empty partial IDs", async () => {
    const created = await runCLI(["add", "parent task"]);
    expect(created).toBe(0);

    const code = await runCLI(["add", "child task", "--subtask-of", ""]);
    expect(code).toBe(4);
  });
});
