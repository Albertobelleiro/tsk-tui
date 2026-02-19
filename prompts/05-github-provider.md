# Session 5 — GitHub Issues Integration

> **Prerequisite**: Session 1 (config, OAuth infra, sync engine) must be complete.

<context>
- Project: tsk — terminal task manager
- Stack: TypeScript strict, Bun, @opentui/react
- Session 1 artifacts available:
  - `src/config/config.ts` — ConfigManager
  - `src/config/types.ts` — GitHubConfig interface (accessToken, repo, useGhCli, labelFilter)
  - `src/integrations/types.ts` — SyncProvider, ExternalTask
  - `src/integrations/sync-engine.ts` — Sync engine
  - `src/integrations/http.ts` — apiFetch
  - `src/integrations/oauth-device-flow.ts` — Device flow implementation
  - `src/integrations/registry.ts` — Provider registry
- Task type has: externalId, externalSource ("github-issues"), parentId, subtaskIds, tags[], priority, dueDate, project
</context>

<role>
You are a senior TypeScript developer integrating GitHub Issues REST API into a terminal task manager. You prioritize zero-config auth via the gh CLI, fall back to device flow OAuth, and handle GitHub's unique data model (labels as priority, milestones as projects, task lists in markdown as pseudo-subtasks).
</role>

<task>
Implement GitHub Issues integration: zero-config auth via gh CLI, device flow fallback, bidirectional sync with label-based priority, milestone mapping, and task-list parsing for pseudo-subtasks.
</task>

<research_required>
Before writing ANY code, research the GitHub API:

1. **GitHub REST API — Issues** — https://docs.github.com/en/rest/issues
   - GET /repos/{owner}/{repo}/issues (list)
   - POST /repos/{owner}/{repo}/issues (create)
   - PATCH /repos/{owner}/{repo}/issues/{number} (update)
   - State: "open" / "closed"
2. **Authentication**
   - Personal access tokens (PAT)
   - `gh auth token` command for zero-config
   - Device Flow — https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
3. **Labels** — https://docs.github.com/en/rest/issues/labels
   - How to add/remove labels
   - We'll use labels for priority mapping (e.g., "priority:high")
4. **Milestones** — https://docs.github.com/en/rest/issues/milestones
   - Map to tsk project
5. **Pagination** — Link header based
   - Parse `Link: <url>; rel="next"` header
6. **Rate limits** — https://docs.github.com/en/rest/rate-limit
   - 5000 req/hour with token, 60 without
   - X-RateLimit-Remaining header
7. **Task lists in issue body** — `- [ ] task` / `- [x] task` syntax
   - Used as pseudo-subtasks (display-only sync)

Write findings as a comment block at the top of the provider file.
</research_required>

<requirements>

## 1. Provider: `src/integrations/github-issues.ts`

### 1.1 Authentication (Priority Order)

```typescript
async function resolveGitHubToken(config: GitHubConfig): Promise<string | null> {
  // 1. Try gh CLI (zero config — best UX)
  if (config.useGhCli !== false) {
    try {
      const result = await Bun.$`gh auth token`.text();
      const token = result.trim();
      if (token && token.length > 10) return token;
    } catch { /* gh not installed or not authed */ }
  }

  // 2. Use stored token
  if (config.accessToken) return config.accessToken;

  // 3. No auth available
  return null;
}
```

**Connect flows:**
- `tsk connect github --repo owner/repo` → auto-detect `gh` CLI token. If found: done. If not: run device flow.
- `tsk connect github --token <pat> --repo owner/repo` → store PAT directly.
- `tsk connect github --repo owner/repo --no-gh` → skip gh detection, force device flow or token.

**Device flow** (when gh CLI not available):
1. POST `https://github.com/login/device/code` with client_id + scope
2. Display: `"Go to https://github.com/login/device and enter code: XXXX-XXXX"`
3. Open browser to verification URL
4. Poll `https://github.com/login/oauth/access_token` with device_code every `interval` seconds
5. On success: store access_token in config

After auth: test with `GET /repos/{owner}/{repo}` to verify access.

### 1.2 Field Mapping

| tsk field | GitHub field | Mapping notes |
|-----------|-------------|---------------|
| title | title | Direct |
| description | body | Markdown |
| status "todo"/"in_progress" | state: "open" | GitHub has no in_progress |
| status "done" | state: "closed" | |
| priority | labels | Convention: "priority:urgent", "priority:high", "priority:medium", "priority:low" |
| project | milestone.title | |
| tags | labels[].name | Excluding priority: labels |
| dueDate | milestone.due_on | Or: parse from body? (GitHub issues don't have due dates) |
| parentId | N/A | See pseudo-subtasks below |

**Priority via labels:**
```typescript
const PRIORITY_LABELS: Record<TaskPriority, string> = {
  urgent: "priority:urgent",
  high: "priority:high",
  medium: "priority:medium",
  low: "priority:low",
  none: "",  // no label
};

function extractPriorityFromLabels(labels: string[]): TaskPriority {
  for (const [priority, label] of Object.entries(PRIORITY_LABELS)) {
    if (labels.includes(label)) return priority as TaskPriority;
  }
  return "none";
}

function separateLabels(labels: string[]): { priority: TaskPriority; tags: string[] } {
  const priorityLabels = new Set(Object.values(PRIORITY_LABELS));
  return {
    priority: extractPriorityFromLabels(labels),
    tags: labels.filter(l => !priorityLabels.has(l)),
  };
}
```

When pushing: add the appropriate `priority:X` label and remove others.

**Due date handling:**
GitHub Issues don't have a due date field. Options:
1. **Milestone due_on** — if milestone has a due date, use it (imprecise)
2. **Body convention** — parse `Due: YYYY-MM-DD` from issue body
3. **Skip** — don't sync due dates

**Recommended**: Option 2 — append/parse `<!-- tsk:due:YYYY-MM-DD -->` as an HTML comment in the issue body. Invisible in rendered markdown but machine-readable.

### 1.3 Pseudo-subtasks (Task Lists)

GitHub Issues don't have real subtasks, but support task lists in markdown:
```markdown
## Tasks
- [ ] First subtask
- [x] Completed subtask
- [ ] Third subtask
```

**Pull**: Parse task list items from issue body as read-only subtask indicators:
- Extract `- [ ] title` and `- [x] title` patterns from body
- Don't create real tsk subtasks from these — just show them in task detail
- Store as notes with source "sync" for display

**Push**: When a tsk task has subtasks, generate a task list in the issue body:
```markdown
{description}

## Subtasks
- [x] Completed subtask (tsk)
- [ ] Pending subtask (tsk)
```

Set `supportsSubtasks = false` on the provider — it's display-only, not real sync.

### 1.4 Pagination

GitHub uses Link header pagination:
```
Link: <https://api.github.com/repos/owner/repo/issues?page=2>; rel="next",
      <https://api.github.com/repos/owner/repo/issues?page=5>; rel="last"
```

```typescript
function parseLinkHeader(header: string | null): { next?: string; last?: string } {
  if (!header) return {};
  const links: Record<string, string> = {};
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="(\w+)"/);
    if (match) links[match[2]] = match[1];
  }
  return links;
}
```

Fetch all pages until no `next` link.

### 1.5 Label Management

When pushing priority changes, need to manage labels:
- `GET /repos/{owner}/{repo}/labels` — list available labels
- `POST /repos/{owner}/{repo}/labels` — create if missing (e.g., "priority:high")
- Label add/remove is done via the issue update endpoint (pass full labels array)

Ensure priority labels exist in the repo before first push. Auto-create them with appropriate colors:
```typescript
const PRIORITY_LABEL_COLORS: Record<string, string> = {
  "priority:urgent": "f7768e",
  "priority:high": "ff9e64",
  "priority:medium": "e0af68",
  "priority:low": "7dcfff",
};
```

### 1.6 Filtering

If `labelFilter` is set in config, only sync issues that have ALL specified labels:
```
GET /repos/{owner}/{repo}/issues?labels=bug,backend&state=all&per_page=100
```

### 1.7 Required Headers

```typescript
const GITHUB_HEADERS = {
  "Accept": "application/vnd.github+json",
  "User-Agent": "tsk-cli",
  "X-GitHub-Api-Version": "2022-11-28",
};
```

</requirements>

<implementation>

## Step 1: Research
1. Fetch GitHub REST API docs — issues, labels, milestones, pagination, device flow
2. Document findings at top of provider file

## Step 2: Provider implementation
3. Create `src/integrations/github-issues.ts` implementing SyncProvider
4. Implement resolveGitHubToken (gh CLI → stored → null)
5. Implement field mapping with label-based priority extraction
6. Implement fetchTasks — GET /repos/{owner}/{repo}/issues with pagination
7. Implement createTask — POST /repos/{owner}/{repo}/issues
8. Implement updateTask — PATCH /repos/{owner}/{repo}/issues/{number}
9. Implement completeTask (close) / reopenTask (reopen)
10. Implement deleteTask — close + add "wontfix" label (GitHub doesn't hard-delete)
11. Implement task list parsing from issue body (pseudo-subtasks)
12. Implement task list generation when pushing tasks with subtasks
13. Implement due date via HTML comment in body
14. Implement priority label auto-creation and management
15. Implement Link header pagination parser

## Step 3: Auth flow
16. Implement gh CLI detection
17. Implement device flow fallback (using oauth-device-flow.ts)
18. PAT direct input: `tsk connect github --token <pat> --repo owner/repo`
19. After auth: test with repo access check

## Step 4: Register and wire
20. Register in `src/integrations/registry.ts`
21. Wire CLI commands: connect, sync, disconnect

## Step 5: Test and verify
22. `tsk connect github --repo owner/repo` → should detect gh CLI or prompt device flow
23. `tsk sync github --dry-run` → should show issue diff
24. `bun run tsc --noEmit` — zero errors

</implementation>

<constraints>
- Use native fetch() — no octokit or GitHub SDK
- All HTTP through apiFetch from src/integrations/http.ts
- Always set User-Agent and X-GitHub-Api-Version headers
- gh CLI detection must be non-blocking and fail silently if not installed
- Device flow: use placeholder OAuth client_id with TODO
- Priority via labels is a convention — auto-create labels on first push
- GitHub Issues don't have real subtasks — use task lists in body (display-only)
- Due date via HTML comment in body: `<!-- tsk:due:YYYY-MM-DD -->`
- supportsSubtasks = false on this provider
- Parse Link header for pagination — never assume page count
- Rate limit: check X-RateLimit-Remaining, back off at < 100 remaining
- `--token` path must always work
- 10s timeout, 3 retries on 429/5xx
- Never display tokens
- Run `bun run tsc --noEmit` after implementation
</constraints>
