# Releasing tsk

This document describes the release process for maintainers.

## Prerequisites

- CI is green on `main`
- Changelog updated
- Version updated where applicable

## Build and Verify Locally

```bash
bun install
bun run typecheck
bun test
bun run build:all
```

## Create a Release Tag

```bash
git checkout main
git pull --ff-only
git tag vX.Y.Z
git push origin vX.Y.Z
```

The release workflow will:

- Build binaries for configured targets
- Upload artifacts
- Create a GitHub Release with generated notes

## Post-Release Checklist

- Verify artifacts on the release page
- Validate install script path against the published asset names
- Announce release notes
