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

```
正常路径
  cycle_start ──→ pick_todo ──→ build ──→ pr ──→ merged ──→ cycle_end           ✓ 现有
  cycle_start ──→ idle (BACKLOG 空)                                             ✓ 现有

异常 / 兜底路径（IDEA-028 重点）
  cycle_start ──→ (process crash) ──→ heartbeat 超时被 reaper 清理              ❓ 是否 emit?
  cycle_start ──→ TCR 失败 ──→ rollback ──→ ???                                 ❓ 是否 emit?
  cycle_start ──→ PR 创建失败 ──→ fallback ──→ ???                              ❓ 是否 emit?
  cycle_start ──→ 超过 N 小时仍 running ──→ orphan reaper 接管                  ❓ 是否 emit?
  cycle_start ──→ peer review escalate ──→ 用户中止 ──→ ???                     ❓ 是否 emit?
```

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
