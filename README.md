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

Roll — a CLI that lets AI agents pick up backlog items and ship them through your normal git + CI workflow. Works with Claude, Cursor, Codex, Kimi, and others.

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
roll init           # set up Roll here
roll loop on        # let AI work through the backlog (optional)
```

`roll init` detects legacy code and routes you to `$roll-onboard` when appropriate.
First time through? Start with [Getting started](guide/en/getting-started.md).

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
| `roll pulse [--json]` | Today's delivery pulse: cycles in window, merged count, attested count, plus an ASCII sparkline from the story spectrum. Bilingual EN/中. `--json` for machine-readable output |
| `roll doctor [skills]` | Environment + install diagnosis (agents, skill catalog, plists, launchd lanes) |
| `roll tune [reset]` | Suggest-only self-tuning from loop trends — read-only, never auto-applies |
| **Cards & evidence** | |
| `roll idea "<one-sentence description>"` | Capture a card: auto-classify, number, lint, infer epic, mint the full story folder — the one user entry for adding cards |
| `roll story new <ID> --title <t> [--epic <e>] [--no-index]` | The one minting entry agents/skills use: card folder + backlog row + index refresh (`--no-index` for batches) |
| **Project · per repo** | |
| `roll init` | Set up Roll in this project (agent-driven onboarding for legacy code) |
| `roll offboard` | Remove Roll from this project |
| `roll test [--where] [--reset]` | Run the test suite (routes through the isolation adapter; unknown types fail loud) |
| `roll daemon <start\|stop\|status>` | Manage the read-only observability daemon (OPT-IN only; never auto-started) |
| `roll ci [--wait]` | Show or wait for current commit's CI status |
| `roll release [--dry-run]` | The ONE release flow: bump → changelog fold → package gate → commit-push → consistency gate → PR → auto-merge → tag push (gate runs before merge; drives the merge via GitHub auto-merge) |
| `roll showcase [--card <ID>]` | The golden-path standard E2E in an isolated sandbox: reset the card, cast a heterogeneous real-agent trio (kimi/claude/pi), deliver via the loop, capture CLI+web screenshots, assemble the evidence chain, emit a pass/fail verdict |
| `roll dream run-once` | Run the nightly Dream scan now; code-structure findings are seeded by a deterministic TS/AST pre-scan artifact before the agent writes the report |
| `roll pair [init\|status\|score]` | Cross-agent pairing: heterogeneous peer re-checks and scores deliveries |
| `roll cycles [--since 1d\|3d\|7d\|all]` | The cycle ledger — one line per cycle, failures never swallowed |
| `roll cycle <id>` | One cycle's full trace tape (cycle→story→build→peer→ci→pr→end) |
| web `#loop` cycle rows | The same ledger expands to the shared ActivitySignal stream and writes `.roll/loop/cycle-<id>.signals.jsonl` for replay |
| `roll peer [--reviewer <agent>] (--prompt <text>\|--file <path>)` | One-shot structured external-provider review; records `.roll/peer/runs.jsonl` |
| **Config & machine** | |
| `roll ls [--json] [--stale-days <n>]` | List the cross-project registry (`~/.roll/projects.json`): name · tag · verdict · path; missing/stale rows flagged, never dropped |
| `roll config [lang <zh\|en\|--reset>\|…]` | Read/write roll config (language, loop window, dream time) |
| `roll agent [set <slot> <agent>\|use <name>\|list]` | Per-machine complexity-slot routing (easy/default/hard/fallback) |
| `roll cast [--json]` | Print the complexity-ladder → role Casting table (same data the web console grid shows; `--json` for the machine view) |
| `roll doctor skills [--strict] [--json]` | Strict skills audit (skills · violations · hub lines + the four invocation groups — the SAME yardstick the web Skills page reads) |
| `roll setup skills` | Sync the `guide/skills.md` skill catalog |
| `roll doc [--lang en\|zh] [name]` | View the Charter / language guide markdown in the terminal (`--lang` falls back to the configured language) |
| `roll tool status` | Show registered tools, effective `.roll/policy.yaml` state, and requirement readiness |
| `roll prices [refresh]` | Model price table (cost accounting source) |
| `roll setup [skills\|-f]` | First-time install, skill catalog generation, or re-sync conventions to all AI clients |
| `roll update` | Upgrade to latest + re-sync |
| `roll --version` / `roll -v` | Print installed roll version |

## Truth Model In The UI

The Delivery Dossier is a truth projection, not a backlog mirror. Persistent
facts flow through one read path: anchors -> selectors -> adapter ->
projections. `roll index` renders the front truth board from three aggregates:
Story, Cycle, and Release.

- A backlog row is a claim; merge evidence on `main` and recorded acceptance
  evidence are truth. A premature `✅ Done` claim is shown as drift.
- Cycle history is read through the TerminalOutcome vocabulary, not legacy
  free-form summary text.
- Missing facts render as `?`. A visible `0` means a known zero, not unknown.

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
