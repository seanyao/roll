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
- **Doc coverage**: compute from `docs/guide/en/` and `docs/guide/zh/`:
  - EN coverage = number of files in `docs/guide/en/`
  - ZH translation rate = files in `docs/guide/zh/` ÷ files in `docs/guide/en/` × 100%

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

文件命名：`docs/briefs/YYYY-MM-DD-{NN}.md`，NN 为当日序号（01 起，零填充两位）。
计算方式：`ls docs/briefs/YYYY-MM-DD-*.md 2>/dev/null | wc -l`，+1 即为本次序号。

全部用中文输出。**省略空 section**（无内容时连标题一起不输出）：

```markdown
# 简报 {YYYY-MM-DD HH:mm}

> 触发：{触发原因} | 覆盖：{起止时间范围}

## 已完成（{N} 项）
| 编号 | 描述 | 类型 |
|----|-------------|------|
| US-XXX | {标题} | 用户故事 |
| FIX-XXX | {标题} | 缺陷修复 |
| REFACTOR-XXX | {标题} | 重构 |

<!-- 仅当有 🔨 条目时输出 -->
## 进行中
| 编号 | 描述 |
|----|-------------|
| US-XXX | {标题} — 开始于 {date} |

<!-- 仅当有 📋 条目时输出 -->
## 待处理队列（{N} 项）
| 编号 | 描述 | 优先级 |
|----|-------------|----------|
| US-XXX | {标题} | 高 |

<!-- 仅当 roll-.dream 有新发现时输出 -->
## 悟见
{来自 docs/dream/ 的摘要}

<!-- 仅当有 ESCALATE 告警时输出 -->
## 需人工介入
{告警内容}

<!-- 始终输出 doc coverage 数字；若无缺口写"覆盖完整" -->
## 文档覆盖度
- guide/en: {N} 个文档
- ZH 翻译率：{M}/{N}（{%}）
- {缺口列表 或 "覆盖完整，无缺口。"}

## 发版就绪
{✅ 可发版 / ⚠️ 暂缓 — 原因}

**下一版本：** `v{YYYY}.{MMDD}.{序号}`

- {本轮新增 1}
- {本轮新增 2}

---
*状态：进行中 {N} · 待处理 {N} · 告警 {N} | 下次简报：{datetime}*
```

**首份简报或传入 `--full-history`**：在"已完成"表格后追加历史汇总区块：

```markdown
### 历史汇总
**Epic: {Name}** — {done}/{total} ✅
```

### Step 4.5 — Commit Brief

写完文件后立即提交，让简报进入 git 历史，便于后续追溯与跨会话审计：

```bash
git add docs/briefs/YYYY-MM-DD-NN.md
git commit -m "docs: roll-brief YYYY-MM-DD-NN — {触发原因}"
```

- 触发原因来自调用上下文（Feature 完成 / 每日 / 手动 / `--feature` / `--since`），用一句话填入
- 写文件失败时不要执行 commit；保持工作区干净，由调用方处理重试
- 仅 `docs/briefs/` 下新文件入 commit，不要顺带带入其他无关变更

### Step 5 — Notify

写完文件后在终端或 CI 日志中打印简报路径：

```
📋 简报已生成：docs/briefs/2026-05-10-01.md
   发布就绪：✅ 可发版
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
