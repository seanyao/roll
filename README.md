```
 ██████╗  ██████╗ ██╗     ██╗     
 ██╔══██╗██╔═══██╗██║     ██║     
 ██████╔╝██║   ██║██║     ██║     
 ██╔══██╗██║   ██║██║     ██║     
 ██║  ██║╚██████╔╝███████╗███████╗
 ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚══════╝
```

> Roll out features with AI agents — _Move fast, no sprints._

**[中文版 README](README_CN.md)**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/@seanyao/roll.svg)](https://www.npmjs.com/package/@seanyao/roll)
[![CI](https://github.com/seanyao/roll/actions/workflows/ci.yml/badge.svg)](https://github.com/seanyao/roll/actions/workflows/ci.yml)

---

## What is Roll?

Roll is an autonomous delivery system for software teams — AI agents pick stories from your BACKLOG, execute them with encoded engineering discipline, and ship continuously while you stay focused on what to build next.

**Two core values:**
1. **Autonomous delivery** — `roll loop on` runs BACKLOG items hourly; Dream (nightly code-health scan) surfaces maintenance tasks; humans retain sole release authority
2. **Skill-driven execution** — 20+ skills encode TDD, TCR, and INVEST practices as reliable, repeatable workflows any agent can follow

_Works with Claude, Cursor, Codex, or your own agent._

---

## Quick Start (30 seconds)

```bash
npm install -g @seanyao/roll
roll setup          # distribute conventions to all AI clients
cd my-project
roll init           # create AGENTS.md + BACKLOG.md + docs/features/
roll loop on        # optional: let the agent work unattended
```

**Requirements:** bash 4+, Node.js 16+

---

## Documentation Index

| Topic | English | 中文 |
|-------|---------|------|
| Overview & architecture | [guide/en/overview.md](docs/guide/en/overview.md) | [guide/zh/overview.md](docs/guide/zh/overview.md) |
| Engineering methodology | [guide/en/methodology.md](docs/guide/en/methodology.md) | [guide/zh/methodology.md](docs/guide/zh/methodology.md) |
| Loop (autonomous executor) | [guide/en/loop.md](docs/guide/en/loop.md) | [guide/zh/loop.md](docs/guide/zh/loop.md) |
| Dream (nightly health scan) | [guide/en/dream.md](docs/guide/en/dream.md) | [guide/zh/dream.md](docs/guide/zh/dream.md) |
| Peer (cross-agent review) | [guide/en/peer.md](docs/guide/en/peer.md) | [guide/zh/peer.md](docs/guide/zh/peer.md) |
| Skill selection guide | [guide/en/skills.md](docs/guide/en/skills.md) | [guide/zh/skills.md](docs/guide/zh/skills.md) |
| Domain model (DDD) | [domain/context-map.md](docs/domain/context-map.md) | — |
| Engineering common sense | [practices/engineering-common-sense.md](docs/practices/engineering-common-sense.md) | — |

---

## Commands

| Command | Description |
|---------|-------------|
| `roll setup [-f]` | First-time install or re-sync conventions to all AI clients |
| `roll update` | Upgrade to latest version |
| `roll init` | Initialize project: AGENTS.md + BACKLOG.md + docs/features/ |
| `roll status` | Show sync state, skill links, detected AI tools |
| `roll backlog` | Show pending tasks from BACKLOG.md |
| `roll loop <on\|off\|now\|status\|monitor>` | 🤖 Manage autonomous executor |
| `roll brief` | 🤖 Show latest owner digest |
| `roll peer` | 🤖 Cross-agent code review |
| `roll release` | 🤖 Version + tag + npm publish + GitHub Release |

---

## Evolution

Roll didn't start as a framework. It started as a question: *what if the AI didn't just write code, but actually shipped it?*

**Getting the basics shipped (Apr 2026)**
The first milestone was making Roll self-maintaining: npm-distributed, self-updating, with a one-command release flow that handles versioning, changelogs, tagging, and publishing. Before building anything ambitious, the toolchain had to be trustworthy.

**A multi-agent ecosystem (late Apr – early May)**
Roll expanded beyond Claude to support Kimi, DeepSeek, Codex, and Trae — each skill able to declare which tools and models it prefers. The bigger shift was social: `roll-peer` enabled cross-agent code review, so agents could challenge each other's decisions before anything landed on `main`. GitHub Actions brought that discipline into CI.

**Autonomous execution unlocked (May 10)**
`roll loop` made the leap from "AI assists" to "AI delivers." Stories run back-to-back without human prompting. `roll-.dream` runs nightly architecture health checks and files its own refactor tickets. The system started generating its own work queue.

**Making the machine visible (May 11–12)**
Autonomous execution is only useful if you can trust it. This phase added real-time terminal windows, loop monitoring, macOS notifications, CI status queries, and a daily briefing digest — everything needed to see what the AI is doing without having to babysit it.

**A reliable delivery pipeline (May 13–14)**
The final piece was correctness under pressure: worktree isolation prevents stories from colliding on `main`, `depends-on:` constraints enforce sequencing, and auto-merge gates on both CI green *and* AI code review approval. The pipeline now catches its own mistakes.

---

**Where we're heading:** The autonomous execution layer keeps deepening — the goal is a system where AI handles the full delivery loop end-to-end, and humans stay in the loop only for direction and release sign-off.

---

## Contributing

PRs welcome. Keep them focused on one thing. For larger changes, open an issue first.

1. `git clone https://github.com/seanyao/roll.git && cd roll && ./install.sh`
2. Make changes with bats tests (`tests/`)
3. Run `npm test` before pushing

---

## Acknowledgments

- **[khazix-skills](https://github.com/KKKKhazix/khazix-skills)** by Digital Life Khazix — HV Analysis framework used by `$roll-research`, MIT License.
- **[superpowers](https://github.com/obra/superpowers)** by Jesse Vincent — composable skills library that inspired several Roll workflow patterns.

---

MIT License
