# Roll — Features

> 产品视角的功能索引。Story 是构建单位、Changelog 是发布单位，
> 这里描述的是 roll 当前**作为产品**所提供的能力。
>
> 每次发版时由 `scripts/release.sh` 自动重写本文件，使之与 BACKLOG 和
> `docs/features/` 的真实状态保持一致。

---

## ✨ Core Highlights

- **Autonomous BACKLOG Executor** — 按调度自动认领 BACKLOG 任务，在隔离 worktree 里跑 Claude，CI 绿后自动合入，中断 / 孤儿状态自愈
- **Cross-Agent Peer Review** — 关键决策走多 AI 协商（AGREE / REFINE / OBJECT / ESCALATE），失败按 capability map 自动 fallback
- **Universal AI Tool Integration** — Claude / Kimi / DeepSeek / Codex / Gemini / Trae / opencode / Pi / Cursor 主流 AI 工具统一 convention sync 与 skill 链接
- **TCR-First Engineering Discipline** — Test && Commit || Revert；proof-of-pass pre-commit hook 物理拦截未测试提交
- **Cycle Event Stream** — runner 与 skill 发结构化事件，每一轮自治循环像 CI pipeline 一样可回放

---

## Features by Epic

### CLI 极简化
- [cli-simplification](features/cli-simplification.md) — 三步极简 `roll init`，按项目类型推断 convention，不再问类型

### Skill 生态
- [new-skills](features/new-skills.md) — roll-idea / roll-notes / roll-.clarify / roll-doctor / roll-peer / roll-doc 等核心 skill 集

### 分发
- [npm-distribution](features/npm-distribution.md) — npm 包发布、`roll update`、版本提示

### IDE 接入
- [trae-support](features/trae-support.md) — Trae IDE 检测 + project_rules.md 同步
- [opencode-support](features/opencode-support.md) — opencode 检测 + AGENTS.md 同步
- ai-tools — DeepSeek TUI / Pi（pi-coding-agent）/ Codex CLI 接入支持

### QA 与测试
- [e2e-lifecycle](features/e2e-lifecycle.md) — Story 完成后 E2E Deposit，CI E2E gating，失败诊断

### 诊断
- [roll-debug](features/roll-debug.md) — Black Box 注入诊断 + auto-fix

### 发版
- [roll-release](features/roll-release.md) — `scripts/release.sh` 一键发版（人触发，npm 2FA 走真终端），自动算版本号 / 写 VERSION / 同步 CHANGELOG / release_notes / features.md

### 工程基础
- skill-harness — 技能权限声明、Identity 约定、Co-Authored-By 归属、Scope Gate
- [github-actions](features/github-actions.md) — Claude Bot 工作流模板
- [pr-lifecycle](features/pr-lifecycle.md) — agent-agnostic PR 评审、loop PR inbox、可选秒级 webhook
- [convention-management](features/convention-management.md) — Goal-Driven Execution、Where to Look 导航、roll-doc 为存量项目补 AGENTS.md
- [agent-compliance](features/agent-compliance.md) — proof-of-pass + pre-commit hook 物理拦截未测试提交

### Changelog
- [changelog-integration](features/changelog-integration.md) — AI 生成 changelog，风格守门，自审重写

### 自治演化
- [autonomous-evolution](features/autonomous-evolution.md) — roll-loop 自治 BACKLOG 执行器：调度、worktree 隔离、PR 自动合并、孤儿恢复、心跳

### 文档
- [documentation](features/documentation.md) — 双语分层文档（guide / domain / features），dream 巡检文档覆盖度

### Backlog 生命周期
- [alert-lifecycle](features/alert-lifecycle.md) — `roll alert` 命令，ALERT ack / resolve，与 brief / status 联动

### 自治循环可观测性
- [notifications](features/notifications.md) — 自治循环可观测性，loop 状态推送
- [cycle-event-stream](features/cycle-event-stream.md) — runner / SKILL 发结构化事件，`roll loop attach/monitor` 像 CI pipeline 一样可视化每一轮

### CLI 视觉系统 *(规划中)*
- [cli-redesign](features/cli-redesign.md) — 整个 roll CLI 输出统一为同一套终端语言（语义色、字形、EN/ZH 双行、三段式 IA），从 `roll loop status` 开始逐步铺到 home / status / backlog / brief / setup / init / peer / --help

### 营销与官网
- [landing-page](features/landing-page.md) — 首屏动画 6 秒内讲清三层自治产品故事

---

## 维护说明

- 本文件由 `scripts/release.sh` 在发版时通过 `roll-.changelog` skill 整体重写
- 手动编辑会在下次发版被覆盖
- 新增 Feature 时无需手动改本文件，发版会自动同步
- 缺 deep doc 的 Feature 列出但不加链接，由 dream / 文档巡检反向触发补 doc
