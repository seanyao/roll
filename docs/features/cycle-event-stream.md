# Feature: cycle-event-stream

<a id="us-loop-001"></a>
## ✅ US-LOOP-001 cycle 结构化事件流 — runner / SKILL emit 标签事件，monitor 与 attach 直接渲染

**Created**: 2026-05-17
**Completed**: 2026-05-17
**Plan**: [cycle-event-stream-plan.md](cycle-event-stream-plan.md)

- As a roll 用户
- I want `roll loop attach` 和 `roll loop monitor` 让我一眼看清 cycle 正在哪个阶段
- So that 我不必从 agent 自言自语的原始流里自己 parse，看 loop 干活像看 CI pipeline

**Domain Model:**
- Context: Loop Observability
- Aggregate: Cycle Event (Root) owns [Event, EventFile]
- Events raised: 无新增 domain event（本 US 本身就是定义 event 表达层）
- Cross-context: roll-loop / roll-build / roll-peer 三个 SKILL 需协同 emit

**AC:**
- [x] 新增 `_loop_event` shell helper（bin/roll）：参数 `<stage> <label> <detail> <outcome>`，同时输出到 stdout（tab-sep）和 `~/.shared/roll/loop/events-<slug>.ndjson`（JSON）
- [x] helper 使用 `flock` 串行化 NDJSON 追加，避免并发触发的事件交错（macOS 降级为 `lockf`，两者均不可用时直接 append）
- [x] cycle runner 在 worktree 创建后 emit `cycle_start`，idle 路径 emit `idle`，发布完成 emit `cycle_end`
- [x] roll-loop SKILL 选定 story 时调用 helper emit `story` 事件
- [x] roll-peer SKILL 每轮协商完成 emit `peer` 事件（含 round N/M 和 outcome）
- [x] roll-build SKILL 整个 TCR 阶段完成 emit `build` 事件（含提交数 / 耗时 / zero-diff revert 计数）
- [x] `_loop_enforce_ci` 旁 emit `ci` 事件（green / red / heal-attempting）
- [x] `_loop_publish_pr` 旁 emit `pr` 事件（auto-merged / failed）
- [x] `events-<slug>.ndjson` 单文件超过 10MB 自动轮转，保留最近 5 份
- [ ] `roll loop attach` 接入 tmux 看到的事件行以颜色区分 stage（绿 ok / 红 fail / 黄 warn / 灰 idle）
- [x] `roll loop monitor` 读 NDJSON 渲染当前 cycle 进度条 + stage 标记（新增 events section + `roll loop events [N]` 子命令）
- [x] 录制一份样本 NDJSON 文件（典型成功 cycle 一轮），存于 `docs/site/cycle-sample.ndjson`，作为 landing page 动画的 fixture
- [x] 单元测试覆盖 helper 函数的 stdout/NDJSON 写入、flock 串行化、文件轮转
- [x] 集成测试覆盖 `loop test` 跑完后 events-*.ndjson 字段完整性

**Files:**
- `bin/roll` — 新增 `_loop_event` helper、轮转逻辑；现有 echo `[loop]` 处补 helper 调用
- `skills/roll-loop/SKILL.md` — Story 选取阶段加 emit step
- `skills/roll-build/SKILL.md` — Phase 5 结束加 emit step
- `skills/roll-peer/SKILL.md` — 每轮决议加 emit step
- `tests/unit/loop_event.bats` — helper 行为单元测试
- `tests/integration/cmd_loop_event.bats` — 端到端事件流完整性
- `docs/site/cycle-sample.ndjson` — landing page fixture
- `docs/features/cycle-event-stream.md` / `cycle-event-stream-plan.md` — 本 feature 文档

**Dependencies:**
- Depends on: 无
- Depended on by: US-WEB-001（landing page 动画消费 cycle-sample.ndjson）

**Data Flow:**
- Producer: cycle runner（boundary 事件）+ 三个 SKILL（domain 事件）
- Consumer: `roll loop attach`（tmux 直读）/ `roll loop monitor`（NDJSON 渲染）/ landing page Terminal 组件（fixture 回放）
- Integration test: `tests/integration/cmd_loop_event.bats`

---

<a id="us-loop-002"></a>
## ✅ US-LOOP-002 loop tmux 输出体现方法论掌控力

**Created**: 2026-05-17
**Completed**: 2026-05-17

- As a roll 用户
- I want `roll loop attach` 的 tmux 输出压制 agent 自言自语噪音，用真实数据突出每个关键检查点
- So that 扫一眼就能确认 TCR 纪律（proof-of-pass）、peer 决议、CI 硬 gate、PR 合并全部有据可查而非口说

**AC:**
- [x] `lib/loop-fmt.py` 实现 3-tier 状态机：Tier 3 抑制、Tier 2 灰色 `✏ path`、Tier 1 信号行
- [x] Tier 3 完全压制：`system/init`、thinking block、Read/Glob/Grep tool call、普通 Bash、非错误 tool result
- [x] Tier 2 静默输出 Edit/Write：`  ✏ <path>`（深灰，无额外空行）
- [x] Tier 1 stamp：`[loop] cycle N:` 明文 → `HH:MM:SS  cycle #N — picking story`；`result` event → 静音 done 行
- [x] Tier 1 step：tcr commit 含 hash + 消息 + 测试数量；story skill 含 US-ID；peer 含 verdict；ci 含 green/red；pr 含编号
- [x] 错误 tool result → `→  error  tool  <first line of error>`
- [x] `result` event `error_max_turns` → `→  error  max-turns  Xs`
- [x] ANSI 颜色：深灰时间戳/箭头/detail，cyan 分类，white 标识，green ok 状态，red 错误状态
- [x] 30 条 fixture-driven bats 单元测试全部通过（`tests/unit/loop_fmt.bats`）

**Files:**
- `lib/loop-fmt.py` — 完整重写，实现 3-tier state machine（`LoopFmt` class）
- `tests/unit/loop_fmt.bats` — 30 条单元测试，覆盖全部 tier 和边界情况

---

<a id="us-loop-003"></a>
## US-LOOP-003 loop 等待期间显示 spinner 动画 ✅

**Created**: 2026-05-17
**Completed**: 2026-05-17

- As a roll 用户 watching loop in tmux
- I want spinner animation feedback during the 3 long-wait moments
- So that the output doesn't appear frozen while story execution, CI, or PR merge is in progress

**AC:**
- [x] `lib/loop-fmt.py` 新增 `Spinner` class：background thread 用 `\r` 动态更新当前行（⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏ 帧序列）
- [x] Wait point 1 — Skill("roll-build"/"roll-fix") 调用后：spinner 显示 "executing story..."
- [x] Wait point 2 — `roll ci`/`npm run ci`/`ci:local` 命令后：spinner 显示 "waiting for CI..."
- [x] Wait point 3 — `gh pr create/merge` 命令后：spinner 显示 "merging PR..."
- [x] 三个 spinner 在 result 到来时自动 stop（清除当前行）
- [x] `LOOP_FMT_NO_SPIN=1` 关闭动画，输出静态 ⏳ 行（供测试确定性）
- [x] 4 个新测试全部通过（含回归：原有 30 条仍全绿）

**Files:**
- `lib/loop-fmt.py` (modified — Spinner class + 3 wait-point wiring)
- `tests/unit/loop_fmt.bats` (modified — 4 new spinner tests)
- `CHANGELOG.md` (modified — Unreleased entry added)

**Dependencies:**
- Depends on: US-LOOP-002（loop-fmt.py 基础架构）

---

<a id="us-loop-004"></a>
## US-LOOP-004 把每轮 cycle 的成本、token、耗时写进事件流 📋

**Created**: 2026-05-18
**Plan**: [loop-cost-telemetry-plan.md](loop-cost-telemetry-plan.md)

- As a Roll user / dashboard reader
- I want 每轮 cycle 的真实成本数字（token / 上报成本 / 耗时 / 模型名）能永久保留
- So that dashboard 看历史不再 `—`，多机器 / 多项目对账可加总

**Domain Model:**
- Context: Cycle Event Stream
- Aggregate: Cycle Event (Root) gets enriched detail payload on cycle_end
- Cross-context: View Rendering 消费

**AC:**
- [ ] cycle 结束时 cycle_end 事件的 detail 段含 model / tokens (input/output/cache_creation/cache_read) / cost_reported_usd / duration_ms
- [ ] 新数据用 JSON detail；老数据（字符串 detail）保持可解析，dashboard 不崩
- [ ] cron.log 的"cycle done"行保留（tmux 显示需要），但不再是 dashboard 的成本来源
- [ ] idle cycle（没跑 claude）不强求 token 字段，cost=0
- [ ] 至少跑一轮真实 loop 验证：events.ndjson 新 cycle_end 携带完整 detail

**Files:**
- `lib/loop-fmt.py`（result 事件解析 + 写 sidecar）
- `bin/roll`（生成 inner runner 时把 sidecar 拼进 cycle_end 事件）

**Dependencies:**
- Depended on by: US-VIEW-010
