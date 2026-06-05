> **Roll v3——引擎已是 TypeScript（`packages/`，pnpm monorepo）；命令保持不变。**
> bash 实现作为 `bin/roll` 留在仓内：TS 层未接管命令的自动回落，也是 TS 套件对拍的 oracle。`skills/` 是 git submodule。v2 归档在 `v2` 分支（锚点 tag `v2-freeze-2026-06-04`）。

```
 ██████╗  ██████╗ ██╗     ██╗     
 ██╔══██╗██╔═══██╗██║     ██║     
 ██████╔╝██║   ██║██║     ██║     
 ██╔══██╗██║   ██║██║     ██║     
 ██║  ██║╚██████╔╝███████╗███████╗
 ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚══════╝
```

**[English README](README.md)**

[![官网](https://img.shields.io/badge/官网-seanyao.github.io%2Froll-blue)](https://seanyao.github.io/roll/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/@seanyao/roll.svg)](https://www.npmjs.com/package/@seanyao/roll)
[![CI](https://github.com/seanyao/roll/actions/workflows/ci.yml/badge.svg)](https://github.com/seanyao/roll/actions/workflows/ci.yml)

让 AI agent 自己从 backlog 取任务，走你既有的 git + CI 流程交付。支持 Claude、Cursor、Codex、Kimi 等。

## 安装

```bash
curl -fsSL https://seanyao.github.io/roll/install | bash
```

```bash
npm install -g @seanyao/roll
```

环境要求：Node.js ≥ 22（CLI 入口运行在 node 上）。内置回落引擎需要 bash 3.2+。

## 使用

```bash
cd your-project
roll init           # 在当前项目落地 Roll
roll loop on        # 可选：让 AI 自动跑 backlog
```

`roll init` 会识别老项目并在合适时引导到 `$roll-onboard`。

## 命令

| 命令 | 说明 |
|------|------|
| **Autonomy · 日常使用** | |
| `roll loop <on\|off\|now\|status\|eval\|runs\|story\|monitor>` | 管理自主 BACKLOG 执行循环 |
| `roll brief` | 查看最新 owner 简报 |
| `roll backlog [sync\|block\|defer\|lint\|…]` | 查看、管理、从 GitHub Issues 同步待处理任务 |
| `roll peer` | 跨 Agent 协商对审 |
| `roll alert` | 查看 / 清除 loop 告警 |
| **Project · 项目内** | |
| `roll init` | 在当前项目落地 Roll |
| `roll status` | 显示当前状态和漂移项 |
| `roll agent [use <name>]` | 切换当前项目使用的 agent |
| `roll ci [--wait]` | 查看 / 等待当前 commit 的 CI 状态 |
| `roll test [--where] [--reset]` | 运行测试套件（通过隔离适配器分发；未知类型显式报错） |
| `roll release` | 执行发版脚本（仅人工） |
| `roll review-pr <number>` | 对指定 PR 做 AI 代码评审 |
| **Machine · 全局** | |
| `roll setup [-f]` | 首次安装或重新同步约定到所有 AI 客户端 |
| `roll update` | 升级到最新版本并重新同步 |
| `roll version` | 显示已安装的 roll 版本 |

## 仓库结构

开发态是 pnpm monorepo，发布态是单一 npm 包。

```
packages/      TypeScript 引擎（pnpm workspaces）：spec · core · infra · cli · web
bin/roll       冻结的 bash v2 引擎 —— 自动回落 + diff-test oracle
lib/           运行时伴生（python/sh），loop 与回落路径在用
skills/        Git submodule → seanyao/roll-skills（agent 技能契约）
conventions/   roll setup 同步到各 AI 客户端的约定
template/      roll init 安装的项目脚手架
tests/         看护 bash 引擎的冻结 bats 套件（CI 非阻塞道）
```

发布为单一 npm 包 `@seanyao/roll`：`dist/`（esbuild 打平的 TS）+ `bin/` + `lib/` + `skills/` + `conventions/` + `template/`。

## 文档

| 主题 | English | 中文 |
|------|---------|------|
| 概述与架构 | [guide/en/overview.md](guide/en/overview.md) | [guide/zh/overview.md](guide/zh/overview.md) |
| 工程方法论 | [guide/en/methodology.md](guide/en/methodology.md) | [guide/zh/methodology.md](guide/zh/methodology.md) |
| 验收证据（`roll attest`） | [guide/en/acceptance-evidence.md](guide/en/acceptance-evidence.md) | [guide/zh/acceptance-evidence.md](guide/zh/acceptance-evidence.md) |
| 一致性与发版闸 | [guide/en/consistency.md](guide/en/consistency.md) | [guide/zh/consistency.md](guide/zh/consistency.md) |
| Loop（自主执行器） | [guide/en/loop.md](guide/en/loop.md) | [guide/zh/loop.md](guide/zh/loop.md) |
| Loop 数据布局（Phase 2.0） | [guide/en/loop-data-layout.md](guide/en/loop-data-layout.md) | [guide/zh/loop-data-layout.md](guide/zh/loop-data-layout.md) |
| Dream（夜间健康巡检） | [guide/en/dream.md](guide/en/dream.md) | [guide/zh/dream.md](guide/zh/dream.md) |
| Peer（跨 Agent 评审） | [guide/en/peer.md](guide/en/peer.md) | [guide/zh/peer.md](guide/zh/peer.md) |
| AI Agent 与复杂度路由 | [guide/en/ai-agents.md](guide/en/ai-agents.md) | [guide/zh/ai-agents.md](guide/zh/ai-agents.md) |
| 配置（环境变量） | [guide/en/configuration.md](guide/en/configuration.md) | [guide/zh/configuration.md](guide/zh/configuration.md) |
| 技能选择指南 | [guide/en/skills.md](guide/en/skills.md) | [guide/zh/skills.md](guide/zh/skills.md) |
| roll-doc（遗留文档自动化:四 phase + Phase 3b 深度读取） | [guide/en/roll-doc.md](guide/en/roll-doc.md) | [guide/zh/roll-doc.md](guide/zh/roll-doc.md) |
| 幻灯片（deck 生成器） | [guide/en/slides.md](guide/en/slides.md) | [guide/zh/slides.md](guide/zh/slides.md) |
| 幻灯片 —— 布局参考（Layouts） | [guide/en/slides.md#layouts](guide/en/slides.md#layouts) | [guide/zh/slides.md#layouts布局](guide/zh/slides.md#layouts%E5%B8%83%E5%B1%80) |
| 反馈（`roll feedback`） | [guide/en/feedback.md](guide/en/feedback.md) | [guide/zh/feedback.md](guide/zh/feedback.md) |
| Backlog GitHub 同步（`roll backlog sync`） | [guide/en/backlog-github-sync.md](guide/en/backlog-github-sync.md) | [guide/zh/backlog-github-sync.md](guide/zh/backlog-github-sync.md) |
| 跨机器同步 | [guide/en/loop.md#cross-machine-sync](guide/en/loop.md#cross-machine-sync) | [guide/zh/loop.md#跨机器同步](guide/zh/loop.md#%E8%B7%A8%E6%9C%BA%E5%99%A8%E5%90%8C%E6%AD%A5) |
| Cycle 结果评分（`roll loop eval`） | [guide/en/loop.md#cycle-result-eval](guide/en/loop.md#cycle-result-eval) | [guide/zh/loop.md#cycle-结果评分result-eval](guide/zh/loop.md#cycle-%E7%BB%93%E6%9E%9C%E8%AF%84%E5%88%86result-eval) |
| Cycle 退出摘要（`.command` 窗口复盘） | [guide/en/loop.md#cycle-exit-summary](guide/en/loop.md#cycle-exit-summary) | [guide/zh/loop.md#cycle-退出摘要cycle-exit-summary](guide/zh/loop.md#cycle-%E9%80%80%E5%87%BA%E6%91%98%E8%A6%81cycle-exit-summary) |
| Pricing（成本可见性） | [guide/en/pricing.md](guide/en/pricing.md) | [guide/zh/pricing.md](guide/zh/pricing.md) |
| 常见问题（排障） | [guide/en/faq.md](guide/en/faq.md) | [guide/zh/faq.md](guide/zh/faq.md) |
| 接入模式 | [guide/en/patterns/](guide/en/patterns/) | [guide/zh/patterns/](guide/zh/patterns/) |

## 贡献

详见 [CONTRIBUTING.md](CONTRIBUTING.md)，里面有开发流程、测试方法和 PR 约定。

## 安全

详见 [SECURITY.md](SECURITY.md)。漏洞请私下汇报，不要在公开 Issue 里贴。

## License

[MIT](LICENSE)
