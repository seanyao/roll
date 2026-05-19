# Roll — Project Setup

## Initialize a Project

From your project root:

```bash
roll init
```

`roll init` does three things in sequence:

1. **Reads your project** — detects language, framework, and existing structure without asking questions.
2. **Writes conventions** — creates or updates `CLAUDE.md`, `AGENTS.md`, and `BACKLOG.md` if they do not exist.
3. **Syncs skills** — links roll's skill set into your AI tool's skill directory (`.claude/skills/` for Claude Code).

No interactive prompts. No project-type selection. Roll infers from what already exists.

## Sync After Updating Roll

When roll ships a new version of its conventions or skills, sync them into your project:

```bash
roll sync
```

`sync` only overwrites files that roll manages (skills and global conventions). Your project-specific files (`BACKLOG.md`, `docs/`, etc.) are never touched.

## Typical First-Use Sequence

```bash
npm install -g roll        # install roll
roll setup                 # configure AI tools globally (one time per machine)
cd my-project
roll init                  # initialize this project
$roll-design               # open a design session to populate BACKLOG.md
roll loop on               # enable autonomous execution
```

## What Gets Created

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Claude Code project instructions |
| `AGENTS.md` | Agent conventions: domain model, scope, coding standards |
| `BACKLOG.md` | Story tracking (Epic / Feature / Story / Fix / Refactor) |
| `.roll/features/` | Per-feature deep docs (one file per Feature) |

## Re-initializing

`roll init` is idempotent — running it again on an existing project is safe. It
skips files that already exist and only creates what is missing.

## See Also

- [installation.md](installation.md) — install and update roll
- [conventions.md](conventions.md) — AGENTS.md structure and conventions
- [loop.md](loop.md) — enable autonomous execution
