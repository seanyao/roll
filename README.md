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
npm install -g @seanyao/roll
roll setup
```

Requirements: bash 3.2+, Node.js 16+.

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
| `roll loop <on\|off\|now\|status\|runs\|story\|monitor>` | Manage the autonomous BACKLOG executor |
| `roll brief` | Show latest owner brief |
| `roll backlog [block\|defer\|lint\|…]` | View and manage pending tasks |
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
| Dream (nightly health scan) | [guide/en/dream.md](guide/en/dream.md) | [guide/zh/dream.md](guide/zh/dream.md) |
| Peer (cross-agent review) | [guide/en/peer.md](guide/en/peer.md) | [guide/zh/peer.md](guide/zh/peer.md) |
| Configuration (env vars) | [guide/en/configuration.md](guide/en/configuration.md) | [guide/zh/configuration.md](guide/zh/configuration.md) |
| Skill selection guide | [guide/en/skills.md](guide/en/skills.md) | [guide/zh/skills.md](guide/zh/skills.md) |
| Slides (deck generator) | [guide/en/slides.md](guide/en/slides.md) | [guide/zh/slides.md](guide/zh/slides.md) |
| Test isolation (`roll test` + Tart VM) | [guide/en/test-isolation.md](guide/en/test-isolation.md) | [guide/zh/test-isolation.md](guide/zh/test-isolation.md) |
| Cross-machine sync | [guide/en/loop.md#cross-machine-sync](guide/en/loop.md#cross-machine-sync) | [guide/zh/loop.md#跨机器同步](guide/zh/loop.md#%E8%B7%A8%E6%9C%BA%E5%99%A8%E5%90%8C%E6%AD%A5) |
| Pricing (cost visibility) | [guide/en/pricing.md](guide/en/pricing.md) | [guide/zh/pricing.md](guide/zh/pricing.md) |
| FAQ (troubleshooting) | [guide/en/faq.md](guide/en/faq.md) | [guide/zh/faq.md](guide/zh/faq.md) |
| Adoption patterns | [guide/en/patterns/](guide/en/patterns/) | [guide/zh/patterns/](guide/zh/patterns/) |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow, test setup, and PR conventions.

## Security

See [SECURITY.md](SECURITY.md). Please report vulnerabilities privately, not through public issues.

## Acknowledgments

- **[khazix-skills](https://github.com/KKKKhazix/khazix-skills)** by Digital Life Khazix — HV Analysis framework used by `$roll-research`, MIT License.
- **[superpowers](https://github.com/obra/superpowers)** by Jesse Vincent — composable skills library that inspired several Roll workflow patterns.

## License

[MIT](LICENSE)
