# Roll — Features

> 产品视角的功能索引。Story 是构建单位、Changelog 是发布单位，
> 这里描述的是 roll 当前**作为产品**所提供的能力。
>
> 每次发版时由 `scripts/release.sh` 自动重写本文件，使之与 BACKLOG 和
> `docs/features/` 的真实状态保持一致。

---

## ✨ Core Highlights

- **Autonomous BACKLOG Executor** — roll-loop 按调度自动认领 BACKLOG 任务，
  在隔离 worktree 里跑 Claude，开 PR 等 CI 绿后自动合入；中断 / 孤儿状态自愈
- **Cross-Agent Peer Review** — 关键决策三态（AGREE / REFINE / OBJECT / ESCALATE）
  多 AI 协商；失败按 capability map 自动 fallback
- **Universal AI Tool Integration** — Claude / Kimi / DeepSeek / Codex / Gemini /
  Trae / opencode / Pi / Cursor，统一 convention sync 与 skill 链接
- **TCR-First Engineering Discipline** — Test && Commit \|\| Revert，pre-commit
  proof-of-pass 物理拦截未测试 commit
- **Self-Healing Documentation** — dream 夜检文档新鲜度，loop 自动补缺口

---

## Features by Epic

### CLI & Project Lifecycle
- [CLI Simplification](docs/features/cli-simplification.md) — 三步极简 `roll init`，按项目类型推断 convention，不再问类型
- [npm Distribution](docs/features/npm-distribution.md) — npm 包发布、`roll update`、版本提示
- [Hello World](docs/features/hello-world.md) — 新用户最短上手路径

### Skill Ecosystem
- [New Skills](docs/features/new-skills.md) — roll-idea / roll-notes / roll-.clarify / roll-doctor / roll-peer / roll-doc 等核心 skill 集

### Multi-IDE & AI Tool Integration
- [Trae Support](docs/features/trae-support.md) — Trae IDE 检测 + project_rules.md 同步
- [opencode Support](docs/features/opencode-support.md) — opencode 检测 + AGENTS.md 同步
- ai-tools — DeepSeek TUI / Pi (pi-coding-agent) / Codex CLI 支持

### Autonomous Operation
- [Autonomous Evolution](docs/features/autonomous-evolution.md) — roll-loop 自治 BACKLOG 执行器：调度、worktree 隔离、PR 自动合并、孤儿恢复、心跳
- [PR Lifecycle](docs/features/pr-lifecycle.md) — agent-agnostic PR 评审、loop PR inbox、可选秒级 webhook
- [Peer-tmux Cleanup](docs/features/peer-tmux-cleanup.md) — peer 终态后 tmux session 自动清理

### Quality & Diagnostics
- [E2E Lifecycle](docs/features/e2e-lifecycle.md) — Story 完成后 E2E Deposit，CI E2E gating，失败诊断
- [roll-debug](docs/features/roll-debug.md) — BB 注入诊断 + auto-fix
- [Agent Compliance](docs/features/agent-compliance.md) — proof-of-pass + pre-commit hook，物理拦截未测试 commit

### Release & Changelog
- [Release Script](docs/features/roll-release.md) — `scripts/release.sh` 一键发版（人触发，npm 2FA 走真终端），自动算版本号 / 写 VERSION / 同步 CHANGELOG / release_notes / features.md
- [Changelog Integration](docs/features/changelog-integration.md) — AI 生成 changelog，风格守门，自审重写

### Documentation
- [Documentation](docs/features/documentation.md) — 双语分层文档（guide / domain / features），dream 巡检文档覆盖度

### Engineering Infrastructure
- skill-harness — 技能权限声明、Identity 约定、Co-Authored-By 归属、Scope Gate、DDD 增强
- [GitHub Actions](docs/features/github-actions.md) — Claude Bot 工作流模板
- [Convention Management](docs/features/convention-management.md) — Goal-Driven Execution、Where to Look 导航、roll-doc 为存量项目补 AGENTS.md

### Observability
- [Alert Lifecycle](docs/features/alert-lifecycle.md) — `roll alert` 命令，ALERT ack / resolve，与 brief / status 联动
- [Notifications](docs/features/notifications.md) — 自主循环可观测性，loop 状态推送

---

## 维护说明

- 本文件由 `scripts/release.sh` 在发版时通过 `roll-.changelog` skill 整体重写
- 手动编辑会在下次发版被覆盖
- 新增 Feature 时无需手动改本文件，发版会自动同步
- 缺 deep doc 的 Feature 列出但不加链接，由 dream / 文档巡检反向触发补 doc
