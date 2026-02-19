import { describe, expect, it } from "bun:test";
import { shouldCaptureInput, shouldNotifyUnblocked } from "./task-list.tsx";
import { shouldBlockGlobalShortcuts } from "../app.tsx";
import { colors, setMonochromeEnabled } from "../theme/colors.ts";

describe("task-list interaction guards", () => {
  it("marks view as capturing input for search and inline add", () => {
    expect(shouldCaptureInput(false, false)).toBe(false);
    expect(shouldCaptureInput(true, false)).toBe(true);
    expect(shouldCaptureInput(false, true)).toBe(true);
  });

  it("notifies unblocked tasks only when transitioning to done", () => {
    expect(shouldNotifyUnblocked(false, false)).toBe(true);
    expect(shouldNotifyUnblocked(true, false)).toBe(false);
    expect(shouldNotifyUnblocked(false, true)).toBe(false);
  });

  it("blocks global shortcuts while a view captures input", () => {
    expect(shouldBlockGlobalShortcuts(false, true)).toBe(true);
    expect(shouldBlockGlobalShortcuts(true, false)).toBe(true);
    expect(shouldBlockGlobalShortcuts(false, false)).toBe(false);
  });

  it("switches to monochrome theme when no-color mode is enabled", () => {
    setMonochromeEnabled(true);
    expect(colors.accent).toBe("white");
    expect(colors.bg).toBe("black");
    setMonochromeEnabled(false);
  });
});
