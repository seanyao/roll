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

## Features

### Autonomous Execution

- Autonomous Execution / `roll loop on` — AI picks stories from BACKLOG and executes hourly in an isolated worktree `[core]`
- Autonomous Execution / `roll loop monitor` — live dashboard: loop / dream / brief service status `[core]`
- Autonomous Execution / `roll loop attach` — attach to the live tmux session and watch AI work in real time `[highlight]`
- Autonomous Execution / `roll loop pause / resume` — hand-code yourself; let AI resume when you're done

### Quality Gates

- Quality Gates / Peer Review — a second AI agent challenges the plan or diff before any risky build `[core]` `[highlight]`
- Quality Gates / Self-Review — post-commit self-check on each micro-commit
- Quality Gates / Acceptance Check — ACs verified against story definition after every build
- Quality Gates / CI Gate — loop waits for green CI; red CI halts the loop and writes an alert `[core]`
- Quality Gates / TCR Discipline — no commit without passing tests; zero-diff commits revert automatically `[core]`

### Nightly Dream

- Dream / Code Health Scan — detects dead code, architectural drift, over-engineering candidates `[highlight]`
- Dream / Doc Coverage — flags missing guides, stale docs, undocumented ENV vars
- Dream / REFACTOR Queue — writes REFACTOR-NNN entries to BACKLOG for loop to pick up next morning

### Story Lifecycle

- Story Lifecycle / `$roll-idea` — one-liner capture: instant FIX or IDEA backlog entry `[core]`
- Story Lifecycle / `$roll-design` — DDD-backed planning: clarify → design → split into INVEST stories `[core]`
- Story Lifecycle / `$roll-build` — TCR story execution → worktree → PR → auto-merge `[core]`
- Story Lifecycle / `$roll-fix` — fast-path bug fix, same CI gate, lighter ceremony

### Observability

- Observability / `roll status` — project health: backlog queue, loop state, CI, release-ready verdict `[core]`
- Observability / `roll loop runs` — per-cycle history with outcome, TCR count, duration
- Observability / `roll alert` — view, acknowledge, and clear loop alerts
- Observability / `roll brief` — daily digest: what shipped, what's in-progress, next priorities `[highlight]`

### On-Demand Skills

- Skills / `$roll-debug` — mount a diagnostic probe, trace root cause, auto-fix if source-traceable
- Skills / `$roll-doc` — scan any project for doc gaps and generate missing documentation
- Skills / `$roll-sentinel` — spot-check production against BACKLOG acceptance criteria
- Skills / `$roll-doctor` — diagnose the dev toolchain: node, npm, git, AI tools
- Skills / `$roll-notes` — capture a development moment in narrative form

### Multi-Agent

- Multi-Agent / Fallback Routing — primary agent down → automatic failover `[highlight]`
- Multi-Agent / `roll peer` — structured negotiation: propose → challenge → refine, up to 3 rounds `[core]`
- Multi-Agent / PR Inbox — external PRs get AI review before merge; stale PRs auto-rebase `[new]`
- Multi-Agent / `roll review-pr` — on-demand AI review for any PR, any agent `[new]`

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
- [configuration.md](configuration.md) — `ROLL_HOME` / `ROLL_CONFIG` / `ROLL_GLOBAL` overrides
