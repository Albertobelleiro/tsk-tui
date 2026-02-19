# Contributing to tsk

Thanks for your interest in contributing to `tsk`.

## Scope

This repository contains a terminal-first task manager with:

- Interactive TUI
- Headless CLI
- Optional provider integrations (Todoist, Linear, Asana, GitHub)

Please keep pull requests focused and incremental.

## Before Opening a Pull Request

1. Check existing issues and pull requests.
2. For non-trivial work, open an issue first and align on approach.
3. Ensure your change is in scope for this repository.

## Development Setup

```bash
git clone https://github.com/Albertobelleiro/tsk-tui.git
cd tsk-tui
bun install
```

Run quality checks locally:

```bash
bun run typecheck
bun test
bun run build
```

## Branching and Commits

- Branch from `main`.
- Use clear, atomic commits.
- Prefer Conventional Commit style:
  - `feat: add recurring due date parser`
  - `fix: handle ambiguous partial task ids`
  - `docs: clarify sync conflict strategy`

## Pull Request Requirements

A pull request should include:

- Problem statement and solution summary
- User impact
- Test updates for behavior changes
- Documentation updates when behavior, flags, or config change

Before requesting review, verify:

- `bun run typecheck` passes
- `bun test` passes
- No credentials, private keys, or environment files are included

## Coding Guidelines

- Keep TypeScript strictness intact.
- Avoid introducing unrelated refactors in feature/bugfix PRs.
- Prefer clear naming and small functions.
- Preserve backward compatibility for CLI behavior when possible.

## Reporting Security Issues

Do not open public issues for vulnerabilities.

Use the process described in [`SECURITY.md`](SECURITY.md).

## Code of Conduct

By participating, you agree to the project [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
