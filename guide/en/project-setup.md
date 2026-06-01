# Roll — Project Setup

## Initialize a Project

From your project root:

```bash
roll init
```

`roll init` detects the current directory state and picks one of three modes:

1. **Empty directory** — fresh start. Roll writes `AGENTS.md` plus an empty
   `.roll/` scaffold (`backlog.md`, `features/`, `domain/`). No prompts. This is
   the **seed** adoption pattern — see [patterns/seed-pattern.md](patterns/seed-pattern.md).
2. **Existing legacy codebase** — Roll detects existing source files but no
   `.roll/` directory. It does **not** silently scaffold; instead it surfaces
   `$roll-onboard`, an interactive skill that scans the codebase, asks a short
   set of cognition / scope / privacy questions, and produces
   `.roll/onboard-plan.yaml` for review. Run `roll init --apply` once the plan
   looks right. This is the **graft** pattern — see
   [legacy-onboarding.md](legacy-onboarding.md) and
   [patterns/graft-pattern.md](patterns/graft-pattern.md).
3. **Re-init** — `.roll/` already exists. Roll re-merges global conventions into
   `AGENTS.md` section-by-section, preserving all project-specific content, and
   ensures missing scaffold pieces are filled in. Idempotent.

Upgrading from a pre-2.0 layout (`BACKLOG.md` at root, `docs/features/`,
`docs/domain/`)? Run `roll migrate` first — see
[migration-2.0.md](migration-2.0.md). `roll init` will refuse to scaffold on top
of a half-migrated project.

## Sync After Updating Roll

When roll ships a new version of its conventions or skills, sync them into your project:

```bash
roll sync
```

`sync` only overwrites files that roll manages (skills and global conventions). Your project-specific files (`.roll/backlog.md`, project source, etc.) are never touched.

## Typical First-Use Sequence

```bash
curl -fsSL https://seanyao.github.io/roll/install | bash   # install roll
roll setup                 # configure AI tools globally (one time per machine)
cd my-project
roll init                  # initialize this project (or run $roll-onboard for legacy code)
$roll-design               # open a design session to populate .roll/backlog.md
roll loop on               # enable autonomous execution
```

## What Gets Created

| File | Purpose |
|------|---------|
| `AGENTS.md` | Agent conventions: domain model, scope, coding standards (root-level — entry point for every AI client) |
| `.roll/backlog.md` | Story tracking (Epic / Feature / Story / Fix / Refactor) |
| `.roll/features/` | Per-feature deep docs (one file per Feature) |
| `.roll/domain/` | DDD models, context map, architecture records |

## Re-initializing

`roll init` is idempotent — running it again on an existing project is safe. It
skips files that already exist and only creates what is missing.

## See Also

- [installation.md](installation.md) — install and update roll
- [conventions.md](conventions.md) — AGENTS.md structure and conventions
- [patterns/](patterns/README.md) — three adoption patterns (seed / graft / replant)
- [legacy-onboarding.md](legacy-onboarding.md) — graft Roll into an existing codebase
- [migration-2.0.md](migration-2.0.md) — upgrade a pre-2.0 project to `.roll/` layout
- [loop.md](loop.md) — enable autonomous execution

## Git Hooks Auto-Setup (US-INFRA-008/009)

Roll's TCR pre-commit gate lives in `hooks/pre-commit`. Git ignores this directory
by default — `core.hooksPath` must point to it. Roll configures this automatically
in three places so you never hit a "TCR gate bypassed" window:

1. **`roll setup`** — configures `core.hooksPath=hooks` in the current repo.
2. **Autonomous loop cycle preflight** — each cycle ensures the worktree it runs in
   has the correct hooks path.
3. **Claude Code SessionStart hook** (`.claude/settings.json`) — runs
   `git config core.hooksPath hooks` every time a new Claude Code session opens in
   this project.

**Manual override:** If you've intentionally set `core.hooksPath` to something else,
Roll will not overwrite it. The auto-setup only fires when the value is unset or
equals the git default `.git/hooks`.

**Troubleshooting:** If commits are going through without running tests:

```bash
git config core.hooksPath   # should print: hooks
ls hooks/pre-commit          # should exist and be executable
roll setup                   # re-runs the configuration step
```
