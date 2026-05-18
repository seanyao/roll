# Peer Tmux Session Cleanup — PRD

**Created**: 2026-05-15
**Status**: Design

## Problem

`cmd_peer`（`bin/roll peer`）在执行 peer review 时会创建 tmux session
`roll-peer-<from>-<to>` 并弹出终端窗口（auto-attach），让用户实时观看跨 agent
协商过程。这个 session 为多轮复用（round 1→2→3）而设计——session 生命周期跨
多轮协商，复用同一个终端窗口。

**但 `cmd_peer` 在任何 exit path 上都没有清理 tmux session。** 对比：

| 组件 | 创建方式 | 清理机制 |
|------|---------|---------|
| Loop runner | `tmux new-session -d … "bash INNER_SCRIPT"` | 命令跑完 session 自然退出，runner `while has-session` 等待 |
| Peer (`cmd_peer`) | `tmux new-session -d -s "roll-peer-…"`（无 command，常驻 shell）| **无** |

这导致每次 `roll peer` 完成后，tmux session 和弹出的终端窗口一直残留。
多次 peer review 后 session 堆积，`tmux ls` 越来越嘈杂。

## Root Cause

`cmd_peer` 的 session 创建位于 :1696–1704，在函数末尾的 exit case 分支
（:1776–1785）没有任何 `tmux kill-session` 调用。

设计上 session 多轮复用是合理的——但终态未清理。目前"复用"依赖的是：
- 同一对 `from→to` 的不同 round 复用同一个 session name
- 下一轮 `roll peer` 进程通过 `tmux has-session` 检测到已有 session，跳过创建

但终态（AGREE / ESCALATE / round≥3 非 AGREE / UNKNOWN）没有下一轮，
session 就该被销毁。

## Solution

在 `cmd_peer` 的退出逻辑中，根据 resolution 和 round 决定是否 kill session：

```
resolution === AGREE              → kill（任务圆满完成）
resolution in [ESCALATE, UNKNOWN]  → kill（异常终态，不会继续）
resolution in [REFINE, OBJECT] && round >= 3 → kill（达到最大轮数，升级）

resolution in [REFINE, OBJECT] && round < 3  → 不杀（留给下一轮复用）
```

### 实现位置

在 `cmd_peer` 的 `case` 分支之后、`exit` 之前（:1776 附近），加一个统一的 exit path：

```bash
# Cleanup: kill tmux session on terminal resolutions
# Keep alive only when next round is expected (REFINE/OBJECT + round < 3)
local _should_kill=true
case "$resolution" in
  REFINE|OBJECT) [[ "$round" -lt 3 ]] && _should_kill=false ;;
esac
if [[ "$_should_kill" == "true" ]] && [[ -n "$peer_session" ]] \
   && command -v tmux >/dev/null 2>&1 \
   && tmux has-session -t "$peer_session" 2>/dev/null; then
  tmux kill-session -t "$peer_session" 2>/dev/null || true
fi
```

### 终端行为

`tmux kill-session` 会断开所有 attached client，终端窗口随之关闭（取决于终端模拟器行为，但主流 Terminal/iTerm2/Ghostty 均会在 session 消失后关闭窗口）。

### No-op 条件

- `tmux` 不可用 → 跳过
- `peer_session` 为空（tmux 不可用的降级路径）→ 跳过
- session 已不存在 → `tmux has-session` 返回非 0，跳过

## Scope

### In Scope
- `cmd_peer` 终态清理 tmux session

### Out of Scope
- Loop session 清理（已由 inner script 自然退出 + `while has-session` 等待覆盖）
- `_peer_dispatch_in_tmux` 的内部临时文件清理（已有 `rm -f`）
- Multi-round 中间的 session 保活（现有行为保持不变）

## Alternatives Considered

1. **给 session 加 command**（模仿 loop）——不可行。Loop session 跑单个长任务，
   peer session 需要在同一个 shell 里跑多轮短命令（send-keys 调度），session
   必须有常驻 shell。
2. **清理交给 launchd/cron**——过度设计，增加了系统的复杂度。
   `/tmp/` 下无残留，session 是 tmux server 的纯内存资源，重启自然消失，
   但每天积累十几个 peer session 仍然影响开发体验。
3. **不做清理，只在文档里说明**——用户体验差，session 是自动创建的不是用户
   主动管理的，不清理等同于泄漏。

## Related

- US-AUTO-027: peer 调用 auto-attach（创建了 tmux session 基建，当时未纳入清理）
- FIX-028: `roll peer` REFINE/OBJECT 收尾 unbound variable 崩溃
- FIX-029: peer auto-attach Ghostty 参数解析错误
- REFACTOR-011: 清理遗留 worktree（类似问题——session 泄漏）
