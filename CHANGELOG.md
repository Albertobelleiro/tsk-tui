# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Public repository governance and operations docs (`CONTRIBUTING`, `SECURITY`, `SUPPORT`, `GOVERNANCE`, release guide)
- Community templates (issues, pull requests, code ownership, Dependabot)
- Environment variable template (`.env.example`)

### Changed

- CI typecheck step aligned with `bun run typecheck`
- Release workflow matrix expanded to include macOS Intel build (`darwin-x64`)
- README enhanced with community and operations documentation links

### Removed

- Internal-only development artifacts (`.agents`, `.claude`, `prompts`)

## [0.2.0] - 2026-02-19

### Added

- CLI + TUI task management workflow
- Multi-provider sync support
- Agent bridge support
- Subtask and time tracking support
