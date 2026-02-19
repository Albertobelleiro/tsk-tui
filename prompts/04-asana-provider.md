# Session 4 — Asana Integration

> **Prerequisite**: Session 1 (config, OAuth infra, sync engine) must be complete.

<context>
- Project: tsk — terminal task manager
- Stack: TypeScript strict, Bun, @opentui/react
- Session 1 artifacts available:
  - `src/config/config.ts` — ConfigManager for ~/.tsk/config.json
  - `src/config/types.ts` — AsanaConfig interface (accessToken, refreshToken, tokenExpiresAt, workspaceId, workspaceName, projectId, projectName)
  - `src/integrations/types.ts` — SyncProvider interface, ExternalTask
  - `src/integrations/sync-engine.ts` — Bidirectional sync engine
  - `src/integrations/sync-state.ts` — SyncStateManager
  - `src/integrations/http.ts` — apiFetch with retry/timeout
  - `src/integrations/oauth-helpers.ts` — runOAuthFlow, refreshAccessToken
  - `src/integrations/registry.ts` — Provider registry
  - `src/cli/index.ts` — connect/disconnect/sync commands ready
- Task type has: externalId, externalSource ("asana"), parentId, subtaskIds, notes[], tags[], priority, dueDate, project
</context>

<role>
You are a senior TypeScript developer integrating Asana's REST API into a terminal task manager. You will research the API, implement the provider with native subtask support, handle OAuth with token refresh, and map Asana's data model to tsk's.
</role>

<task>
Implement full Asana integration: OAuth with refresh tokens, bidirectional sync with NATIVE subtask support, field mapping, and CLI commands.
</task>

<research_required>
Before writing ANY code, research the Asana API by fetching these documentation pages:

1. **Asana REST API overview** — https://developers.asana.com/docs/overview
   - Base URL, auth headers, response format, pagination
2. **OAuth flow** — https://developers.asana.com/docs/oauth
   - Authorize URL, token URL, scopes, refresh token rotation
   - Token expiry and refresh mechanism
3. **Tasks** — https://developers.asana.com/docs/tasks
   - GET /tasks (list in project), POST /tasks (create), PUT /tasks/{gid} (update)
   - Complete/uncomplete endpoints
   - Available fields: name, notes, completed, due_on, assignee, tags, parent, etc.
   - `opt_fields` parameter (CRITICAL for performance — only request needed fields)
4. **Subtasks** — https://developers.asana.com/docs/get-subtasks-from-a-task
   - GET /tasks/{task_gid}/subtasks
   - POST /tasks/{parent_gid}/subtasks (create subtask)
   - Asana has EXCELLENT native subtask support — this is a key differentiator
5. **Projects** — https://developers.asana.com/docs/projects
   - GET /projects (in workspace)
6. **Tags** — https://developers.asana.com/docs/tags
   - GET /tags, POST /tasks/{gid}/addTag, POST /tasks/{gid}/removeTag
7. **Workspaces** — https://developers.asana.com/docs/workspaces
   - GET /workspaces (for setup)
8. **Custom fields** — Does Asana have a priority custom field? How to handle priority?
9. **Pagination** — https://developers.asana.com/docs/pagination
   - Offset-based pagination, `limit` and `offset` params
10. **Rate limits** — https://developers.asana.com/docs/rate-limits
    - Per-minute limits, retry-after headers

Write your research findings as a comment block at the top of the provider file.
</research_required>

<requirements>

## 1. Provider: `src/integrations/asana.ts`

Implement `SyncProvider` interface for Asana.

### 1.1 Authentication

Two paths:
- **OAuth**: `tsk connect asana`
  - Authorize URL: `https://app.asana.com/-/oauth_authorize`
  - Token URL: `https://app.asana.com/-/oauth_token`
  - Scopes: `default` (full access)
  - Returns: access_token + refresh_token + expires_in
  - **CRITICAL**: Implement token refresh — Asana tokens expire! (typically 1 hour)
  - Store `tokenExpiresAt` in config, check before every API call
- **Personal access token**: `tsk connect asana --token <pat>`
  - User gets PAT from Asana Developer Console
  - PATs don't expire — simpler path

**Token refresh logic:**
```typescript
async function ensureValidToken(config: AsanaConfig): Promise<string> {
  if (!config.tokenExpiresAt || !config.refreshToken) return config.accessToken;
  const expiresAt = new Date(config.tokenExpiresAt).getTime();
  const now = Date.now();
  if (now < expiresAt - 60000) return config.accessToken;  // 1 min buffer
  // Refresh token
  const result = await refreshAccessToken({ ... });
  // Update config with new tokens
  await ConfigManager.setIntegration("asana", {
    ...config,
    accessToken: result.access_token,
    refreshToken: result.refresh_token ?? config.refreshToken,
    tokenExpiresAt: new Date(Date.now() + (result.expires_in ?? 3600) * 1000).toISOString(),
  });
  return result.access_token;
}
```

After auth:
1. Fetch workspaces (`GET /workspaces`)
2. If `workspaceId` not set → prompt user to select
3. Fetch projects in workspace (`GET /projects?workspace={gid}`)
4. If `projectId` not set → prompt user to select (or sync all)
5. Store workspace and project info in config

### 1.2 Field Mapping

| tsk field | Asana field | Mapping notes |
|-----------|-------------|---------------|
| title | name | Direct |
| description | notes | Plain text (use `html_notes` for rich if needed) |
| status "done" | completed: true | PUT to update, or POST complete endpoint |
| status "todo" | completed: false | |
| dueDate | due_on | YYYY-MM-DD |
| project | memberships[0].project.name | Resolved via project GID |
| tags | tags[].name | Need addTag/removeTag API calls |
| parentId | parent.gid | **NATIVE SUBTASKS** |

**Priority handling:**
Asana does NOT have a built-in priority field. Options:
1. **Skip priority mapping** — don't sync priority to/from Asana (simplest)
2. **Custom field** — If user's Asana workspace has a "Priority" custom field, map to it
3. **Tags as priority** — Use tags like "priority:high" (fragile)

**Recommended**: Option 1 (skip) as default, with a note that priority custom field support can be added later. Document this limitation clearly.

### 1.3 Native Subtask Support (KEY FEATURE)

Asana has the best subtask API of all providers:
- **Fetch subtasks**: `GET /tasks/{task_gid}/subtasks?opt_fields=name,completed,due_on,parent,notes,tags.name`
- **Create subtask**: `POST /tasks/{parent_gid}/subtasks` with task body
- **Move subtask**: `POST /tasks/{task_gid}/setParent` with `{ parent: gid }`

Implementation:
- Set `supportsSubtasks = true`
- When pulling: fetch top-level tasks first, then recursively fetch subtasks
- Subtask depth: Asana supports unlimited nesting — tsk should handle at least 3 levels
- When pushing: if task has parentId, resolve to Asana parent GID and use setParent
- Subtask ordering: Asana preserves subtask order

### 1.4 opt_fields (CRITICAL)

Asana's API returns minimal data by default. You MUST specify `opt_fields` on every request:

```typescript
const TASK_OPT_FIELDS = [
  "name", "notes", "completed", "completed_at", "due_on",
  "parent", "parent.gid", "tags", "tags.name",
  "memberships.project", "memberships.project.name",
  "modified_at", "created_at", "permalink_url",
].join(",");

// GET /tasks?project={gid}&opt_fields={TASK_OPT_FIELDS}
```

Without opt_fields, Asana returns only `gid` and `name`.

### 1.5 Pagination

Asana uses offset-based pagination:
```
GET /tasks?project=123&limit=100&offset=abc123
```
- Response includes `next_page.offset` if more results exist
- Loop until `next_page` is null
- Default limit: 100 (max)

### 1.6 Tag Sync

Tags in Asana require separate API calls:
- Get tags on a task: included in task response with opt_fields
- Add tag: `POST /tasks/{gid}/addTag` with `{ tag: tag_gid }`
- Remove tag: `POST /tasks/{gid}/removeTag` with `{ tag: tag_gid }`
- Find or create tag: `GET /tags?workspace={gid}` then `POST /tags` if needed

Cache tag name ↔ GID mapping to avoid repeated lookups.

</requirements>

<implementation>

## Step 1: Research
1. Fetch Asana REST API docs — tasks, subtasks, OAuth, pagination, opt_fields, tags
2. Document findings at top of provider file

## Step 2: Provider implementation
3. Create `src/integrations/asana.ts` implementing SyncProvider
4. Implement token refresh logic (ensureValidToken with expiry check)
5. Implement field mapping (note: no priority mapping — document limitation)
6. Implement fetchTasks — GET /tasks with project filter + opt_fields + pagination
7. Implement createTask — POST /tasks
8. Implement updateTask — PUT /tasks/{gid}
9. Implement completeTask / reopenTask
10. Implement deleteTask — DELETE /tasks/{gid}
11. Implement fetchSubtasks — GET /tasks/{gid}/subtasks (recursive for nested)
12. Implement createSubtask — POST /tasks/{parent_gid}/subtasks
13. Implement tag sync (addTag, removeTag with GID resolution)
14. Implement fetchProjects, fetchLabels (tags)

## Step 3: OAuth flow
15. Implement Asana OAuth with refresh token rotation
16. After auth: fetch workspaces → prompt selection → fetch projects → prompt selection
17. Personal access token fallback
18. Store all IDs and names in config

## Step 4: Register and wire
19. Register in `src/integrations/registry.ts`
20. Wire CLI commands: connect, sync, disconnect

## Step 5: Test and verify
21. `tsk connect asana --token <test-pat>` → should show workspaces + projects
22. `tsk sync asana --dry-run` → should show task diff with subtasks
23. `bun run tsc --noEmit` — zero errors

</implementation>

<constraints>
- Use native fetch() only — no asana SDK
- All HTTP through apiFetch from src/integrations/http.ts
- ALWAYS include opt_fields on Asana requests — never rely on defaults
- Implement token refresh — Asana OAuth tokens expire in ~1 hour
- Handle refresh token rotation (new refresh_token on each refresh)
- Subtask support is a key differentiator — implement it thoroughly (recursive fetch + create)
- Priority: do NOT sync (Asana has no built-in priority) — document clearly
- Tag sync requires separate API calls (addTag/removeTag) — batch efficiently
- Paginate all list endpoints (limit=100, loop until next_page is null)
- OAuth placeholder client_id/secret with TODO
- `--token` path must always work
- 10s timeout, 3 retries on 429/5xx
- Never display tokens
- Run `bun run tsc --noEmit` after implementation
</constraints>
