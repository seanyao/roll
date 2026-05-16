# Feature: cycle-event-stream

<a id="us-loop-001"></a>
## US-LOOP-001 cycle 结构化事件流 — runner / SKILL emit 标签事件，monitor 与 attach 直接渲染 📋

**Created**: 2026-05-17
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
- [ ] 新增 `_loop_event` shell helper（bin/roll）：参数 `<stage> <label> <detail> <outcome>`，同时输出到 stdout（tab-sep）和 `~/.shared/roll/loop/events-<slug>.ndjson`（JSON）
- [ ] helper 使用 `flock` 串行化 NDJSON 追加，避免并发触发的事件交错
- [ ] cycle runner 在 worktree 创建后 emit `cycle_start`，idle 路径 emit `idle`，发布完成 emit `cycle_end`
- [ ] roll-loop SKILL 选定 story 时调用 helper emit `story` 事件
- [ ] roll-peer SKILL 每轮协商完成 emit `peer` 事件（含 round N/M 和 outcome）
- [ ] roll-build SKILL 整个 TCR 阶段完成 emit `build` 事件（含提交数 / 耗时 / zero-diff revert 计数）
- [ ] `_loop_enforce_ci` 旁 emit `ci` 事件（green / red / heal-attempting）
- [ ] `_loop_publish_pr` 旁 emit `pr` 事件（auto-merged / failed）
- [ ] `events-<slug>.ndjson` 单文件超过 10MB 自动轮转，保留最近 5 份
- [ ] `roll loop attach` 接入 tmux 看到的事件行以颜色区分 stage（绿 ok / 红 fail / 黄 warn / 灰 idle）
- [ ] `roll loop monitor` 读 NDJSON 渲染当前 cycle 进度条 + stage 标记
- [ ] 录制一份样本 NDJSON 文件（典型成功 cycle 一轮），存于 `docs/site/cycle-sample.ndjson`，作为 landing page 动画的 fixture
- [ ] 单元测试覆盖 helper 函数的 stdout/NDJSON 写入、flock 串行化、文件轮转
- [ ] 集成测试覆盖 `loop test` 跑完后 events-*.ndjson 字段完整性

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
