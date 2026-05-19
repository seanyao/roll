# Loop Write-Side Integrity

> 治理 loop 写入侧的完整性问题：cycle 结束信号 + cycle 项目身份。
> 详见 [loop-write-integrity-plan.md](loop-write-integrity-plan.md)。

---

<a id="us-loop-005"></a>
## US-LOOP-005 cycle 结束信号完整性审计 📋

**Created**: 2026-05-19
**Plan**: [loop-write-integrity-plan.md](loop-write-integrity-plan.md)
**Source**: IDEA-028

- As a roll loop owner
- I want every cycle termination path to write a matching `cycle_end` event + `runs.jsonl` row
- So that dashboard 不再因为漏写而把已结束的 cycle 显示成"running"

**Domain Model:**
- Context: Autonomous Loop
- Aggregate: Cycle (Root) owns [EventStream, RunSummary]
- Events raised: [CycleCompleted | CycleAbandoned | CycleTimedOut | CycleCrashed | CycleFailedPR]
- Invariant: 每个 CycleStarted 必须有一对匹配的终止事件

**AC:**
- [ ] 枚举 loop 所有 cycle 终止路径，列入 `loop-write-integrity-plan.md` 的 Termination Paths 表
- [ ] 至少覆盖：merged success / TCR rollback / PR create fail fallback / orphan recovery / heartbeat timeout / user abort
- [ ] 每条终止路径都写 `cycle_end` 事件（outcome 字段区分）
- [ ] 每条终止路径都 append 一行 `runs.jsonl`（status 字段区分）
- [ ] dashboard 显示的 outcome 与实际终止原因一致，不再有"假 running"
- [ ] 集成测试：模拟每条终止路径，验证两类信号都写入

**Files:**
- `bin/roll` — cycle wrapper script、各终止分支
- `lib/loop_*.py` — 若有共享写入函数
- `tests/integration/loop_termination_paths.bats`（新增）

**Dependencies:**
- 与 US-LOOP-006 并行，互不阻塞

**Data Flow:**
- Producer: cycle wrapper script (per termination path)
- Consumer: `roll loop status` renderer, `roll loop runs`
- Integration test: 每条路径一个 bats 用例

---

<a id="us-loop-006"></a>
## US-LOOP-006 cycle 写入身份归一 ✅

**Created**: 2026-05-19
**Completed**: 2026-05-19
**Plan**: [loop-write-integrity-plan.md](loop-write-integrity-plan.md)
**Source**: IDEA-029

- As a roll loop owner
- I want events / runs.jsonl 始终以主项目 slug 写入（不论 cycle 跑在 worktree、tmp 还是哪里）
- So that dashboard 按当前项目 slug 过滤时拿到完整历史，记录不再被切碎到 `tmp-*` / `cycle-*` 假身份下

**Domain Model:**
- Context: Autonomous Loop
- Aggregate: Cycle (Root)
- Value Object: ProjectIdentity (主项目 slug)
- Invariant: cycle 的 ProjectIdentity 与运行位置无关，恒等于主项目 slug

**AC:**
- [x] cycle 启动时把主项目 slug 写入 `$ROLL_MAIN_SLUG` 环境变量，子进程继承
- [x] worktree 内调用 `_project_slug` 时优先使用 `$ROLL_MAIN_SLUG`；不存在时从 `git rev-parse --git-common-dir` 推主仓库根再算（FIX-034 已覆盖兜底）
- [x] events 写入路径恒为 `events-${main_slug}.ndjson`
- [x] runs.jsonl `project` 字段恒为 `${main_slug}`，不再出现 `tmp-*`
- [x] 集成测试：在 worktree / tmp cwd 触发 `_loop_event`，断言所有写入都归到主项目 slug

**Files:**
- `bin/roll` — `_project_slug` ROLL_MAIN_SLUG 优先；`_write_loop_runner_script` inner 模板 export ROLL_MAIN_SLUG
- `tests/unit/project_slug_in_worktree.bats`（新增）
- `tests/integration/loop_identity_normalization.bats`（新增）

**Dependencies:**
- 与 US-LOOP-005 并行，互不阻塞
- 复用 FIX-056 / FIX-058 的迁移逻辑作为参考

**Data Flow:**
- Producer: cycle wrapper（任意 cwd）→ 归一后写入
- Consumer: `roll loop status` renderer（按主项目 slug 过滤）
- Integration test: `tests/integration/loop_identity_normalization.bats`
