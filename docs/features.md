# Roll — Features

> 产品视角的功能索引。Story 是构建单位、Changelog 是发布单位，
> 这里描述的是 roll 当前**作为产品**所提供的能力。
>
> 每次发版时由 `scripts/release.sh` 自动重写本文件，使之与 BACKLOG 和
> `docs/features/` 的真实状态保持一致。

---

## ✨ Core Highlights

- **Autonomous BACKLOG Executor** — Picks up BACKLOG tasks on schedule, runs Claude in isolated worktrees, auto-merges PRs after CI passes, and self-heals interrupted runs
  按调度自动认领 BACKLOG 任务，在隔离 worktree 里跑 Claude，CI 绿后自动合入，中断 / 孤儿状态自愈
- **Cross-Agent Peer Review** — Critical decisions go through multi-AI negotiation (AGREE / REFINE / OBJECT / ESCALATE) with automatic capability-map fallback on failure
  关键决策多 AI 协商；失败按 capability map 自动 fallback
- **Universal AI Tool Integration** — Claude / Kimi / DeepSeek / Codex / Gemini / Trae / opencode / Pi / Cursor all share the same convention sync and skill links
  主流 AI 工具统一 convention sync 与 skill 链接
- **TCR-First Engineering Discipline** — Test && Commit || Revert; pre-commit proof-of-pass physically blocks untested commits
  proof-of-pass pre-commit hook 物理拦截未测试提交
- **Self-Healing Documentation** — dream nightly scans for doc freshness; loop auto-fills gaps
  dream 夜检文档新鲜度，loop 自动补缺口

---

## Features by Epic

### CLI Simplification
- [cli-simplification](docs/features/cli-simplification.md) — Three-step `roll init`, auto-detects project type, no more interactive type prompts
  三步极简 `roll init`，按项目类型推断 convention，不再问类型

### Skill Ecosystem
- [new-skills](docs/features/new-skills.md) — roll-idea / roll-notes / roll-.clarify / roll-doctor / roll-peer / roll-doc and other core skills
  roll-idea / roll-notes / roll-.clarify / roll-doctor / roll-peer / roll-doc 等核心 skill 集

### Distribution
- [npm-distribution](docs/features/npm-distribution.md) — npm package publish, `roll update`, and version nudge
  npm 包发布、`roll update`、版本提示

### IDE Integration
- [trae-support](docs/features/trae-support.md) — Trae IDE detection and project_rules.md sync
  Trae IDE 检测 + project_rules.md 同步
- [opencode-support](docs/features/opencode-support.md) — opencode detection and AGENTS.md sync
  opencode 检测 + AGENTS.md 同步
- ai-tools — DeepSeek TUI / Pi (pi-coding-agent) / Codex CLI support
  DeepSeek TUI / Pi / Codex CLI 接入支持

### QA & Testing
- [e2e-lifecycle](docs/features/e2e-lifecycle.md) — E2E deposit on Story completion, CI E2E gating, failure diagnosis
  Story 完成后 E2E Deposit，CI E2E gating，失败诊断

### Diagnostics
- [roll-debug](docs/features/roll-debug.md) — Black Box injection diagnostics and auto-fix
  BB 注入诊断 + auto-fix

### Release Management
- [roll-release](docs/features/roll-release.md) — `scripts/release.sh` one-command release (human-triggered, npm 2FA through real terminal), auto version bump / VERSION write / CHANGELOG sync / release_notes / features.md
  `scripts/release.sh` 一键发版（人触发，npm 2FA 走真终端），自动算版本号 / 写 VERSION / 同步 CHANGELOG / release_notes / features.md

### Engineering Infrastructure
- skill-harness — Skill permission declarations, Identity convention, Co-Authored-By attribution, Scope Gate
  技能权限声明、Identity 约定、Co-Authored-By 归属、Scope Gate
- [github-actions](docs/features/github-actions.md) — Claude Bot workflow templates
  Claude Bot 工作流模板
- [pr-lifecycle](docs/features/pr-lifecycle.md) — Agent-agnostic PR review, loop PR inbox, optional sub-second webhook
  agent-agnostic PR 评审、loop PR inbox、可选秒级 webhook
- [convention-management](docs/features/convention-management.md) — Goal-Driven Execution, Where to Look navigation, roll-doc fills AGENTS.md for legacy projects
  Goal-Driven Execution、Where to Look 导航、roll-doc 为存量项目补 AGENTS.md
- [agent-compliance](docs/features/agent-compliance.md) — proof-of-pass + pre-commit hook physically blocks untested commits
  proof-of-pass + pre-commit hook 物理拦截未测试提交

### Changelog
- [changelog-integration](docs/features/changelog-integration.md) — AI-generated changelog with style gating and self-review rewrite
  AI 生成 changelog，风格守门，自审重写

### Autonomous Evolution
- [autonomous-evolution](docs/features/autonomous-evolution.md) — roll-loop autonomous BACKLOG executor: scheduling, worktree isolation, auto PR merge, orphan recovery, heartbeat
  roll-loop 自治 BACKLOG 执行器：调度、worktree 隔离、PR 自动合并、孤儿恢复、心跳

### Documentation
- [documentation](docs/features/documentation.md) — Bilingual layered docs (guide / domain / features), dream scans for coverage
  双语分层文档（guide / domain / features），dream 巡检文档覆盖度

### Backlog 生命周期管理
- [alert-lifecycle](docs/features/alert-lifecycle.md) — `roll alert` command, ALERT ack / resolve, linked to brief / status
  `roll alert` 命令，ALERT ack / resolve，与 brief / status 联动

### 自主循环可观测性
- [notifications](docs/features/notifications.md) — Autonomous loop observability with loop status push
  自主循环可观测性，loop 状态推送
- [cycle-event-stream](docs/features/cycle-event-stream.md) — runner / SKILL emit structured events; `roll loop attach/monitor` visualizes each cycle like a CI pipeline
  runner / SKILL 发结构化事件，`roll loop attach/monitor` 像 CI pipeline 一样可视化每一轮

### Marketing & Site
- [landing-page](docs/features/landing-page.md) — Above-the-fold animation tells the three-layer autonomous product story in under 6 seconds
  首屏动画 6 秒内讲清三层自治产品故事

---

## 维护说明

- 本文件由 `scripts/release.sh` 在发版时通过 `roll-.changelog` skill 整体重写
- 手动编辑会在下次发版被覆盖
- 新增 Feature 时无需手动改本文件，发版会自动同步
- 缺 deep doc 的 Feature 列出但不加链接，由 dream / 文档巡检反向触发补 doc
