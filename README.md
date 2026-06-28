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

Roll — a Supervisor-led CLI harness that routes AI agents through story-scoped planning, building, evaluation, git, CI, and acceptance evidence. Works with Claude, Cursor, Codex, Kimi, Pi, Reasonix, and other local rigs when they are available.

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

## V4 Supervisor Execution

Roll V4 separates project coordination from story delivery:

- **Supervisor Agent** coordinates at project level: backlog order, cross-Story context, route advice, repeated failures, release readiness, budget, and owner escalation. It observes and advises; it does not implement a Story or override evidence gates.
- **Story Execution Unit** delivers one Story through an execution profile: `standard` = Builder, `verified` = Builder -> Evaluator, `planned` = Planner -> Builder -> Evaluator.
- **Planner / Builder / Evaluator roles** are stable contracts. The concrete `agent`, `model`, and `rig` can vary per Story through route profiles.
- **Skills remain** the capability layer. Roles invoke `$roll-design`, `$roll-build`, `$roll-fix`, `$roll-peer`, `$roll-.qa`, and related skills instead of rewriting those contracts into TypeScript.
- **Fallback is fail-loud**. If a requested agent or rig is unavailable, Roll records that unavailability and pauses or asks for owner action; it does not silently pretend another agent was used.
- **Attest and evidence are story-scoped**. A Story is accepted through its own `latest/<id>-report.html`, AC map, and screenshots/test artifacts.

Role routing can be declared per Story:

```yaml
story: US-V4-012
execution_profile: verified
roles:
  builder:
    agent: kimi
    responsibility: update README, docs, guides, website, and samples
  evaluator:
    agent: pi
    responsibility: evaluate new-user clarity and product narrative
```

Runtime availability is explicit: if `kimi` or `pi` is not callable on the current machine, the delivery records that limitation instead of hiding it behind a silent fallback.

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

Roll explains the next design step instead of inventing fake work. The Planner turns the requirement into Stories, the Supervisor selects `standard`, `verified`, or `planned` per Story, Builder/Evaluator roles execute, and the owner reviews story-scoped attest evidence.

**Existing project**

```bash
cd existing-codebase
roll init
roll next
roll init --apply        # after reviewing the generated onboard plan
roll loop on
```

Roll diagnoses the repository without destructive migration, writes or updates Roll metadata only after review, and then lets the Supervisor reason over existing backlog, docs, context, open PRs, and route profiles. Current state is visible through CLI-first observability: `roll status`, `roll loop watch`, `roll loop runs`, `roll cycle <id>`, `roll loop alert`, and story reports.

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
| `roll supervisor [observe\|advise\|next\|why] [--json]` | Project-level Supervisor Agent (v0 observe/advise): reads backlog, delivery-truth coverage, open PRs, route config, repeated failures, and explicit release blockers, then emits concise advisory decisions. Cross-Story coordination only — never implements a Story; persistent policy changes need owner confirmation |
| `roll pulse [--json]` | Today's delivery pulse: cycles in window, merged count, attested count, plus an ASCII sparkline from the story spectrum. Bilingual EN/中. `--json` for machine-readable output |
| `roll doctor [skills\|--tools]` | Environment + install diagnosis; `roll doctor --tools` shows focused tool and screenshot readiness, including Terminal.app Screen Recording |
| `roll daemon <start\|stop\|status>` | Experimental read-only event broadcaster for future browser observability; defaults to `127.0.0.1:7077`, records `.roll/loop/daemon.pid`, and is never auto-started by the loop |
| `roll tune [reset]` | Suggest-only self-tuning from loop trends — read-only, never auto-applies |
| **Cards & evidence** | |
| `roll idea "<one-sentence description>"` | Capture a card: auto-classify, number, lint, infer epic, mint the full story folder — the one user entry for adding cards |
| `roll story new <ID> --title <t> [--epic <e>] [--no-index]` | The one minting entry agents/skills use: card folder + backlog row + index refresh (`--no-index` for batches) |
| **Project · per repo** | |
| `roll init` | Diagnose this directory and route to fresh scaffold, PRD/design handoff, existing-codebase onboard, repair, migration, or `roll status` |
| `roll next` | Continue the init/onboard journey with one best next command: design, apply, repair, migrate, loop, or status |
| `roll design [--from-file <path>] [--agent <name>]` | Launch `$roll-design` interactively; `--from-file` binds a PRD/brief as the design input |
| `roll offboard` | Remove Roll from this project |
| `roll test [--where] [--reset]` | Run the test suite (routes through the isolation adapter; unknown types fail loud) |
| `roll daemon <start\|stop\|status>` | Manage the experimental read-only observability daemon (opt-in only; never auto-started) |
| `roll ci [--wait]` | Show or wait for current commit's CI status |
| `roll release [--dry-run]` | The ONE release flow: bump → changelog fold → package gate → commit-push → consistency gate → PR → auto-merge → tag push (gate runs before merge; drives the merge via GitHub auto-merge) |
| `roll showcase [--card <ID>]` | The golden-path standard E2E in an isolated sandbox: reset the card, cast a heterogeneous real-agent trio (kimi/claude/pi), deliver via the loop, capture CLI+web screenshots, assemble the evidence chain, emit a pass/fail verdict |
| `roll dream run-once` | Run the nightly Dream scan now; code-structure findings are seeded by a deterministic TS/AST pre-scan artifact before the agent writes the report |
| `roll pair [init\|status\|score]` | Cross-agent pairing: heterogeneous peer re-checks and scores deliveries |
| `roll cycles [--since 1d\|3d\|7d\|all]` | The cycle ledger — one line per cycle, failures never swallowed |
| `roll cycle <id>` | One cycle's full trace tape (cycle→story→build→peer→ci→pr→end); the same trace is persisted as `.roll/loop/cycle-<id>.signals.jsonl` for replay |
| `roll peer [--reviewer <agent>] (--prompt <text>\|--file <path>)` | One-shot structured external-provider review; records `.roll/peer/runs.jsonl` |
| **Config & machine** | |
| `roll ls [--json] [--stale-days <n>]` | List the cross-project registry (`~/.roll/projects.json`): name · tag · verdict · path; missing/stale rows flagged, never dropped |
| `roll config [lang <zh\|en\|--reset>\|…]` | Read/write roll config (language, loop window, dream time) |
| `roll agent [set <slot> <agent>\|use <name>\|list]` | Per-machine complexity-slot routing (easy/default/hard/fallback) |
| `roll cast [--json]` | Print the complexity-ladder -> role Casting table (`--json` for the machine view) |
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

The full Supervisor Live Console and multi-role board are next work, not
something this README claims as shipped.

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
