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

环境要求：Node.js ≥ 22。Roll 是自包含的 TypeScript CLI —— 除 node 外无其它运行时引擎。

## 使用

```bash
cd your-project
roll init           # 在当前项目落地 Roll
roll loop on        # 可选：让 AI 自动跑 backlog
```

`roll init` 会识别老项目并在合适时引导到 `$roll-onboard`。
第一次跑建议从[快速上手](guide/zh/getting-started.md)开始。

## 命令

| 命令 | 说明 |
|------|------|
| **Autonomy · 日常使用** | |
| `roll loop <on\|off\|now\|status\|eval\|runs\|story\|…>` | 管理自主 BACKLOG 执行循环 |
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
lib/           运行时伴生（价格快照、i18n 文案目录）
skills/        Git submodule → seanyao/roll-skills（agent 技能契约）
conventions/   roll setup 同步到各 AI 客户端的约定
template/      roll init 安装的项目脚手架
```

构建与测试：`pnpm install && pnpm -r test`。

发布为单一 npm 包 `@seanyao/roll`：`dist/`（CLI 经 esbuild 打平为单个自包含 ESM）+ `lib/` + `skills/` + `conventions/` + `template/`。

## 文档

| | |
|---|---|
| **从这里开始** | [快速上手](guide/zh/getting-started.md) · [概述与架构](guide/zh/overview.md) · [工程方法论](guide/zh/methodology.md) |
| **日常使用** | [Loop（自主执行器）](guide/zh/loop.md) · [配置](guide/zh/configuration.md) · [价格与成本](guide/zh/pricing.md) · [FAQ](guide/zh/faq.md) |
| **质量机制** | [验收证据（`roll attest`）](guide/zh/acceptance-evidence.md) · [证据生命周期](guide/zh/acceptance-evidence.md#三段式生命周期) · [一致性与发版闸](guide/zh/consistency.md) · [测试隔离](guide/zh/test-isolation.md) |
| **底层设计** | [架构：分层·领域·不变量](docs/architecture.md) · [验证体系](docs/verification.md) · [理念宣言](docs/manifesto.md) |

完整指南目录：[guide/zh/](guide/zh/) —— agent 路由、peer 评审、feedback、backlog 同步、接入模式等。

## 贡献

详见 [CONTRIBUTING.md](CONTRIBUTING.md)，里面有开发流程、测试方法和 PR 约定。

## 安全

详见 [SECURITY.md](SECURITY.md)。漏洞请私下汇报，不要在公开 Issue 里贴。

## License

[MIT](LICENSE)
