# Roll — Overview

Roll is an autonomous delivery system. Write a goal in `.roll/backlog.md`, let Roll execute it.

## Quick Start

```bash
curl -fsSL https://seanyao.github.io/roll/install | bash

cd my-project
roll setup && roll init

roll loop on        # AI starts executing BACKLOG on a configurable schedule
roll loop status    # check scheduler state and recent cycles
roll loop watch     # optional: read-only live view of the current cycle
```

## How It Works

Roll runs on three autonomous layers:

- **Loop** — on a configurable schedule, picks the top story from BACKLOG and executes it via `$roll-build` in an isolated worktree. CI must pass before anything lands on `main`.
- **Dream** — at 3am, scans the codebase for dead code, doc gaps, and architectural drift. Queues `REFACTOR-NNN` entries for loop to pick up.
- **Peer** — before any risky build, a second AI agent reviews the plan or diff and must agree before execution continues.

You set goals, review PRs, and run releases. Everything in between is Roll.

## Features

### Autonomous Execution

- `roll loop on` — AI picks stories from BACKLOG and executes on a configurable schedule in an isolated worktree `[core]`
- `roll loop status` — scheduler snapshot, recent cycles, queue, alerts, and cost `[core]`
- `roll loop watch` — default read-only live status; use `--events` for compact events and `--raw-events` only for audit/debug `[highlight]`
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
- `roll design` / `$roll-design` — DDD-backed planning: clarify → design → split into INVEST stories. `roll design` launches the skill in your AI agent from the command line. `[core]`
- `$roll-build` — TCR story execution → worktree → PR → auto-merge `[core]`
- `$roll-fix` — fast-path bug fix, same CI gate, lighter ceremony

### Observability

- `roll status` — verdict-first truth summary (LOOP · CYCLE · RELEASE · STORY with attest coverage), then convention/AI-client sync health `[core]`
- Delivery Dossier — the web console: a verdict strip, the loop heartbeat, three aggregates, and the six-state Story spectrum, all from the ONE truth snapshot
- `roll loop runs` — per-cycle TerminalOutcome history with TCR count and duration
- `roll loop alert` — view, acknowledge, and clear loop alerts
- `roll dossier` — the Delivery Dossier: shipped / in-progress / queue / truth drift / release readiness, all from one truth ledger `[highlight]`

### Delivery Dossier — the web console

`roll index` renders `index.html`, the Delivery Dossier. Every number on it
reads from one truth snapshot, so the web surface and the CLI print the same
aggregates (`roll cast` ≡ the Casting grid, `roll doctor skills` ≡ the Skills
page, `roll release consistency` ≡ the seven-dimension panel, `roll status` ≡ the
Story spectrum). One computation, two faces.

The console's information architecture:

- **Dark top-bar with a green-dot project switcher** — the active project carries
  a green status dot; the switcher lists every project in `~/.roll/projects.json`
  (the same registry `roll ls` prints) and jumps between their consoles.
- **EN / 中 language toggle** — single-language presentation; the toggle flips the
  whole console between English and Chinese.
- **Project tabs** — Now · Backlog · Loop · Release · Casting · Charter. Now is
  the default landing view: live cycle, loop heartbeat, running processes, next
  picks, needs-you rows, and the truth rollup with verdict, aggregates, and the
  six-state Story spectrum.
- **Machine-global breadcrumb (`MACHINE › …`)** — Agents · Skills · Tools ·
  Conventions · About. These pages describe the machine, not one project: the
  agents installed on this box, the `skills/<name>/SKILL.md` contracts that govern
  every project here, the built-in tool catalog with each tool's default
  guardrails (timeout / sandbox / retry / per-cycle cap) on the **Tools** page
  (`tools.html`), and the conventions synced into each AI client.
- **Charter** — a markdown browser over the project's charter docs, language
  guides (`guide/en` ↔ `guide/zh`), and epic plans, rendered inline.
- **Casting** — who plays which role: the four complexity slots
  (easy / default / hard / fallback) plus the scenario roles (peer · PR review ·
  spar · onboard). An unconfigured slot shows an explicit em-dash, never a guess.

The three-state delivery ladder — **claimed → merged → attested** — replaces a
binary done flag. A backlog row that says done is only `claimed`; it becomes
`merged` when the delivery PR is merged to `main`, and `attested` when its
acceptance evidence (report · AC map · visual evidence) is on file. **A story is
done if and only if it is both merged and attested** (`done ≡ merged ∧ attested`);
anything short of that renders as drift or unknown, never a silent green.

### On-Demand Skills

- `$roll-debug` — mount a diagnostic probe, trace root cause, auto-fix if source-traceable
- `$roll-doc-audit` — check docs/site/help against implementation; index gaps and draft missing docs
- `$roll-doctor` — diagnose the dev toolchain: node, npm, git, AI tools
- `$roll-notes` — capture a development moment in narrative form

### Multi-Agent

- Fallback Routing — primary agent down → automatic failover `[highlight]`
- `$roll-peer` — multi-round negotiation; `roll peer` records one-shot structured review facts `[core]`
- PR Inbox — external PRs get AI review before merge; stale PRs auto-rebase `[new]`
- `roll review-pr` — on-demand AI review for any PR, any agent `[new]`

## Project Structure

Roll 2.0 keeps the project root clean. All Roll-managed artifacts live under
`.roll/`:

```
my-project/
├── AGENTS.md            # engineering constraints (root-level — agents read this first)
├── README.md            # product front door
├── src/  tests/         # your code
└── .roll/               # everything Roll touches
    ├── backlog.md       # Story / Fix / Refactor index
    ├── features/        # per-Story AC + plan docs
    ├── domain/          # DDD models, context map
    ├── briefs/  dream/  # autonomous-layer output
    └── decisions/       # ADRs
```

Upgrading a pre-2.0 project? See [migration-2.0.md](migration-2.0.md) —
`npx @seanyao/roll@2 migrate` moves `BACKLOG.md`, `docs/features/`, and
`docs/domain/` into the new layout in one pass.

## Choosing an Adoption Mode

Roll supports three adoption patterns. Pick the one that fits your starting
point — see [patterns/](patterns/README.md) for the decision tree:

- **Seed** — empty directory + a product vision. Roll is native from day one.
- **Graft** — existing project, zero-invasion. `$roll-onboard` reverse-engineers
  `.roll/` from what's already there. See [legacy-onboarding.md](legacy-onboarding.md).
- **Replant** — heavy legacy debt. Reverse-engineer the spec, then rebuild on
  the new spec.

## Guide Index

| Topic | Document |
|-------|----------|
| First working project | [getting-started.md](getting-started.md) |
| Scheduling, subcommands, tmux visibility | [loop.md](loop.md) |
| Governed tool registry and policy | [tools.md](tools.md) |
| Nightly code health and REFACTOR generation | [dream.md](dream.md) |
| Cross-agent review protocol | [peer.md](peer.md) |
| Complete skill catalog | [skills.md](skills.md) |
| Adoption patterns (seed / graft / replant) | [patterns/](patterns/README.md) |
| Onboarding a legacy codebase | [legacy-onboarding.md](legacy-onboarding.md) |
| Upgrading from pre-2.0 layout | [migration-2.0.md](migration-2.0.md) |
| Common scenarios and troubleshooting | [faq.md](faq.md) |
| Environment variable configuration | [configuration.md](configuration.md) |
