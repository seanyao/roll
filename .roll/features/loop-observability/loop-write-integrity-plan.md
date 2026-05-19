# Loop Write-Side Integrity — Plan

## Problem

Loop 写入侧目前有两类已知偏差，都会让 dashboard 显示与实际不符：

1. **结束信号缺失（IDEA-028）**：某些 cycle 终止路径没有写 `cycle_end` 事件 / `runs.jsonl` 行。dashboard 默认 outcome 为 "running"，于是看到一批"卡住中"的 cycle，实际早已合并或废弃。
2. **写入身份错位（IDEA-029）**：cycle 在隔离 worktree 里跑时，`_project_slug` 取的是 worktree 路径（如 `roll-d9dfa0-cycle-XXX` 或 `tmp-XXX`），导致 events / runs.jsonl 记录被分散到错误的 slug 名下，dashboard 按"主项目 slug"过滤时漏掉这部分历史。

两条同属"loop 写入侧的健全性问题"，应归到一个 Feature 治理，但拆成两个独立 US 交付。

## Domain Model

**Bounded Context**: Autonomous Loop（自主循环）

**Aggregate**: Cycle (Root)
- Entities: EventStream (events-${slug}.ndjson), RunSummary (runs.jsonl row)
- Value Objects: ProjectIdentity (slug), CycleOutcome (running/done/idle/fail)
- Invariants:
  - 每个 cycle 必须有一对匹配的开始信号 + 终止信号（cycle_start ↔ cycle_end | idle）
  - cycle 的 ProjectIdentity 必须等于其主项目 slug，与运行位置无关
  - runs.jsonl 行必须与 events 流同 cycle 同身份

**Domain Events** raised by Cycle：
| Event | 触发条件 | 当前覆盖状态 |
|-------|---------|------------|
| CycleStarted | 任意 cron / 手动触发开始 | ✅ 已覆盖 |
| CycleIdled | BACKLOG 无 Todo | ✅ 已覆盖 |
| CycleCompleted (built) | TCR 提交完毕 | ✅ 已覆盖 |
| CycleCompleted (merged) | PR 合并成功 | ✅ 已覆盖 |
| CycleAbandoned (orphan recovery) | 检测到孤儿 worktree 后清理 | ⚠️ 部分缺失 |
| CycleTimedOut | 超时退出 | ⚠️ 部分缺失 |
| CycleCrashed (auto-heal) | wrapper 崩溃后自愈 | ⚠️ 部分缺失 |
| CycleFailedPR (fallback) | PR 创建失败兜底 | ⚠️ 部分缺失 |

## Termination Paths to Audit

> Audit completed 2026-05-19 as part of US-LOOP-005. Source: `_write_loop_runner_script` in `bin/roll` (lines ~2750-3030 of the inner heredoc).

| # | Termination Path | Trigger / Branch | `cycle_end` event | `runs.jsonl` row | Status |
|---|------------------|------------------|--------------------|------------------|--------|
| T1 | merged success | `_publish_status==0`, PR auto-merge confirmed | `cycle_end done` | `status=built` | ✅ Covered |
| T2 | idle — BACKLOG empty | `_cycle_commits==0` after claude returns | `idle` (terminal twin of cycle_start) | `status=idle` | ✅ Covered |
| T3 | gh unavailable + ff merge_back OK | `_publish_status==2` and `_worktree_merge_back` succeeds | **MISSING — US-LOOP-005 adds `cycle_end done`** | `status=built` | ⚠️ Fix in this US |
| T4 | gh unavailable + ff merge_back failed + orphan push OK | `_publish_status==2`, merge_back failed, orphan branch+tag pushed | **MISSING — US-LOOP-005 adds `cycle_end orphan`** | `status=built` | ⚠️ Fix in this US |
| T5 | gh unavailable + all publish failed | `_publish_status==2`, merge_back failed, orphan push failed (worktree preserved) | **MISSING — US-LOOP-005 adds `cycle_end failed`** | `status=failed` | ⚠️ Fix in this US |
| T6 | PR publish failed + orphan push OK | `_publish_status==1`, orphan branch+tag pushed | **MISSING — US-LOOP-005 adds `cycle_end orphan`** | `status=built` | ⚠️ Fix in this US |
| T7 | PR publish failed + orphan push failed | `_publish_status==1`, orphan push failed (worktree preserved) | **MISSING — US-LOOP-005 adds `cycle_end failed`** | `status=failed` | ⚠️ Fix in this US |
| T8 | claude session failed | `_exit != 0` after retry budget exhausted | **MISSING — US-LOOP-005 adds `cycle_end failed`** | `status=failed` | ⚠️ Fix in this US |
| T9 | cycle hard timeout | `_CYCLE_TIMED_OUT==1`, EXIT trap fires | `cycle_end blocked` (in `_inner_cleanup`) | **MISSING — US-LOOP-005 adds row via trap** | ⚠️ Fix in this US |
| T10 | worktree setup failed (no isolation) | `_worktree_create` fails, early `exit 0` before cycle_start | n/a (cycle never started) | **MISSING — US-LOOP-005 adds row before exit** | ⚠️ Fix in this US |
| T11 | orphan worktree recovered (predecessor cycle) | Inline at cycle start, recovers prior cycle's leftover worktree | (Out of scope — recovered cycles never started in *this* run) | (n/a — already recorded by predecessor cycle, or never was) | ➖ Documented, no change |

`cycle_end` outcome enum (post-US-LOOP-005):
- `done` — PR merged or ff-merged into main
- `orphan` — code preserved as orphan branch+tag on origin (recoverable but not on main)
- `failed` — code remains only in preserved local worktree (operator action needed)
- `blocked` — cycle exceeded `ROLL_LOOP_CYCLE_TIMEOUT_SEC`

`runs.jsonl` status enum is unchanged: `built` / `idle` / `failed` per FIX-018 schema.

## Identity Drift Points

```
slug 计算入口                           当前行为                       期望行为
─────────────────────────────────────────────────────────────────────────────────
_project_slug() at cycle 开始时          按 $PWD 算                     按主项目根目录算
events file path 拼接                    events-${cwd_slug}.ndjson      events-${main_slug}.ndjson
runs.jsonl 'project' 字段                = cwd_slug                     = main_slug
worktree 内的子调用                      继承 cwd_slug（错误）           应从 $ROLL_MAIN_SLUG 环境继承
```

主项目 slug 的获取需要一个稳定来源——候选方案：
- (A) cycle 启动时把主项目 slug 写入 `$ROLL_MAIN_SLUG` 环境变量传给子进程
- (B) 从 `git rev-parse --git-common-dir` 推回主仓库根，再算 slug
- (C) 维护 `~/.shared/roll/loop/slug-map.yaml`，运行时查表

推荐 **A + B 双轨**：环境变量是 fast path，B 作为兜底。

## US Split

| US | 主题 | Scope | Size |
|----|-----|------|------|
| US-LOOP-005 | cycle 结束信号完整性审计 | 枚举 5+ 终止路径，每条补 emit cycle_end + runs.jsonl row | M |
| US-LOOP-006 | cycle 写入身份归一 | 修复 slug 计算，让 worktree 内写入都用主项目身份 | S |

两个 US 互不依赖，可以并行 / 任意顺序执行。

## Out of Scope（本次 Feature 不做）

- **Renderer 兜底**：events 文件缺失时从 runs.jsonl 反推 cycle 列表。今天讨论过，结论是不必要（events 是 source of truth，缺失应该作为告警信号而不是悄悄修复）。
- **历史数据回溯**：今天的 reconstruction 是一次性脚本，不进 BACKLOG。
- **slug 算法本身的稳定性**：FIX-056/058 已经做过迁移逻辑，本次不重做。
