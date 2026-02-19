# Architecture Overview

## High-Level Components

- `bin/tsk.tsx`: entrypoint for CLI and TUI
- `src/cli/`: headless command execution and output formatting
- `src/store/`: task domain model, persistence, and state transitions
- `src/views/` + `src/components/`: terminal UI rendering and interaction
- `src/integrations/`: provider adapters and sync infrastructure
- `src/config/`: runtime configuration and secret-bearing integration settings

## Data Model

Core task data is persisted locally in `~/.tsk/tasks.json`.

Configuration is persisted in `~/.tsk/config.json`.

## Sync Strategy

Integrations synchronize between local tasks and external providers.

Conflict handling is configurable and implemented in the sync engine.

## Runtime

- Bun runtime
- TypeScript strict mode
- OpenTUI React reconciler for TUI rendering
