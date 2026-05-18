# Loop Write-Side Integrity

> 治理 loop 写入侧的完整性问题：cycle 结束信号 + cycle 项目身份。
> 详见 [loop-write-integrity-plan.md](loop-write-integrity-plan.md)。

---

<a id="us-loop-005"></a>
## US-LOOP-005 cycle 结束信号完整性审计 ✅

**Created**: 2026-05-19
**Completed**: 2026-05-19
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
- [x] 枚举 loop 所有 cycle 终止路径，列入 `loop-write-integrity-plan.md` 的 Termination Paths 表（11 条，T1-T11）
- [x] 至少覆盖：merged success / gh-unavailable ff-merge / orphan recovery / PR-publish 失败 / claude 失败 / cycle timeout / worktree setup 失败
- [x] 每条终止路径都写 `cycle_end` 事件（outcome 枚举：done / orphan / failed / blocked / idle 终止 twin）
- [x] 每条终止路径都 append 一行 `runs.jsonl`（status: built / idle / failed），timeout 与 worktree-setup-fail 通过 `_runs_append` 兜底写入
- [x] dashboard 显示的 outcome 与实际终止原因一致（`runs.jsonl` row 总数 = 已调度 cycle 数，不再漏写）
- [x] 单元测试覆盖每条终止路径的 emit point（`tests/unit/loop_termination_signals.bats` 9 个用例）

**Files:**
- `bin/roll` — inner runner heredoc: 新增 `_runs_append` 共享 helper、T3-T8 cycle_end 发射、T9/T10 runs.jsonl 兜底
- `tests/unit/loop_termination_signals.bats`（新增 9 个用例）
- `.roll/features/loop-write-integrity-plan.md` — Termination Paths 审计表填充

**Dependencies:**
- 与 US-LOOP-006 并行，互不阻塞

**Data Flow:**
- Producer: cycle wrapper script (per termination path)
- Consumer: `roll loop status` renderer, `roll loop runs`
- Test: `tests/unit/loop_termination_signals.bats` — grep 生成的 inner script 每个 emit point

---

<a id="us-loop-006"></a>
## US-LOOP-006 cycle 写入身份归一 📋

**Created**: 2026-05-19
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
- [ ] cycle 启动时把主项目 slug 写入 `$ROLL_MAIN_SLUG` 环境变量，子进程继承
- [ ] worktree 内调用 `_project_slug` 时优先使用 `$ROLL_MAIN_SLUG`；不存在时从 `git rev-parse --git-common-dir` 推主仓库根再算
- [ ] events 写入路径恒为 `events-${main_slug}.ndjson`
- [ ] runs.jsonl `project` 字段恒为 `${main_slug}` 或 `${main_slug}-cycle-...`，不再出现 `tmp-*`
- [ ] 集成测试：在 worktree / tmp cwd 触发 cycle，断言所有写入都归到主项目 slug

**Files:**
- `bin/roll` — `_project_slug` 函数 + cycle wrapper 启动脚本
- `tests/unit/project_slug_in_worktree.bats`（新增）
- `tests/integration/loop_identity_normalization.bats`（新增）

**Dependencies:**
- 与 US-LOOP-005 并行，互不阻塞
- 复用 FIX-056 / FIX-058 的迁移逻辑作为参考

**Data Flow:**
- Producer: cycle wrapper（任意 cwd）→ 归一后写入
- Consumer: `roll loop status` renderer（按主项目 slug 过滤）
- Integration test: `tests/integration/loop_identity_normalization.bats`
