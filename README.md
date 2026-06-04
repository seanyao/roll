> ⚠️ **This is the Roll v3 work-in-progress branch — the stable version lives on `main` (bash, anchor tag `v2-freeze-2026-06-04`).**
> **这是 Roll v3 在建分支——稳定版在 `main` 分支（bash）。**
> What's new on this branch: `packages/` — TypeScript monorepo growing layer by layer; `skills/` — git submodule → [seanyao/roll-skills](https://github.com/seanyao/roll-skills); commands not yet ported fall back to bash automatically (see [AGENTS.md](AGENTS.md)).
> 本分支新增：`packages/`（TS monorepo，逐层生长）；`skills/`（git submodule 独立仓）；未迁完的命令自动回落 bash（见 [AGENTS.md](AGENTS.md)）。
> Build & test: `pnpm install && pnpm -r test`. Bash entry `bin/roll` unchanged.

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

Requirements: bash 3.2+. npm/Node.js not required — curl install is self-contained.

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
| `roll status` | Show current state and drift |
| `roll agent [use <name>]` | Per-project agent selection |
| `roll ci [--wait]` | Show or wait for current commit's CI status |
| `roll test [--where] [--reset]` | Run the test suite (routes through isolation adapter; Tart VM on Apple Silicon) |
| `roll release` | Run the release script (human-only) |
| `roll review-pr <number>` | AI-powered code review for a PR |
| **Machine · global** | |
| `roll setup [-f]` | First-time install or re-sync conventions to all AI clients |
| `roll update` | Upgrade to latest + re-sync |
| `roll version` | Print installed roll version |

## Documentation

| Topic | English | 中文 |
|-------|---------|------|
| Overview & architecture | [guide/en/overview.md](guide/en/overview.md) | [guide/zh/overview.md](guide/zh/overview.md) |
| Engineering methodology | [guide/en/methodology.md](guide/en/methodology.md) | [guide/zh/methodology.md](guide/zh/methodology.md) |
| Loop (autonomous executor) | [guide/en/loop.md](guide/en/loop.md) | [guide/zh/loop.md](guide/zh/loop.md) |
| Loop data layout (Phase 2.0) | [guide/en/loop-data-layout.md](guide/en/loop-data-layout.md) | [guide/zh/loop-data-layout.md](guide/zh/loop-data-layout.md) |
| Dream (nightly health scan) | [guide/en/dream.md](guide/en/dream.md) | [guide/zh/dream.md](guide/zh/dream.md) |
| Peer (cross-agent review) | [guide/en/peer.md](guide/en/peer.md) | [guide/zh/peer.md](guide/zh/peer.md) |
| AI agents & complexity routing | [guide/en/ai-agents.md](guide/en/ai-agents.md) | [guide/zh/ai-agents.md](guide/zh/ai-agents.md) |
| Configuration (env vars) | [guide/en/configuration.md](guide/en/configuration.md) | [guide/zh/configuration.md](guide/zh/configuration.md) |
| Skill selection guide | [guide/en/skills.md](guide/en/skills.md) | [guide/zh/skills.md](guide/zh/skills.md) |
| roll-doc (legacy doc automation: four phases + Phase 3b deep read) | [guide/en/roll-doc.md](guide/en/roll-doc.md) | [guide/zh/roll-doc.md](guide/zh/roll-doc.md) |
| Slides (deck generator) | [guide/en/slides.md](guide/en/slides.md) | [guide/zh/slides.md](guide/zh/slides.md) |
| Slides — Layouts reference | [guide/en/slides.md#layouts](guide/en/slides.md#layouts) | [guide/zh/slides.md#layouts布局](guide/zh/slides.md#layouts%E5%B8%83%E5%B1%80) |
| Feedback (`roll feedback`) | [guide/en/feedback.md](guide/en/feedback.md) | [guide/zh/feedback.md](guide/zh/feedback.md) |
| Backlog GitHub sync (`roll backlog sync`) | [guide/en/backlog-github-sync.md](guide/en/backlog-github-sync.md) | [guide/zh/backlog-github-sync.md](guide/zh/backlog-github-sync.md) |
| Test isolation (`roll test` + Tart VM) | [guide/en/test-isolation.md](guide/en/test-isolation.md) | [guide/zh/test-isolation.md](guide/zh/test-isolation.md) |
| Cross-machine sync | [guide/en/loop.md#cross-machine-sync](guide/en/loop.md#cross-machine-sync) | [guide/zh/loop.md#跨机器同步](guide/zh/loop.md#%E8%B7%A8%E6%9C%BA%E5%99%A8%E5%90%8C%E6%AD%A5) |
| Remote monitoring (watch loop from a phone via `remote-watch`) | [guide/en/loop.md#remote-monitoring](guide/en/loop.md#remote-monitoring) | [guide/zh/loop.md#远程监控remote-monitoring](guide/zh/loop.md#%E8%BF%9C%E7%A8%8B%E7%9B%91%E6%8E%A7remote-monitoring) |
| Cycle result eval (`roll loop eval`) | [guide/en/loop.md#cycle-result-eval](guide/en/loop.md#cycle-result-eval) | [guide/zh/loop.md#cycle-结果评分result-eval](guide/zh/loop.md#cycle-%E7%BB%93%E6%9E%9C%E8%AF%84%E5%88%86result-eval) |
| Cycle exit summary (`.command` window recap) | [guide/en/loop.md#cycle-exit-summary](guide/en/loop.md#cycle-exit-summary) | [guide/zh/loop.md#cycle-退出摘要cycle-exit-summary](guide/zh/loop.md#cycle-%E9%80%80%E5%87%BA%E6%91%98%E8%A6%81cycle-exit-summary) |
| Pricing (cost visibility) | [guide/en/pricing.md](guide/en/pricing.md) | [guide/zh/pricing.md](guide/zh/pricing.md) |
| FAQ (troubleshooting) | [guide/en/faq.md](guide/en/faq.md) | [guide/zh/faq.md](guide/zh/faq.md) |
| Adoption patterns | [guide/en/patterns/](guide/en/patterns/) | [guide/zh/patterns/](guide/zh/patterns/) |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow, test setup, and PR conventions.

## Security

See [SECURITY.md](SECURITY.md). Please report vulnerabilities privately, not through public issues.

## License

[MIT](LICENSE)
