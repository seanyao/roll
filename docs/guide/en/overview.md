# Roll — Overview

Roll is an autonomous delivery system that turns a BACKLOG into shipped code continuously.
Engineering practices (TCR, INVEST stories, code review) are encoded as executable skills —
reliable enough for an agent to run unattended, disciplined enough to ship production code.

## Three-Layer Autonomous Model

```
Human  →  sets goals, reviews PRs, runs roll-release
Loop   →  executes BACKLOG items hourly (roll loop)
Dream  →  scans code health nightly, generates REFACTOR items (roll-.dream)
Peer   →  cross-agent review gate inside each build (roll peer)
```

- **Human layer**: you write `## Ideas`, approve stories, and run `scripts/release.sh`.
- **Loop layer**: `roll loop on` installs a launchd scheduler. Every hour (within active window),
  loop picks the top `📋 Todo` story from BACKLOG.md and executes it via `$roll-build`.
- **Dream layer**: a nightly cron at 3am scans the codebase, surfaces friction, and appends
  `REFACTOR-NNN` entries to BACKLOG.md for loop to pick up.
- **Peer layer**: before any risky build, loop invokes `roll peer` for a second-opinion review
  from a different AI agent (kimi, deepseek, codex, etc.).

## Quick Start

```bash
# Install roll
npm install -g @seanyao/roll

# Set up in your project
cd my-project
roll setup
roll init

# Enable autonomous operation
roll loop on

# Watch it work
roll loop monitor
```

## BACKLOG Priority Order

Loop always picks stories in this order:

1. `FIX-XXX` bugs (blockers first)
2. `US-XXX` user stories
3. `REFACTOR-XXX` tech debt

Stories marked `🚫 Hold` or `🔨 In Progress` are skipped.
You can bypass loop entirely: `$roll-build US-XXX` executes any story immediately.

## Key Files

| File | Purpose |
|------|---------|
| `BACKLOG.md` | Story index (Status column drives loop) |
| `docs/features/<feature>.md` | AC, files, dependencies per story |
| `~/.roll/config.yaml` | Agent routing, active window, schedule |
| `~/.shared/roll/loop/state.yaml` | Current loop run state |
| `~/.shared/roll/loop/runs.jsonl` | Per-run history |

## Further Reading

- [loop.md](loop.md) — Scheduling, subcommands, tmux visibility
- [dream.md](dream.md) — Nightly code health and REFACTOR generation
- [peer.md](peer.md) — Cross-agent review protocol
