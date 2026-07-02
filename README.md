```
 ██████╗  ██████╗ ██╗     ██╗     
 ██╔══██╗██╔═══██╗██║     ██║     
 ██████╔╝██║   ██║██║     ██║     
 ██╔══██╗██║   ██║██║     ██║     
 ██║  ██║╚██████╔╝███████╗███████╗
 ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚══════╝
```

**[中文版 README](README_CN.md)**

[![Website](https://img.shields.io/badge/Website-seanyao.github.io%2Froll-blue)](https://seanyao.github.io/roll/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/@seanyao/roll.svg)](https://www.npmjs.com/package/@seanyao/roll)
[![CI](https://github.com/seanyao/roll/actions/workflows/ci.yml/badge.svg)](https://github.com/seanyao/roll/actions/workflows/ci.yml)

Roll — a Prime Agent-led CLI harness that routes AI agents through story-scoped planning, building, evaluation, git, CI, and acceptance evidence. Works with Claude, Cursor, Codex, Kimi, Pi, Reasonix, and other local rigs when they are available.

## Install

```bash
curl -fsSL https://seanyao.github.io/roll/install | bash
```

```bash
npm install -g @seanyao/roll
```

Requirements: Node.js ≥ 22. Roll is a self-contained TypeScript CLI — no runtime engine beyond node.

## Use

```bash
cd your-project
roll init           # set up Roll here (interactive confirmation)
roll next           # continue with design, apply, repair, migrate, loop, or status
roll loop on        # let AI work through the backlog (optional)
```

`roll init` first diagnoses the current directory. Complete Roll projects get
`Already initialized` and `Next: roll status`; partial Roll projects get
`roll init --repair`, while pre-2.0 layouts get migration guidance without writing files. Existing codebases route to
`$roll-onboard`. PRD/docs-only workspaces are treated as new projects: Roll writes
`.roll/brief.md` from the detected document and points to
`roll design --from-file <detected-doc>`.
Empty directories ask what you are building in an interactive terminal; in scripts
and CI, plain `roll init` is read-only and `roll init --auto` writes a placeholder
brief before pointing to `roll design`.
For existing-codebase grafts, `roll init --apply` validates the generated
artifacts, prints a review checkpoint with every planned file operation, and
waits for owner confirmation before writing. Automation must use
`roll init --apply --auto` after that review.
After any init path, `roll next` is the continuation button: it reads the same
brief, onboard plan, backlog, and Roll markers, then prints one best next
command instead of a menu.
First time through? Start with [Getting started](guide/en/getting-started.md).

## V4 Prime Agent Execution

Roll V4 separates project coordination from story delivery:

- **Prime Agent** coordinates at project level: backlog order, cross-Story context, route advice, repeated failures, release readiness, budget, and owner escalation. It observes and advises; it does not implement a Story or override evidence gates.
- **Delta Unit** delivers one Story through scoped roles: `execute` performs the Story work, `evaluate` reviews/scores evidence, and `supervise` coordinates above the Story boundary.
- **supervise / execute / evaluate roles** are stable contracts. The concrete `agent` and optional `model` are resolved through the Agent Scope model: `Scope -> Role -> Binding -> Agent -> Model`.
- **Skills remain** the capability layer. Roles invoke `$roll-design`, `$roll-build`, `$roll-fix`, `$roll-peer`, `$roll-.qa`, and related skills instead of rewriting those contracts into TypeScript.
- **Fallback is fail-loud**. If a requested agent or rig is unavailable, Roll records that unavailability and pauses or asks for owner action; it does not silently pretend another agent was used.

### Prime Agent backlog-clearing standard

When the owner asks Roll to clear a backlog, Prime Agent treats the scope as every
live non-Hold `FIX-*`, `US-*`, and `REFACTOR-*` row unless the owner narrows it.
Before scheduling another card it reconciles backlog status, open PRs, recent
cycle endings, CI/evaluator gates, manual-merge PRs, and `.roll` meta state.
Each card gets its own Builder and, when required by the execution profile, an
independent Evaluator/Scorer selected from the current Agent roster. Repeated
failure, zero TCR, missing PR/CI/evaluator evidence, parser failures, auth
blocks, permission blocks, and `[roll:manual-merge]` PRs stop new scheduling and
surface an owner action through `roll supervisor status/next/why`.

### Operating modes

Roll has two product modes over the same backlog, truth, route profile, execution
profiles, evidence, Evaluator, and release gates:

- **guided** — the owner drives through `roll supervisor status/next/why` and
  starts work explicitly with commands such as `roll loop go --cards <id>`.
  Guided mode never silently starts long-running Story execution.
- **autonomous** — `roll loop on` installs the scheduler; eligible Stories may
  be picked within the existing pause, budget, route, evidence, Evaluator, and
  release gates. `roll loop pause` / `roll loop off` return control to guided
  operation; `roll loop resume` / `roll loop on` switch back explicitly.
- **Attest and evidence are story-scoped**. A Story is accepted through its own `latest/<id>-report.html`, AC map, and screenshots/test artifacts.

Agent bindings are declared in two files: `~/.roll/agents.yaml` for Machine Scope
and `.roll/agents.yaml` for Project Scope. A Project can inherit the machine pool
and bind Story roles:

```yaml
schema: roll-agents/v1
scope: project
inherits: machine
defaults:
  story:
    roles:
      execute:
        kind: select
        from: [kimi, codex, pi]
        require: [execute]
        strategy: first-available
      evaluate:
        kind: select
        from: [claude, codex, kimi, pi, agy, reasonix, cursor]
        require: [evaluate]
        avoid: [execute]
        strategy: least-recent
```

Runtime availability is explicit: if a candidate is not callable on the current
machine because of auth, network, VPN, or account state, the current resolution
records that limitation instead of rewriting the static pool.

## Onboarding Samples

**Zero-start project**

```bash
mkdir my-product && cd my-product
roll init
# In an interactive terminal, describe the requirement, point to a PRD,
# or let Roll write .roll/brief.md from detected notes.
roll next
roll design --from-file .roll/brief.md
roll loop on
```

Roll explains the next design step instead of inventing fake work. The Prime Agent turns the requirement into Stories, resolves `execute` and optional `evaluate` roles per Story, and the owner reviews story-scoped attest evidence.

**Existing project**

```bash
cd existing-codebase
roll init
roll next
roll init --apply        # after reviewing the generated onboard plan
roll loop on
```

Roll diagnoses the repository without destructive migration, writes or updates Roll metadata only after review, and then lets the Prime Agent reason over existing backlog, docs, context, open PRs, and scoped role bindings. Current state is visible through CLI-first observability: `roll status`, `roll loop watch`, `roll loop runs`, `roll cycle <id>`, `roll loop alert`, and story reports.

## Quick start for new projects

A new project needs a remote before the loop can push branches and open PRs:

```bash
cd your-project
roll init
# 1. Create a GitHub repository for the project and add it as `origin`
# 2. Push the current branch so the loop has somewhere to land work
git push -u origin main
# 3. Start the autonomous loop
roll loop on
```

The loop will fail fast with an alert if the repository is missing or
unreachable, so it never burns agent tokens against a broken push target.  If
you need to stop the loop, `roll loop pause` persists a pause marker; resume
with `roll loop resume` when ready.

## Commands

| Command | Description |
|---------|-------------|
| **Autonomy · daily use** | |
| `roll loop <on\|off\|now\|status\|watch\|runs\|log\|story\|events\|eval\|signals\|alert\|fmt\|pr-inbox\|mute\|unmute\|pause\|resume\|reset\|gc>` | Manage the autonomous BACKLOG executor (incl. per-cycle result scoring) |
| `roll loop watch [-n <lines>] [--events\|--raw-events] [--verbose\|--raw] [--attach]` | Read-only live observation. Use default first for owner-facing status (phase / quiet / TCR / last signal), `--events` for compact event debugging, and `--raw-events` only for audit/debug JSON. Ctrl-C ends the view, not the loop; `--attach` joins the tmux observe window read-only |
| `roll loop go [--epic <e>\|--cards <ids>] [--budget <usd>] [--for <duration>] [--review <auto\|hetero\|self\|off>]` | Run goal mode manually until the scoped work completes, pauses, or hits a budget/usage/timebox guardrail; it can run while the scheduler is off, and a paused loop should be resumed first; final review defaults to `auto` |
| `roll loop goal` | Show persisted goal scope, review mode, usage, limits, safety gate, and last decision |
| `roll backlog [sync\|block\|defer\|lint\|…]` | View, manage, and sync (from GitHub Issues) pending tasks |
| `roll loop alert [list\|ack\|resolve\|log]` | View / clear loop alerts |
| `roll status` | Verdict-first truth summary read from the ONE snapshot — LOOP · CYCLE · RELEASE · STORY, with the STORY line's attest-coverage % (`done ≡ merged ∧ attested`) — then convention/AI-client sync health |
| `roll supervisor [status\|observe\|advise\|next\|why\|live] [--json]` | Project-level Prime Agent: observes project truth, explains guided/autonomous mode and next owner action, advises next steps, and renders a read-only live role board with Planner / Builder / Evaluator panes. Cross-Story coordination only — never implements a Story; persistent policy changes need owner confirmation |
| `roll pulse [--json]` | Today's delivery pulse: cycles in window, merged count, attested count, plus an ASCII sparkline from the story spectrum. Bilingual EN/中. `--json` for machine-readable output |
| `roll help [--lang en\|zh] [name]` | View the Charter / language guide markdown in the terminal; `roll --help` remains the CLI usage summary |
| `roll doctor [skills\|tools\|--tools]` | Environment + install diagnosis; `roll doctor tools` shows registered tool policy/readiness, and `roll doctor --tools` shows focused tool and screenshot readiness, including Terminal.app Screen Recording |
| `roll tune [reset]` | Suggest-only self-tuning from loop trends — read-only, never auto-applies |
| **Cards & evidence** | |
| `roll idea "<one-sentence description>"` | Capture a card: auto-classify, number, lint, infer epic, mint the full story folder — the one user entry for adding cards |
| `roll story new <ID> --title <t> [--epic <e>] [--no-index]` | The one minting entry agents/skills use: card folder + backlog row + index refresh (`--no-index` for batches) |
| **Project · per repo** | |
| `roll init` | Diagnose this directory and route to fresh scaffold, PRD/design handoff, existing-codebase onboard, repair, migration, or `roll status` |
| `roll next` | Continue the init/onboard journey with one best next command: design, apply, repair, migrate, loop, or status |
| `roll design [--from-file <path>] [--agent <name>] [--verbose|--raw]` | Launch `$roll-design` interactively; `--from-file` binds a PRD/brief as the design input; `--raw` dumps the full transcript |
| `roll offboard` | Remove Roll from this project |
| `roll test [--where] [--reset]` | Run the test suite (routes through the isolation adapter; unknown types fail loud) |
| `roll ci [--wait]` | Show or wait for current commit's CI status |
| `roll release [--dry-run]` | The ONE release flow: bump → changelog fold → package gate → commit-push → consistency gate → PR → auto-merge → tag push (gate runs before merge; drives the merge via GitHub auto-merge) |
| `roll showcase [--card <ID>]` | The golden-path standard E2E in an isolated sandbox: reset the card, cast a heterogeneous real-agent trio (kimi/claude/pi), deliver via the loop, capture CLI+web screenshots, assemble the evidence chain, emit a pass/fail verdict |
| `roll dream run-once` | Run the nightly Dream scan now; code-structure findings are seeded by a deterministic TS/AST pre-scan artifact before the agent writes the report |
| `roll pair [init\|status\|score]` | Cross-agent pairing: heterogeneous peer re-checks and scores deliveries |
| `roll cycles [--since 1d\|3d\|7d\|all]` | The cycle ledger — one line per cycle, failures never swallowed |
| `roll cycle <id>` | One cycle's full trace tape (cycle→story→build→peer→ci→pr→end); the same trace is persisted as `.roll/loop/cycle-<id>.signals.jsonl` for replay |
| `roll cycle <id> --activity [--json]` | Supervisor-facing activity analysis: active vs silent, micro-step plan, test transitions, green-uncommitted work, oversized actions, and advisory split suggestions |
| `roll cycle <id> --roles [--json]` | The execution cast — who was Builder and who was Evaluator, which peers were consulted, and the single accepted score; also written to `summary.md`/`summary.json` and the Execution Cast report block ([guide](guide/en/loop.md#cycle-role-visibility)) |
| `roll cycle <id> --collab [--json]` | The collaboration relay view over the same `CycleRoleSummary`: Supervisor/Designer → Builder → Peer Reviewer/Evaluator → Gate, including handoff, escalation, and terminus |
| `roll supervisor live --collab [--once\|--json]` | Multi-cycle collaboration stream for the Prime Agent board; `--once` captures a stable snapshot and live mode follows new cycle rows |
| `roll cycle --legend` | Print the Layer A collaboration protocol legend used by the cycle and supervisor collab views |
| `roll peer [--reviewer <agent>] (--prompt <text>\|--file <path>)` | One-shot structured external-provider review; records `.roll/peer/runs.jsonl` |
| **Config & machine** | |
| `roll ls [--json] [--stale-days <n>]` | List the cross-project registry (`~/.roll/projects.json`): name · tag · verdict · path; missing/stale rows flagged, never dropped |
| `roll config [lang <zh\|en\|--reset>\|…]` | Read/write roll config (language, loop window, dream time) |
| `roll agent [migrate --dry-run\|migrate\|list]` | Agent Scope view: Machine Scope, Project Scope, resolved roles, pool health, and legacy compatibility |
| `roll cast [--json]` | Print the current role casting view (`--json` for the machine view) |
| `roll doctor skills [--strict] [--json]` | Strict skills audit (skills · violations · hub lines + the four invocation groups — the SAME yardstick the web Skills page reads) |
| `roll setup skills` | Sync the `guide/skills.md` skill catalog |
| `roll doc [--lang en\|zh] [name]` | View the Charter / language guide markdown in the terminal (`--lang` falls back to the configured language) |
| `roll tool status` | Show registered tools, effective `.roll/policy.yaml` state, input contracts, and requirement readiness |
| `roll prices [refresh]` | Model price table (cost accounting source) |
| `roll setup [skills\|-f]` | First-time install, skill catalog generation, or re-sync conventions to all AI clients |
| `roll update` | Upgrade to latest + re-sync |
| `roll --version` / `roll -v` | Print installed roll version |

## Observability Now

Roll's current observability is CLI-first. Persistent facts flow through one
read path: anchors -> selectors -> adapter -> projections. `roll status`,
`roll loop watch`, `roll loop runs`, `roll cycle <id>`, `roll pulse`, and
story-scoped attest reports are the current user-facing truth surfaces.
`roll index` is an on-demand archive and repair renderer for static HTML pages;
it is not the active delivery truth surface.

- A backlog row is a claim; merge evidence on `main` and recorded acceptance
  evidence are truth. A premature `✅ Done` claim is shown as drift.
- Cycle history is read through the TerminalOutcome vocabulary, not legacy
  free-form summary text.
- Missing facts render as `?`. A visible `0` means a known zero, not unknown.

`roll supervisor live` is the shipped CLI-first multi-role board. A browser/TUI
Prime Agent Live Console remains future work and must reuse the same view model.

## Repository layout

Dev side — a pnpm monorepo. Publish side — one npm package.

```
packages/      TypeScript engine (pnpm workspaces): spec · core · infra · cli · web
lib/           Runtime companions (prices snapshots, i18n catalog)
skills/        Git submodule → seanyao/roll-skills (the agent skill contracts)
conventions/   Conventions synced into AI clients by `roll setup`
template/      Project scaffolding installed by `roll init`
```

Build & test: `pnpm install && pnpm -r test`.

Published as a single npm package `@seanyao/roll`: `dist/` (the CLI bundled to one self-contained ESM by esbuild) + `lib/` + `skills/` + `conventions/` + `template/`.

## Documentation

| | |
|---|---|
| **Start here** | [Getting started](guide/en/getting-started.md) · [Overview & architecture](guide/en/overview.md) · [Engineering methodology](guide/en/methodology.md) |
| **Daily driving** | [The loop (autonomous executor)](guide/en/loop.md) · [Tools & policy](guide/en/tools.md) · [Configuration](guide/en/configuration.md) · [Pricing & cost](guide/en/pricing.md) · [FAQ](guide/en/faq.md) |
| **Quality machinery** | [Acceptance evidence (`roll attest`)](guide/en/acceptance-evidence.md) · [Evidence lifecycle](guide/en/acceptance-evidence.md#lifecycle-in-three-stages) · [Consistency & release gate](guide/en/consistency.md) · [Cross-agent pairing](guide/en/pairing.md) · [Peer review](guide/en/peer.md) · [Test isolation](guide/en/test-isolation.md) |
| **Under the hood** | [Architecture: layers · domain · invariants](docs/architecture.md) · [Verification system](docs/verification.md) · [Manifesto](docs/manifesto.md) |

Full guide index: [guide/en/](guide/en/) — agents, peer review, feedback, backlog sync, adoption patterns, and more.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow, test setup, and PR conventions.

## Security

See [SECURITY.md](SECURITY.md). Please report vulnerabilities privately, not through public issues.

## License

[MIT](LICENSE)
