# Changelog Integration — Design Plan

**Created**: 2026-05-10

## Problem

`roll-.changelog` skill exists but is never called. `roll-build` and `roll-fix` have no post-deploy trigger for changelog generation. As a result, no managed project ever gets a `CHANGELOG.md` automatically.

## Key Design Decision

**Always generate, never skip.** Every successful deploy produces a changelog entry. If `CHANGELOG.md` doesn't exist yet, create it and backfill all historical completed Stories from `BACKLOG.md`.

## Scope

| Item | What | Where |
|------|------|-------|
| US-CL-001 | roll-build Phase 12 auto-triggers `$roll-.changelog` | `skills/roll-build/SKILL.md` |
| US-CL-002 | roll-.changelog supports first-time creation with historical backfill | `skills/roll-.changelog/SKILL.md` |

## Out of Scope

- roll-fix triggering changelog (can be added later, same pattern)
- Changelog format customization per project
- npm version bumping (handled by `$roll-release`)
