# Session 2 — Todoist Integration

> **Prerequisite**: Session 1 (config, OAuth infra, sync engine) must be complete.

<context>
- Project: tsk — terminal task manager
- Stack: TypeScript strict, Bun, @opentui/react
- Session 1 artifacts available:
  - `src/config/config.ts` — ConfigManager for ~/.tsk/config.json
  - `src/config/types.ts` — TodoistConfig interface (accessToken, refreshToken, projectFilter, projectId)
  - `src/integrations/types.ts` — SyncProvider interface, ExternalTask
  - `src/integrations/sync-engine.ts` — Bidirectional sync engine
  - `src/integrations/sync-state.ts` — SyncStateManager
  - `src/integrations/http.ts` — apiFetch with retry/timeout
  - `src/integrations/oauth-helpers.ts` — runOAuthFlow, token exchange
  - `src/cli/index.ts` — connect/disconnect/sync commands (provider dispatch ready)
- Task type has: externalId, externalSource ("todoist"), parentId, subtaskIds, notes[], tags[], priority, dueDate, project
</context>

<role>
You are a senior TypeScript developer integrating Todoist's REST API into a terminal task manager. You will research the API documentation, implement the provider, and wire it into the existing sync infrastructure.
</role>

<task>
Implement full Todoist integration: OAuth, bidirectional sync with subtask support, field mapping, and CLI commands.
</task>

<research_required>
Before writing ANY code, research the Todoist API by fetching these documentation pages:

1. **Todoist REST API v2 overview** — https://developer.todoist.com/rest/v2
   - Authentication method, base URL, response format
2. **OAuth flow** — https://developer.todoist.com/guides/#oauth
   - Authorize URL, token URL, required parameters, scopes
   - Does it support PKCE? Does it require client_secret?
3. **Tasks endpoints** — https://developer.todoist.com/rest/v2/#tasks
   - GET /tasks (list), POST /tasks (create), POST /tasks/{id} (update), DELETE /tasks/{id}
   - POST /tasks/{id}/close (complete), POST /tasks/{id}/reopen
   - Available fields: content, description, priority, due, project_id, labels, parent_id, order
4. **Subtask support** — How parent_id works for creating subtasks
5. **Projects endpoints** — https://developer.todoist.com/rest/v2/#projects
   - GET /projects (list all)
6. **Labels endpoints** — https://developer.todoist.com/rest/v2/#labels
   - GET /labels (list all) — these map to tsk tags
7. **Rate limits** — What are the limits? Headers to check?
8. **Completed tasks** — How to fetch completed/done tasks (may need Sync API)

Write your research findings as a comment block at the top of the provider file.
</research_required>

<requirements>

## 1. Provider: `src/integrations/todoist.ts`

Implement `SyncProvider` interface for Todoist.

### 1.1 Authentication

Two paths:
- **OAuth**: `tsk connect todoist` → runs OAuth flow with browser
  - Authorize URL: `https://todoist.com/oauth/authorize`
  - Token URL: `https://todoist.com/oauth/access_token`
  - Scopes: `data:read_write`
  - Todoist requires `client_secret` (no PKCE support) — use built-in placeholder or `--client-id`/`--client-secret` flags
  - State param for CSRF
- **Personal token**: `tsk connect todoist --token <api-token>`
  - User gets token from Todoist Settings → Integrations → Developer
  - Store directly in config, skip OAuth

After auth, test connection by calling `GET /rest/v2/projects` and printing user's project list.

### 1.2 Field Mapping

| tsk field | Todoist field | Mapping notes |
|-----------|---------------|---------------|
| title | content | Direct |
| description | description | Direct |
| status "done" | is_completed: true | Use close/reopen endpoints |
| status "todo" | is_completed: false | |
| priority "urgent" | priority: 4 | **INVERTED**: Todoist 4=urgent, 1=normal |
| priority "high" | priority: 3 | |
| priority "medium" | priority: 2 | |
| priority "low" | priority: 1 | |
| priority "none" | priority: 1 | |
| dueDate | due.date | YYYY-MM-DD, or due.string for natural language |
| project | project_id | Resolve by name ↔ ID using projects list |
| tags | labels | Array of label names in REST v2 |
| parentId | parent_id | Native subtask support! |
| order | order | Todoist also has an order field |

**Priority mapping** (critical — Todoist uses inverted numbering):
```typescript
const TSK_TO_TODOIST_PRIORITY: Record<TaskPriority, number> = {
  urgent: 4, high: 3, medium: 2, low: 1, none: 1,
};
const TODOIST_TO_TSK_PRIORITY: Record<number, TaskPriority> = {
  4: "urgent", 3: "high", 2: "medium", 1: "none",
};
```

### 1.3 Subtask Handling

Todoist natively supports subtasks via `parent_id` on tasks:
- When pulling: if a task has `parent_id`, resolve to local parentId via sync state ID map
- When pushing: if a local task has `parentId`, resolve to Todoist `parent_id` via sync state
- Pull parent first, then children (order matters for ID resolution)

### 1.4 Project Resolution

Before first sync, fetch all Todoist projects. If `projectFilter` is set in config:
- Find matching project by name
- Store resolved `projectId` in config
- Only sync tasks from that project
- When creating tasks remotely, set project_id

If no filter: sync all projects, map project names.

### 1.5 Completed Tasks

Research how to fetch completed tasks in Todoist:
- REST v2 may not include completed tasks in `GET /tasks`
- May need to use the Sync API's `completed/get_all` endpoint
- Or: track completions via the sync engine (local task marked done → call close endpoint)
- Document findings and chosen approach in comments

### 1.6 Rate Limits

- Document rate limits from API docs
- Use the `apiFetch` helper which already handles 429 with backoff
- If Todoist uses specific headers (X-RateLimit-Remaining, etc.), parse them

## 2. Wire into CLI

Update `src/cli/index.ts`:
- `tsk connect todoist` → run TodoistProvider OAuth flow or token flow
- `tsk connect todoist --token <token>` → store token, test connection, show projects
- `tsk disconnect todoist` → remove todoist config, clear sync state mappings
- `tsk sync todoist` → instantiate TodoistProvider + SyncEngine, run sync
- `tsk sync todoist --dry-run` → show what would change

## 3. Provider Registration

Create a provider registry so the sync commands can look up providers by name:

```typescript
// src/integrations/registry.ts
const providers: Record<string, () => Promise<SyncProvider>> = {
  todoist: () => import("./todoist.ts").then(m => m.createTodoistProvider()),
  // ... other providers added in later sessions
};

async function getProvider(name: ExternalSource): Promise<SyncProvider | null>;
async function getConnectedProviders(): Promise<SyncProvider[]>;
```

</requirements>

<implementation>

## Step 1: Research
1. Fetch Todoist REST API v2 docs — tasks, projects, labels, auth
2. Document findings at top of provider file
3. Note any gaps or limitations (completed tasks, sync tokens, etc.)

## Step 2: Provider implementation
4. Create `src/integrations/todoist.ts` implementing SyncProvider
5. Implement field mapping functions (mapToLocal, mapToExternal) with priority inversion
6. Implement fetchTasks — GET /rest/v2/tasks (with project filter if set)
7. Implement createTask — POST /rest/v2/tasks
8. Implement updateTask — POST /rest/v2/tasks/{id}
9. Implement completeTask — POST /rest/v2/tasks/{id}/close
10. Implement reopenTask — POST /rest/v2/tasks/{id}/reopen
11. Implement deleteTask — DELETE /rest/v2/tasks/{id}
12. Implement fetchSubtasks (if API supports filtering by parent_id, or filter client-side)
13. Implement fetchProjects — GET /rest/v2/projects
14. Implement fetchLabels — GET /rest/v2/labels

## Step 3: OAuth flow
15. Implement Todoist-specific OAuth (requires client_secret, no PKCE)
16. Add personal token fallback path
17. After auth: fetch projects, let user select if projectFilter not set

## Step 4: Provider registry
18. Create `src/integrations/registry.ts`
19. Register todoist provider

## Step 5: CLI wiring
20. Wire `tsk connect todoist` in cli/index.ts to todoist OAuth/token flow
21. Wire `tsk sync todoist` to SyncEngine + TodoistProvider
22. Wire `tsk disconnect todoist`

## Step 6: Test and verify
23. `tsk connect todoist --token <test-token>` → should show projects
24. `tsk sync todoist --dry-run` → should show task diff
25. `bun run tsc --noEmit` — zero errors

</implementation>

<constraints>
- Use native fetch() only — no todoist SDK or API wrapper libraries
- All HTTP through `apiFetch` helper from src/integrations/http.ts
- Store OAuth tokens in ~/.tsk/config.json via ConfigManager
- File permissions 0o600 on config.json
- Never display access tokens — mask in all output
- Handle Todoist's inverted priority numbering correctly
- Subtask parent_id resolution must handle ordering (parent synced before child)
- 10s timeout on all requests, 3 retries on 429/5xx
- OAuth client_id and client_secret: use TODO placeholder constants — real values will be registered later
- `--token` path must always work as fallback
- Run `bun run tsc --noEmit` after implementation
</constraints>
