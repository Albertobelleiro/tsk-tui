# Session 3 — Linear Integration

> **Prerequisite**: Session 1 (config, OAuth infra, sync engine) must be complete.

<context>
- Project: tsk — terminal task manager
- Stack: TypeScript strict, Bun, @opentui/react
- Session 1 artifacts available:
  - `src/config/config.ts` — ConfigManager for ~/.tsk/config.json
  - `src/config/types.ts` — LinearConfig interface (accessToken, teamId, teamName, projectId, stateMapping)
  - `src/integrations/types.ts` — SyncProvider interface, ExternalTask
  - `src/integrations/sync-engine.ts` — Bidirectional sync engine
  - `src/integrations/sync-state.ts` — SyncStateManager
  - `src/integrations/http.ts` — apiFetch + graphqlFetch with retry/timeout
  - `src/integrations/oauth-helpers.ts` — runOAuthFlow with PKCE support
  - `src/integrations/registry.ts` — Provider registry (register linear here)
  - `src/cli/index.ts` — connect/disconnect/sync commands ready for provider dispatch
- Task type has: externalId, externalSource ("linear"), parentId, subtaskIds, notes[], tags[], priority, dueDate, project
</context>

<role>
You are a senior TypeScript developer integrating Linear's GraphQL API into a terminal task manager. You will research the API, implement GraphQL queries/mutations with native fetch(), handle OAuth with PKCE, and map Linear's data model (issues, states, sub-issues, teams, projects, labels) to tsk's task model.
</role>

<task>
Implement full Linear integration: OAuth with PKCE, bidirectional sync via GraphQL, workflow state mapping, sub-issue support, and CLI commands.
</task>

<research_required>
Before writing ANY code, research the Linear API by fetching these documentation pages:

1. **Linear API overview** — https://developers.linear.app/docs
   - GraphQL endpoint URL, authentication headers, rate limits
2. **OAuth flow** — https://developers.linear.app/docs/oauth/authentication
   - Authorize URL, token URL, scopes, PKCE support, actor types
3. **Issues** — queries and mutations
   - Fetching issues (with filters, pagination)
   - Creating issues (IssueCreateInput)
   - Updating issues (IssueUpdateInput)
   - Archiving / completing issues
4. **Workflow states** — https://developers.linear.app/docs/graphql/schema (WorkflowState type)
   - How states map to tsk statuses (backlog, unstarted, started, completed, cancelled)
   - State types: "backlog", "unstarted", "started", "completed", "cancelled"
5. **Sub-issues** — parent/children relationship on issues
6. **Teams** — required for creating issues
7. **Projects** — optional grouping
8. **Labels** — map to tsk tags
9. **Priority** — Linear uses 0-4 (0=none, 1=urgent, 2=high, 3=medium, 4=low)
10. **Pagination** — cursor-based (first/after, pageInfo)

Write your research findings as a comment block at the top of the provider file.
</research_required>

<requirements>

## 1. Provider: `src/integrations/linear.ts`

Implement `SyncProvider` interface for Linear.

### 1.1 Authentication

Two paths:
- **OAuth with PKCE**: `tsk connect linear`
  - Authorize URL: `https://linear.app/oauth/authorize`
  - Token URL: `https://api.linear.app/oauth/token`
  - Scopes: `read,write,issues:create`
  - Linear supports PKCE (code_challenge_method=S256) — use it!
  - No client_secret needed with PKCE
- **Personal API key**: `tsk connect linear --api-key <key>`
  - User gets key from Linear Settings → API → Personal API keys
  - Store directly in config

After auth:
1. Fetch viewer info (`query { viewer { id name email } }`) to confirm connection
2. Fetch teams (`query { teams { nodes { id name } } }`)
3. If `teamId` not set → prompt user to select a team (required for creating issues)
4. Store teamId and teamName in config

### 1.2 GraphQL Client

Use `graphqlFetch` from `src/integrations/http.ts`:

```typescript
const GRAPHQL_URL = "https://api.linear.app/graphql";

async function linearQuery<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
async function linearMutation<T>(mutation: string, variables?: Record<string, unknown>): Promise<T>;
```

All queries/mutations use:
- Header: `Authorization: Bearer <accessToken>`
- Header: `Content-Type: application/json`

### 1.3 Key GraphQL Operations

**Fetch issues:**
```graphql
query Issues($teamId: String!, $after: String, $updatedAfter: DateTime) {
  issues(
    filter: {
      team: { id: { eq: $teamId } }
      updatedAt: { gte: $updatedAfter }
    }
    after: $after
    first: 50
    orderBy: updatedAt
  ) {
    nodes {
      id
      title
      description
      priority
      state { id name type }
      project { id name }
      labels { nodes { id name } }
      dueDate
      parent { id }
      children { nodes { id } }
      completedAt
      updatedAt
      url
    }
    pageInfo { hasNextPage endCursor }
  }
}
```

Paginate until `hasNextPage` is false.

**Create issue:**
```graphql
mutation CreateIssue($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue { id title url }
  }
}
```

**Update issue:**
```graphql
mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) {
    success
    issue { id title }
  }
}
```

**Fetch workflow states** (needed for status mapping):
```graphql
query WorkflowStates($teamId: String!) {
  workflowStates(filter: { team: { id: { eq: $teamId } } }) {
    nodes { id name type }
  }
}
```

### 1.4 Field Mapping

| tsk field | Linear field | Mapping notes |
|-----------|-------------|---------------|
| title | title | Direct |
| description | description | Markdown supported |
| status | state.type | See state mapping below |
| priority "urgent" | priority: 1 | **INVERTED**: Linear 1=urgent, 4=low, 0=none |
| priority "high" | priority: 2 | |
| priority "medium" | priority: 3 | |
| priority "low" | priority: 4 | |
| priority "none" | priority: 0 | |
| dueDate | dueDate | YYYY-MM-DD |
| project | project.name | Resolve by name ↔ ID |
| tags | labels[].name | Resolve label names ↔ IDs |
| parentId | parent.id | Sub-issues! |

**State type mapping** (Linear workflow state types → tsk status):
```typescript
const STATE_TYPE_TO_TSK: Record<string, TaskStatus> = {
  "backlog": "todo",
  "unstarted": "todo",
  "started": "in_progress",
  "completed": "done",
  "cancelled": "archived",
};
```

For pushing (tsk status → Linear state):
- Fetch team's workflow states on connect
- Find a state of the matching type
- Store mapping in config `stateMapping` for customization

**Priority mapping** (Linear uses inverted numbering like Todoist but differently):
```typescript
const TSK_TO_LINEAR_PRIORITY: Record<TaskPriority, number> = {
  urgent: 1, high: 2, medium: 3, low: 4, none: 0,
};
const LINEAR_TO_TSK_PRIORITY: Record<number, TaskPriority> = {
  0: "none", 1: "urgent", 2: "high", 3: "medium", 4: "low",
};
```

### 1.5 Sub-issue Handling

Linear natively supports sub-issues (parent/children on Issue):
- When pulling: if issue has `parent.id`, resolve to local parentId via sync state
- When pushing: if local task has parentId, resolve to Linear parent issue ID via sync state
- Set `supportsSubtasks = true` on the provider
- Pull parents before children (sort by depth or process in two passes)

### 1.6 Label Resolution

Before syncing, fetch all team labels:
```graphql
query Labels($teamId: String!) {
  issueLabels(filter: { team: { id: { eq: $teamId } } }) {
    nodes { id name color }
  }
}
```

- Cache label name ↔ ID mapping
- When pushing tags: find or create label by name
- When pulling labels: map to tag names

### 1.7 Pagination

Linear uses cursor-based pagination:
- Request `first: 50` with optional `after: cursor`
- Check `pageInfo.hasNextPage` and `pageInfo.endCursor`
- Loop until all pages fetched
- Collect all nodes into a single array

</requirements>

<implementation>

## Step 1: Research
1. Fetch Linear API docs — OAuth, issues schema, workflow states, sub-issues, pagination
2. Document findings at top of provider file

## Step 2: Provider implementation
3. Create `src/integrations/linear.ts` implementing SyncProvider
4. Implement GraphQL query/mutation helpers (using graphqlFetch from http.ts)
5. Implement fetchWorkflowStates — cache state type → state ID mapping
6. Implement fetchTasks — paginated issues query, map all fields
7. Implement createTask — issueCreate mutation
8. Implement updateTask — issueUpdate mutation
9. Implement completeTask — update state to "completed" type
10. Implement reopenTask — update state to "unstarted" or "backlog" type
11. Implement deleteTask — archive issue (Linear doesn't hard-delete)
12. Implement fetchProjects and fetchLabels
13. Implement field mapping with priority inversion and state type mapping

## Step 3: OAuth flow
14. Implement Linear OAuth with PKCE (no client_secret needed)
15. After auth: fetch viewer info, fetch teams, prompt team selection
16. Fetch and store workflow state mapping
17. Personal API key fallback: `tsk connect linear --api-key <key>`

## Step 4: Register and wire
18. Register in `src/integrations/registry.ts`
19. Wire `tsk connect linear`, `tsk sync linear`, `tsk disconnect linear` in CLI

## Step 5: Test and verify
20. `tsk connect linear --api-key <test-key>` → should show teams
21. `tsk sync linear --dry-run` → should show issue diff
22. `bun run tsc --noEmit` — zero errors

</implementation>

<constraints>
- Use native fetch() with graphqlFetch helper — no @linear/sdk or graphql-request
- All HTTP through helpers from src/integrations/http.ts
- Handle Linear's inverted priority (1=urgent, 4=low, 0=none) correctly
- Workflow states vary per team — MUST fetch dynamically, never hardcode state IDs
- Paginate all queries until hasNextPage is false
- Sub-issues must resolve parent/child ordering correctly during sync
- OAuth placeholder client_id with TODO — real ID registered later
- `--api-key` path must always work as fallback
- 10s timeout on all requests, 3 retries on 429/5xx
- Never display tokens
- Run `bun run tsc --noEmit` after implementation
</constraints>
