```
 ██████╗  ██████╗ ██╗     ██╗     
 ██╔══██╗██╔═══██╗██║     ██║     
 ██████╔╝██║   ██║██║     ██║     
 ██╔══██╗██║   ██║██║     ██║     
 ██║  ██║╚██████╔╝███████╗███████╗
 ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚══════╝
```

> _Agents, roll out._

**[中文版 README](README_CN.md)**

[![Website](https://img.shields.io/badge/Website-seanyao.github.io%2FRoll-blue)](https://seanyao.github.io/Roll/)
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

## Evolution

Roll didn't start as a framework. It started as a question: *what if the AI didn't just write code, but actually shipped it?*

Early versions just pushed engineering conventions to whichever AI tool you were running. Then came multi-agent support — Kimi, DeepSeek, Codex, Trae — and `roll-peer`, which let one AI challenge another's decisions before anything landed on `main`.

The real shift was `roll loop`: stories running back-to-back without human prompting, `roll-.dream` filing its own refactor tickets after nightly scans, the system generating its own work queue. What followed was building enough trust to leave it running overnight — worktree isolation, CI + AI review double gates, real-time visibility into what the agent was actually doing.

The goal from here: full delivery, end to end — with humans on the loop, not in it.

---

## Quick Start (30 seconds)

```bash
npm install -g @seanyao/roll
roll setup          # distribute conventions to all AI clients
cd my-project
roll init           # create AGENTS.md + .roll/backlog.md + .roll/features/
roll loop on        # optional: let the agent work unattended
```

**Requirements:** bash 4+, Node.js 16+

---

## Documentation Index

| Topic | English | 中文 |
|-------|---------|------|
| Overview & architecture | [guide/en/overview.md](guide/en/overview.md) | [guide/zh/overview.md](guide/zh/overview.md) |
| Engineering methodology | [guide/en/methodology.md](guide/en/methodology.md) | [guide/zh/methodology.md](guide/zh/methodology.md) |
| Loop (autonomous executor) | [guide/en/loop.md](guide/en/loop.md) | [guide/zh/loop.md](guide/zh/loop.md) |
| Dream (nightly health scan) | [guide/en/dream.md](guide/en/dream.md) | [guide/zh/dream.md](guide/zh/dream.md) |
| Peer (cross-agent review) | [guide/en/peer.md](guide/en/peer.md) | [guide/zh/peer.md](guide/zh/peer.md) |
| Configuration (env vars) | [guide/en/configuration.md](guide/en/configuration.md) | [guide/zh/configuration.md](guide/zh/configuration.md) |
| Skill selection guide | [guide/en/skills.md](guide/en/skills.md) | [guide/zh/skills.md](guide/zh/skills.md) |
| FAQ (troubleshooting) | [guide/en/faq.md](guide/en/faq.md) | [guide/zh/faq.md](guide/zh/faq.md) |
| Domain model (DDD) | [domain/context-map.md](.roll/domain/context-map.md) | — |
| Engineering common sense | [practices/engineering-common-sense.md](guide/en/practices/engineering-common-sense.md) | — |

---

## Commands

| Command | Description |
|---------|-------------|
| `roll setup [-f]` | First-time install or re-sync conventions to all AI clients |
| `roll update` | Upgrade to latest version |
| `roll init` | Initialize project: AGENTS.md + .roll/backlog.md + .roll/features/ |
| `roll status` | Show sync state, skill links, detected AI tools |
| `roll backlog` | Show pending tasks from .roll/backlog.md |
| `roll loop <on\|off\|now\|status\|monitor>` | 🤖 Manage autonomous executor |
| `roll brief` | 🤖 Show latest owner digest |
| `roll peer` | 🤖 Cross-agent code review |
| `roll release` | 🤖 Version + tag + npm publish + GitHub Release |

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
