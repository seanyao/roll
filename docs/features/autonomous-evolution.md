# Autonomous Evolution

> Epic: 为 Roll 引入自主演化能力。Agent 可在无人干预的情况下持续执行、自我反思、
> 自我重构；人类只在简报后决定是否发布。

---

<a id="us-auto-001"></a>
## US-AUTO-001 roll-build 架构摩擦信号 ✅

**Created**: 2026-05-10
**Completed**: 2026-05-10

- As a developer using roll-build
- I want architectural strain detected during Story implementation to be automatically flagged
- So that REFACTOR entries accumulate in BACKLOG without interrupting current work

**Domain Model:**
- Context: Build
- Aggregate: Story execution flow
- Events raised: [ArchitectureFrictionDetected] → BACKLOG (REFACTOR entry)

**AC:**
- [x] roll-build 在实现过程中识别架构摩擦信号（需大规模改动现有结构、模块边界不清晰、跨 Context 耦合等）
- [x] 自动在 BACKLOG.md 追加 `REFACTOR-XXX` 条目（含触发 Story ID、摩擦描述）
- [x] 不中断当前 Story 实现流程
- [x] 摩擦详情写入 `docs/features/refactor-log.md`

**Files:**
- `skills/roll-build/SKILL.md`
- `BACKLOG.md`
- `docs/features/refactor-log.md`（按需创建）

**Dependencies:**
- Depended on by: US-AUTO-004（loop 执行 REFACTOR 条目）

---

<a id="us-auto-002"></a>
## US-AUTO-002 roll-dream ✅

**Created**: 2026-05-10
**Completed**: 2026-05-10

- As an autonomous agent system
- I want a nightly skill that reviews code structure and architecture health
- So that technical debt and architectural drift are surfaced proactively as REFACTOR entries

**Domain Model:**
- Context: Autonomous Evolution
- Aggregate: Codebase health state
- Events raised: [DreamCompleted] → BACKLOG (REFACTOR entries) + docs/dream/

**AC:**
- [x] 新建 `skills/roll-dream/SKILL.md`，定义巡检逻辑：死代码、架构漂移（对比 `docs/domain/`）、可修剪抽象、可提炼模式
- [x] 产出 `REFACTOR-XXX` 条目写入 BACKLOG.md
- [x] 巡检报告写入 `docs/dream/YYYY-MM-DD.md`
- [x] SKILL.md 明确与 `roll-sentinel` 的区别（sentinel 看运行时，dream 看代码结构）
- [x] SKILL.md 包含 cron 和 GitHub Actions 两种调度配置示例

**Files:**
- `skills/roll-dream/SKILL.md`（新建）
- `BACKLOG.md`
- `docs/dream/`（按需创建）

**Dependencies:**
- Depended on by: US-AUTO-004

---

<a id="us-auto-003"></a>
## US-AUTO-003 roll-brief ✅

**Created**: 2026-05-10
**Completed**: 2026-05-10

- As a human product owner
- I want periodic briefings summarizing what the agent has done
- So that I can stay informed and make confident release decisions without being in the execution loop

**Domain Model:**
- Context: Autonomous Evolution
- Aggregate: Project state snapshot
- Events raised: [BriefGenerated] → docs/briefs/

**AC:**
- [x] 新建 `skills/roll-brief/SKILL.md`
- [x] 三种触发模式：Feature 完成时自动触发、每日早晨定时触发、`$roll-brief` 按需调用
- [x] 简报内容：已完成（US/FIX/REFACTOR）、进行中、BACKLOG 队列概况、需人类介入的升级项、发布就绪建议
- [x] 输出到 `docs/briefs/YYYY-MM-DD-HH.md`
- [x] 明确区别于 `roll-.changelog`：简报是 owner 面内部消化，changelog 是用户面发布说明

**Files:**
- `skills/roll-brief/SKILL.md`（新建）
- `docs/briefs/`（按需创建）

**Dependencies:**
- Depended on by: US-AUTO-004（loop 在适当时机触发 brief）

---

<a id="us-auto-004"></a>
## US-AUTO-004 roll-loop ✅

**Created**: 2026-05-10
**Completed**: 2026-05-10

- As an autonomous agent system
- I want an hourly BACKLOG executor that routes and runs pending items automatically
- So that the project can self-evolve end-to-end without human intervention in execution

**Domain Model:**
- Context: Autonomous Evolution
- Aggregate: Execution scheduler
- Events raised: [LoopCycleCompleted], [LoopPaused] → state.yaml + ALERT

**AC:**
- [x] 新建 `skills/roll-loop/SKILL.md`，定义路由逻辑：US-XXX → `$roll-build`，FIX-XXX → `$roll-fix`，REFACTOR-XXX → `$roll-build`
- [x] `~/.roll/config.yaml` 支持 `loop.primary` / `loop.fallback` agent 配置
- [x] 调度器基础设施：GitHub Actions cron 配置模板 + 本地 cron 安装说明
- [x] 失败处理：网络错误指数退避（2s/4s/8s/16s）→ token 耗尽切换 fallback agent → 持续失败暂停写 ALERT
- [x] 状态文件 `~/.shared/roll/loop/state.yaml`：记录当前执行项、断点，支持恢复
- [x] 执行边界：`roll-release` 步骤不自动执行，升级到 `roll-brief` 通知人类
- [x] 在适当节点自动触发 `roll-brief`（Feature 完成时）

**Files:**
- `skills/roll-loop/SKILL.md`（新建）
- `conventions/global/AGENTS.md`（补充 loop 调度说明）
- `.github/workflows/roll-loop.yml`（GitHub Actions 模板，新建）
- `~/.roll/config.yaml`（新增 loop 配置段说明）

**Dependencies:**
- Depends on: US-AUTO-001, US-AUTO-002, US-AUTO-003（loop 执行这三者的产出）

---

<a id="us-auto-005"></a>
## US-AUTO-005 CLI 管理层文档化 ✅

**Created**: 2026-05-10
**Completed**: 2026-05-10

- As a developer using Roll's autonomous evolution features
- I want the CLI commands and per-project config to be documented
- So that I can manage the loop without guessing at the interface

**AC:**
- [x] BACKLOG.md 补 US-AUTO-005 / US-AUTO-006 条目
- [x] autonomous-evolution.md 补 CLI 管理层说明（roll loop/brief/agent）
- [x] `.roll.yaml` per-project agent 配置约定记录在 feature doc
- [x] IDEA-004 roll-brief 推送渠道写入 BACKLOG Ideas

**CLI 管理命令（已实现于 bin/roll）:**

```bash
# 自主循环管理（本项目）
roll loop on              # 启用调度（写入 crontab：loop 每小时 + dream 01:00 + brief 08:00）
roll loop off             # 停用调度（移除 crontab 条目）
roll loop now             # 立即触发一个周期（有中断则自动恢复）
roll loop status          # 查看调度状态 + 当前 state.yaml + ALERT

# 简报
roll brief                # 展示最新简报；超过 24h 自动重新生成

# Agent 切换（per-project）
roll agent use <name>     # 设置当前项目的 agent（写入 .roll.yaml）
roll agent list           # 列出已安装的 agent
roll agent                # 查看当前项目使用的 agent

# 无参数时（在项目目录）
roll                      # 展示项目 dashboard：loop 状态 + 最新 brief 摘要
```

**`.roll.yaml` 约定（per-project agent 配置）:**

```yaml
# .roll.yaml — 项目根目录，per-project 配置
# 覆盖 ~/.roll/config.yaml 的全局 agent 设置
agent: claude   # claude | kimi | deepseek | opencode | ...
```

- 由 `roll agent use <name>` 自动写入，也可手动编辑
- 按需加入 `.gitignore`（个人偏好）或提交（团队统一）
- 全局回退：`~/.roll/config.yaml → loop.primary_agent`，再回退到 `claude`

**Files:**
- `bin/roll`（新增 cmd_loop / cmd_brief / cmd_agent / _dashboard）
- `BACKLOG.md`
- `docs/features/autonomous-evolution.md`

---

<a id="us-auto-006"></a>
## US-AUTO-006 Methodology 自主演化章节 ✅

**Created**: 2026-05-10
**Completed**: 2026-05-10

- As a Roll user
- I want the methodology documentation to explain the autonomous evolution layer
- So that I understand it's optional, how local cron works, and the three-layer architecture

**AC:**
- [x] methodology-en.md 新增 Loop D 自主演化章节
- [x] methodology.md 同步中文版
- [x] 说明三层架构（基础层 / 自主层 / 反思层）及其可选性
- [x] 说明本地 cron 优于 GitHub Actions 的原因
- [x] 说明 dashboard 行为（roll 无参数）

**Files:**
- `docs/methodology-en.md`
- `docs/methodology.md`

---

<a id="us-auto-007"></a>
## US-AUTO-007 roll backlog 命令 ✅

**Created**: 2026-05-10
**Completed**: 2026-05-10

- As a developer using Roll's autonomous execution
- I want a `roll backlog` command that shows all pending tasks
- So that I can check what's queued without opening BACKLOG.md manually

**AC:**
- [x] `roll backlog` reads BACKLOG.md and prints all 📋 Todo items
- [x] Groups by type: Bug Fixes (FIX-XXX, red), User Stories (US-XXX, cyan), Refactors (REFACTOR-XXX, yellow)
- [x] Bug fixes listed first (highest priority)
- [x] Shows total count in header
- [x] Shows "backlog is clear" when nothing pending
- [x] Errors clearly if BACKLOG.md not found
- [x] Added to `roll --help` and `usage()` output
- [x] Added to dashboard (`roll loop monitor` queue section)

**CLI:**
```bash
roll backlog    # show pending tasks grouped by type
```

**Files:**
- `bin/roll` (cmd_backlog, usage, main routing)

---

<a id="us-auto-008"></a>
## US-AUTO-008 roll loop monitor ✅

**Created**: 2026-05-10
**Completed**: 2026-05-10

- As a human overseeing autonomous execution
- I want a live `roll loop monitor` dashboard like `top`
- So that I can see the loop's current state, queue, and recent history at a glance

**AC:**
- [x] `roll loop monitor [interval]` — refreshing terminal view (default: 3s interval)
- [x] Shows: scheduler enabled/disabled + agent, current execution state (running/paused/idle), ALERT if present
- [x] Shows pending queue from BACKLOG.md (FIX first, then US, then REFACTOR), color-coded
- [x] Shows last 5 lines of `~/.shared/roll/loop/cron.log` as recent activity
- [x] Ctrl-C to exit cleanly
- [x] Optional interval argument: `roll loop monitor 5` for 5-second refresh
- [x] Added to `cmd_loop` routing and `usage()` output

**CLI:**
```bash
roll loop monitor       # live dashboard, refresh every 3s
roll loop monitor 5     # refresh every 5s
```

**Files:**
- `bin/roll` (_loop_monitor, cmd_loop routing, usage)

---

<a id="us-auto-009"></a>
## US-AUTO-009 launchd 调度迁移 ✅

**Created**: 2026-05-10
**Completed**: 2026-05-10

- As a macOS user of Roll's autonomous evolution features
- I want scheduling to use launchd instead of crontab
- So that loop/dream/brief services are managed as proper launchd agents

**Domain Model:**
- Context: Autonomous Evolution
- Aggregate: Scheduler infrastructure
- Events raised: [Plists Installed] → ~/Library/LaunchAgents/

**AC:**
- [x] `roll setup` on macOS installs three launchd plist files (loop/dream/brief) in `~/Library/LaunchAgents/` — disabled by default (not loaded)
- [x] `roll setup` idempotent — plist content-diffed, unchanged files not rewritten
- [x] `roll loop on` on macOS: (re)writes runner scripts + calls `launchctl load` for each service
- [x] `roll loop off` on macOS: calls `launchctl unload`; warns if not loaded
- [x] `roll loop status` on macOS: checks `launchctl list` label instead of crontab
- [x] Linux path preserved — crontab fallback intact in `_loop_on`/`_loop_off`/`_loop_status`
- [x] Unit tests: `_install_launchd_plists` — schedule timing, idempotency, runner script creation
- [x] Integration tests: `cmd_setup` installs 3 plists; `cmd_loop` load/unload lifecycle

**Files:**
- `bin/roll` (_SHARED_ROOT, _install_launchd_plists, cmd_setup, _loop_on, _loop_off, _loop_status)
- `tests/unit/launchd.bats`
- `tests/integration/cmd_setup.bats`
- `tests/integration/cmd_loop.bats` (new)

---

<a id="us-auto-010"></a>
## US-AUTO-010 roll-loop TCR 硬校验 📋

**Created**: 2026-05-10

- As a product owner relying on autonomous execution
- I want roll-loop to verify TCR rhythm after each story completes
- So that no story is marked Done without at least one `tcr:` micro-commit

**AC:**
- [ ] roll-loop 在每条故事完成后（Step 4 Post-Item Cleanup），执行 `git log --oneline` 检查自该故事开始时间以来的 `tcr:` 前缀提交数量
- [ ] 数量 == 0：将 BACKLOG.md 中该故事状态从 ✅ Done 回退为 📋 Todo，写 ALERT 到 `~/.shared/roll/loop/ALERT.md`
- [ ] ALERT 内容包含：故事 ID、检测时间、原因 "zero TCR commits since story start"、建议操作（手动补 TCR 或 `roll loop reset` 后重跑）
- [ ] 数量 > 0：正常流程继续，状态保持 ✅ Done
- [ ] 检查逻辑写入 `skills/roll-loop/SKILL.md` Step 4 节
- [ ] 补写验证测试：mock git log 输出，覆盖 TCR 存在 / 不存在两个分支

**Files:**
- `skills/roll-loop/SKILL.md`（Step 4 补充 TCR 校验逻辑）
- `tests/unit/roll_loop_tcr_check.bats`

---

<a id="us-auto-011"></a>
## US-AUTO-011 roll loop monitor 增强 📋

**Created**: 2026-05-10

- As a developer on macOS running autonomous loop
- I want `roll loop monitor` to show all three launchd service states and a live log tail
- So that I can see the full scheduler health and recent activity in one view without leaving the terminal

**AC:**
- [ ] 显示三行 launchd 服务状态：loop（每小时）/ dream（每晚 01:00）/ brief（每天 08:00），每行显示 ● enabled / ○ disabled
- [ ] 每次刷新周期（默认 3s）末尾显示 `~/.shared/roll/loop/launchd.log` 最后 10 行（实时 log tail）
- [ ] log tail 区域与队列区域有明确分隔标题
- [ ] 补写 / 更新 `tests/unit/roll_loop_monitor.bats`，覆盖三服务状态行和 log tail 渲染逻辑

**CLI:**
```bash
roll loop monitor       # 实时刷新，含三服务状态 + log tail
roll loop monitor 5     # 5 秒刷新间隔
```

**Files:**
- `bin/roll` (_loop_monitor)
- `tests/unit/roll_loop_monitor.bats`
