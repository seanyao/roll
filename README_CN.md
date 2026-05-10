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

Roll 解决一个具体问题：同一团队的开发者使用不同的 AI 客户端（Claude Code、Cursor、Gemini CLI、Kimi、Codex、DeepSeek、Pi、OpenCode、Trae），每个 agent 接收到的工程约束完全不同。一个人用 Claude 写的代码跑了测试，另一个人用 Cursor 写的代码直接绕过了同一套测试——不是 AI 能力差异，而是它们拿到的约束不一样。

Roll 通过三个机制解决这个问题：

1. **Convention CLI** — 统一的工程约定源，一键分发到本机所有 AI 客户端目录（`~/.claude/`、`~/.cursor/`、`~/.gemini/`、`~/.kimi/`、`~/.codex/`、`~/.deepseek/` 等）
2. **Skill System** — 20 个经过验证的工程实践（TDD、TCR、SRE、INVEST、DDD）编码为任何 AI agent 都能遵循的标准化指令
3. **Autonomous Evolution** — 可选的自主演化层：`roll-loop` 每小时执行 BACKLOG 待办，`roll-.dream` 每晚扫描代码健康，`roll-brief` 每天早晨向人类简报。人类保留发布的唯一权力。

结果：任何 agent、任何客户端、相同约束——以及可选的持续自主交付。

---

## 从这里开始

在了解命令和技能之前，先读工程方法论——它解释了三层闭环架构（调研 → 实现 → 观测）、自主演化层、每个技能存在的原因，以及它们如何组成完整的交付体系。

**[English](docs/methodology-en.md)** · **[中文](docs/methodology.md)**

---

## 安装

```bash
npm install -g @seanyao/roll
roll setup
```

**环境要求：** bash 4+、Node.js 16+

升级：

```bash
roll update
```

> **贡献者**（开发 roll 本身）：`git clone https://github.com/seanyao/roll.git && cd roll && ./install.sh`

---

## 约定管理

为 Claude Code / Gemini CLI / Cursor / Kimi / Codex / DeepSeek / Pi / OpenCode / Trae 统一行为约定——一个来源，全部同步。

### 命令

命令分两类：**bash 命令** 执行纯 shell 逻辑；**agent 命令**（标记 🤖）会启动完整的 AI agent 会话来执行 SKILL.md。

| 命令 | 说明 |
|------|------|
| `roll setup [-f]` | 首次安装或重新同步（加 `--force` 覆盖本地缓存） |
| `roll update` | 一键升级：`npm install -g @seanyao/roll@latest` + 重新同步 |
| `roll init` | 初始化项目：创建 `AGENTS.md` + `BACKLOG.md` + `docs/features/` |
| `roll status` | 显示同步状态、技能链接、检测到的 AI 工具 |
| `roll backlog` | 显示 BACKLOG.md 中所有待处理任务 |
| `roll agent [use <name>\|list]` | 切换项目 agent——影响所有 🤖 命令 |
| `roll loop <on\|off\|now\|status\|monitor\|resume\|reset>` | 🤖 管理自主 BACKLOG 执行器（三服务：loop/dream/brief） |
| `roll brief` | 🤖 展示最新简报（超过 24h 自动重新生成） |
| `roll peer` | 🤖 跨 Agent 代码评审与协商 |
| `roll release` | 🤖 同步日志 + 版本号 + tag + npm publish + GitHub Release |
| `roll`_（无参数，在项目目录）_ | Dashboard：loop 状态、待办数量、最新简报摘要 |

### 典型流程

```bash
# 1. 安装到本机
npm install -g @seanyao/roll
roll setup

# 2. 初始化项目（在项目根目录执行）
cd my-app
roll init

# 3. 升级到新版
roll update

# 4. 启用自主演化（可选）
roll loop on                  # 三服务：loop（每小时）+ dream（每晚）+ brief（每天）
roll loop monitor             # 实时监控面板
roll brief                    # 查看最新简报

# 5. 按项目切换 agent
roll agent use kimi           # 本项目所有 🤖 命令改用 kimi
```

### 约定分层

```
全局  ~/.claude/CLAUDE.md         ← 用户自有；roll setup 追加 @roll.md
      ~/.claude/roll.md            ← Roll 约定（由 roll setup 写入）
  ↓  自动叠加
项目  <project>/AGENTS.md         ← roll init 生成
      <project>/.claude/CLAUDE.md
```

全局约定仅追加，永不覆盖已有文件。项目约定通过 `roll init` 按项目注入。

### 目录结构

```
~/.roll/
├── config.yaml                  # 同步路径配置
└── conventions/
    ├── global/                  # 唯一真相源
    │   ├── AGENTS.md
    │   ├── CLAUDE.md / GEMINI.md / .cursor-rules
    └── templates/               # 项目类型模板
        ├── fullstack/
        ├── frontend-only/
        ├── backend-service/
        └── cli/
```

---

## 技能体系

技能是将经过验证的工程实践编码为 AI agent 可可靠执行的指令。技能存放在 `~/.roll/skills/`，通过 `roll setup` 软链接到各 AI 客户端的技能目录。

### 工作流

```
调研 → 设计 → 实现 → 检查 → 修复 → (循环)
```

### 速查

| 场景 | 技能 |
|------|------|
| 方向不确定，需要想清楚 | `$roll-design "topic"` |
| 执行已规划的 Story | `$roll-build US-001` |
| 自由需求 | `$roll-build "给后台加搜索"` |
| 修 Bug | `$roll-fix FIX-001` |
| 快速记录想法或 Bug | `$roll-idea "description"` |
| 高风险逻辑（支付、鉴权、状态机） | `$roll-spar "feature"` |
| 深度调研（产品/公司/技术） | `$roll-research "subject"` |
| 跨 Agent 代码评审 | `$roll-peer` |
| 巡检生产回归 | `$roll-sentinel patrol` |
| 调试崩溃页面 | `$roll-debug <URL>` |
| 记录开发日志 | `$roll-notes "刚修好那个恶心的 bug"` |
| 让 agent 通宵工作 | `roll loop on` |

### 完整技能列表

**Loop A — 调研与设计**

| 技能 | 说明 |
|------|------|
| `$roll-research` | HV 分析（横纵分析）深度调研框架，输出 PDF 报告 |
| `$roll-design` | 多轮讨论 → [peer review] → DDD 建模 → 方案设计 → [peer review] → 写 Story 到 BACKLOG |

**Loop B — 实现与迭代**

| 技能 | 说明 |
|------|------|
| `$roll-build` | 万能入口：Story ID、Fix ID 或一句话需求。TCR 驱动微步提交 |
| `$roll-spar` | 对抗式 TDD — Attacker 写测试，Defender 写代码 |
| `$roll-fix` | 从 BACKLOG 执行 Bug 修复 / 热修复 |
| `$roll-release` | 一键发布：自动版本号（YYYY.MMDD.N）→ tag → npm publish → GitHub Release |
| `$roll-peer` | 跨 Agent 代码评审 — Claude / Kimi / DeepSeek / Codex 双边协商 |

**Loop C — 可观测性与维护**

| 技能 | 说明 |
|------|------|
| `$roll-sentinel` | 随机化生产巡检，自适应热点权重 |
| `$roll-debug` | 基于 Playwright 的现场取证 + 根因分析 |

**自主演化（可选，通过 `roll loop on` 启用）**

| 技能 | 说明 |
|------|------|
| `$roll-loop` | 每小时 BACKLOG 执行器 — 按类型路由 US/FIX/REFACTOR 到对应技能，强制 TCR |
| `$roll-.dream` | 每晚代码健康巡检 — 死代码、架构漂移 → REFACTOR 条目 |
| `$roll-brief` | Owner 面简报 — 已完成、待处理、发布就绪建议 |

**被动支撑**

| 技能 | 说明 |
|------|------|
| `$roll-.review` | 提交前多维度自审 |
| `$roll-.qa` | 测试金字塔与覆盖率标准参考 |
| `$roll-.changelog` | 从 BACKLOG 自动生成 CHANGELOG |
| `$roll-.echo` | 被动意图澄清 |
| `$roll-.clarify` | 模糊 build 请求的被动范围澄清 |
| `$roll-idea` | 快速将 Bug 或想法写入 BACKLOG.md |
| `$roll-notes` | 项目日记 — 追加开发片段到 `notes/YYYY-MM-DD.md` |
| `$roll-doctor` | 一键开发工具链健康检查 |

---

## 自主演化

默认关闭。执行 `roll loop on` 启用，让 agent 在无人值守的情况下继续工作。

```
┌─────────────────────────────────────────────────────────┐
│  基础层（始终激活）                                      │
│  $roll-design → $roll-build → $roll-fix → $roll-spar   │
│  人类驱动每一个动作                                      │
├─────────────────────────────────────────────────────────┤
│  自主层（可选：roll loop on）                            │
│  roll-loop   — 每小时 BACKLOG 执行器                    │
│  roll-.dream — 每晚代码健康巡检                          │
│  roll-brief  — 每日晨报 + 发布就绪建议                   │
│  人类审阅简报；保留发布的唯一权力                         │
└─────────────────────────────────────────────────────────┘
```

三个服务通过 macOS launchd（Linux: crontab）调度，统一管理：

- **roll-loop** 每小时运行，从 BACKLOG 拾取 `📋 Todo` 条目，按类型路由（`US-XXX → $roll-build`、`FIX-XXX → $roll-fix`、`REFACTOR-XXX → $roll-build`），并强制 TCR 纪律——如果 Story 完成时没有 `tcr:` 微提交，回退为 Todo 并写 ALERT。
- **roll-.dream** 每晚运行，扫描死代码、架构漂移和重构机会，输出 `REFACTOR-XXX` 条目到 BACKLOG。
- **roll-brief** 每天早晨运行（或通过 `roll brief` 按需触发），生成包含发布就绪建议的 owner 面简报。

自主层**永远不会**调用 `roll-release`。生产发布始终由人类决定。

使用 `roll loop monitor` 查看类似 `top` 的实时面板：三服务 launchd 状态、当前执行状态、待办队列、告警和实时日志。

按项目配置 agent：`roll agent use <name>` 写入 `.roll.yaml`，每个项目可以使用不同的 AI 客户端（claude / kimi / deepseek / pi / codex / opencode）。查找顺序：`.roll.yaml` → `~/.roll/config.yaml` → `claude`（默认）。

---

## 项目结构（`roll init`）

```
my-project/
├── AGENTS.md            # 项目约束与技能路由
├── BACKLOG.md           # Story 与 Bug 索引
├── docs/features/       # Story 详情与设计文档
└── ... 你的项目文件
```

---

## 贡献

欢迎贡献。Roll 是一个小而专注的工具——PR 请聚焦单一改动。

1. Fork 仓库并从 `main` 创建分支
2. 修改并在适用处添加测试（`tests/`）
3. 确保 `./bin/roll --help` 输出正确
4. 提交带有清晰描述的 Pull Request

大的改动请先开 Issue 讨论方案。

---

## 致谢

Roll 受益于开源社区的想法和启发：

- **[khazix-skills](https://github.com/KKKKhazix/khazix-skills)** by 数字生命卡兹克 — `$roll-research` 使用的 HV 分析（横纵分析）深度调研框架源自此项目，遵循 MIT 许可。Copyright (c) 2026 数字生命卡兹克。
- **[superpowers](https://github.com/obra/superpowers)** by Jesse Vincent — 一个面向 AI 编程 agent 的可组合技能库，Roll 的多个工作流模式受其启发。

---

## 许可

MIT
