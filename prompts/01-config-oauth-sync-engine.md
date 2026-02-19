# Session 1 — Config System + OAuth Infrastructure + Sync Engine

<context>
- Project: tsk — keyboard-driven terminal task manager (TUI + CLI)
- Stack: TypeScript strict, Bun ≥ 1.2.0, @opentui/react
- Persistence: ~/.tsk/tasks.json (atomic writes via tmp+rename, debounced 300ms)
- Store: src/store/task-store.ts — singleton, useSyncExternalStore, 50-level undo/redo
- Types: src/store/types.ts — Task already has externalId (string|null), externalSource (ExternalSource|null)
- ExternalSource type: "todoist" | "linear" | "asana" | "claude-code" | "codex" | "github-issues"
- CLI: src/cli/index.ts — 11 existing commands
- No external dependencies beyond @opentui/core and @opentui/react — use native fetch() for all HTTP
- Bun conventions: Bun.serve(), Bun.file(), Bun.write(), Bun.$`cmd`
</context>

<role>
You are a senior TypeScript engineer building the integration foundation for a terminal task manager. You have deep expertise in OAuth 2.0 (authorization code + PKCE, device flow), Bun runtime APIs, and building sync engines with conflict resolution.
</role>

<task>
Build three foundational layers that all provider integrations will use:
1. Configuration system for storing credentials and settings
2. OAuth authentication infrastructure (localhost callback server + helpers)
3. Generic bidirectional sync engine with conflict resolution
</task>

<requirements>

## 1. CONFIGURATION SYSTEM

### 1.1 Config interfaces: `src/config/types.ts`

```typescript
interface TskConfig {
  version: 1;
  theme: string;  // Default: "tokyo-night"

  integrations: {
    todoist?: TodoistConfig;
    linear?: LinearConfig;
    asana?: AsanaConfig;
    github?: GitHubConfig;
    agent?: AgentConfig;
  };

  sync: {
    autoSyncEnabled: boolean;          // Default: false
    autoSyncIntervalMinutes: number;   // Default: 5
    conflictStrategy: "remote-wins" | "local-wins" | "newest-wins";  // Default: "newest-wins"
    syncOnStartup: boolean;            // Default: false
  };

  display: {
    showSyncStatus: boolean;           // Default: true
    showClock: boolean;                // Default: true
    dateFormat: "relative" | "absolute" | "iso";  // Default: "relative"
  };
}

interface TodoistConfig {
  accessToken: string;
  refreshToken?: string;
  projectFilter?: string;       // Sync only this project (name)
  projectId?: string;           // Resolved Todoist project ID
}

interface LinearConfig {
  accessToken: string;
  teamId?: string;
  teamName?: string;
  projectId?: string;
  stateMapping?: Record<string, string>;  // Linear workflow state → tsk status
}

interface AsanaConfig {
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: string;      // ISO timestamp for refresh
  workspaceId?: string;
  workspaceName?: string;
  projectId?: string;
  projectName?: string;
}

interface GitHubConfig {
  accessToken?: string;
  repo: string;                 // "owner/repo"
  useGhCli?: boolean;           // true = use `gh auth token`
  labelFilter?: string[];       // Only sync issues with these labels
}

interface AgentConfig {
  enabled: boolean;
  pollIntervalMs: number;       // Default: 2000
}
```

### 1.2 Config manager: `src/config/config.ts`

```typescript
class ConfigManager {
  private static _configPath = join(homedir(), ".tsk", "config.json");

  static async load(): Promise<TskConfig>;           // Load from disk, fill defaults
  static async save(config: TskConfig): Promise<void>; // Atomic write, chmod 0o600
  static async get<K extends keyof TskConfig>(key: K): Promise<TskConfig[K]>;
  static async set<K extends keyof TskConfig>(key: K, value: TskConfig[K]): Promise<void>;
  static async getIntegration<K extends keyof TskConfig["integrations"]>(name: K): Promise<TskConfig["integrations"][K]>;
  static async setIntegration<K extends keyof TskConfig["integrations"]>(name: K, value: NonNullable<TskConfig["integrations"][K]>): Promise<void>;
  static async removeIntegration(name: keyof TskConfig["integrations"]): Promise<void>;
  static defaults(): TskConfig;
}
```

Implementation details:
- File: `~/.tsk/config.json`
- File permissions: `0o600` (owner read/write only — contains tokens!)
- Atomic writes: write to `.tmp` file, then rename (same pattern as task-store)
- On load: deep-merge with defaults so missing keys get filled
- On save: validate required fields, strip undefined values
- NEVER log or display access tokens in output

### 1.3 Config CLI commands

Add to `src/cli/index.ts`:

```bash
tsk config list                          # Show all config (mask tokens as "****")
tsk config get <key>                     # Get specific key (e.g., "sync.conflictStrategy")
tsk config set <key> <value>             # Set specific key
tsk config reset                         # Reset to defaults (asks confirmation)
tsk config edit                          # Open in $EDITOR
tsk config path                          # Print config file path
```

Support dot-notation keys: `tsk config set sync.autoSyncEnabled true`, `tsk config set integrations.todoist.projectFilter "Work"`.

---

## 2. OAUTH INFRASTRUCTURE

### 2.1 Localhost callback server: `src/integrations/oauth-server.ts`

```typescript
interface OAuthCallbackResult {
  code: string;
  state: string;
}

interface OAuthServerOptions {
  expectedState: string;
  timeoutMs?: number;            // Default: 120000 (2 minutes)
  successHtml?: string;          // Shown in browser after success
  errorHtml?: string;            // Shown in browser on error
}

interface OAuthServer {
  port: number;                  // Assigned port
  url: string;                   // http://localhost:{port}/callback
  result: Promise<OAuthCallbackResult>;
  shutdown: () => void;
}

async function startOAuthCallback(options: OAuthServerOptions): Promise<OAuthServer>;
```

Implementation:
- Use `Bun.serve()` on port 0 (OS assigns available port)
- Handle `GET /callback?code=...&state=...`
- Validate `state` matches `expectedState` (CSRF protection)
- Return success HTML page: "Authentication successful! You can close this tab."
- On error/mismatch: return error HTML page
- Auto-shutdown after receiving valid callback OR on timeout
- The `result` promise rejects on timeout or state mismatch

### 2.2 OAuth helpers: `src/integrations/oauth-helpers.ts`

```typescript
// PKCE (Proof Key for Code Exchange)
function generateCodeVerifier(): string;     // 43-128 char random string
function generateCodeChallenge(verifier: string): Promise<string>;  // SHA-256 + base64url

// State token
function generateState(): string;            // Random 32-byte hex

// Browser opening (cross-platform)
async function openBrowser(url: string): Promise<boolean>;
// macOS: Bun.$`open ${url}`
// Linux: Bun.$`xdg-open ${url}`
// Fallback: print URL and ask user to open manually

// Token exchange helper
async function exchangeCodeForToken(options: {
  tokenUrl: string;
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret?: string;
  codeVerifier?: string;        // For PKCE
  extraParams?: Record<string, string>;
}): Promise<{ access_token: string; refresh_token?: string; expires_in?: number; [key: string]: unknown }>;

// Token refresh helper
async function refreshAccessToken(options: {
  tokenUrl: string;
  refreshToken: string;
  clientId: string;
  clientSecret?: string;
}): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }>;

// Generic OAuth flow orchestrator
async function runOAuthFlow(options: {
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  scopes: string[];
  usePkce?: boolean;
  extraAuthorizeParams?: Record<string, string>;
}): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number; raw: Record<string, unknown> }>;
```

The `runOAuthFlow` orchestrator should:
1. Generate state + PKCE (if usePkce)
2. Start localhost callback server
3. Build authorize URL with all params
4. Open browser
5. Wait for callback (with timeout)
6. Exchange code for token
7. Shut down server
8. Return tokens

### 2.3 GitHub Device Flow: `src/integrations/oauth-device-flow.ts`

For GitHub (which doesn't support localhost redirect well for CLI apps):

```typescript
async function runDeviceFlow(options: {
  deviceCodeUrl: string;      // https://github.com/login/device/code
  tokenUrl: string;           // https://github.com/login/oauth/access_token
  clientId: string;
  scopes: string[];
}): Promise<{ accessToken: string }>;
```

Flow:
1. POST to deviceCodeUrl → get device_code, user_code, verification_uri, interval
2. Print to terminal: "Enter code **XXXX-XXXX** at https://github.com/login/device"
3. Open browser to verification_uri
4. Poll tokenUrl every `interval` seconds with device_code
5. Handle responses: "authorization_pending" → keep polling, "slow_down" → increase interval, "expired_token" → error, "access_denied" → error
6. On success: return access token

### 2.4 `tsk connect` and `tsk disconnect` CLI commands

```bash
# OAuth flow (starts browser)
tsk connect todoist
tsk connect linear
tsk connect asana
tsk connect github --repo owner/repo

# Personal token (bypasses OAuth — always works as fallback)
tsk connect todoist --token <api-token>
tsk connect linear --api-key <api-key>
tsk connect asana --token <pat>
tsk connect github --token <pat> --repo owner/repo

# Bring your own OAuth app credentials
tsk connect todoist --client-id <id> --client-secret <secret>

# GitHub auto-detect gh CLI
tsk connect github --repo owner/repo    # auto-detects gh CLI token if available

# Disconnect
tsk disconnect todoist
tsk disconnect linear
tsk disconnect asana
tsk disconnect github

# Status
tsk sync --status                        # Show all connection statuses
```

When `tsk connect <provider>` is run:
1. Check if already connected → prompt "Already connected to X. Reconnect? [y/N]"
2. If `--token` / `--api-key` provided → store directly in config, test with a ping request
3. Else → run OAuth flow → store token in config
4. After storing token → test connection (fetch user info or project list)
5. Print "✓ Connected to <Provider>" or "✗ Failed: <error>"
6. For providers with projects/teams (Linear, Asana) → prompt user to select one if not specified

---

## 3. SYNC ENGINE

### 3.1 Sync interfaces: `src/integrations/types.ts`

```typescript
interface ExternalTask {
  externalId: string;
  title: string;
  description?: string;
  status: "open" | "closed";
  priority?: number;                    // Provider-normalized 0-4 (0=none, 4=urgent)
  project?: string;
  labels?: string[];
  dueDate?: string;                    // YYYY-MM-DD
  parentExternalId?: string | null;
  subtaskExternalIds?: string[];
  updatedAt: string;                   // ISO timestamp
  completedAt?: string | null;
  url?: string;                        // Link to external UI
}

interface SyncProvider {
  readonly name: ExternalSource;

  // Connection
  isConnected(): Promise<boolean>;
  testConnection(): Promise<{ ok: boolean; user?: string; error?: string }>;

  // CRUD — all must handle errors gracefully (return null/empty on failure, never throw unhandled)
  fetchTasks(options?: { updatedSince?: string }): Promise<ExternalTask[]>;
  createTask(task: ExternalTask): Promise<ExternalTask | null>;
  updateTask(externalId: string, updates: Partial<ExternalTask>): Promise<ExternalTask | null>;
  completeTask(externalId: string): Promise<boolean>;
  reopenTask(externalId: string): Promise<boolean>;
  deleteTask(externalId: string): Promise<boolean>;

  // Subtasks (optional — not all providers support them)
  supportsSubtasks: boolean;
  fetchSubtasks?(parentExternalId: string): Promise<ExternalTask[]>;
  createSubtask?(parentExternalId: string, task: ExternalTask): Promise<ExternalTask | null>;

  // Field mapping
  mapToLocal(external: ExternalTask): Partial<Task>;
  mapToExternal(task: Task): Partial<ExternalTask>;

  // Metadata
  fetchProjects?(): Promise<Array<{ id: string; name: string }>>;
  fetchLabels?(): Promise<Array<{ id: string; name: string }>>;
}

interface SyncResult {
  provider: ExternalSource;
  pulled: number;
  pushed: number;
  deleted: number;
  conflicts: number;
  errors: SyncError[];
  timestamp: string;
  durationMs: number;
}

interface SyncError {
  taskId?: string;
  externalId?: string;
  operation: "pull" | "push" | "delete" | "map";
  message: string;
}
```

### 3.2 Sync state: `src/integrations/sync-state.ts`

Persisted in `~/.tsk/sync-state.json`:

```typescript
interface SyncState {
  lastSyncAt: Partial<Record<ExternalSource, string>>;  // ISO timestamp per provider
  idMap: Record<string, string>;          // localId → externalId
  reverseIdMap: Record<string, string>;   // externalId → localId
  deletedLocally: string[];               // localIds deleted since last sync
  deletedRemotely: string[];              // externalIds deleted since last sync
  lastPullHashes: Record<string, string>; // externalId → hash(task) for change detection
}

class SyncStateManager {
  static async load(): Promise<SyncState>;
  static async save(state: SyncState): Promise<void>;
  static defaults(): SyncState;

  static addMapping(state: SyncState, localId: string, externalId: string): void;
  static removeMapping(state: SyncState, localId: string): void;
  static getLocalId(state: SyncState, externalId: string): string | undefined;
  static getExternalId(state: SyncState, localId: string): string | undefined;
}
```

### 3.3 Sync engine: `src/integrations/sync-engine.ts`

```typescript
class SyncEngine {
  constructor(
    private store: TaskStore,
    private provider: SyncProvider,
    private syncState: SyncState,
    private config: TskConfig["sync"],
  ) {}

  async sync(options?: { pullOnly?: boolean; pushOnly?: boolean; dryRun?: boolean }): Promise<SyncResult>;
  async pullOnly(): Promise<SyncResult>;
  async pushOnly(): Promise<SyncResult>;
}
```

Sync algorithm:

```
SYNC(provider, store, syncState, config):

  errors = []
  pulled = pushed = deleted = conflicts = 0

  // ── PULL PHASE ──
  1. remoteTasks = provider.fetchTasks({ updatedSince: syncState.lastSyncAt[provider.name] })
  2. For each remoteTask:
     a. localId = syncState.reverseIdMap[remoteTask.externalId]

     b. IF localId exists (known task):
        - localTask = store.tasks.find(id === localId)
        - IF localTask was deleted locally since last sync:
          → provider.deleteTask(remoteTask.externalId)  // push local delete
          → deleted++
        - ELSE:
          - Compare updatedAt timestamps using config.conflictStrategy:
            "newest-wins": if remote.updatedAt > local.updatedAt → update local
            "remote-wins": always update local
            "local-wins": skip (will push in push phase)
          - If updating local: store.updateTask(localId, provider.mapToLocal(remoteTask))
          - pulled++ (if changed)

     c. IF localId NOT exists (new remote task):
        - Create local task: store.addTask(provider.mapToLocal(remoteTask))
        - Set externalId and externalSource on the new task
        - syncState.addMapping(newTask.id, remoteTask.externalId)
        - If remoteTask.parentExternalId → resolve to local parentId via syncState.reverseIdMap
        - pulled++

  // ── PUSH PHASE ──
  3. Find local tasks to push:
     a. Tasks where externalSource === provider.name AND updatedAt > lastSyncAt (modified locally)
     b. Tasks where externalSource is null AND no externalId (new tasks to push)
        → Only push if user opted in (don't auto-push all local tasks to remote)

  4. For each task to push:
     a. IF has externalId:
        - externalTask = provider.mapToExternal(localTask)
        - provider.updateTask(externalId, externalTask)
        - pushed++
     b. IF no externalId (new):
        - externalTask = provider.mapToExternal(localTask)
        - result = provider.createTask(externalTask)
        - Store externalId and externalSource on local task
        - syncState.addMapping(localTask.id, result.externalId)
        - Handle subtasks: if local has parentId, resolve to parentExternalId
        - pushed++

  // ── DELETE RECONCILIATION ──
  5. For externalIds in previous pull that are missing from current pull:
     → Task was deleted remotely
     → Delete locally (or archive): store.deleteTask(localId)
     → Clean up syncState mappings

  // ── FINALIZE ──
  6. syncState.lastSyncAt[provider.name] = new Date().toISOString()
  7. SyncStateManager.save(syncState)
  8. Return SyncResult { pulled, pushed, deleted, conflicts, errors, timestamp, durationMs }
```

### 3.4 HTTP helpers: `src/integrations/http.ts`

```typescript
// Wrapper around fetch() with timeout, retry, and error handling
async function apiFetch<T>(url: string, options?: {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;          // Default: 10000
  maxRetries?: number;         // Default: 3
  retryOnStatus?: number[];    // Default: [429, 500, 502, 503]
}): Promise<{ data: T; status: number } | { error: string; status: number }>;

// GraphQL helper (for Linear)
async function graphqlFetch<T>(url: string, options: {
  query: string;
  variables?: Record<string, unknown>;
  token: string;
  timeoutMs?: number;
}): Promise<{ data: T } | { error: string }>;
```

- All requests timeout after 10s
- Rate limit (429): exponential backoff — 1s, 2s, 4s, max 3 retries
- Server errors (500/502/503): retry up to 3 times
- 401: Do NOT retry — mark integration as disconnected
- NEVER throw unhandled — always return error objects

### 3.5 `tsk sync` CLI commands

```bash
tsk sync                           # Sync all connected providers
tsk sync todoist                   # Sync specific provider
tsk sync --pull-only               # Only pull from remote
tsk sync --push-only               # Only push to remote
tsk sync --dry-run                 # Show what would change without executing
tsk sync --status                  # Show connection status + last sync times
tsk sync --reset                   # Reset sync state (clear ID mappings, re-sync from scratch)
```

`tsk sync --status` output example:
```
Integration Status:
  Todoist    ✓ Connected    Last sync: 5m ago    Tasks: 23 synced
  Linear     ✓ Connected    Last sync: 12m ago   Tasks: 8 synced
  Asana      ✗ Not connected
  GitHub     ✗ Not connected
  Agent      ○ Disabled
```

`tsk sync --dry-run` output:
```
Dry run — Todoist:
  PULL: 3 tasks to create, 2 to update, 0 to delete
  PUSH: 1 task to create, 0 to update, 0 to delete
  Conflicts: 1 (would resolve with "newest-wins")
No changes applied.
```

</requirements>

<implementation>

## Step 1: Config types and manager
1. Create `src/config/types.ts` with all config interfaces
2. Create `src/config/config.ts` with ConfigManager class
3. Implement: load (with defaults merge), save (atomic write + chmod 0o600), get/set with dot-notation
4. Test: create config, read it back, verify file permissions

## Step 2: Config CLI
5. Add `config` command to `src/cli/index.ts` with subcommands: list, get, set, reset, edit, path
6. Mask tokens in `config list` output (show "****" for any field named token/accessToken/refreshToken/apiKey)
7. Test: `tsk config list`, `tsk config set sync.autoSyncEnabled true`

## Step 3: OAuth infrastructure
8. Create `src/integrations/oauth-server.ts` — Bun.serve() localhost callback
9. Create `src/integrations/oauth-helpers.ts` — PKCE, state, browser open, token exchange, refresh, orchestrator
10. Create `src/integrations/oauth-device-flow.ts` — GitHub device flow
11. Test: start callback server, verify it receives code param, shuts down

## Step 4: HTTP helpers
12. Create `src/integrations/http.ts` — apiFetch with timeout/retry/backoff, graphqlFetch
13. Test: mock a 429 response, verify retry with backoff

## Step 5: Sync interfaces and state
14. Create `src/integrations/types.ts` with ExternalTask, SyncProvider, SyncResult, SyncError
15. Create `src/integrations/sync-state.ts` with SyncStateManager (load/save/mapping ops)
16. Test: create sync state, add mappings, persist, reload

## Step 6: Sync engine
17. Create `src/integrations/sync-engine.ts` with full bidirectional sync algorithm
18. Implement pull phase, push phase, delete reconciliation
19. Implement conflict resolution (newest-wins, remote-wins, local-wins)
20. Implement dry-run mode (log changes without executing)

## Step 7: Connect/Disconnect/Sync CLI
21. Add `connect` command — dispatch to provider-specific OAuth or token flow
22. Add `disconnect` command — remove credentials from config, clear sync state for provider
23. Add `sync` command — instantiate engine + run sync
24. For `connect`: implement placeholder flows that store tokens but don't call real APIs yet (providers come in sessions 2-5)

## Step 8: Verify
25. Run `bun run tsc --noEmit` — fix all type errors
26. Test full flow: `tsk config list` → `tsk connect todoist --token fake-token` → `tsk sync --status` → `tsk disconnect todoist`

</implementation>

<output>
New files:
- src/config/types.ts
- src/config/config.ts
- src/integrations/types.ts
- src/integrations/sync-engine.ts
- src/integrations/sync-state.ts
- src/integrations/http.ts
- src/integrations/oauth-server.ts
- src/integrations/oauth-helpers.ts
- src/integrations/oauth-device-flow.ts

Modified files:
- src/cli/index.ts (new commands: config, connect, disconnect, sync)

Created on disk:
- ~/.tsk/config.json (on first `tsk config` run)
- ~/.tsk/sync-state.json (on first sync)
</output>

<constraints>
- ONLY use Bun APIs — no npm packages for HTTP or OAuth
- Use native fetch() — no axios, got, or node-fetch
- No OAuth libraries — implement flows manually with fetch()
- File permissions 0o600 on config.json and sync-state.json
- NEVER log or display access tokens — mask as "****" in all output
- All network requests must have 10s timeout
- All async operations wrapped in try/catch — return error objects, never throw unhandled
- Rate limit: exponential backoff (1s, 2s, 4s) with max 3 retries
- Config is backward compatible — missing keys get defaults
- Do NOT modify src/store/types.ts or src/store/task-store.ts — they're already complete
- Provider-specific implementations go in sessions 2-5 — this session builds the FRAMEWORK only
- Run `bun run tsc --noEmit` after each step
</constraints>
