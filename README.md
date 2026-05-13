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

The first version was almost embarrassingly small — a way to push engineering conventions to whatever AI tool you happened to be running. But it needed to be trustworthy before it could be useful, so the early weeks went into making Roll self-maintaining: one-command releases, self-updating installs, a clean npm presence.

The next step was making Roll genuinely multi-agent. Kimi, DeepSeek, Codex, Trae — each integrated with its own skill preferences and model bindings. `roll-peer` came from a simple insight: agents shouldn't just review their own work. Have one AI challenge another's design decisions before anything lands on `main`. That turned out to be the first glimpse of what Roll was actually becoming.

The real shift happened when `roll loop` went live. Stories started running back-to-back without any human prompt. `roll-.dream` began filing its own refactor tickets after nightly scans. The system had started generating its own work queue — not just executing tasks, but surfacing the next ones.

What followed was learning to trust that autonomy: real-time terminal windows, worktree isolation so loop runs never touch your in-progress work, a CI + AI review double gate so nothing merges until it's actually ready. The kind of loop you can leave running overnight and wake up to something mergeable.

The goal from here: full delivery, end to end — with humans on the loop, not in it.

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
