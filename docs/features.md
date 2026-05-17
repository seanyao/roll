# Roll — Features

> Product-view feature index. Stories are the build unit, the changelog is
> the release unit; this file describes what roll currently offers **as a
> product**.
>
> Rewritten by `scripts/release.sh` on every release to stay in sync with
> BACKLOG and `docs/features/`.
>
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
- **Cycle Event Stream** — runner and skills emit structured events so each autonomous loop cycle can be replayed like a CI pipeline
  runner 与 skill 发结构化事件，每一轮自主循环像 CI pipeline 一样可回放

---

## Features by Epic

### CLI Simplification
- [cli-simplification](features/cli-simplification.md) — Three-step `roll init`, auto-detects project type, no more interactive type prompts
  三步极简 `roll init`，按项目类型推断 convention，不再问类型

### Skill Ecosystem
- [new-skills](features/new-skills.md) — roll-idea / roll-notes / roll-.clarify / roll-doctor / roll-peer / roll-doc and other core skills
  roll-idea / roll-notes / roll-.clarify / roll-doctor / roll-peer / roll-doc 等核心 skill 集

### Distribution
- [npm-distribution](features/npm-distribution.md) — npm package publish, `roll update`, and version nudge
  npm 包发布、`roll update`、版本提示

### IDE Integration
- [trae-support](features/trae-support.md) — Trae IDE detection and project_rules.md sync
  Trae IDE 检测 + project_rules.md 同步
- [opencode-support](features/opencode-support.md) — opencode detection and AGENTS.md sync
  opencode 检测 + AGENTS.md 同步
- ai-tools — DeepSeek TUI / Pi (pi-coding-agent) / Codex CLI support
  DeepSeek TUI / Pi / Codex CLI 接入支持

### QA & Testing
- [e2e-lifecycle](features/e2e-lifecycle.md) — E2E deposit on Story completion, CI E2E gating, failure diagnosis
  Story 完成后 E2E Deposit，CI E2E gating，失败诊断

### Diagnostics
- [roll-debug](features/roll-debug.md) — Black Box injection diagnostics and auto-fix
  BB 注入诊断 + auto-fix

### Release Management
- [roll-release](features/roll-release.md) — `scripts/release.sh` one-command release (human-triggered, npm 2FA through real terminal), auto version bump / VERSION write / CHANGELOG sync / release_notes / features.md
  `scripts/release.sh` 一键发版（人触发，npm 2FA 走真终端），自动算版本号 / 写 VERSION / 同步 CHANGELOG / release_notes / features.md

### Engineering Infrastructure
- skill-harness — Skill permission declarations, Identity convention, Co-Authored-By attribution, Scope Gate
  技能权限声明、Identity 约定、Co-Authored-By 归属、Scope Gate
- [github-actions](features/github-actions.md) — Claude Bot workflow templates
  Claude Bot 工作流模板
- [pr-lifecycle](features/pr-lifecycle.md) — Agent-agnostic PR review, loop PR inbox, optional sub-second webhook
  agent-agnostic PR 评审、loop PR inbox、可选秒级 webhook
- [convention-management](features/convention-management.md) — Goal-Driven Execution, Where to Look navigation, roll-doc fills AGENTS.md for legacy projects
  Goal-Driven Execution、Where to Look 导航、roll-doc 为存量项目补 AGENTS.md
- [agent-compliance](features/agent-compliance.md) — proof-of-pass + pre-commit hook physically blocks untested commits
  proof-of-pass + pre-commit hook 物理拦截未测试提交

### Changelog
- [changelog-integration](features/changelog-integration.md) — AI-generated changelog with style gating and self-review rewrite
  AI 生成 changelog，风格守门，自审重写

### Autonomous Evolution
- [autonomous-evolution](features/autonomous-evolution.md) — roll-loop autonomous BACKLOG executor: scheduling, worktree isolation, auto PR merge, orphan recovery, heartbeat
  roll-loop 自治 BACKLOG 执行器：调度、worktree 隔离、PR 自动合并、孤儿恢复、心跳

### Documentation
- [documentation](features/documentation.md) — Bilingual layered docs (guide / domain / features), dream scans for coverage
  双语分层文档（guide / domain / features），dream 巡检文档覆盖度

### Backlog Lifecycle
- [alert-lifecycle](features/alert-lifecycle.md) — `roll alert` command, ALERT ack / resolve, linked to brief / status
  `roll alert` 命令，ALERT ack / resolve，与 brief / status 联动

### Autonomous Loop Observability
- [notifications](features/notifications.md) — Autonomous loop observability with loop status push
  自主循环可观测性，loop 状态推送
- [cycle-event-stream](features/cycle-event-stream.md) — runner / SKILL emit structured events; `roll loop attach/monitor` visualizes each cycle like a CI pipeline
  runner / SKILL 发结构化事件，`roll loop attach/monitor` 像 CI pipeline 一样可视化每一轮

### Marketing & Site
- [landing-page](features/landing-page.md) — Above-the-fold animation tells the three-layer autonomous product story in under 6 seconds
  首屏动画 6 秒内讲清三层自治产品故事

---

## Maintenance / 维护说明

- This file is rewritten by `scripts/release.sh` via the `roll-.changelog` skill on every release
  本文件由 `scripts/release.sh` 在发版时通过 `roll-.changelog` skill 整体重写
- Manual edits will be overwritten on the next release
  手动编辑会在下次发版被覆盖
- No need to edit this file when adding a new Feature — releases auto-sync it
  新增 Feature 时无需手动改本文件，发版会自动同步
- Features without a deep doc are listed without a link; `dream` / doc audit will queue the missing doc
  缺 deep doc 的 Feature 列出但不加链接，由 dream / 文档巡检反向触发补 doc
