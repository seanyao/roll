# Autonomous Evolution

> Epic: 为 Roll 引入自主演化能力。Agent 可在无人干预的情况下持续执行、自我反思、
> 自我重构；人类只在简报后决定是否发布。

---

<a id="us-auto-001"></a>
## US-AUTO-001 roll-build 架构摩擦信号 ✅

**Created**: 2026-05-10
**Completed**: 2026-05-10

- As a product engineer using roll-build
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

- As a product engineer using Roll's autonomous evolution features
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

- As a product engineer using Roll's autonomous execution
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
## US-AUTO-010 roll-loop TCR 硬校验 ✅

**Created**: 2026-05-10
**Completed**: 2026-05-10

- As a product owner relying on autonomous execution
- I want roll-loop to verify TCR rhythm after each story completes
- So that no story is marked Done without at least one `tcr:` micro-commit

**AC:**
- [x] roll-loop 在每条故事完成后（Step 4 Post-Item Cleanup），执行 `git log --oneline` 检查自该故事开始时间以来的 `tcr:` 前缀提交数量
- [x] 数量 == 0：将 BACKLOG.md 中该故事状态从 ✅ Done 回退为 📋 Todo，写 ALERT 到 `~/.shared/roll/loop/ALERT.md`
- [x] ALERT 内容包含：故事 ID、检测时间、原因 "zero TCR commits since story start"、建议操作（手动补 TCR 或 `roll loop reset` 后重跑）
- [x] 数量 > 0：正常流程继续，状态保持 ✅ Done
- [x] 检查逻辑写入 `skills/roll-loop/SKILL.md` Step 4 节
- [x] 补写验证测试：覆盖 TCR 存在 / 不存在两个分支（`tests/unit/loop_tcr.bats`，8 用例）

**Files:**
- `bin/roll` (`_loop_tcr_count`, `_loop_enforce_tcr`)
- `skills/roll-loop/SKILL.md`（Step 4 补充 TCR 校验逻辑）
- `tests/unit/loop_tcr.bats`（8 测试用例）

---

<a id="us-auto-011"></a>
## US-AUTO-011 roll loop monitor 增强 ✅

**Created**: 2026-05-10
**Completed**: 2026-05-11

- As a product engineer on macOS running autonomous loop
- I want `roll loop monitor` to show all three launchd service states and a live log tail
- So that I can see the full scheduler health and recent activity in one view without leaving the terminal

**AC:**
- [x] 显示三行 launchd 服务状态：loop（每小时）/ dream（每晚 01:00）/ brief（每天 08:00），每行显示 ● enabled / ○ disabled
- [x] 每次刷新周期（默认 3s）末尾显示 `~/.shared/roll/loop/launchd.log` 最后 10 行（实时 log tail）
- [x] log tail 区域与队列区域有明确分隔标题
- [x] 补写 / 更新 `tests/unit/roll_loop_monitor.bats`，覆盖三服务状态行和 log tail 渲染逻辑

**CLI:**
```bash
roll loop monitor       # 实时刷新，含三服务状态 + log tail
roll loop monitor 5     # 5 秒刷新间隔
```

**Files:**
- `bin/roll` (_loop_monitor)
- `tests/unit/roll_loop_monitor.bats`

---

<a id="us-auto-012"></a>
## US-AUTO-012 loop 调度时间和 agent 移入配置文件 ✅

**Created**: 2026-05-11
**Completed**: 2026-05-11

- As a product engineer using roll's autonomous loop
- I want to configure loop schedule times and default agent in `~/.roll/config.yaml`
- So that I can adjust them without editing `bin/roll` source code

**AC:**
- [x] `~/.roll/config.yaml` 支持以下调度字段，使用 24 小时制，以机器本地时区为准：
  - `loop_minute`（整数）— roll-loop 触发分钟，每小时执行
  - `loop_active_start`（整数，默认 **10**）— loop 每日最早触发小时（含）
  - `loop_active_end`（整数，默认 **18**）— loop 每日最晚触发小时（不含）
  - `loop_dream_hour`（整数，默认 3）— roll-.dream 触发小时
  - `loop_dream_minute`（整数）— roll-.dream 触发分钟
  - `loop_brief_hour`（整数，默认 9）— roll-brief 触发小时
  - `loop_brief_minute`（整数）— roll-brief 触发分钟
- [x] **minute 字段未配置时，从项目路径 hash 推导默认值**，而非硬编码：
  - `_project_slug` 已有 md5 hash（6 位 hex），取其数值 `% 55 + 1` 得到 1–55 范围的分钟数（避开 :00）
  - 三个服务在此基础上各加固定偏移（+0 / +2 / +4 分钟，mod 55 + 1），保证同一项目内也不同时触发
  - 效果：不同项目自动分散到不同分钟，无需用户配置；需要固定时间再手动指定
- [x] **active window 实现**：loop runner script 在执行前检查当前小时是否在 `[loop_active_start, loop_active_end)` 范围内；不在窗口内则静默退出（不写 state，不计为错误）
- [x] `_install_launchd_plists` 从配置读取 hour/minute；未配置时用上述 hash 推导逻辑
- [x] `roll loop on` 输出的时间提示显示实际使用的分钟值和 active window
- [x] `roll loop monitor` 三服务状态行的时间标注同上，loop 行额外显示 active window
- [x] `roll setup` 写入初始 `~/.roll/config.yaml` 时加入带注释的 schedule 示例段：
  ```yaml
  # Loop schedule (24h format)
  loop_active_start: 10   # loop only runs during active window (after human reviews brief)
  loop_active_end: 18
  # loop_minute: 5        # omit to auto-derive from project hash (avoids contention)
  loop_dream_hour: 3
  # loop_dream_minute: 10 # omit to auto-derive
  loop_brief_hour: 9
  # loop_brief_minute: 15 # omit to auto-derive
  primary_agent: claude
  ```
- [x] `primary_agent` 字段写入 `roll setup` 初始模板（代码路径已有读取逻辑，补模板）
- [x] 单元测试：`_install_launchd_plists` 覆盖以下场景：
  - 自定义 hour/minute 覆盖 hash 推导
  - 两个不同路径项目的默认 minute 不相同
  - 同一项目三个服务的默认 minute 各不相同
  - active window 边界：窗口内触发，窗口外静默退出

**Files:**
- `bin/roll` (`_install_launchd_plists`, `_loop_on`, `_loop_monitor`, `cmd_setup`, `_write_runner_script`)
- `tests/unit/launchd.bats`（补自定义时间 + active window 用例）

---

<a id="us-auto-013"></a>
## US-AUTO-013 roll-propose — 主动发起产品需求提案 ✅

**Created**: 2026-05-11
**Completed**: 2026-05-11

- As a product engineer working with roll
- I want to actively invoke `$roll-propose` to generate product-level feature proposals
- So that I can get structured US drafts ready for review without writing them from scratch

**背景：**
roll-dream 负责技术/架构层面的内省（从执行经验里提炼改进信号）。产品视角的需求发现是另一种思维——想象用户场景、识别功能空白、提出新方向——不依赖执行经验，应由人主动发起而非被动调度。

**AC:**
- [x] `$roll-propose` skill 存在，可通过 Claude Code 主动调用
- [x] 运行时读取 `BACKLOG.md`、最近 commits、现有 skills 列表，作为上下文
- [x] 产出 1–3 条 proposed US，每条包含：动机（why）、目标用户场景、AC 草稿
- [x] 写入项目根目录 `PROPOSALS.md`（追加，带时间戳），不直接写入 BACKLOG
- [x] `PROPOSALS.md` 格式明确标注"待审批"状态，与正式 US 物理隔离
- [x] 人工审批后手动将条目移入 BACKLOG；拒绝时可在 PROPOSALS.md 标注拒绝原因（防止重复提出相似提案）
- [x] skill 提示词引导 agent 从"用户视角"而非"技术视角"思考，避免与 roll-dream 重叠

**Files:**
- `skills/roll-propose/SKILL.md`（新建）

---

<a id="us-auto-014"></a>
## US-AUTO-014 `_install_launchd_plists` 变更自动 reload ✅

**Created**: 2026-05-11
**Completed**: 2026-05-11

- As a product engineer developing roll itself
- I want plist changes to take effect immediately without manual `launchctl load`
- So that TCR commits to scheduling code don't silently leave old plists running

**背景：**
`_install_launchd_plists` 已对比 plist 内容差异（`before`/`after`），但只递增 `updated` 计数器打印提示，不 reload。导致改了调度逻辑的 tcr 提交后，launchd 仍跑旧版，服务静默失效。

**AC:**
- [x] `_install_launchd_plists` 中，plist 内容变化 AND 服务已加载（`_launchd_is_loaded "$label"`）→ 自动 `launchctl unload` + `launchctl load`
- [x] plist 内容不变（幂等场景）→ 不触发 reload，行为与现在相同
- [x] 服务未加载时 → 仅写文件，不 load（由 `roll loop on` 负责首次加载，行为不变）
- [x] 单元测试：`tests/unit/launchd.bats` 补覆盖"内容变更+已加载 → reload"和"内容不变 → 不 reload"两个分支

**Files:**
- `bin/roll` (`_launchd_is_loaded` — fixed to use `print-disabled` for accurate detection)
- `tests/unit/launchd.bats` (tests 28-29: reload branch coverage)

---

<a id="us-auto-015"></a>
## US-AUTO-015 `roll loop status/monitor` 三态展示 📋

**Created**: 2026-05-11

- As a product engineer running autonomous loop
- I want `roll loop status` and `roll loop monitor` to distinguish between loaded, installed-but-not-loaded, and not-installed states
- So that silent failures like "plist exists but not in launchctl" are immediately visible

**背景：**
当前两函数只有两态（loaded / disabled），无法检测"plist 文件存在但未 load"这种静默失效模式——这次 roll 自身三服务全部处于该状态超过一天才被发现。

**三态定义：**
```
● enabled           launchctl list 里有该 label
⚠ installed/off    plist 文件存在（_launchd_plist_path）但未 load    → run: roll loop on
○ not installed     plist 文件不存在                                  → run: roll setup
```

**AC:**
- [ ] `_loop_monitor` macOS 分支：三服务各自独立判断三态并输出对应颜色标识（GREEN/RED/YELLOW）
- [ ] `_loop_status` macOS 分支：同样检查三服务（当前只检查 loop 一个服务），输出三态
- [ ] `⚠ installed/off` 状态末尾显示修复命令 `run: roll loop on`
- [ ] `○ not installed` 状态末尾显示 `run: roll setup`
- [ ] 单元测试：`tests/unit/roll_loop_monitor.bats` 补三态渲染用例（每服务三种情况）

**Files:**
- `bin/roll` (`_loop_status`, `_loop_monitor`)
- `tests/unit/roll_loop_monitor.bats`

---

<a id="us-auto-016"></a>
## US-AUTO-016 loop 执行 story 前标记 🔨 In Progress 📋

**Created**: 2026-05-11

- As a product owner reviewing morning briefs
- I want BACKLOG.md to reflect when loop is actively working on a story
- So that brief can surface in-progress work and tcr micro-commits are no longer invisible

**背景：**
loop 从 📋 Todo 直接跳到 ✅ Done，中间状态不写回 BACKLOG。brief 的"进行中"section 永远是空的，tcr 微提交无法被感知。需要在执行前写 🔨，执行后正常流程结案。

**AC:**
- [ ] roll-loop SKILL.md Step 3（route and execute）：调用 `$roll-build/$roll-fix` 前，先将 BACKLOG.md 中该 story 从 `📋 Todo` 改为 `🔨 In Progress`，提交 `chore: mark US-XXX in progress`
- [ ] 执行完成 → ✅ Done（现有 roll-build/fix 流程不变）
- [ ] TCR 硬校验失败（`_loop_enforce_tcr`）→ 从 `✅ Done` 回退 `📋 Todo`（现有逻辑已正确处理）
- [ ] loop 启动时（Step 1 Read State）：扫描 BACKLOG.md 中所有 `🔨 In Progress` 条目；若 state.yaml 中无对应 running item，视为崩溃孤儿，revert 为 `📋 Todo`，写 ALERT
- [ ] brief SKILL.md Step 2 中"进行中"section 可直接读取 `🔨 In Progress` 条目，无需额外逻辑

**Files:**
- `skills/roll-loop/SKILL.md`（Step 3 前置 + Step 1 孤儿清理）
- `bin/roll`（`_loop_enforce_tcr` 验证 revert 路径兼容 🔨 状态）

---

<a id="us-auto-017"></a>
## US-AUTO-017 roll-.dream 日志改为中文输出 📋

**Created**: 2026-05-11

- As a product engineer reading morning dream reports
- I want dream logs to be in Chinese
- So that the language is consistent with roll-brief and readable without context switching

**AC:**
- [ ] `skills/roll-.dream/SKILL.md` 的 Dream Log 输出模板改为中文（标题、section 名、固定文案）
- [ ] 内容描述（发现的代码问题）也用中文表述
- [ ] 格式结构保持不变（Summary / 死代码 / 架构漂移 / 裁剪候选 / 新兴模式 / 创建的 REFACTOR 条目）
- [ ] BACKLOG.md 追加的 REFACTOR 条目描述本身也改为中文（现已是中文，保持不变）

**Files:**
- `skills/roll-.dream/SKILL.md`（Output 模板 + 固定文案全部中文化）

---

<a id="us-auto-018"></a>
## US-AUTO-018 roll-brief 和 roll-.dream 生成文档后自动 git commit 📋

**Created**: 2026-05-11

- As a product engineer who uses git history as a timeline
- I want brief and dream documents to be committed automatically when generated
- So that docs/briefs/ and docs/dream/ are fully tracked without manual intervention

**背景：**
dream 当前有隐式 commit 行为（`7cc0a26` 验证），但 SKILL.md 没有写明，属于隐式约定。brief 没有 commit 步骤，历史记录依赖人工提交。本 story 把两者都显式化、标准化。

**AC:**
- [ ] `roll-brief` SKILL.md Step 4（Write Brief）之后增加 commit 步骤：
  - `git add docs/briefs/YYYY-MM-DD-NN.md`
  - `git commit -m "docs: roll-brief YYYY-MM-DD-NN — {触发原因}"`
  - 写文件失败时不 commit
- [ ] `roll-.dream` SKILL.md Output 节增加显式 commit 步骤（标准化现有隐式行为）：
  - BACKLOG.md 变更（REFACTOR 条目）与 dream log 文件在**同一个 commit**
  - commit message：`chore: dream scan YYYY-MM-DD — {N} REFACTOR entries`
  - 无 REFACTOR 条目时：`chore: dream scan YYYY-MM-DD — no findings`
  - 写文件失败时不 commit
- [ ] 两个 SKILL 的 `allowed-tools` 已包含 `Bash(git:*)`，无需修改权限声明

**Files:**
- `skills/roll-brief/SKILL.md`（Step 4 后增加 git commit）
- `skills/roll-.dream/SKILL.md`（Output 节增加显式 commit + message 格式）

---

<a id="us-auto-019"></a>
## US-AUTO-019 $roll-design 非交互模式 + IDEA 晋升路径 📋

**Created**: 2026-05-11

- As a product engineer running autonomous loop
- I want to queue requirements without a synchronous design session
- So that I can drop requirements and walk away while loop executes them asynchronously

**背景（来自 peer review）：**
$roll-design 当前全程同步，有多个人类等待点（Clarify/Discuss/Confirm），与「人离线、loop 在线」的全自主模式冲突。IDEA-NNN 没有轻量晋升通道，导致想法积压。

**AC:**
- [ ] `$roll-design --from-file <path>` — 读取结构化输入文件（包含描述 + 预期 AC），自动跳过 Clarify/Discuss，直接进入 Analyze → Story Split → 写入 BACKLOG 为 📋 Todo，无需实时确认
- [ ] `$roll-design "..."` 当输入已包含清晰 scope（含明确动词 + 范围 + 验收信号）时，自动识别为高置信输入，跳过 Clarify，最多保留 Discuss（方案有分歧时）
- [ ] `$roll-design --from-idea IDEA-NNN` — 读取 BACKLOG.md 中对应 IDEA 原文作为种子，自动跳过 Clarify，进入 Analyze，产出 US-XXX 或 FIX-XXX，IDEA 条目标注 `→ US-XXX`
- [ ] 非交互模式下写入 BACKLOG 的 story 状态为 📋 Todo（loop 可直接执行），不需要人工二次确认

**Files:**
- `skills/roll-design/SKILL.md`（Clarify 触发条件 + 非交互模式 + --from-idea 路径）

---

<a id="us-auto-020"></a>
## US-AUTO-020 roll-design + roll-loop SKILL 文档补充两处说明 📋

**Created**: 2026-05-11

- As a product engineer adopting full autonomous mode
- I want the skills to explicitly document the emergency override path and the "No" confirmation semantics
- So that the mental model is unambiguous and I don't accidentally lock myself out of immediate execution

**背景（来自 peer review）：**
两处文档空白会造成认知误导：1）全自主叙事下人容易以为「一切都等 loop」，忘记可以直接执行；2）$roll-design 的 Confirm gate 语义不清，"No" 实际是「不立即执行，story 仍在 BACKLOG」但文档没说。

**AC:**
- [ ] `skills/roll-design/SKILL.md` Workflow 末尾 gate 说明补充：`No = story 已写入 BACKLOG 为 📋 Todo，loop 下轮将自动执行；选 No 仅跳过立即执行`
- [ ] `skills/roll-loop/SKILL.md` 执行边界（Execution Boundary）段补充：`roll-loop 是默认调度器，不垄断执行权。任何时刻人可直接 $roll-build US-XXX 或 $roll-fix FIX-XXX 绕过 loop 立即执行（紧急 bug、中断插入等场景）`

**Files:**
- `skills/roll-design/SKILL.md`（Confirm gate 注释）
- `skills/roll-loop/SKILL.md`（Execution Boundary 段）

---

<a id="us-auto-021"></a>
## US-AUTO-021 `roll status` 增加全局 loop 概览区块 📋

**Created**: 2026-05-11
**Promoted from**: IDEA-010

- As a developer managing multiple projects with roll
- I want `roll status` to show all registered projects' loop state, schedule times, and backlog counts
- So that I can see the health of all autonomous loops in one command without cd-ing into each project

**AC:**
- [ ] `roll status` 在现有 convention/skills 区块后追加 "Loop Overview" 区块
- [ ] 扫描 `~/Library/LaunchAgents/com.roll.loop.*.plist`，提取项目路径和 slug
- [ ] 每个项目显示：项目名、loop 状态（● on / ○ off）、实际调度时间（从 plist 读取）、backlog 待办数（扫描对应项目的 BACKLOG.md）
- [ ] 项目路径不存在时显示 `(path missing)` 而非报错
- [ ] 无任何已注册项目时跳过该区块（不输出空表格）

**Domain Model:**
- Context: Autonomous Evolution
- Aggregate: LoopScheduler（跨项目视图）
- Files touched: `bin/roll` → `cmd_status`

**Files:**
- `bin/roll`（`cmd_status` 函数）
- `tests/unit/roll_status.bats`（新增 loop overview 测试用例）
