# Peer Tmux Session Cleanup

> Feature for automatically cleaning up tmux sessions after `roll peer` completes.

<a id="us-auto-039"></a>
## US-AUTO-039 Peer 完成后自动清理 tmux session 和终端窗口 ✅

**Created**: 2026-05-15
**Completed**: 2026-05-15
**Plan**: [peer-tmux-cleanup-plan.md](peer-tmux-cleanup-plan.md)

- As a roll user
- I want `roll peer` to clean up its tmux session and terminal window after reaching a terminal resolution
- So that I don't accumulate stale tmux sessions and orphaned terminal windows

**Domain Model:**
- Context: Autonomous Operation
- Aggregate: PeerReview (Root)
- Entities touched: tmux session lifecycle (no new entities)
- Events raised: [PeerSessionCleanedUp] → loop dashboard (session 消失，dashboard 不再显示)

**AC:**
- [x] AGREE 结果 → kill tmux session `roll-peer-<from>-<to>`，终端窗口自行关闭
- [x] ESCALATE 结果 → kill tmux session，终端窗口自行关闭
- [x] UNKNOWN 结果 → kill tmux session，终端窗口自行关闭
- [x] REFINE/OBJECT 且 round ≥ 3 → kill tmux session（已达到最大轮数，升级）
- [x] REFINE/OBJECT 且 round < 3 → 保留 session（留给下一轮复用，现有行为不变）
- [x] tmux 不可用时 → 静默跳过，不报错（`command -v tmux` + `has-session` 双重守卫）
- [x] 测试覆盖终态四种 resolution × tmux 可用/不可用组合（6 tests added）

**Files:**
- `bin/roll` — `cmd_peer()` exit 前加 `_should_kill` 清理逻辑
- `tests/unit/roll_peer_exit_paths.bats` — 新增 6 条 session 清理行为断言

**Dependencies:**
- Depends on: FIX-028 (peer exit paths 不崩溃，清理逻辑 base)
- Depended on by: (none)
