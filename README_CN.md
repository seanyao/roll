```
 ██████╗  ██████╗ ██╗     ██╗     
 ██╔══██╗██╔═══██╗██║     ██║     
 ██████╔╝██║   ██║██║     ██║     
 ██╔══██╗██║   ██║██║     ██║     
 ██║  ██║╚██████╔╝███████╗███████╗
 ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚══════╝
```

> 用 AI Agent 交付功能 — _快速推进，无需冲刺。_

**[English README](README.md)**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/@seanyao/roll.svg)](https://www.npmjs.com/package/@seanyao/roll)
[![CI](https://github.com/seanyao/roll/actions/workflows/ci.yml/badge.svg)](https://github.com/seanyao/roll/actions/workflows/ci.yml)

---

## Roll 是什么？

Roll 是面向 AI agent 的指令与工作流框架——将经过验证的工程实践（TDD、TCR、SRE、INVEST）编码为任何 agent 都能遵循的技能，把统一约定分发到本机所有 AI 客户端，并通过可选的自主演化层让 agent 在无人值守时持续工作。

**三个核心价值：**
1. **任何 agent，相同约束** — Claude、Cursor、Kimi、DeepSeek、Codex 全部接收一致的工程护栏
2. **技能体系** — 20 个技能将调研 → 设计 → 实现 → 检查 → 修复编码为可靠、可复现的工作流
3. **自主演化** — `roll loop on` 每小时执行 BACKLOG 待办；人类保留发布的唯一权力

---

## 快速开始（30 秒）

```bash
npm install -g @seanyao/roll
roll setup          # 把约定分发到所有 AI 客户端
cd my-project
roll init           # 创建 AGENTS.md + BACKLOG.md + docs/features/
roll loop on        # 可选：让 agent 无人值守工作
```

**环境要求：** bash 4+、Node.js 16+

---

## 文档索引

| 主题 | English | 中文 |
|------|---------|------|
| 概述与架构 | [guide/en/overview.md](docs/guide/en/overview.md) | [guide/zh/overview.md](docs/guide/zh/overview.md) |
| 工程方法论 | [guide/en/methodology.md](docs/guide/en/methodology.md) | [guide/zh/methodology.md](docs/guide/zh/methodology.md) |
| Loop（自主执行器） | [guide/en/loop.md](docs/guide/en/loop.md) | [guide/zh/loop.md](docs/guide/zh/loop.md) |
| Dream（夜间健康巡检） | [guide/en/dream.md](docs/guide/en/dream.md) | [guide/zh/dream.md](docs/guide/zh/dream.md) |
| Peer（跨 Agent 评审） | [guide/en/peer.md](docs/guide/en/peer.md) | [guide/zh/peer.md](docs/guide/zh/peer.md) |
| 技能选择指南 | [guide/en/skills.md](docs/guide/en/skills.md) | [guide/zh/skills.md](docs/guide/zh/skills.md) |
| 领域模型（DDD） | [domain/context-map.md](docs/domain/context-map.md) | — |
| 工程常识 | [practices/engineering-common-sense.md](docs/practices/engineering-common-sense.md) | — |

---

## 命令

| 命令 | 说明 |
|------|------|
| `roll setup [-f]` | 首次安装或重新同步约定到所有 AI 客户端 |
| `roll update` | 升级到最新版本 |
| `roll init` | 初始化项目：AGENTS.md + BACKLOG.md + docs/features/ |
| `roll status` | 显示同步状态、技能链接、检测到的 AI 工具 |
| `roll backlog` | 显示 BACKLOG.md 中待处理任务 |
| `roll loop <on\|off\|now\|status\|monitor>` | 🤖 管理自主执行器 |
| `roll brief` | 🤖 显示最新 owner 简报 |
| `roll peer` | 🤖 跨 Agent 代码评审 |
| `roll release` | 🤖 版本号 + tag + npm publish + GitHub Release |

---

## 贡献

欢迎 PR，请聚焦单一改动。大的改动先开 Issue 讨论。

1. `git clone https://github.com/seanyao/roll.git && cd roll && ./install.sh`
2. 修改并添加 bats 测试（`tests/`）
3. 推送前运行 `npm test`

---

## 致谢

- **[khazix-skills](https://github.com/KKKKhazix/khazix-skills)** by 数字生命卡兹克 — `$roll-research` 使用的 HV 分析框架，MIT 许可。
- **[superpowers](https://github.com/obra/superpowers)** by Jesse Vincent — 启发了 Roll 多个工作流模式的可组合技能库。

---

MIT 许可
