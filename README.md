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

Requirements: Node.js ≥ 22 (the CLI entry runs on node). bash 3.2+ for the bundled fallback engine.

## Use

```bash
cd your-project
roll init           # set up Roll here
roll loop on        # let AI work through the backlog (optional)
```

`roll init` detects legacy code and routes you to `$roll-onboard` when appropriate.

## Commands

| Command | Description |
|---------|-------------|
| **Autonomy · daily use** | |
| `roll loop <on\|off\|now\|status\|eval\|signals\|runs\|story\|monitor\|…>` | Manage the autonomous BACKLOG executor (incl. per-cycle result scoring) |
| `roll brief` | Show latest owner brief |
| `roll backlog [sync\|block\|defer\|lint\|…]` | View, manage, and sync (from GitHub Issues) pending tasks |
| `roll peer` | Cross-agent negotiation & review |
| `roll alert` | View / clear loop alerts |
| **Project · per repo** | |
| `roll init` | Set up Roll in this project |
| `roll story new <ID> --title <t> [--epic <e>]` | Mint a story's card folder (spec + page + index) — the single creation channel |
| `roll attest <ID>` | Render the acceptance-evidence report into the card folder |
| `roll index` | Rebuild the three-layer Delivery Dossier (front page · epics · story dossiers) |
| `roll status` | Show current state and drift |
| `roll agent [use <name>]` | Per-machine complexity-slot routing (easy/default/hard/fallback) |
| `roll ci [--wait]` | Show or wait for current commit's CI status |
| `roll test [--where] [--reset]` | Run the test suite (routes through the isolation adapter; unknown types fail loud) |
| `roll release` | Run the release script (human-only) |
| `roll review-pr <number>` | AI-powered code review for a PR |
| **Machine · global** | |
| `roll setup [-f]` | First-time install or re-sync conventions to all AI clients |
| `roll update` | Upgrade to latest + re-sync |
| `roll version` | Print installed roll version |

## Repository layout

Dev side — a pnpm monorepo. Publish side — one npm package.

```
packages/      TypeScript engine (pnpm workspaces): spec · core · infra · cli · web
bin/roll       Frozen bash v2 engine — automatic fallback + the diff-test oracle
lib/           Runtime companions (python/sh) used by the loop & fallback paths
skills/        Git submodule → seanyao/roll-skills (the agent skill contracts)
conventions/   Conventions synced into AI clients by `roll setup`
template/      Project scaffolding installed by `roll init`
```

The frozen v2 bash lives on the `v2` branch (anchor tag `v2-freeze-2026-06-04`). Build & test: `pnpm install && pnpm -r test`.

Published as a single npm package `@seanyao/roll`: `dist/` (TS bundled by esbuild) + `bin/` + `lib/` + `skills/` + `conventions/` + `template/`.

## Documentation

| | |
|---|---|
| **Start here** | [Overview & architecture](guide/en/overview.md) · [Engineering methodology](guide/en/methodology.md) |
| **Daily driving** | [The loop (autonomous executor)](guide/en/loop.md) · [Configuration](guide/en/configuration.md) · [Pricing & cost](guide/en/pricing.md) · [FAQ](guide/en/faq.md) |
| **Quality machinery** | [Acceptance evidence (`roll attest`)](guide/en/acceptance-evidence.md) · [Consistency & release gate](guide/en/consistency.md) · [Test isolation](guide/en/test-isolation.md) |
| **Under the hood** | [Architecture: layers · domain · invariants](docs/architecture.md) · [Verification system](docs/verification.md) · [Manifesto](docs/manifesto.md) |

Full guide index: [guide/en/](guide/en/) — agents, peer review, slides, feedback, backlog sync, adoption patterns, and more.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow, test setup, and PR conventions.

## Security

See [SECURITY.md](SECURITY.md). Please report vulnerabilities privately, not through public issues.

## License

[MIT](LICENSE)
