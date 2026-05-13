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
## US-AUTO-032 loop worktree 隔离（已拆分） ✅ Split

**Created**: 2026-05-12
**Status**: 拆分为 US-AUTO-036（loop-safe helpers）+ US-AUTO-037（manual runner integration）
**Rationale**: 按「自我修改悖论」拆分标准——loop 自己跑 runner.sh，故事修改 runner.sh 等于在飞行中换发动机，无法在当前 run 内验证。详见 [loop-pr-pipeline-plan.md](loop-pr-pipeline-plan.md)。

参见：
- [US-AUTO-036](#us-auto-036) — 纯加法 helpers + 单测，loop 可自动执行
- [US-AUTO-037](#us-auto-037) — runner orchestration 接入，**人工执行**

---

<a id="us-auto-033"></a>
## US-AUTO-033 loop 自动建 PR + GitHub Auto-merge 📋

**Created**: 2026-05-13

- As a product owner using roll-loop
- I want completed stories to automatically create a PR and enable auto-merge
- So that merged-to-main is fully autonomous once CI passes, with no manual steps

**Domain Model:**
- Context: Autonomous Evolution
- Aggregate: Story delivery pipeline
- Events raised: [StoryPRCreated] → GitHub auto-merge → [StoryMergedToMain]

**Background:**
当前 roll-build Phase 8 直接 `git push origin main`，人工介入为零但绕过了 PR 审计链。
另一个问题是：每次 loop push 分支后，GitHub 会在仓库首页显示 "Compare & pull request" banner，
需要人手动点击或让 agent 操作。本 Story 把 PR 创建和 auto-merge 纳入 loop 自动流程，
人完全不需要介入，同时保留 PR 作为审计和 rollback 入口。

**AC:**
- [ ] roll-build Phase 8 改为推到 feature 分支（`loop/<US-ID>`），不再直接推 main
- [ ] CI 通过后（Phase 9），用 `gh pr create` 自动建 PR：
  - title: `{US-ID}: {story description}`
  - body: 包含 story AC 摘要、TCR micro-commit 数量、CI 状态
  - base: `main`，head: `loop/<US-ID>`
- [ ] PR 创建后立即执行 `gh pr merge --auto --squash`，开启 GitHub auto-merge
- [ ] GitHub auto-merge 要求 repo 开启 "Allow auto-merge" 设置（在 repo Settings → General）；`roll setup` 或文档中说明此前提
- [ ] CI 失败时不建 PR，走现有 ALERT 路径
- [ ] loop 跑完后 `roll loop runs` 展示中加一列：PR URL（若已建）
- [ ] 幂等：同一 `loop/<US-ID>` 分支若 PR 已存在，不重复创建，复用已有 PR URL

**Non-goals:**
- PR review 流程（require review / approve）→ 目标是全自动，不加人工审批
- 多 base branch 支持 → 固定 main
- PR label / assignee / milestone → 后续可扩展

**Files:**
- `skills/roll-build/SKILL.md`（Phase 8 改推分支，Phase 9 后加 PR 创建步骤）
- `bin/roll`（`_loop_runs_format_line` 加 PR URL 列）
- `docs/guide/en/methodology.md`（说明 PR + auto-merge 是 loop 交付终态）

**Dependencies:**
- `depends-on:US-AUTO-037` — runner 必须先在 worktree + `loop/<US>` 分支上工作（不再直推 main）
- 前提：GitHub repo 开启 "Allow auto-merge"（**已开**，2026-05-13）

## US-AUTO-034 loop 起跑先消化开放 PR 再领新 backlog 📋

**Created**: 2026-05-13
**Reframed**: 2026-05-13 — 从原版「avoid pending PR」改为「process pending PR first」

- As a Roll user / external contributor / peer agent
- I want loop to treat open PRs as the first class of work, not as obstacles
- So that pending review/merge tasks get cleared before loop opens new fronts, and PRs never starve while loop pumps new commits

**Domain Model:**
- Context: Autonomous Evolution / Loop Execution
- Aggregate: `LoopRunner` adds `PRInbox` responsibility (open PR queue)
- Events raised: [PRReviewed approve|request-changes] · [PRStaleDetected] · [PREscalated] → ALERT
- Invariants:
  - **PR-first**：每轮 cron 必须先扫开放 PR，PR 处理完才扫 BACKLOG
  - loop 自有 PR（`headRef=loop/<US>`）已设 auto-merge，本轮不重复处理，让 GitHub 平台完成
  - 外部 / 人工 PR → 走 AI 评审（US-AUTO-035 的 approve/request-changes 机制）
  - PR 处理失败（评审 escalate / rebase 失败）→ 写 ALERT，**不阻塞**继续扫 BACKLOG（除非该 PR 命中了 BACKLOG 中待领的 story）

**Background:**
原版 US-AUTO-034（PR-avoid）把开放 PR 当作障碍物，loop 撞到就退让。新版反转思路：**PR 也是工作单元**——loop 应该先把队列里的开放 PR 推进一格（评审、approve、rebase、merge）再去领新 BACKLOG。这跟 autonomous-evolution 的整体模型对齐：人/外部贡献者开的 PR 也应被自治流水线处理，不靠用户手动 click。

**Flow:**

```
[cron 起跑]
   │
   ├─ Step A: gh pr list --state open --json number,headRefName,author,title,body
   │
   │  for each PR:
   │   ├─ headRefName == "loop/<US>" (loop 自己开的)
   │   │     └─→ 检查是否已 auto-merge 中 → 是则跳过（GitHub 平台会处理）
   │   │         非（auto-merge 被取消？）→ 重新 gh pr merge --auto，写 INFO
   │   │
   │   ├─ author != loop & 非 stale (CI 绿、up-to-date)
   │   │     └─→ 调 US-AUTO-035 的 review 机制
   │   │           ├─ approve → gh pr review --approve → 标 auto-merge → 继续下一 PR
   │   │           ├─ request-changes → gh pr review --request-changes + 评论 → ALERT escalate
   │   │           └─ uncertain → ALERT escalate (need human)
   │   │
   │   └─ stale (CI 红 / out-of-date)
   │         └─→ 尝试 git fetch + rebase onto origin/main，push 重跑 CI
   │             ├─ 成功 → 等下一轮 cron 再次评估
   │             └─ 冲突 → ALERT 含 PR 链接 + "请手动 rebase"
   │
   ├─ Step B: 等所有 PR Step A 处理完毕（或全部 escalate 到 ALERT）
   │
   └─ Step C: 按现有 Step 2 扫 BACKLOG 领新 📋 Todo
              （新故事开新 PR → 进入下一轮 Step A 队列）
```

**AC:**
- [ ] `bin/roll` 新增 `_loop_pr_inbox()` 总调度函数 + 子函数 `_loop_pr_classify`（按 author/branch/CI 分类） + `_loop_pr_rebase_stale`（rebase 卡住的 PR）
- [ ] `gh` 未安装 / 仓库不可解析 / 调用失败 → 跳过 Step A，继续 Step C（lenient，与现有 CI gate 一致）
- [ ] 调 `claude-code-review`-style review 机制（具体由 US-AUTO-035 提供）；本 Story 只负责**调度**，不负责实现 review 逻辑
- [ ] loop 自己 `loop/<US>` 分支：识别后跳过，不重复触发 review（避免 self-review）
- [ ] **Human-review-activity guard**（kimi peer review 2026-05-13 加入）：对外部 PR 调 US-AUTO-035 review 前，先 `gh pr view <N> --json reviews`：
  - 最近 human review (`author_association != BOT|APP`) 是 `CHANGES_REQUESTED` → skip AI review + ALERT「PR #N pending human changes — skipping auto-review」
  - 最近 human review 是 `APPROVED` → skip AI review，让 GitHub 在 CI 绿后自动合
- [ ] **Rebase 熔断器**（kimi peer review 2026-05-13 加入）：每个 PR 的 rebase 行为记录在 state.yaml `pr_state.<PR#N>.rebase_attempts`：
  - 单 PR 24h 内 `rebase_attempts >= 3` → **停止 rebase**，写 ALERT「PR #N rebased 3× without CI resolution — possible workflow file error」
  - 24h 滑动窗口（条目带时间戳，过期清理）
  - 防止 workflow-broken 等场景下无限 rebase 循环
- [ ] 外部 / 人工 PR：approve 后等 GitHub auto-merge（CI 绿 + AI approve 双门，见 US-AUTO-035）
- [ ] `skills/roll-loop/SKILL.md` 新增 Step A「PR Inbox」放在 Step 1.5（CI 健康检查）之后、原 Step 2（扫 BACKLOG）之前
- [ ] runs.jsonl 新加字段 `pr_processed: [PR#N, ...]`（schema 扩展，FIX-018 之后第二次扩展，必须文档化）
- [ ] state.yaml schema 扩展：`pr_state: {"<PR#N>": {"rebased_at": ISO8601, "attempts": int}}`
- [ ] 单测 `tests/unit/roll_loop_pr_inbox.bats` 覆盖：自有 PR 跳过 / 外部 PR 调 review / stale PR rebase 成功 / stale PR rebase 冲突 / **rebase 熔断 (3 次后 ALERT)** / **human CHANGES_REQUESTED 时 skip** / **human APPROVED 时 skip** / gh 不可用 共 8 路径
- [ ] 集成测试 `tests/integration/cmd_loop.bats` 加一个用例：mock `gh pr list` 与 review 接口，断言 PR Step A 先于 BACKLOG Step C

**Non-goals:**
- 不在 review 逻辑里实现 approve/request-changes 的判定（那是 US-AUTO-035 的事）
- 不处理已 close/merged 的 PR — 只看 `--state open`
- 不自动合并 require-changes 后又被改的 PR — 仍等下一轮 cron 重新走 Step A
- 不替代人工最终决策：所有 escalate → ALERT，由人裁定

**Files:**
- `bin/roll`：`_loop_pr_inbox` + 子函数族
- `skills/roll-loop/SKILL.md`：Step A 新增
- `tests/unit/roll_loop_pr_inbox.bats`（新增）
- `tests/integration/cmd_loop.bats`（加 1 个用例）
- `docs/features/loop-pr-pipeline-plan.md`：本 Story 在整体管线中的位置

**Risks:**
- **Self-review 风险**：loop 调 AI review 评审 loop 自己开的 PR，同源 bias。AC 已要求识别 `loop/<US>` 分支跳过；后续可考虑路径 D（跨 agent peer review）
- ~~**吞噬人工修改窗口**~~：已通过 Human-review-activity guard AC 缓解（kimi 2026-05-13 REFINE）
- ~~**无限 rebase 循环**~~（workflow 文件错时 CI 永不跑）：已通过 Rebase 熔断器 AC 缓解（kimi 2026-05-13 REFINE）
- 速率限制：每轮 cron 调多次 `gh pr review`，正常项目流量级远低于 GitHub API quota

**Dependencies:**
- `depends-on:US-AUTO-035` — review 机制由 035 提供
- `depends-on:US-AUTO-033` — 没 PR 流量，PR-first 无用武之地
- 与 US-AUTO-036/037（worktree）独立

## US-AUTO-035 claude-code-review.yml 加 approve/request-changes 能力 📋

**Created**: 2026-05-13

- As the autonomous evolution pipeline
- I want a GitHub Action that not only comments but also approves or requests changes on PRs
- So that AI review becomes a hard merge gate alongside CI (path C: CI green AND AI approved → auto-merge)

**Domain Model:**
- Context: Autonomous Evolution / MergeGate
- Aggregate: `MergeGate` owns [CICheck, AIReviewer]
- Events raised: [PRApproved] · [PRChangesRequested] · [ReviewEscalated] → ALERT
- Invariants:
  - AI review 决策必须可审计（评论里包含理由）
  - approve / request-changes 是**双向操作**，AI 评审失败时必须能 `--request-changes`，不能只 approve
  - 紧急 hotfix 须有 escape hatch（人工绕过 AI gate）

**Background:**
当前 `claude-code-review.yml` 权限是 `pull-requests: read`，只能发评论。要做路径 C（CI 绿 + AI 评审通过双门），action 必须能 `gh pr review --approve` / `--request-changes` 来真正影响 merge 决策。

**Flow:**

```
PR opened/synchronize
   ↓
claude-code-review action 触发
   ↓
评审 diff（按 code-review skill）
   ├─ 通过：gh pr review --approve --body "<理由摘要>"
   ├─ 不通过：gh pr review --request-changes --body "<具体问题>"
   └─ 不确定（cross-cutting / 大改）：发评论，不 approve 不 reject，写 ALERT 待人裁
        ↓
[GitHub 平台]
   ├─ CI 绿 + approve → auto-merge 触发 → squash & merge
   ├─ CI 绿 + request-changes → 卡住，等下一次 push 触发新评审
   └─ CI 红 → 任何情况都不合
```

**AC:**
- [ ] `.github/workflows/claude-code-review.yml` permissions 改：`pull-requests: write`（保留 contents: read）
- [ ] action 内 prompt 改为评审 + 决策双产物：approve / request-changes / escalate 三种结果
- [ ] approve 时调 `gh pr review --approve --body "$body"`，body 包含决策理由摘要
- [ ] request-changes 时调 `gh pr review --request-changes --body "$body"`，body 包含具体问题清单
- [ ] uncertain 时只发普通评论 + 写 `_LOOP_ALERT`（loop 跑完后可见）
- [ ] **Escape hatch**：PR body 含 `[skip-ai-review]` tag 或 commit message 含 `SKIP_AI_REVIEW`，action 跳过评审并直接 approve（紧急 hotfix 通道）
- [ ] action 失败（API 报错、prompt 超时）→ 不 approve、不 reject，发评论说明，由 CI gate 单独把关
- [ ] 同步开 repo `required_pull_request_reviews=1`，使「CI 绿 + AI 评审通过」成为合并双门（须人工 PATCH branch protection）
- [ ] 文档：`docs/features/loop-pr-pipeline-plan.md` 写明路径 A → C 切换步骤
- [ ] 集成验证：开一个故意有问题的测试 PR，确认 AI request-changes 卡住 merge

**Non-goals:**
- 不实现跨 agent peer review（路径 D，由后续 US 落）
- 不自动合 PR — auto-merge 仍由 US-AUTO-033 的 `gh pr merge --auto` 触发
- 不评审 PR 模板/格式（如 title 规范），只评审代码 diff

**Files:**
- `.github/workflows/claude-code-review.yml`（permissions + prompt 改写）
- `bin/roll`：`roll setup` 提示开启 `required_pull_request_reviews` 的 API call 命令
- `docs/features/loop-pr-pipeline-plan.md`：路径 C 切换记录

**Risks:**
- **同源 bias**：claude 评 claude 写的代码，可能放行同源思维 bug。Escape hatch 与未来路径 D 是缓解
- **Action 失败假阳性**：API 抖动导致评审失败时若 fallback 是 approve，等于放行所有；AC 已设计 fallback 是「不动作」，merge 卡在缺少 review 状态，更安全
- **紧急情况太多 escape hatch**：若团队习惯性加 `[skip-ai-review]`，AI gate 失效。需定期审计 skip 比例

**Dependencies:**
- `depends-on:US-AUTO-033` — 没 PR 流，AI approve 无对象（technical 上可独立部署，value 上挂钩）
- 前提：repo 开启 `required_pull_request_reviews=1`（落地时同步操作）
- Depended on by: US-AUTO-034 (PR-first inbox 调用本 Story 的 review 机制)

## US-AUTO-036 worktree 隔离 Phase 1：helpers + 单测（loop-safe） ✅

**Created**: 2026-05-13
**Completed**: 2026-05-13
**Split from**: US-AUTO-032

- As the loop runtime that should not break by changing the runner that spawned it
- I want worktree helper functions delivered as pure additions, fully unit-tested, without touching runner.sh
- So that loop can safely deliver them in one cycle, and US-AUTO-037 (runner integration) becomes a low-risk pure wiring task afterward

**Domain Model:**
- Context: Autonomous Evolution / Loop Execution
- Aggregate: LoopRunner gains [WorktreeHelpers]（独立的 helper 命名空间，不接入 runner）
- Events raised: 无（纯函数库，不改运行行为）
- Invariants:
  - **不修改 runner.sh / launchd plist / cron** ── 保证 loop-safe
  - 所有 helpers 必须在 unit test 中独立验证，不依赖真实 git remote

**Scope (loop-safe additions only):**

新增的 helper 函数（放在 bin/roll，命名空间 `_worktree_*`）：
- `_worktree_path <slug> <us-id>` → 返回 `~/.shared/roll/worktrees/<slug>-<us-id>`
- `_worktree_create <path> <branch> <base>` → `git worktree add ... -b <branch> <base>`，处理分支已存在的幂等性（先 `git branch -D` 再 add）
- `_worktree_cleanup <path> <branch>` → `git worktree remove --force` + `git branch -D`
- `_worktree_fetch_origin <branch>` → `git fetch origin <branch> --quiet`，lenient on failure
- `_worktree_submodule_init <path>` → cd 进 worktree 跑 `git submodule update --init --recursive`，验证与 main 工作区共存
- `_worktree_merge_back <branch>` → 回 main → `git pull --ff-only` → `git merge --ff-only <branch>` → `git push`，失败写 `_LOOP_ALERT`

**AC:**
- [x] 上述 6 个 helper 函数全部加入 `bin/roll`（外加 `_worktree_alert` 共 7 个），函数注释含「loop-safe / 不被 runner 调用」说明
- [x] 新增 `tests/unit/roll_worktree.bats` 覆盖 7 路径：
  - create-fresh / create-with-existing-branch (幂等) / cleanup / fetch-success / fetch-failed-lenient / merge-back-ff-success / merge-back-ff-failure-alert
- [x] submodule 协同测试：单测搭建 file:// 子模块，main 已 init，验证 worktree 内 `_worktree_submodule_init` 不破坏 main 工作区
- [x] **零行 runner.sh 变更**——`_write_loop_runner_script` 函数体未触碰，diff 仅在 `_worktree_*` 新命名空间
- [x] **零行 launchd plist / cron 变更**

**Non-goals:**
- 不接入 runner（那是 US-AUTO-037）
- 不写 `tests/integration/cmd_loop.bats` 集成测（也在 US-AUTO-037）
- 不删除原 worktree 失败时遗留——靠 ALERT 提示人查目录，自动 GC 走 `roll-doctor` 另一个 FIX

**Files:**
- `bin/roll`：新增 `_worktree_*` 函数族（7 个 helpers）
- `tests/unit/roll_worktree.bats`（新增，11 个用例）

**Risks:**
- helpers 写好了但暂时无人调用，可能被未来重构误删——加注释「Phase 1 of worktree; called by Phase 2 (US-AUTO-037)」防误删

**Delivery notes (2026-05-13):**
- 3 个 TCR commits: lifecycle (6499c3d) / fetch+submodule (9bb4757) / merge_back (41e424e) + 1 CI fixture fix (`init.defaultBranch=main` for ubuntu)
- CI 绿（test-unit + test-integration）on commit 41e424e+1
- `git diff origin/main..HEAD bin/roll` 仅两块 hunk，全部位于 `_worktree_*` 块内（~line 3008+, 3079+），`_write_loop_runner_script` (~line 2042) 零改动

**Dependencies:**
- 无前置依赖（纯加法）
- Depended on by: US-AUTO-037（接入 runner）

## US-AUTO-037 worktree 隔离 Phase 2：runner 接入 + 集成验证（人工） 📋

**Created**: 2026-05-13
**Split from**: US-AUTO-032
**Execution constraint**: `manual-only:true` — **不允许 loop 自动执行**，必须 `$roll-build US-AUTO-037` 人工接管

- As a Roll maintainer
- I want to wire the worktree helpers (US-AUTO-036) into `_write_loop_runner_script` and verify end-to-end behavior manually
- So that the self-modification risk (loop changing the runner that spawned it) is contained by human supervision

**Why manual-only:**

按「自我修改悖论」拆分标准：本 Story 修改 runner.sh，loop 不能在当前 run 内验证新 runner——新 runner 只有下一轮 cron 才会生效，而下一轮就是它的第一次生产运行。若引入 bug，未来 loop 全坏且可能静默降级。所以必须人工：(a) build，(b) `roll loop test` 真 claude 链路验证，(c) 手动触发一轮 cron 观察 worktree 生命周期完整，(d) 通过后再让 loop 继续。

**Scope (runner integration):**

`_write_loop_runner_script` 起跑路径改为：

```bash
# 起跑前
git fetch origin main --quiet                                          # 用 _worktree_fetch_origin
WT="~/.shared/roll/worktrees/<slug>-<US>"
git worktree add "$WT" -b "loop/<US>" origin/main                      # 用 _worktree_create
cd "$WT" && git submodule update --init --recursive                    # 用 _worktree_submodule_init
# tmux session 命名加 US 后缀
SESSION="roll-loop-<slug>-<US>"

# skill 在 worktree 内执行 (cwd=$WT)

# 完成后
if [ "$?" = "0" ] && ci_green; then
  cd <main-tree>
  git pull --ff-only origin main      # 用 _worktree_merge_back 的前半段
  git merge --ff-only "loop/<US>"
  git push
  git worktree remove "$WT"
  git branch -D "loop/<US>"
else
  echo "保留 worktree: $WT" >> $_LOOP_ALERT
fi
```

**AC:**
- [ ] `_write_loop_runner_script` 接入 US-AUTO-036 的 6 个 helpers，**不重复实现** worktree 操作逻辑
- [ ] tmux session 命名带 US 后缀（`roll-loop-<slug>-<US>`）以支持同项目多 worktree（虽然 LOCK 仍是单锁，但避免重启时旧 session 残留冲突）
- [ ] LOCK 协议**不变**（per-slug 单锁）—— 跨 story 并发是未来 US，本 Story 仍单 LOCK
- [ ] 集成测试 `tests/integration/cmd_loop.bats` 加端到端用例：完整模拟一轮 cron，断言 worktree 创建 → skill 跑通 → merge 回 main → worktree 清理
- [ ] 失败路径测试：TCR 失败 / CI 失败 / ff-only 失败时 worktree 必须保留 + `_LOOP_ALERT` 写入路径
- [ ] **手动验证清单**（执行 build 后必跑）：
  - `roll loop test` 真 claude 链路通过
  - `roll loop now` 触发一轮，watching `~/.shared/roll/worktrees/` 看 worktree 完整生命周期
  - 故意制造一个 TCR 失败 story，验证 worktree 保留 + ALERT 写入
  - 一轮 cron 真实触发（等 launchd），确认 plist 路径仍指向 main tree、runner 在 worktree 跑

**Non-goals:**
- 跨 story 并发（仍单 LOCK）→ 另起 US
- Worktree 自动陈旧扫描（stale > 7d）→ 走 `roll-doctor` 作为单独 FIX
- Auto-rebase（main 在 fetch 后又移动时自动 rebase loop/<US>）→ 先观察 ALERT 频率，必要时另起 US

**Files:**
- `bin/roll`：`_write_loop_runner_script` 改造 + `_loop_now`（同步）
- `tests/integration/cmd_loop.bats`（端到端用例）
- `docs/features/loop-pr-pipeline-plan.md`：标注本 Story 已落地

**Risks (kimi flagged in original US-AUTO-032):**
- **Submodule WD collision**：worktree 内 `submodule update` 可能与 main 的 submodule 工作区互相覆写——靠 US-AUTO-036 的单测覆盖 + 本 Story 集成测重复验证
- 失败 worktree 不会自动 GC：ALERT 文案明确提醒"请检查 worktrees 目录"

**Dependencies:**
- `depends-on:US-AUTO-036` — helpers 必须先到位
- 前提：`manual-only:true` 标签——roll-loop SKILL Step 2 选 story 时必须**跳过**所有 `manual-only:true` 的故事
