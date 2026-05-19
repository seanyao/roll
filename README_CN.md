```
 ██████╗  ██████╗ ██╗     ██╗     
 ██╔══██╗██╔═══██╗██║     ██║     
 ██████╔╝██║   ██║██║     ██║     
 ██╔══██╗██║   ██║██║     ██║     
 ██║  ██║╚██████╔╝███████╗███████╗
 ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚══════╝
```

> _Agents, roll out._

**[English README](README.md)**

[![官网](https://img.shields.io/badge/官网-seanyao.github.io%2Froll-blue)](https://seanyao.github.io/roll/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/@seanyao/roll.svg)](https://www.npmjs.com/package/@seanyao/roll)
[![CI](https://github.com/seanyao/roll/actions/workflows/ci.yml/badge.svg)](https://github.com/seanyao/roll/actions/workflows/ci.yml)

---

## Roll 是什么？

Roll 是面向软件团队的自主交付系统——AI agent 从 BACKLOG 中取出故事，按编码好的工程纪律执行，持续交付功能，让你专注于决定做什么，而不是怎么做。

**两个核心价值：**
1. **自主交付** — `roll loop on` 每小时执行 BACKLOG 待办；Dream（夜间代码健康巡检）自动提报维护任务；人类保留发布的唯一权力
2. **技能驱动执行** — 20+ 个技能将 TDD、TCR、INVEST 实践编码为可靠、可复现的工作流，任何 agent 都能遵循

_支持 Claude、Cursor、Codex，或你自己的 agent。_

## 2.0 新特性（2026-05）

Roll 2.0 引入**过程/产品分离**架构，让开源项目结构更清晰：

- **`.roll/` 目录约定** — 所有过程产物（backlog、features、briefs、dream 日志）从根级搬入 `.roll/`；用户文档 `guide/` 和 `site/` 上移到根级。旧 `docs/` 目录消失。
- **`roll migrate`** — 老项目一键迁移到新结构。`git mv` 保留历史，单原子 commit，三态幂等。
- **`$roll-onboard`** — 遗留项目交互式接入技能。AI 读完代码 ≤ 3 分钟回答 9 个问题、产出 plan；`roll init --apply` 落盘。
- **三种接入模式** — `seed`（新项目）、`graft`（遗留项目零侵入）、`replant`（遗留项目清账重建）。详见 [guide/zh/patterns/](guide/zh/patterns/)。

## 演进

Roll 不是从框架开始的，它从一个问题开始：*如果 AI 不只是写代码，而是真的把它交付出去，会怎样？*

最早的版本只是把工程约定推送给你正在用的 AI 工具。后来扩展到多 agent——Kimi、DeepSeek、Codex、Trae 各自有偏好的技能和模型；`roll-peer` 让一个 AI 在代码合入前质疑另一个 AI 的决策。

真正的转折是 `roll loop` 上线：故事一个接一个自动执行，`roll-.dream` 每晚巡检后自己开修复待办，系统开始生成自己的工作队列。随后是建立信任——实时可见、worktree 隔离、CI + AI 双重门控，让你能放心地把它开着睡觉。

接下来的目标：AI 端到端全程交付，人掌舵。

---

## 快速开始（30 秒）

```bash
npm install -g @seanyao/roll
roll setup          # 把约定分发到所有 AI 客户端
cd my-project
roll init           # 创建 AGENTS.md + .roll/backlog.md + .roll/features/
roll loop on        # 可选：让 agent 无人值守工作
```

**环境要求：** bash 4+、Node.js 16+

---

## 接入路径

把 Roll 引入项目有三种方式。拿不准走哪条？直接运行 `roll init`——它会检测遗留代码并自动路由到 `$roll-onboard`。

| 路径 | 适用场景 | 起步方式 |
|------|----------|----------|
| **Seed（播种）** | 全新项目，从零开始 | `roll init`（上文"快速开始"路径） |
| **Graft（嫁接）** | 已有代码库，保留当前工作流不动 | `roll init` → AI 提示运行 `$roll-onboard` → ≤ 3 分钟回答 9 个问题 → `roll init --apply` |
| **Replant（重栽）** | 已有代码库，准备彻底对齐 Roll 约定 | 同 Graft，但在 onboard 时选择"clean rebuild"清账重建 |

详情：[seed](guide/zh/patterns/seed-pattern.md) · [graft](guide/zh/patterns/graft-pattern.md) · [replant](guide/zh/patterns/replant-pattern.md)

---

## 文档索引

| 主题 | English | 中文 |
|------|---------|------|
| 概述与架构 | [guide/en/overview.md](guide/en/overview.md) | [guide/zh/overview.md](guide/zh/overview.md) |
| 工程方法论 | [guide/en/methodology.md](guide/en/methodology.md) | [guide/zh/methodology.md](guide/zh/methodology.md) |
| Loop（自主执行器） | [guide/en/loop.md](guide/en/loop.md) | [guide/zh/loop.md](guide/zh/loop.md) |
| Dream（夜间健康巡检） | [guide/en/dream.md](guide/en/dream.md) | [guide/zh/dream.md](guide/zh/dream.md) |
| Peer（跨 Agent 评审） | [guide/en/peer.md](guide/en/peer.md) | [guide/zh/peer.md](guide/zh/peer.md) |
| 配置（环境变量） | [guide/en/configuration.md](guide/en/configuration.md) | [guide/zh/configuration.md](guide/zh/configuration.md) |
| 技能选择指南 | [guide/en/skills.md](guide/en/skills.md) | [guide/zh/skills.md](guide/zh/skills.md) |
| 常见问题（排障） | [guide/en/faq.md](guide/en/faq.md) | [guide/zh/faq.md](guide/zh/faq.md) |
| 接入模式 | [guide/en/patterns/](guide/en/patterns/) | [guide/zh/patterns/](guide/zh/patterns/) |
| 工程常识 | [practices/engineering-common-sense.md](guide/en/practices/engineering-common-sense.md) | — |

---

## 命令

| 命令 | 说明 |
|------|------|
| **Autonomy · 日常使用** | |
| `roll loop <on\|off\|now\|status\|monitor>` | 🤖 管理自主 BACKLOG 执行循环 |
| `roll brief` | 🤖 查看最新 owner 简报 |
| `roll backlog [block\|defer\|…]` | 查看和管理待处理任务 |
| `roll peer` | 🤖 跨 Agent 协商对审 |
| `roll alert` | 查看 / 清除 loop 告警 |
| **Project · 项目内** | |
| `roll init` | 初始化项目：AGENTS.md + .roll/backlog.md + .roll/features/ |
| `roll status` | 显示当前状态和漂移项 |
| `roll agent [use <name>]` | 切换当前项目使用的 agent（Claude / Cursor / Codex / Kimi / …） |
| `roll ci [--wait]` | 查看 / 等待当前 commit 的 CI 状态 |
| `roll release` | 🤖 执行发版脚本（仅人工） |
| `roll review-pr <number>` | 🤖 对指定 PR 做 AI 代码评审 |
| **Machine · 全局** | |
| `roll setup [-f]` | 首次安装或重新同步约定到所有 AI 客户端 |
| `roll update` | 升级到最新版本并重新同步 |
| `roll version` | 显示已安装的 roll 版本 |

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
