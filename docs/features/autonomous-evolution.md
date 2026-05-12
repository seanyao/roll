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
## US-AUTO-016 loop 执行 story 前标记 🔨 In Progress ✅

**Created**: 2026-05-11
**Completed**: 2026-05-11

- As a product owner reviewing morning briefs
- I want BACKLOG.md to reflect when loop is actively working on a story
- So that brief can surface in-progress work and tcr micro-commits are no longer invisible

**背景：**
loop 从 📋 Todo 直接跳到 ✅ Done，中间状态不写回 BACKLOG。brief 的"进行中"section 永远是空的，tcr 微提交无法被感知。需要在执行前写 🔨，执行后正常流程结案。

**AC:**
- [x] roll-loop SKILL.md Step 3：调用 executor 前将 BACKLOG.md 该 story 从 `📋 Todo` 改为 `🔨 In Progress`，提交 `chore: mark US-XXX in progress`
- [x] executor SKILL.md（roll-build / roll-fix）状态转换段更新：接受 `📋 Todo` 或 `🔨 In Progress` 作为前置状态，正常转 `✅ Done`
- [x] TCR 硬校验失败（`_loop_enforce_tcr`）→ 从 `✅ Done` 回退 `📋 Todo`（现有逻辑已正确处理，已验证无需改动）
- [x] roll-loop SKILL.md Step 1（Read State）：扫描 BACKLOG.md 中所有 `🔨 In Progress` 条目；若 state.yaml 中无对应 running item，视为崩溃孤儿，revert 为 `📋 Todo`，commit + 写 ALERT
- [x] brief SKILL.md "进行中"段读取 🔨 条目（已存在，加 contract 测试固定契约）

**Files:**
- `skills/roll-loop/SKILL.md`（Step 3 前置标记 + Step 1 孤儿清理）
- `skills/roll-build/SKILL.md`（Phase 11 状态转换段接受 🔨 前置状态）
- `skills/roll-fix/SKILL.md`（同上）
- `tests/unit/roll_loop_skill.bats`（Step 3 + Step 1 contract 测试）
- `tests/unit/roll_build_skill.bats`（executor + brief contract 测试）

---

<a id="us-auto-017"></a>
## US-AUTO-017 roll-.dream 日志改为中文输出 ✅

**Created**: 2026-05-11
**Completed**: 2026-05-11

- As a product engineer reading morning dream reports
- I want dream logs to be in Chinese
- So that the language is consistent with roll-brief and readable without context switching

**AC:**
- [x] `skills/roll-.dream/SKILL.md` 的 Dream Log 输出模板改为中文（标题、section 名、固定文案）
- [x] 内容描述（发现的代码问题）也用中文表述
- [x] 格式结构保持不变（Summary / 死代码 / 架构漂移 / 裁剪候选 / 新兴模式 / 创建的 REFACTOR 条目）
- [x] BACKLOG.md 追加的 REFACTOR 条目描述本身也改为中文（现已是中文，保持不变）

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
## US-AUTO-019 $roll-design 非交互模式 + IDEA 晋升路径 ✅

**Created**: 2026-05-11
**Completed**: 2026-05-11

- As a product engineer running autonomous loop
- I want to queue requirements without a synchronous design session
- So that I can drop requirements and walk away while loop executes them asynchronously

**背景（来自 peer review）：**
$roll-design 当前全程同步，有多个人类等待点（Clarify/Discuss/Confirm），与「人离线、loop 在线」的全自主模式冲突。IDEA-NNN 没有轻量晋升通道，导致想法积压。

**AC:**
- [x] `$roll-design --from-file <path>` — 读取结构化输入文件（包含描述 + 预期 AC），自动跳过 Clarify/Discuss，直接进入 Analyze → Story Split → 写入 BACKLOG 为 📋 Todo，无需实时确认
- [x] `$roll-design "..."` 当输入已包含清晰 scope（含明确动词 + 范围 + 验收信号）时，自动识别为高置信输入，跳过 Clarify，最多保留 Discuss（方案有分歧时）
- [x] `$roll-design --from-idea IDEA-NNN` — 读取 BACKLOG.md 中对应 IDEA 原文作为种子，自动跳过 Clarify，进入 Analyze，产出 US-XXX 或 FIX-XXX，IDEA 条目标注 `→ US-XXX`
- [x] 非交互模式下写入 BACKLOG 的 story 状态为 📋 Todo（loop 可直接执行），不需要人工二次确认

**Files:**
- `skills/roll-design/SKILL.md`（Non-Interactive Mode section + Clarify skip conditions + --from-file/--from-idea paths）

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
## US-AUTO-021 `roll status` 增加全局 loop 概览区块 ✅

**Created**: 2026-05-11
**Completed**: 2026-05-11
**Promoted from**: IDEA-010

- As a developer managing multiple projects with roll
- I want `roll status` to show all registered projects' loop state, schedule times, and backlog counts
- So that I can see the health of all autonomous loops in one command without cd-ing into each project

**AC:**
- [x] `roll status` 在现有 convention/skills 区块后追加 "Loop Overview" 区块
- [x] 扫描 `~/Library/LaunchAgents/com.roll.loop.*.plist`，提取项目路径和 slug
- [x] 每个项目显示：项目名、loop 状态（● on / ○ off）、实际调度时间（从 plist 读取）、backlog 待办数（扫描对应项目的 BACKLOG.md）
- [x] 项目路径不存在时显示 `(path missing)` 而非报错
- [x] 无任何已注册项目时跳过该区块（不输出空表格）

**Domain Model:**
- Context: Autonomous Evolution
- Aggregate: LoopScheduler（跨项目视图）
- Files touched: `bin/roll` → `cmd_status`

**Files:**
- `bin/roll`（`_status_loop_overview` + `cmd_status` call）
- `tests/unit/roll_status.bats`（8 test cases covering all ACs）

---

<a id="us-auto-022"></a>
## US-AUTO-022 Loop 并发安全 — per-loop LOCK + skip-if-🔨 ✅

**Created**: 2026-05-11
**Completed**: 2026-05-11

- As a developer running roll in autonomous mode
- I want the loop to be safe against concurrent execution
- So that two loop instances never process the same story, and human/agent manual execution doesn't conflict with a running loop

**背景：**
launchd 按时间触发 loop，如果上一次 loop 还在跑，新触发的实例需要感知并退出。同时 loop 在选 story 时需要跳过已被标记为 🔨 In Progress 的条目，支持人工介入和未来多 agent 协作场景。

**实现细节：**
LOCK 文件路径采用 per-project：`<runner-dir>/.LOCK-<slug>`（每项目独立，roll 和 APE-PR 的 loop 不互锁）。运行时由 runner script 通过 `$0` 自推导，无需额外参数。

**AC:**
- [x] loop 启动时写入 `~/.shared/roll/loop/.LOCK-<slug>`（含 PID）
- [x] loop 启动时检查 LOCK：PID 存活 → 写"loop already running, skipping"到 log → 退出 0
- [x] loop 启动时检查 LOCK：PID 已死（残留） → 清理 LOCK → 继续执行
- [x] loop 正常结束 / 异常退出时删除 LOCK（trap EXIT）
- [x] SKILL.md 说明扫 BACKLOG 时跳过 🔨 In Progress 条目（供 claude 遵循）
- [x] 测试：两个 loop 实例并发，第二个检测到 LOCK 后退出 0，第一个正常完成
- [x] 测试：陈旧 LOCK（PID 已死）被自动清理后正常执行

**Domain Model:**
- Context: Autonomous Evolution
- Aggregate: LoopScheduler
- Files touched: `bin/roll`（runner script 生成）、`skills/roll-loop/SKILL.md`

**Files:**
- `bin/roll`（`_write_loop_runner_script` 中加 LOCK 检测 + trap）
- `skills/roll-loop/SKILL.md`（Step 2 skip 🔨 + Concurrency Safety 段）
- `tests/unit/roll_loop_lock.bats`（5 个测试：3 unit grep + 2 行为集成）
- `tests/unit/roll_loop_skill.bats`（2 个测试：SKILL.md 内容契约）

**Dependencies:**
- Depended on by: US-AUTO-016（🔨 标记需要 LOCK 才能保证不重复执行）

---

<a id="us-auto-024"></a>
## US-AUTO-024 `roll loop runs` — 每次 loop 运行的快速可见性 ✅

**Created**: 2026-05-11
**Completed**: 2026-05-11

- As a developer running roll in autonomous mode
- I want to see what each loop iteration just did without waiting for the next morning's brief
- So that I can pull a quick digest at any time of day and stay aware of what loop has executed

**背景：**
loop 每小时跑一次（active window 10:00–24:00，每天 14 次），但 brief 每天只有早上 9 点一次。中间 13 次 loop 的产出对人不可见，要看必须翻 `cron.log`（嘈杂）或 `git log`（碎片化）。需要一个**拉式 per-run 摘要**：单次 loop 结束写一行结构化数据，新命令 `roll loop runs` 显示最近 N 次。

**与 brief 的关系：**
两者解决不同问题，并行存在：

```
brief    每日 1 次，叙事 + 跨日聚合 + 发布建议      "早上花 3 分钟读懂昨天"
runs     按需查看，事件 + 单次小结 + 立即可用      "中午想知道刚才那次干了啥"
```

**AC:**
- [x] loop SKILL.md Step 5 末尾 append 一行 JSON 到 `~/.shared/roll/loop/runs.jsonl`
- [x] 单行字段：`{ts, project, run_id, status, built, skipped, alerts, tcr_count, duration_sec}`
  - `status`: `built` / `idle` / `failed`
  - `built`: 已完成的 story id 列表（如 `["US-AUTO-017","FIX-016"]`）
  - `skipped`: 因为 🔨 In Progress 被跳过的 story id 列表
  - `alerts`: 触发的 ALERT 数量
  - `tcr_count`: 本次 loop 累计的 `tcr:` 提交数
  - `duration_sec`: loop 启动到结束的秒数
- [x] 新命令 `roll loop runs [N]` —— 显示最近 N 条（默认 10），按时间倒序
- [x] 输出格式示例：
  ```
  19:11  ✅ built US-AUTO-017, US-AUTO-018  (2 items, 14 tcr, 28m)
  18:11  ○ idle — no Todo items
  17:11  ○ idle — no Todo items
  16:11  ✗ FAILED — claude API error
  ```
- [x] `roll loop runs` 仅显示**当前项目**的运行（按 project 字段过滤）
- [x] `roll loop runs --all` 显示所有项目的运行（聚合视图）
- [x] runs.jsonl 文件 append-only，永不删除（历史保留；若需要清理由人手动 truncate）

**Non-goals:**
- 不做推送通知（desktop notify）；先拉式起步，避免一天 14 次通知疲劳
- 不替代 brief；brief 继续每日 09:00 跑，承担叙事与发布建议

**Domain Model:**
- Context: Autonomous Evolution
- Aggregate: LoopScheduler
- New Entity: LoopRun（一次 loop 运行的事件记录）
- Files touched: SKILL.md prompt + bin/roll 命令分派

**Files:**
- `skills/roll-loop/SKILL.md`（Step 5 写入 runs.jsonl 指令）
- `bin/roll`（新增 `_loop_runs` 函数 + `runs` 子命令分派 + `--all` flag）
- `tests/unit/roll_loop_runs.bats`（命令分派 + 输出格式契约 + JSONL 解析）

**Dependencies:**
- Depends on: US-AUTO-016（loop 已会标记 🔨，runs 需要从 BACKLOG 行为还原 built/skipped 列表）

---

<a id="us-auto-025"></a>
## US-AUTO-025 loop 在 tmux session 里运行，`roll loop attach` 实时观看 ✅

**Created**: 2026-05-11
**Completed**: 2026-05-11

- As a developer running roll in autonomous mode
- I want to watch the loop's coding agent work in real time, just like attaching to a human's terminal session
- So that loop feels transparent and operable, not a black box

**背景：**
当前 loop 调度链是 launchd → bash → `claude -p "..." >> log`，全程是不可见的子进程。要看进度只能 `tail -f cron.log`，丢失了交互式 claude 那种"看它打字、写文件、commit"的临场感。把 claude 包进一个 detached tmux session，让人可以**按需 attach 实时观看，分离后 loop 继续跑**。

**与 US-AUTO-024 的关系：**
```
US-AUTO-024 (runs)    被动事后摘要         "这次 loop 干了啥"
US-AUTO-025 (attach)  主动实时观看现场      "正在干啥，怎么干"
```

两者互补，runs 解决"知道发生过什么"，attach 解决"亲眼看一遍"。

**AC:**
- [x] runner script 启动时检测 `tmux` 是否可用
  - 可用 → 以 detached session 形式跑 claude；session 名 `roll-loop-<slug>`
  - 不可用 → fallback 到原 headless 模式（`claude -p ... >> log 2>&1`）
- [x] tmux session 启动前 kill 同名旧 session（防止前一次崩溃残留）
- [x] tmux session 内输出同时 pipe 到 `cron.log`（保留原有日志，不退步）
- [x] runner 等待 tmux session 结束才退出（保证 LOCK trap 时序正确）
- [x] 新命令 `roll loop attach`
  - 当前项目 session 存在 → `exec tmux attach -t roll-loop-<slug>`
  - 不存在 → 提示 "No running loop" + 退出 1
- [x] tmux 分离（Ctrl+B D）后 loop 继续跑，不受影响
- [x] 测试：runner 模板含 tmux 检测和 fallback；attach 命令存在/不存在两个分支

**Implementation 草图：**
```bash
# runner script 关键改动
SESSION="roll-loop-${slug}"
if command -v tmux >/dev/null 2>&1; then
  tmux kill-session -t "$SESSION" 2>/dev/null
  tmux new-session -d -s "$SESSION" -x 200 -y 50 \
    "cd '${project_path}' && ${cmd}"
  tmux pipe-pane -t "$SESSION" "cat >> '${log_path}'"
  while tmux has-session -t "$SESSION" 2>/dev/null; do sleep 5; done
else
  cd "${project_path}" && ${cmd} >> "${log_path}" 2>&1
fi
```

**Non-goals:**
- 不做"自动弹出 Terminal 窗口"（一天 14 次弹窗，干扰太大）
- 不做 desktop 通知（runs 命令已经够 pull-based 可见性了）
- 不强制依赖 tmux（没装就 fallback，不影响功能）

**Domain Model:**
- Context: Autonomous Evolution
- Aggregate: LoopScheduler
- New behavior: 跑 claude 的进程容器从裸 bash 子进程升级为 tmux session
- Files touched: bin/roll runner script template + 新 `_loop_attach` 函数

**Files:**
- `bin/roll`（`_write_loop_runner_script` 加 tmux 包装；新增 `_loop_attach` + `attach` 子命令分派）
- `tests/unit/roll_loop_attach.bats`
- 文档：`skills/roll-loop/SKILL.md` 加一行说明 attach 行为（人类操作指南）

**Dependencies:**
- 无硬依赖；tmux 是软依赖（运行时检测）

---

<a id="us-auto-026"></a>
## US-AUTO-026 默认 auto-attach + 极简 mute/unmute — context-aware 可见性 ✅

**Created**: 2026-05-11
**Completed**: 2026-05-11

- As a developer with active autonomous loops
- I want loop and peer to be visible by default — a Terminal window automatically appears when they run, without me having to type anything
- So that I can "watch it happen" while working on other things, and only suppress this when I genuinely don't want to see (one toggle)

**核心理念：**
US-AUTO-025 提供了 tmux 基建（可 attach）。026 把可见性的 UX 从"opt-in pull"反转成"default push, opt-out mute"——让显性化成为默认，符合"我就喜欢看着它自动发生"的直觉。

**三档体验**（同一架构下）：

```
档 1  默认 auto-attach     loop / peer 一触发，背景弹一个 Terminal 窗口
                          窗口内直接是 tmux attach 视图，看 claude 实时干活
                          窗口不抢焦点（osascript activate=false）
                          tmux session 结束后窗口保留最终输出供回看

档 2  mute（不弹）          roll loop mute   一键关弹窗
                          loop / peer 照常在 tmux 里跑，结果照常入库
                          想看可手动 roll loop attach 接入

档 3  unmute（恢复）        roll loop unmute  恢复弹窗
```

**与 US-AUTO-024（runs）和 US-AUTO-025（attach）的关系：**

```
024 runs       事后摘要      "刚才几次都干了啥"
025 attach     手动接入      "我现在主动想看一眼"
026 auto-push  默认弹出      "不用我操心，弹出来就在那"
```

三者互补，共用同一 tmux session 基建，可独立 mute/unmute 切换风格。

**AC:**
- [x] 默认行为：loop runner 启动 tmux session 后，若 `~/.shared/roll/mute` 不存在，调用 osascript 开一个新 Terminal 窗口执行 `tmux attach -t <session>`
- [x] osascript 调用使用等效方式不抢当前焦点：捕获前一个 frontmost app，弹窗后 `delay 0.3` + `tell application _prev to activate` 还原焦点
- [ ] ~~peer 调用时同样行为：bridge 启动 tmux session 后若未 mute，背景弹窗 attach~~ — **split to US-AUTO-027**（peer 当前无 tmux 基建，refactor 体量超出本 story 范围）
- [x] `roll loop mute`：创建 `~/.shared/roll/mute`（空文件即可）；输出"🔇 muted"
- [x] `roll loop unmute`：删除 `~/.shared/roll/mute`；输出"🔔 unmuted"
- [x] mute 状态在 `roll loop status` 显示一行：`Auto-attach  live | muted`
- [x] tmux session 结束后窗口不自动关闭（用户可读最终输出，⌘W 关闭）— Terminal `do script` 默认不自动关闭窗口
- [x] 测试：runner script 含 osascript 调用 + mute 文件存在性检测；mute/unmute 命令存在并正确读写（21 unit tests + 2 integration tests）
- [x] tmux 升级为必装依赖：`roll setup` 通过 `_ensure_tmux` 检测 tmux，没装则自动 `brew install tmux`（macOS）；非 macOS 给清晰安装命令
- [x] tmux 自动安装失败时给清晰错误信息和手动安装指引，不阻塞 setup 主流程（`_ensure_tmux` 总是返回 0）

**Non-goals:**
- 不做 mute duration（2h / today / until 22:00）—— 一个开关足够，复杂度收敛
- 不做窗口管理（多项目时怎么排列）—— 每个 tmux session 独立一个窗口，让用户的 WM / 系统多桌面处理
- 不做"focus-aware"（开会自动 mute）—— 用户自己 mute 就好，避免误判
- 不做 Linux 自动安装（包管理器差异大、可能要 sudo）—— 只给安装命令，让人手动跑

**Domain Model:**
- Context: Autonomous Evolution
- Aggregate: LoopScheduler + PeerNegotiator（共享 visibility 策略）
- New entity: MuteState（单文件，二元）
- Files touched: runner script template、peer bridge、新 `_loop_mute`/`_loop_unmute` 函数

**Files:**
- `bin/roll`（`_write_loop_runner_script` 加 osascript 调用 + mute 检测；新 `_loop_mute` / `_loop_unmute` 子命令；新 `_ensure_tmux` helper；`cmd_setup` 调用）
- `tests/unit/roll_loop_mute.bats`（新增 21 个用例）
- `tests/integration/cmd_loop.bats`（新增 2 个 E2E 用例：mute round-trip + runner 含 osascript）
- `skills/roll-loop/SKILL.md`（"Live attach" 段重写为 default auto-attach + mute/unmute 说明）

**Dependencies:**
- Depends on: US-AUTO-025（tmux 基建必须先有）
- Note: 本 story 把 tmux 从 US-AUTO-025 的"软依赖"升级为"必装依赖"，setup 时自动 `brew install tmux`
- Split off: US-AUTO-027（peer auto-attach — peer 无 tmux 基建，单独成 story）

---

<a id="us-auto-023"></a>
## US-AUTO-023 `roll loop pause / resume` — 人工模式切换 ✅

**Created**: 2026-05-11
**Completed**: 2026-05-11

- As a developer who wants to work manually without loop interference
- I want a lightweight pause/resume for the loop schedule
- So that I can switch between autonomous mode, human mode, and collaborative mode without full off/on cycle

**三种操作模式：**
```
纯自主模式   loop on，人不介入，只审 brief
人机协同     loop on，人随时插入，靠 🔨 协调（US-AUTO-022 保障）
纯人工模式   loop pause，人独占 repo，resume 恢复
```

**AC:**
- [x] `roll loop pause`：向 launchd 设置 disabled（不删 plist），写入 pause 原因和时间到 state file
- [x] `roll loop resume`：清除 disabled，恢复调度；区分 scheduler-resume（手动 pause 后恢复）与 interrupt-resume（崩溃后恢复）
- [x] `roll` dashboard 展示 pause 状态：`Loop  ⏸ paused   run: roll loop resume`
- [x] `roll loop status` 展示 pause 时长（计算 paused_at 到现在）
- [x] macOS / Linux 均支持（macOS: launchctl unload/load；Linux: PAUSE marker file in runner script）

**Domain Model:**
- Context: Autonomous Evolution
- Aggregate: LoopScheduler
- Files touched: `bin/roll`（`_loop_pause`、`_loop_resume`）、dashboard 展示

**Files:**
- `bin/roll`（`_loop_pause`、`_loop_resume`、`_dashboard`、`_loop_status`、`_write_loop_runner_script`）
- `tests/unit/roll_loop_pause.bats`（14 test cases）

**Dependencies:**
- Depends on: US-AUTO-022（pause 期间如有 LOCK 残留需清理）

---

<a id="us-auto-027"></a>
## US-AUTO-027 peer 调用 auto-attach — visibility for cross-agent negotiation ✅

**Created**: 2026-05-11
**Completed**: 2026-05-11
**Split from**: US-AUTO-026 (peer 当前没有 tmux 基建，单独成 story 实现)

- As a developer with cross-agent peer review enabled
- I want to see peer negotiations in real time the same way I see loop runs
- So that the auto-attach visibility model is consistent across all autonomous activity

**核心理念：**
US-AUTO-026 把 loop 的可见性反转成 "default push, opt-out mute"，但 peer 没有 tmux 基建（`_peer_call` 当前直接调 CLI 内联），所以 mute 文件 + osascript 弹窗只对 loop 生效。这条 story 把 peer 也接入同一模型。

**AC:**
- [x] `_peer_call` 启动 tmux session（命名 `roll-peer-<from>-<to>` 或类似）包裹 CLI 调用
- [x] 未 mute（`~/.shared/roll/mute` 不存在）时调用 osascript 背景弹窗 attach tmux session
- [x] CLI 输出捕获到 tmux 内 + log，与 loop 模式一致
- [x] peer review 多轮调用复用同一 session 或合理隔离（决策：一次 review 一个 session，3 轮在同一窗口内）
- [x] 测试：`_peer_call` 体内含 tmux 调用 + mute 检测
- [x] mute/unmute 复用 `roll loop mute/unmute`（一个开关控制所有自主活动，不分 loop/peer）

**Non-goals:**
- 不为每个 peer 调用单独开窗口（噪声过大）—— 一次 review 一个 session
- 不改 peer 协议本身

**Domain Model:**
- Context: Autonomous Evolution / Peer Review
- Aggregate: PeerNegotiator
- Files touched: `bin/roll` (`_peer_auto_attach`, `_peer_dispatch_in_tmux`, `_peer_call`, `cmd_peer`)
- Tests: `tests/unit/roll_peer_tmux.bats` (20 tests)

**Dependencies:**
- Depends on: US-AUTO-026（mute 文件约定 + osascript 模式）

---

<a id="us-auto-028"></a>
## US-AUTO-028 `roll-.dream` Scan 6 — 文档新鲜度持续监测 ✅

**Created**: 2026-05-12
**Completed**: 2026-05-12
**Plan**: [legacy-doc-automation-plan.md](legacy-doc-automation-plan.md)

- As a project maintainer running roll on a long-lived codebase
- I want dream's nightly scan to detect stale docs and undocumented conventions automatically
- So that documentation debt surfaces as REFACTOR entries in BACKLOG and gets fixed by loop without human reminders

**Domain Model:**
- Context: Autonomous Evolution
- Aggregate: DreamScanner owns [DocStalenessCheck]
- Events raised: [DocStalenessFound] → REFACTOR entry written → loop pickup

**AC:**
- [x] `roll-.dream` SKILL.md gains Scan 6 with three checks:
  - **A. Stale docs**: mapping = nearest `README.md` or `docs/features/*.md` that lists the file in its `## Files:` section; flag when owning doc's last commit is >30 days older than the code file's last commit AND doc contains at least one specific file path reference (not conceptual-only)
  - **B. Undocumented ENV vars**: grep for `process\.env\.[A-Z_]+` / `os\.getenv("[A-Z_]+"` / `ENV\["[A-Z_]+"` patterns; flag each variable appearing ≥5× in source with zero mentions in any `.md`; other "convention" signals (comment clusters, module structure) explicitly deferred — too vague for deterministic detection
  - **C. Existence drift** (distinct from Scan 2): module dirs with ≥3 source files and zero name-match in `docs/domain/*.md` — this is an *existence* check; Scan 2 remains responsible for *import boundary* violations
- [x] Scan 2 and Scan 6C never double-flag: Scan 2 flags cross-context imports; Scan 6C flags missing documentation entry
- [x] Each finding produces a `REFACTOR-XXX` entry: `docs: <description> — flagged by dream <date>`
- [x] Dream log gains `## 文档新鲜度` section: counts for stale docs / undocumented ENV vars / undocumented modules
- [x] Scan 6 is **skipped entirely** when US-SKILL-008 (`$roll-doc`) is not yet deployed — no fallback to `$roll-build` (avoids confusion in loop); dependency is strict
- [x] Once US-SKILL-008 deployed: REFACTOR entries carry `$roll-doc` as execution hint
- [x] Scan 6 findings flow into brief via existing dream log → brief pipeline

**Files:**
- `skills/roll-.dream/SKILL.md` (add Scan 6 section + update log template + update description frontmatter)
- `tests/unit/roll_dream_scan6.bats`

**Dependencies:**
- Depends on: US-SKILL-008 (Scan 6 only activates after roll-doc is deployed; strict dependency, no fallback)

---

<a id="us-auto-029"></a>
## US-AUTO-029 `roll` dashboard 重设计 — 自治优先布局 ✅

**Created**: 2026-05-12
**Completed**: 2026-05-12
**Promoted from**: IDEA-008

- As a developer opening a project that runs Roll
- I want the no-arg `roll` command to show "what the AI is autonomously doing" first
- So that Roll 的自治性是项目入口的第一眼信号，不是埋在 `roll loop status` 子命令里

**核心理念：**

Dashboard 是项目入口的「定格画面」（静态打印，非实时刷新——实时刷新归 `roll loop monitor`）。设计原则：**自治优先**。Roll 的卖点是"AI 自驱 + 三层自治 + 四道防线"，dashboard 必须把这些方法论可视化，让用户一眼看到"AI 在跑什么、什么时候跑、防线是否到位"，而不是"我有多少待办"。

**Domain Model:**
- Context: Autonomous Evolution / Visualization
- Aggregate: ProjectDashboard
- Reads from: `_LOOP_STATE`, `_LOOP_ALERT`, `BACKLOG.md`, `docs/briefs/*.md`, `runs.jsonl`, launchd 服务状态, `roll ci` 状态
- 无新数据写入，纯呈现层

**布局（六块，自上而下）：**

```
① Identity (单行)
   roll · v2026.512.8 · agent claude · git ✓

╔══ ② 🤖 AI 自治 — 三层 × 四道防线 (主视觉) ═══════════════╗
║  Loop Layer   ● enabled  every :08  active 10:00–18:00   ║
║               Now: 🔨 US-AUTO-029                         ║
║               last TCR 12min ago · 4 micro-commits today ║
║  Dream Layer  ● enabled  03:10                            ║
║               Last scan 6h ago → 2 REFACTOR queued        ║
║  Peer Layer   ● ready    on complexity=large              ║
║               Last call 2d ago · AGREE                    ║
║  ─ 四道防线 ─                                              ║
║  TCR ● 12min   Spar ○   Auto Review ●   Sentinel ○ off    ║
╚══════════════════════════════════════════════════════════╝

③ 📦 Pipeline 全景
   Idea 3 ▸ Backlog 8 ▸ Build 1🔨 ▸ Verify 0 ▸ Release 0

④ 📊 Current Focus · DoD (仅显示已接入信号)
   🔨 US-AUTO-029
    [✓ AC]  [○ CI]
    其余 4 项 DoD 信号源待接入：see US-AUTO-030/031, IDEA-013/014

⑤ 👤 需要你介入  (空时显示 "✓ AI 自驱中 — 无需介入")
   ⚠ 2 ALERT          run: roll alert
   📋 1 PROPOSAL      run: roll backlog
   ✓ Release ready    run: roll release

⑥ ⏰ Schedules & Last Brief
   loop :08 · dream 03:10 · brief 09:15
   Brief 6h ago — "Release ready: 3 items"
```

**AC:**
- [x] **① Identity 行**：项目名 + `v${VERSION}` + agent + git working tree 状态（clean/dirty）
- [x] **② AI 自治区块（主视觉）**：
  - Loop Layer：launchd 状态（enabled/installed-off/not-installed）+ 调度（`every :NN active HH:00–HH:00`）+ Now 行（in-progress story 标题）+ last TCR 时间（读 `git log --grep="^tcr:"`）+ 今日 tcr commit 计数
  - Dream Layer：launchd 状态 + 调度 + 最近 dream 日志时间 + 产出 REFACTOR 计数
  - Peer Layer：ready 静态 + last `_peer_call` 时间 + 结果（AGREE/REFINE/OBJECT/ESCALATE）
  - 四道防线行：TCR/Spar/Auto Review/Sentinel 四项，` ● 时间` 或 ` ○ off`
  - 视觉权重最高（框线 `╔══╗` 或缩进强化）
- [x] **③ Pipeline 全景**：5 段计数横排（Idea/Backlog/Build/Verify/Release），in-progress 段高亮
  - Idea = `IDEA-NNN` 状态 `📋 Todo` 行数
  - Backlog = US/FIX/REFACTOR 状态 `📋 Todo` 行数
  - Build = `🔨 In Progress` 行数
  - Verify = 暂占位 0（信号源同 DoD UAT，待 IDEA-013 解锁后填充）
  - Release = 暂占位 0（信号源同 DoD Prod，待 US-AUTO-030 解锁后填充）
- [x] **④ Current Focus · DoD**：仅当 Build 段 > 0 时显示。DoD checklist 只渲染 [AC] [CI]（其余 4 项不渲染，并在最后一行用 dim 文字注明"其余 DoD 信号源待接入：see US-AUTO-030/031, IDEA-013/014"）
  - [AC] 信号源：当前 story 的 `[x]` checkbox 完成度（读 `docs/features/<feature>.md#<us-id>`），全部勾选→ ✓，否则 ○
  - [CI] 信号源：调用 `roll ci`（HEAD commit 的 CI 状态），success → ✓，pending/failure → ○ / ✗
- [x] **⑤ Human × AI 区块**：ALERT / PROPOSAL（PROPOSALS.md 待审计数）/ Release ready（brief 摘要包含此关键词时）；三者都为空时显示 `✓ AI 自驱中 — 无需介入`
- [x] **⑥ Schedules & Last Brief**：三服务调度紧凑一行 + last brief 时间 + brief 第一行摘要
- [x] 非 macOS 环境降级：launchd 块换 cron 状态，schedules 块对应调整
- [x] 无 BACKLOG.md 时仍可运行（显示 usage + changelog 当前逻辑保留）
- [x] `tests/unit/roll_dashboard.bats` 覆盖六块的渲染分支（包括空状态/降级路径）

**Non-goals:**
- 实时刷新——归 `roll loop monitor`
- TUI 按键交互——违反"定格画面"定位
- UAT/Evidence/Prod/Sentinel 信号源接入——延后到 US-AUTO-030/031 + IDEA-013/014

**Files:**
- `bin/roll`：`_dashboard()` 函数（~3421 行）重写
- `tests/unit/roll_dashboard.bats`：更新覆盖

**Dependencies:**
- 现有读源：`_LOOP_STATE`、`_LOOP_ALERT`、`_launchd_svc_state`、`_config_read_int`、`_loop_derive_minute`、`roll ci`、`docs/briefs/*.md`、`runs.jsonl`、`PROPOSALS.md`（如存在）
- Follow-up（不阻塞本 story）：US-AUTO-030（Prod 信号）、US-AUTO-031（Sentinel 信号）、IDEA-013（UAT）、IDEA-014（Evidence）

---

<a id="us-auto-030"></a>
## US-AUTO-030 dashboard DoD — Prod 部署回填信号源 ⏸ Deferred

**Created**: 2026-05-12
**Deferred reason**: Dashboard MVP（US-AUTO-029）只渲染 [AC] [CI]；Prod 信号源需先确定回填位置（in-progress story 元数据 vs runs.jsonl vs 新增 deploys.jsonl），不阻塞 dashboard 上线。

- As Roll 用户
- I want `roll release` 完成后 dashboard 能反映"Prod 已部署"
- So that DoD 的 [Prod] 信号能从占位 `—` 升级为 `✓`，方法论闭环可视化

**Open questions:**
- 回填位置：写入 in-progress story 行（需 Markdown 解析）？写 `runs.jsonl` 增加 `deploy` 事件？新增 `deploys.jsonl`？
- 多次发版同一 story 怎么算（首次部署即 ✓？最后一次？）
- non-npm 项目（无 release 概念）的降级路径

---

<a id="us-auto-031"></a>
## US-AUTO-031 dashboard DoD — Sentinel 接管状态信号源 ⏸ Deferred

**Created**: 2026-05-12
**Deferred reason**: `$roll-sentinel` skill 已存在，但运行结果与 dashboard 的连接（数据格式 + 时效窗口）需单独设计。不阻塞 dashboard MVP。

- As Roll 用户
- I want dashboard 显示"Sentinel 接管中"状态（含最近巡检时间 + 异常计数）
- So that 方法论"Sentinel 24/7 巡逻"承诺有可视化证据

**Open questions:**
- Sentinel 运行结果存哪里（log 文件 / sentinel.jsonl / brief）
- "接管中"的判定窗口（最近 24h 有巡检？最近 7d？）
- 异常告警与现有 `_LOOP_ALERT` 是否合并

---

<a id="us-auto-032"></a>
## US-AUTO-032 loop 在 worktree 里跑 — TCR 隔离 📋

**Created**: 2026-05-12
**Promoted from**: IDEA-015
**Peer review**: claude → kimi (architecture, REFINE → incorporated)

- As a Roll user with WIP on main while loop is scheduled
- I want loop runs to never touch my working tree
- So that loop's TCR commits never silently absorb my unstaged WIP (witnessed in commit 1989800 where dashboard story files got bundled into a REFACTOR-008 commit)

**核心理念：**

**控制面 vs 数据面**——launchd plist 与 runner script 是**控制面**，绑定项目身份（slug），常驻 main tree 路径不变；每个 story 起一个**临时 worktree** 作为**数据面**，绑定故事身份（US-ID），生命周期 = story 生命周期。`merge --ff-only` 是唯一回写路径，main tree 在 merge 之前永远只读。

**Domain Model:**
- Context: Autonomous Evolution / Loop Execution
- Aggregate: LoopRunner owns [Worktree, StoryBranch]
- Events raised: [WorktreeCreated] · [StoryMerged] → main pushed · [WorktreeRetained] → ALERT
- Invariants:
  - main 工作树在 merge 那一刻之前永远不被 loop 修改
  - `loop/<US-ID>` 分支永不 push 到 remote
  - 成功路径必清理 worktree+branch；失败路径必保留 worktree+branch+log

**Flow:**

```
runner 起跑
  ├─ git worktree add ~/.shared/roll/worktrees/<slug>-<US> -b loop/<US> main
  │   └─ 分支已存在（重试场景）→ 先 git branch -D loop/<US> 再 add
  ├─ cd worktree && git submodule update --init --recursive
  ├─ skill 执行（TCR 微提交全发生在 loop/<US> 分支）
  ├─ ┌─ 成功 + CI 绿
  │  │   ├─ cd main，git merge --ff-only loop/<US>
  │  │   │   ├─ 成功 → git push → 删 worktree + 删分支
  │  │   │   └─ ff-only 失败（main 移动 / dirty）→ 保留 worktree，写 _LOOP_ALERT
  │  └─ 失败（TCR / CI 红）→ 保留 worktree + 分支 + log，写 _LOOP_ALERT
```

**AC:**
- [ ] runner 起跑前创建 worktree：`git worktree add ~/.shared/roll/worktrees/<slug>-<US> -b loop/<US> main`
- [ ] 重试幂等：若 `loop/<US>` 分支已存在（上次失败遗留），先 `git branch -D loop/<US>` 再 add；通过单测覆盖
- [ ] worktree 内 `git submodule update --init --recursive`（Roll 自身依赖 `tests/helpers/bats-core`）；明确测试 submodule 在 worktree 与 main 同时存在时**不互相破坏**（在 unit test 模拟）
- [ ] skill 在 worktree 内执行（claude/kimi/agent 命令的 cwd 指向 worktree）
- [ ] 成功 + CI 绿 → 回 main → `git merge --ff-only loop/<US>` → push → 删 worktree + 分支
- [ ] ff-only 失败（main 移动或 dirty）→ 保留 worktree + 分支；通过 `_LOOP_ALERT`（不是新 alerts.log）写入 worktree 路径与"请手动 merge"指令
- [ ] TCR / CI 失败 → 保留 worktree + 分支 + log；同样通过 `_LOOP_ALERT` 写入路径
- [ ] plist / runner 路径不变（控制面常驻 main tree）
- [ ] tmux session 命名加 story 后缀：`roll-loop-<slug>-<US>` 而非 `roll-loop-<slug>`，避免同项目多 story 冲突
- [ ] LOCK 仍按 slug 单锁（不开并发，未来 US 再做）
- [ ] 单测：worktree create/cleanup/retry-idempotent/ff-only-success/ff-only-failure/tcr-failure 共 6 路径

**Non-goals（明确切出）:**
- 跨 story 并发（仍单 LOCK）→ 另起 US
- Worktree 自动陈旧扫描（stale > 7d）→ 走 `roll-doctor` 作为单独 FIX
- 主项目以外的 worktree 形态优化（node_modules 缓存、build artifact 复用）→ 项目专属事
- Auto-rebase（main 移动时自动 rebase loop/<US>）→ 先观察 ALERT 频率，必要时另起 US

**Files:**
- `bin/roll`: `_write_loop_runner_script`（worktree 创建+清理逻辑）+ `_loop_now`（同步）+ 新增 `_worktree_path` `_worktree_cleanup` 辅助
- `tests/unit/roll_worktree.bats`（新增，6 路径覆盖）
- `tests/integration/cmd_loop.bats`（加 worktree 集成断言）

**Risks (kimi flagged):**
- **Submodule WD collision**: worktree 内 `submodule update` 可能与 main 的 submodule 工作区互相覆写——AC 明确要求测试这点
- 已在 Non-goals 排除：自动陈旧扫描（避免范围蔓延），但失败 worktree 不会自动 GC，user/loop 多次失败会留多个目录——需在 ALERT 文案中提醒"请检查 worktrees 目录"

**Dependencies:**
- 依赖：现有 `_LOOP_ALERT` 机制（不引入新 alert log）
- Depended on by: 未来跨 story 并发 US、worktree GC FIX
