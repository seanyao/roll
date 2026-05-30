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
npm install -g @seanyao/roll
roll setup
```

环境要求：bash 3.2+、Node.js 16+。

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
| `roll loop <on\|off\|now\|status\|runs\|story\|monitor>` | 管理自主 BACKLOG 执行循环 |
| `roll brief` | 查看最新 owner 简报 |
| `roll backlog [block\|defer\|lint\|…]` | 查看和管理待处理任务 |
| `roll peer` | 跨 Agent 协商对审 |
| `roll alert` | 查看 / 清除 loop 告警 |
| **Project · 项目内** | |
| `roll init` | 在当前项目落地 Roll |
| `roll status` | 显示当前状态和漂移项 |
| `roll agent [use <name>]` | 切换当前项目使用的 agent |
| `roll ci [--wait]` | 查看 / 等待当前 commit 的 CI 状态 |
| `roll test [--where] [--reset]` | 运行测试套件（通过隔离适配器分发；Apple Silicon 上使用 Tart VM） |
| `roll release` | 执行发版脚本（仅人工） |
| `roll review-pr <number>` | 对指定 PR 做 AI 代码评审 |
| **Machine · 全局** | |
| `roll setup [-f]` | 首次安装或重新同步约定到所有 AI 客户端 |
| `roll update` | 升级到最新版本并重新同步 |
| `roll version` | 显示已安装的 roll 版本 |

## 文档

| 主题 | English | 中文 |
|------|---------|------|
| 概述与架构 | [guide/en/overview.md](guide/en/overview.md) | [guide/zh/overview.md](guide/zh/overview.md) |
| 工程方法论 | [guide/en/methodology.md](guide/en/methodology.md) | [guide/zh/methodology.md](guide/zh/methodology.md) |
| Loop（自主执行器） | [guide/en/loop.md](guide/en/loop.md) | [guide/zh/loop.md](guide/zh/loop.md) |
| Dream（夜间健康巡检） | [guide/en/dream.md](guide/en/dream.md) | [guide/zh/dream.md](guide/zh/dream.md) |
| Peer（跨 Agent 评审） | [guide/en/peer.md](guide/en/peer.md) | [guide/zh/peer.md](guide/zh/peer.md) |
| AI Agent 与复杂度路由 | [guide/en/ai-agents.md](guide/en/ai-agents.md) | [guide/zh/ai-agents.md](guide/zh/ai-agents.md) |
| 配置（环境变量） | [guide/en/configuration.md](guide/en/configuration.md) | [guide/zh/configuration.md](guide/zh/configuration.md) |
| 技能选择指南 | [guide/en/skills.md](guide/en/skills.md) | [guide/zh/skills.md](guide/zh/skills.md) |
| 幻灯片（deck 生成器） | [guide/en/slides.md](guide/en/slides.md) | [guide/zh/slides.md](guide/zh/slides.md) |
| 反馈（`roll feedback`） | [guide/en/feedback.md](guide/en/feedback.md) | [guide/zh/feedback.md](guide/zh/feedback.md) |
| 跨机器同步 | [guide/en/loop.md#cross-machine-sync](guide/en/loop.md#cross-machine-sync) | [guide/zh/loop.md#跨机器同步](guide/zh/loop.md#%E8%B7%A8%E6%9C%BA%E5%99%A8%E5%90%8C%E6%AD%A5) |
| Cycle 结果评分（`roll loop eval`） | [guide/en/loop.md#cycle-result-eval](guide/en/loop.md#cycle-result-eval) | [guide/zh/loop.md#cycle-结果评分result-eval](guide/zh/loop.md#cycle-%E7%BB%93%E6%9E%9C%E8%AF%84%E5%88%86result-eval) |
| Pricing（成本可见性） | [guide/en/pricing.md](guide/en/pricing.md) | [guide/zh/pricing.md](guide/zh/pricing.md) |
| 常见问题（排障） | [guide/en/faq.md](guide/en/faq.md) | [guide/zh/faq.md](guide/zh/faq.md) |
| 接入模式 | [guide/en/patterns/](guide/en/patterns/) | [guide/zh/patterns/](guide/zh/patterns/) |

## 贡献

详见 [CONTRIBUTING.md](CONTRIBUTING.md)，里面有开发流程、测试方法和 PR 约定。

## 安全

详见 [SECURITY.md](SECURITY.md)。漏洞请私下汇报，不要在公开 Issue 里贴。

## 致谢

- **[khazix-skills](https://github.com/KKKKhazix/khazix-skills)** by 数字生命卡兹克 — `$roll-research` 使用的 HV 分析框架，MIT 许可。
- **[superpowers](https://github.com/obra/superpowers)** by Jesse Vincent — 启发了 Roll 多个工作流模式的可组合技能库。

## License

[MIT](LICENSE)
