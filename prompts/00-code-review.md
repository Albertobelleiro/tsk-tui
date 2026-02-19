# Session 0 — Code Review

## Objective

Perform a comprehensive code review of the entire `tsk` codebase before starting v0.2 development. The goal is to identify bugs, anti-patterns, performance risks, type safety gaps, UX inconsistencies, and architectural debt that must be resolved before adding integrations and subtask TUI.

Do NOT make any code changes. Output a structured review report only.

## Project Context

- **What**: Keyboard-driven terminal task manager (TUI + CLI dual interface)
- **Stack**: TypeScript strict, Bun runtime, @opentui/react (React for terminals)
- **Persistence**: Single JSON file at `~/.tsk/tasks.json`, debounced writes
- **State**: Singleton TaskStore with `useSyncExternalStore`, 50-level undo/redo
- **UI**: 4 views (task list, kanban board, calendar, help), modal stack system
- **CLI**: 11 headless commands with partial ID resolution and exit codes
- **Theme**: Tokyo Night palette, hardcoded in `src/theme/colors.ts`
- **Data model**: Task with v0.2 fields already added (parentId, subtaskIds, notes, externalId, externalSource, blockedBy, recurrence, estimateMinutes, actualMinutes)

## Files to Review (in this exact order)

### Core (review thoroughly — highest impact)
1. `src/store/types.ts` — All interfaces and type aliases
2. `src/store/task-store.ts` — Singleton store, CRUD, persistence, undo, pub/sub
3. `src/store/schema.ts` — Persisted task parsing/validation
4. `src/app.tsx` — Root component, view routing, modal stack, global keyboard handler

### Views (review for UX bugs and keyboard conflicts)
5. `src/views/task-list.tsx` — Main view, two-panel layout, navigation, all task actions
6. `src/views/project-view.tsx` — Kanban board, column nav, task movement
7. `src/views/calendar-view.tsx` — Month grid, day selection, task display
8. `src/views/help-view.tsx` — Keybinding reference

### Components (review for rendering bugs and edge cases)
9. `src/components/task-row.tsx` — Single task row styling, priority badges, due date colors
10. `src/components/task-detail.tsx` — Right panel detail display
11. `src/components/header.tsx` — Tab navigation bar
12. `src/components/status-bar.tsx` — Bottom info bar
13. `src/components/input-modal.tsx` — Add/edit form, field validation
14. `src/components/select-modal.tsx` — Single/multi select picker
15. `src/components/confirm-modal.tsx` — Yes/no dialog
16. `src/components/search-overlay.tsx` — Real-time search
17. `src/components/modal.tsx` — Base modal wrapper

### CLI (review for flag parsing bugs and edge cases)
18. `src/cli/index.ts` — Command dispatcher, flag parsing, partial ID resolution
19. `src/cli/format.ts` — ANSI formatting, table rendering

### Utilities
20. `src/theme/colors.ts` — Color constants
21. `src/utils/date.ts` — Date formatters and calendar helpers

### Entry Point
22. `bin/tsk.tsx` — CLI vs TUI dispatcher, renderer setup

### Config
23. `package.json` — Dependencies, scripts, build targets
24. `tsconfig.json` — Compiler options

## Review Checklist

For each file, evaluate against ALL of the following categories. Only report issues found — do not pad with "looks good" filler.

### 1. BUGS & CORRECTNESS
- Off-by-one errors in navigation (j/k at boundaries, page jump J/K)
- Race conditions in debounced save (rapid mutations before write completes)
- Undo system: does `structuredClone` correctly deep-copy all fields? Any references leaking?
- Modal stack: can modals get stuck? What happens if you open two modals rapidly?
- Partial ID resolution: what if the input is an empty string? What if all tasks share a prefix?
- Date handling: timezone issues? What happens at midnight? Leap years?
- Calendar view: does February 29 render correctly in leap years? Does month wrapping work at December→January?
- Filter state: does "all" status correctly exclude archived? Are edge cases handled when all tasks are filtered out?
- Sort stability: is the sort stable when tasks have equal priority and no due date?
- JSON persistence: what happens if `Bun.write` fails mid-write (disk full, permissions)?

### 2. TYPE SAFETY
- Any `as` casts that bypass safety?
- Any `any` types hiding in function signatures or return values?
- Are discriminated unions exhaustive (switch/case covering all variants)?
- Do event handlers properly type their parameters?
- Are array index accesses guarded against undefined?
- Does the store's `getSnapshot()` return a stable reference for `useSyncExternalStore`?

### 3. PERFORMANCE
- Is `getFiltered()` called on every render? Does it re-sort the entire array each time?
- Are React components memoized where they should be? (task rows, detail panel)
- Does the scrollbox re-render all children or only visible ones?
- Is `structuredClone` called too frequently (undo snapshot on every mutation)?
- Are there any O(n²) operations hidden in loops?
- Does the keyboard handler create new closures on every render?

### 4. ERROR HANDLING
- What happens if `~/.tsk/` directory can't be created (permissions)?
- What happens if `tasks.json` contains valid JSON but wrong schema?
- Are CLI commands graceful when store.load() fails?
- Do API flag parsers handle malformed input (e.g., `--priority invalid`)?
- Is there any unhandled promise rejection in async paths?

### 5. UX CONSISTENCY
- Are keybindings consistent across views? (same key doing different things in different views)
- Does `Esc` always close the topmost modal/overlay? Are there cases where it doesn't?
- Is `q` to quit disabled when a modal is open? (it should be — don't quit while editing)
- Does the search overlay steal focus correctly? Can you get into a state where keys go to the wrong handler?
- Are empty states shown for every view when no tasks match? Is the messaging consistent?
- Does the status bar accurately reflect the current state at all times?

### 6. ACCESSIBILITY & TERMINAL COMPATIBILITY
- Do colors degrade gracefully in 256-color terminals vs true-color?
- Is `NO_COLOR` env var respected everywhere (not just CLI)?
- Are Unicode characters (●, ◉, ✓, ▪, ▸, ▎) safe across common terminal emulators?
- What happens in very small terminals (< 40 cols, < 10 rows)?

### 7. CODE QUALITY
- Dead code or unused imports?
- Magic numbers or hardcoded strings that should be constants?
- Functions longer than 80 lines that should be decomposed?
- Duplicated logic between views (e.g., keyboard handling repeated in task-list and project-view)?
- Are there TODO/FIXME/HACK comments left in the code?
- Is the module boundary between store and views clean, or does UI logic leak into the store?

### 8. SECURITY
- Is the JSON file readable/writable only by the current user? (file permissions)
- Does `Bun.write` overwrite atomically or can partial writes corrupt data?
- Are there any code injection risks in the CLI argument parser?
- Could malformed task data in `tasks.json` cause a crash or infinite loop?

### 9. EXTENSIBILITY (readiness for v0.2)
- Can the Task interface be extended without breaking existing data files?
- Is the store designed for adding new methods without modifying existing ones?
- Can new views be added without touching app.tsx's keyboard handler?
- Is the modal system flexible enough for new modal types?
- Can the CLI add new commands without restructuring the dispatcher?
- Is the color theme extractable into a pluggable theme system?
- Is there a clean boundary where sync/integration logic could plug in?

## Output Format

Structure your review as follows:

```
# tsk v0.1 — Code Review Report

## Executive Summary
[2-3 sentences: overall assessment, most critical issue, readiness for v0.2]

## Critical Issues (must fix before v0.2)
### [CRIT-1] Title
- **File**: `path/to/file.ts:line`
- **Category**: Bug / Type Safety / Security
- **Description**: [What's wrong]
- **Impact**: [What breaks]
- **Fix**: [Concrete suggestion, 1-3 lines of pseudocode if needed]

## High Priority (fix during v0.2 development)
### [HIGH-1] Title
- **File**: ...
- **Category**: ...
- **Description**: ...
- **Fix**: ...

## Medium Priority (nice to fix, no rush)
### [MED-1] ...

## Low Priority (style / minor)
### [LOW-1] ...

## Architecture Notes for v0.2
[Bullet list: what's well-designed and should be preserved, what needs refactoring before extending, any patterns to avoid repeating]

## Metrics
- Files reviewed: X/24
- Critical issues: N
- High issues: N
- Medium issues: N
- Low issues: N
- Estimated fix effort: [hours]
```

## Constraints

- Read EVERY file listed above — do not skip any
- Do NOT suggest changes to the PRD or feature set — review only what's implemented
- Do NOT add features, refactor, or "improve" code — report only
- Do NOT generate code fixes longer than 5 lines — keep suggestions concise
- Be specific: always cite file path and line number (or function name if line is ambiguous)
- Be honest: if the code is solid in an area, say so briefly and move on — don't invent issues
- Prioritize by impact: a crash bug in the store matters more than a missing comment
- Focus on what would break when v0.2 adds: integrations (async network calls), config system, sync engine, and subtask TUI rendering
