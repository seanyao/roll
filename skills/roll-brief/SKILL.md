---
name: roll-brief
license: MIT
allowed-tools: "Read, Glob, Grep, Write, Bash(git:*)"
description: |
  Owner-facing briefing generator. Summarizes what the agent has done since
  the last brief: completed US/FIX/REFACTOR, in-progress items, BACKLOG queue
  status, escalations requiring human attention, and a release-readiness verdict.
  Three trigger modes: auto on Feature completion, daily morning schedule,
  or manual $roll-brief invocation. Distinct from roll-.changelog (user-facing
  release notes) — this is an internal digest for the product owner.
---

# Roll Brief

> Follows the Architecture Constraints, Development Discipline, and Engineering
> Common Sense defined in the project AGENTS.md.

Owner-facing digest of autonomous agent activity. Gives the human everything
needed to decide whether to run `roll-release` — without having to read every
commit or diff.

## Distinct from roll-.changelog

| | roll-brief | roll-.changelog |
|--|-----------|----------------|
| **Audience** | Product owner (internal) | End users (public) |
| **Content** | All activity including REFACTOR, escalations, health signals | Only user-visible feature changes |
| **Trigger** | Feature completion / daily / on-demand | Post-deploy |
| **Tone** | Operational, candid | Product-facing, polished |

## Trigger Modes

### 1. Feature Completion (auto)

Triggered by `roll-loop` when a set of related Stories under one Feature are
all marked ✅ Done. The loop passes the Feature name as context.

### 2. Daily Morning (scheduled)

Runs at a fixed time each morning (configurable in `~/.roll/config.yaml`).
Covers all activity since the previous brief.

```yaml
# ~/.roll/config.yaml
brief:
  daily_time: "08:00"   # local time
  timezone: "Asia/Shanghai"
```

### 3. On-Demand

```bash
$roll-brief                    # since last brief
$roll-brief --since 2026-05-09 # since specific date
$roll-brief --feature auth     # scoped to one feature
```

## Workflow

### Step 1 — Determine Scope

```bash
# Find timestamp of last brief
ls docs/briefs/ | sort | tail -1

# Read BACKLOG.md — collect all status changes since last brief
# Read git log — commits since last brief timestamp
git log --since="{last_brief_timestamp}" --oneline
```

### Step 2 — Collect Activity

From BACKLOG.md and git log, classify all items since last brief:

- **Completed**: US-XXX ✅, FIX-XXX ✅, REFACTOR-XXX ✅
- **In progress**: items currently 🔨
- **Queue**: items still 📋 Todo (ordered by priority)
- **Dream findings**: any REFACTOR entries added by roll-.dream since last brief
- **Escalations**: any ALERT files in `~/.shared/roll/loop/` or `~/.shared/roll/dream/`

### Step 3 — Assess Release Readiness

A simple heuristic — not a gate, just a signal for the human:

```
✅ Release candidate if:
  - No 🔨 in-progress US items
  - No open ESCALATE alerts
  - CI is green (check latest workflow run)
  - No critical REFACTOR entries flagged in last 48h

⚠️  Hold if any of the above is false
```

### Step 4 — Write Brief

Output to `docs/briefs/YYYY-MM-DD-HH.md`，全部用中文输出：

```markdown
# 简报 {YYYY-MM-DD HH:mm}

## 已完成
| 编号 | 描述 | 类型 |
|----|-------------|------|
| US-XXX | {标题} | 用户故事 |
| FIX-XXX | {标题} | 缺陷修复 |
| REFACTOR-XXX | {标题} | 重构 |

## 进行中
| 编号 | 描述 |
|----|-------------|
| US-XXX | {标题} — 开始于 {date} |

## 待处理队列（{N} 项）
| 编号 | 描述 | 优先级 |
|----|-------------|----------|
| US-XXX | {标题} | 高 |

## 夜间巡检发现
{来自 docs/dream/ 的摘要，无则写"暂无新发现。"}

## 需要人工介入的升级事项
{任何告警，无则写"无 — agent 运行正常。"}

## 发布就绪状态
{✅ 可发布 / ⚠️ 暂缓 — 原因}

---
*下次定时简报：{datetime}*
```

### Step 5 — Notify

写完文件后在终端或 CI 日志中打印简报路径：

```
📋 简报已生成：docs/briefs/2026-05-10-08.md
   发布就绪：✅ 可发布
```

有升级事项时须显著打印，不得遗漏。

## Scheduler Configuration

roll-brief runs **locally**, triggered either by roll-loop (on Feature
completion) or by local cron (daily morning). The agent reads local
BACKLOG state and git history directly.

### Local cron (daily morning)

Installed automatically via `roll loop on` alongside roll-loop and roll-.dream.
The cron entry is generated using the configured agent — no manual cron editing needed.

### Triggered by roll-loop

When roll-loop detects a Feature is fully complete, it invokes roll-brief
automatically — no separate cron entry needed for that trigger.
