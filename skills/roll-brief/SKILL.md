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

Output to `docs/briefs/YYYY-MM-DD-HH.md`:

```markdown
# Brief {YYYY-MM-DD HH:mm}

## What's Done
| ID | Description | Type |
|----|-------------|------|
| US-XXX | {title} | Story |
| FIX-XXX | {title} | Fix |
| REFACTOR-XXX | {title} | Refactor |

## In Progress
| ID | Description |
|----|-------------|
| US-XXX | {title} — started {date} |

## Queue ({N} items)
| ID | Description | Priority |
|----|-------------|----------|
| US-XXX | {title} | high |

## Overnight Dream Findings
{summary from docs/dream/ since last brief, or "No new findings."}

## Escalations Requiring Human Input
{any alerts, or "None — agent operating normally."}

## Release Readiness
{✅ Release candidate / ⚠️ Hold — reason}

---
*Next scheduled brief: {datetime}*
```

### Step 5 — Notify

After writing the file, print the brief path so it's visible in the terminal
or CI log:

```
📋 Brief written: docs/briefs/2026-05-10-08.md
   Release readiness: ✅ Release candidate
```

If there are escalations, print them prominently so they're impossible to miss.

## Scheduler Configuration

### GitHub Actions (daily morning)

```yaml
# .github/workflows/roll-brief.yml
name: Roll Brief
on:
  schedule:
    - cron: '0 0 * * *'  # 08:00 CST = 00:00 UTC
  workflow_dispatch:

jobs:
  brief:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Generate brief
        run: claude -p "$(cat ~/.roll/skills/roll-brief/SKILL.md)"
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      - name: Commit brief
        run: |
          git config user.name "roll-brief"
          git config user.email "roll@auto"
          git add docs/briefs/
          git diff --staged --quiet || git commit -m "chore: daily brief $(date +%Y-%m-%d)"
          git push
```

### Local cron

```bash
# 08:00 every morning
0 8 * * * cd /path/to/project && claude -p "$(cat ~/.roll/skills/roll-brief/SKILL.md)"
```
