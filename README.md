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
1. **Autonomous delivery** — `roll loop on` runs BACKLOG items hourly; Dream surfaces maintenance tasks nightly; humans retain sole release authority
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
