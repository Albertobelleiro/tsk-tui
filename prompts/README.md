# tsk v0.2 — Implementation Prompts

Prompts for Claude Code / Codex to implement v0.2 features. Execute in order.

| Session | File | Scope | Depends on |
|---------|------|-------|------------|
| 0 | `00-code-review.md` | Full code review before v0.2 | — |
| 1 | `01-config-oauth-sync-engine.md` | Config system + OAuth infra + sync engine | — |
| 2 | `02-todoist-provider.md` | Todoist REST API integration | Session 1 |
| 3 | `03-linear-provider.md` | Linear GraphQL API integration | Session 1 |
| 4 | `04-asana-provider.md` | Asana REST API integration | Session 1 |
| 5 | `05-github-provider.md` | GitHub Issues integration | Session 1 |
| 6 | `06-agent-bridge.md` | Claude Code / Codex file-based IPC | Session 1 |
| 7 | `07-subtask-tui.md` | Subtask tree rendering + keybindings | — |
| 8 | `08-tui-indicators-polish.md` | Sync indicators, status bar, help, final polish | Sessions 1-7 |

Sessions 2-6 can run in parallel after session 1 is complete.
Session 7 is independent and can run anytime.
Session 8 is the final integration pass.
