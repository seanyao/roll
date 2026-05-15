# Roll — Overview

Roll is an autonomous delivery system. Write a goal in BACKLOG, let Roll execute it.

## Quick Start

```bash
npm install -g @seanyao/roll

cd my-project
roll setup && roll init

roll loop on        # AI starts executing BACKLOG hourly
roll loop monitor   # watch it work
```

## How It Works

Roll runs on three autonomous layers:

- **Loop** — every hour, picks the top story from BACKLOG and executes it via `$roll-build` in an isolated worktree. CI must pass before anything lands on `main`.
- **Dream** — at 3am, scans the codebase for dead code, doc gaps, and architectural drift. Queues `REFACTOR-NNN` entries for loop to pick up.
- **Peer** — before any risky build, a second AI agent reviews the plan or diff and must agree before execution continues.

You set goals, review PRs, and run releases. Everything in between is Roll.

## Features

### Autonomous Execution

- `roll loop on` — AI picks stories from BACKLOG and executes hourly in an isolated worktree `[core]`
- `roll loop monitor` — live dashboard: loop / dream / brief service status `[core]`
- `roll loop attach` — attach to the live tmux session and watch AI work in real time `[highlight]`
- `roll loop pause / resume` — hand-code yourself; let AI resume when you're done

### Quality Gates

- Peer Review — a second AI agent challenges the plan or diff before any risky build `[core]` `[highlight]`
- Self-Review — post-commit self-check on each micro-commit
- Acceptance Check — ACs verified against story definition after every build
- CI Gate — loop waits for green CI; red CI halts the loop and writes an alert `[core]`
- TCR Discipline — no commit without passing tests; zero-diff commits revert automatically `[core]`

### Nightly Dream

- Code Health Scan — detects dead code, architectural drift, over-engineering candidates `[highlight]`
- Doc Coverage — flags missing guides, stale docs, undocumented ENV vars
- REFACTOR Queue — writes REFACTOR-NNN entries to BACKLOG for loop to pick up next morning

### Story Lifecycle

- `$roll-idea` — one-liner capture: instant FIX or IDEA backlog entry `[core]`
- `$roll-design` — DDD-backed planning: clarify → design → split into INVEST stories `[core]`
- `$roll-build` — TCR story execution → worktree → PR → auto-merge `[core]`
- `$roll-fix` — fast-path bug fix, same CI gate, lighter ceremony

### Observability

- `roll status` — project health: backlog queue, loop state, CI, release-ready verdict `[core]`
- `roll loop runs` — per-cycle history with outcome, TCR count, duration
- `roll alert` — view, acknowledge, and clear loop alerts
- `roll brief` — daily digest: what shipped, what's in-progress, next priorities `[highlight]`

### On-Demand Skills

- `$roll-debug` — mount a diagnostic probe, trace root cause, auto-fix if source-traceable
- `$roll-doc` — scan any project for doc gaps and generate missing documentation
- `$roll-sentinel` — spot-check production against BACKLOG acceptance criteria
- `$roll-doctor` — diagnose the dev toolchain: node, npm, git, AI tools
- `$roll-notes` — capture a development moment in narrative form

### Multi-Agent

- Fallback Routing — primary agent down → automatic failover `[highlight]`
- `roll peer` — structured negotiation: propose → challenge → refine, up to 3 rounds `[core]`
- PR Inbox — external PRs get AI review before merge; stale PRs auto-rebase `[new]`
- `roll review-pr` — on-demand AI review for any PR, any agent `[new]`

## Guide Index

| Topic | Document |
|-------|----------|
| Scheduling, subcommands, tmux visibility | [loop.md](loop.md) |
| Nightly code health and REFACTOR generation | [dream.md](dream.md) |
| Cross-agent review protocol | [peer.md](peer.md) |
| Complete skill catalog | [skills.md](skills.md) |
| Common scenarios and troubleshooting | [faq.md](faq.md) |
| Environment variable configuration | [configuration.md](configuration.md) |
