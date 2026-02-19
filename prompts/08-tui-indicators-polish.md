# Session 8 — TUI Indicators, Sync Integration & Final Polish

> **Prerequisite**: Sessions 1-7 should be complete (at minimum: session 1 + session 7).

<context>
- Project: tsk — terminal task manager
- Stack: TypeScript strict, Bun, @opentui/react
- All previous sessions delivered:
  - Session 1: src/config/ (ConfigManager), src/integrations/ (sync engine, OAuth, http helpers)
  - Sessions 2-5: Provider implementations (todoist.ts, linear.ts, asana.ts, github-issues.ts)
  - Session 6: src/integrations/agent-bridge.ts (file-based IPC)
  - Session 7: Subtask tree rendering in task-list, task-row, task-detail, project-view
- Views: src/views/ (task-list, project-view, calendar-view, help-view)
- Components: src/components/ (header, status-bar, task-row, task-detail, modals)
- App root: src/app.tsx (view router, modal stack, global keyboard)
- CLI: src/cli/index.ts
</context>

<role>
You are a senior React/terminal UI developer doing the final integration pass — wiring sync indicators into the TUI, adding background auto-sync, showing connection status, updating the help view with ALL new keybindings, and polishing the overall experience.
</role>

<task>
Wire all integration features into the TUI: sync status indicators, auto-sync background loop, agent bridge auto-start, toast notifications, updated help view, and final polish.
</task>

<requirements>

## 1. Header Sync Indicators (`src/components/header.tsx`)

### 1.1 Updated header layout

```
  tsk    [1] List  [2] Board  [3] Cal    ════    ✓ Todoist  🔄 Linear  ⚡ Agent    [?] Help
```

**New props:**
```typescript
interface HeaderProps {
  activeView: string;
  // NEW
  syncStatus?: SyncStatusMap;
  agentBridgeActive?: boolean;
}

type SyncStatusMap = Partial<Record<ExternalSource, {
  status: "idle" | "syncing" | "success" | "error";
  lastSync?: string;         // ISO timestamp
  error?: string;
}>>;
```

**Status icons:**
| Status | Icon | Color |
|--------|------|-------|
| idle (connected but not syncing) | Provider name only | dim |
| syncing | `🔄` or `⟳` | yellow |
| success (last sync OK) | `✓` | green |
| error (last sync failed) | `✗` | red |
| agent bridge active | `⚡` | cyan |

Only show indicators for providers that are connected (have config).

### 1.2 Implementation

```typescript
// Inside header render:
const indicators = [];

for (const [provider, status] of Object.entries(syncStatus ?? {})) {
  const icon = status.status === "syncing" ? "⟳"
    : status.status === "success" ? "✓"
    : status.status === "error" ? "✗"
    : "○";
  const color = status.status === "syncing" ? colors.yellow
    : status.status === "success" ? colors.green
    : status.status === "error" ? colors.red
    : colors.fgDim;
  indicators.push({ text: `${icon} ${capitalize(provider)}`, color });
}

if (agentBridgeActive) {
  indicators.push({ text: "⚡ Agent", color: colors.cyan });
}
```

## 2. Status Bar Enhancements (`src/components/status-bar.tsx`)

### 2.1 Updated layout

```
  NORMAL │ 15/23 tasks │ Filter: all │ Sort: priority ↓ │ ⏱ 00:12:30 │ Synced: 2m ago
```

**New props:**
```typescript
interface StatusBarProps {
  // ... existing props ...
  // NEW
  lastSyncTime?: string;          // ISO timestamp of last successful sync
  timerDisplay?: string;          // "00:12:30" or null
  timerTaskTitle?: string;        // "Fix auth" (truncated)
  syncError?: string;             // Error message to show (red)
  undoCount?: number;             // Show "Undo(3)" if > 0
  persistenceError?: string;      // From store.persistenceError
}
```

**New sections (right side):**
- Timer: `⏱ 00:12:30 — Fix auth` (if timer running, green text)
- Undo: `Undo(3)` (if undoCount > 0, dim text)
- Sync: `Synced: 2m ago` (relative time, green) or `Sync error` (red)
- Persistence: `⚠ Save failed` (red, if persistenceError)

### 2.2 Timer display

If `store.activeTimerTaskId` is set:
```typescript
// Update every second
const [timerDisplay, setTimerDisplay] = useState("");
useEffect(() => {
  if (!store.activeTimerTaskId || !store.activeTimerStart) return;
  const interval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - store.activeTimerStart!) / 1000);
    const h = String(Math.floor(elapsed / 3600)).padStart(2, "0");
    const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, "0");
    const s = String(elapsed % 60).padStart(2, "0");
    setTimerDisplay(`${h}:${m}:${s}`);
  }, 1000);
  return () => clearInterval(interval);
}, [store.activeTimerTaskId, store.activeTimerStart]);
```

## 3. Auto-Sync Background Loop (`src/app.tsx`)

### 3.1 Sync manager state

Add to App component:

```typescript
const [syncStatus, setSyncStatus] = useState<SyncStatusMap>({});
const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);

// Background sync
useEffect(() => {
  const config = await ConfigManager.load();
  if (!config.sync.autoSyncEnabled) return;

  const interval = setInterval(async () => {
    await runAllSyncs();
  }, config.sync.autoSyncIntervalMinutes * 60 * 1000);

  // Sync on startup if configured
  if (config.sync.syncOnStartup) {
    void runAllSyncs();
  }

  return () => clearInterval(interval);
}, []);
```

### 3.2 Sync execution

```typescript
async function runAllSyncs() {
  const config = await ConfigManager.load();
  const providers = await getConnectedProviders(); // from registry

  for (const provider of providers) {
    setSyncStatus(prev => ({ ...prev, [provider.name]: { status: "syncing" } }));

    try {
      const syncState = await SyncStateManager.load();
      const engine = new SyncEngine(store, provider, syncState, config.sync);
      const result = await engine.sync();

      setSyncStatus(prev => ({
        ...prev,
        [provider.name]: {
          status: result.errors.length > 0 ? "error" : "success",
          lastSync: result.timestamp,
          error: result.errors[0]?.message,
        },
      }));
      setLastSyncTime(result.timestamp);

      // Show toast
      if (result.pulled > 0 || result.pushed > 0) {
        showToast(`${capitalize(provider.name)}: ${result.pulled} pulled, ${result.pushed} pushed`, "info");
      }
    } catch (e) {
      setSyncStatus(prev => ({
        ...prev,
        [provider.name]: { status: "error", error: e instanceof Error ? e.message : "Sync failed" },
      }));
    }
  }
}
```

### 3.3 Manual sync keybinding

`Ctrl+S` currently forces a save. Extend it:
- Save to disk (existing)
- If any providers connected: trigger sync for all
- Show toast: "Saving & syncing..."

## 4. Agent Bridge Auto-Start (`src/app.tsx`)

```typescript
const [agentBridgeActive, setAgentBridgeActive] = useState(false);
const agentBridgeRef = useRef<AgentBridge | null>(null);

useEffect(() => {
  const config = await ConfigManager.load();
  if (!config.integrations.agent?.enabled) return;

  const bridge = new AgentBridge(store, config.integrations.agent);
  bridge.start();
  agentBridgeRef.current = bridge;
  setAgentBridgeActive(true);

  return () => {
    bridge.stop();
    setAgentBridgeActive(false);
  };
}, []);
```

## 5. Toast Notification System

### 5.1 Toast component: `src/components/toast.tsx`

```typescript
interface Toast {
  id: string;
  message: string;
  type: "success" | "error" | "warning" | "info";
  createdAt: number;
}

interface ToastContainerProps {
  toasts: Toast[];
}
```

Render toasts as stacked lines at the bottom of the screen (above status bar):

```
  ✓ Synced with Todoist: 3 pulled, 1 pushed         [auto-dismiss: 3s]
  ⚡ Agent: created "Fix login bug"                   [auto-dismiss: 3s]
```

- Max 3 visible toasts
- Auto-dismiss after 3 seconds
- Color by type: success=green, error=red, warning=yellow, info=cyan
- Stack newest at bottom

### 5.2 Toast state in app.tsx

```typescript
const [toasts, setToasts] = useState<Toast[]>([]);

function showToast(message: string, type: Toast["type"] = "info") {
  const toast: Toast = { id: crypto.randomUUID(), message, type, createdAt: Date.now() };
  setToasts(prev => [...prev.slice(-2), toast]); // Keep last 3
  setTimeout(() => {
    setToasts(prev => prev.filter(t => t.id !== toast.id));
  }, 3000);
}
```

Pass `showToast` down to views for action feedback:
- "Task added" (success)
- "Task deleted" (success)
- "3 tasks marked done" (success)
- "Synced: 3 pulled, 1 pushed" (info)
- "Sync failed: 401 Unauthorized" (error)
- "Agent: created 'Fix bug'" (info)

## 6. Help View Update (`src/views/help-view.tsx`)

Add ALL new keybindings. Full updated sections:

```
  NAVIGATION                    ACTIONS
  j/↓    Move down              a     Add task (sibling)
  k/↑    Move up                A     Add subtask
  g      Go to top              e     Edit task
  G      Go to bottom           d     Mark done/undone
  J      Page down (10)         x     Delete task
  K      Page up (10)           /     Search
  Enter  Open / Select          !     Set priority
  Esc    Back / Close           p     Set project
  Tab    Switch panel           t     Add/remove tag
                                D     Set due date
  VIEWS                         s     Cycle sort
  1      Task List              f     Cycle filter
  2      Project Board          u     Undo
  3      Calendar               Ctrl+R  Redo
  ?      This help              T     Set time estimate
                                Shift+T  Start/stop timer
  SUBTASKS                      n     View notes
  A          Add subtask        N     Add note
  Shift+→    Indent
  Shift+←    Promote            SYNC & AGENT
  Enter/→    Expand/collapse    Ctrl+S  Save & sync
  ←          Jump to parent

  BOARD VIEW                    GENERAL
  h/l    Switch column          q      Quit
  H/L    Move task ←/→          Ctrl+C Quit

  CALENDAR
  h/j/k/l  Navigate days
  H/L      Prev/next month
  t        Jump to today
```

## 7. Final CLI Integration Summary

Ensure all new commands are registered and working:

```bash
# Config
tsk config list | get | set | reset | edit | path

# Connect / Disconnect
tsk connect <provider> [--token|--api-key] [--repo] [--client-id] [--client-secret]
tsk disconnect <provider>

# Sync
tsk sync [provider] [--pull-only] [--push-only] [--dry-run] [--status] [--reset]

# Agent
tsk agent start | stop | status | send | outbox | clear | snippet

# Subtask CLI (already in store, wire to CLI if not done)
tsk add "title" --parent <id>
tsk subtasks <id>
tsk indent <id> --under <parent-id>
tsk promote <id>
```

## 8. Final Verification Checklist

- [ ] `bun run tsc --noEmit` — zero TypeScript errors
- [ ] `tsk` launches TUI without errors
- [ ] Header shows sync indicators for connected providers
- [ ] Status bar shows sync time, timer, undo count
- [ ] Auto-sync runs in background at configured interval
- [ ] `Ctrl+S` triggers save + sync
- [ ] Agent bridge auto-starts when enabled in config
- [ ] Toasts appear for actions (add, delete, sync, agent commands)
- [ ] Help view shows ALL keybindings (subtasks, sync, timer, notes)
- [ ] Subtask tree renders with proper box-drawing characters
- [ ] Collapse/expand works on parent tasks
- [ ] Indent/promote keybindings work
- [ ] Kanban shows top-level only with progress counts
- [ ] `tsk config list` masks tokens
- [ ] `tsk sync --status` shows all connection statuses
- [ ] `tsk agent snippet` prints CLAUDE.md integration text

</requirements>

<implementation>

## Step 1: Toast component
1. Create `src/components/toast.tsx` with Toast interface and container
2. Add toast state and showToast function to app.tsx

## Step 2: Header indicators
3. Read `src/components/header.tsx`
4. Add syncStatus and agentBridgeActive props
5. Render provider status icons (⟳/✓/✗) with colors
6. Render ⚡ Agent indicator

## Step 3: Status bar enhancements
7. Read `src/components/status-bar.tsx`
8. Add lastSyncTime, timerDisplay, undoCount, syncError, persistenceError props
9. Render timer section (with 1s update interval)
10. Render sync time, undo count, error indicators

## Step 4: Auto-sync loop
11. In app.tsx: add sync state (syncStatus map, lastSyncTime)
12. Implement runAllSyncs function
13. Add useEffect for background sync interval
14. Add sync-on-startup logic
15. Wire Ctrl+S to save + sync

## Step 5: Agent bridge auto-start
16. In app.tsx: add useEffect to start/stop agent bridge based on config
17. Pass agentBridgeActive to header

## Step 6: Wire everything to App
18. Pass syncStatus to Header
19. Pass lastSyncTime, timer, undo to StatusBar
20. Pass showToast to views for action feedback
21. Add toast feedback to existing actions (add, delete, done, etc.)

## Step 7: Help view
22. Update help-view.tsx with ALL new keybinding sections

## Step 8: CLI verification
23. Verify all new CLI commands are registered: config, connect, disconnect, sync, agent, subtask ops
24. Add any missing commands

## Step 9: Final check
25. Run `bun run tsc --noEmit` — fix all errors
26. Walk through the verification checklist above
27. Test TUI launch and basic workflow

</implementation>

<constraints>
- Do NOT modify the store, types, or integration files — only modify TUI components and app.tsx
- All sync operations must be async and non-blocking — never freeze the TUI
- Sync errors shown via toast/status bar — NEVER crash or show raw stack traces
- Toast auto-dismiss after 3s, max 3 visible
- Timer updates every 1s via setInterval (clean up on unmount!)
- Token masking: NEVER display raw tokens in any TUI element
- Help view must be comprehensive — include EVERY keybinding from all sessions
- Background sync interval comes from config (default 5 min) — don't hardcode
- Agent bridge lifecycle tied to TUI lifecycle (start on mount, stop on unmount)
- Run `bun run tsc --noEmit` as final verification
</constraints>
