---
name: roll-loop
license: MIT
allowed-tools: "Read, Glob, Grep, Write, Edit, Bash(git:*), Bash(cat:*), Skill"
description: |
  Autonomous BACKLOG executor. Runs on a schedule (hourly via cron or GitHub
  Actions), scans BACKLOG.md for 📋 Todo items, and routes each to the
  appropriate skill: US-XXX → $roll-build, FIX-XXX → $roll-fix,
  REFACTOR-XXX → $roll-build. Handles agent fallback on token/network failure.
  Never executes roll-release autonomously — release is always a human decision.
  Triggers roll-brief when a Feature completes.
---

# Roll Loop (Autonomous BACKLOG Executor)

> Follows the Architecture Constraints, Development Discipline, and Engineering
> Common Sense defined in the project AGENTS.md.

Runs on a schedule. Picks up pending BACKLOG items and executes them without
human intervention. The human stays informed via `roll-brief` and retains
sole authority over `roll-release`.

## Execution Boundary

**What roll-loop executes autonomously:**
- US-XXX (User Stories) → `$roll-build`
- FIX-XXX (Bug fixes) → `$roll-fix`
- REFACTOR-XXX (Refactors) → `$roll-build`

**What roll-loop never executes:**
- `roll-release` — production deployment is always a human decision
- Any Story marked 🚫 Hold or flagged for human review
- Destructive operations outside normal skill scope

## Configuration

```yaml
# ~/.roll/config.yaml
loop:
  primary_agent: claude          # claude | deepseek | kimi
  fallback_agent: deepseek       # used when primary fails
  max_items_per_run: 3           # limit parallel risk; adjust as needed
  brief_on_feature_complete: true
  retry_backoff: [2, 4, 8, 16]  # seconds, exponential
```

## Workflow

### Step 1 — Read State

```bash
STATE_FILE=~/.shared/roll/loop/state.yaml

# If a previous run was interrupted, resume from state
if [ -f "$STATE_FILE" ] && grep -q "status: interrupted" "$STATE_FILE"; then
  # Resume the interrupted item first
fi
```

### Step 2 — Scan BACKLOG

Read `BACKLOG.md`. Collect all rows where Status = `📋 Todo`, in order:

Priority: FIX-XXX first (bugs block progress), then US-XXX, then REFACTOR-XXX.

Cap at `max_items_per_run` to limit blast radius per cycle.

### Step 3 — Route and Execute

For each item:

```
Item type         → Skill invoked
─────────────────────────────────
US-XXX            → Skill("roll-build", "US-XXX")
FIX-XXX           → Skill("roll-fix", "FIX-XXX")
REFACTOR-XXX      → Skill("roll-build", "REFACTOR-XXX")
```

Before invoking, write current item to state file:

```yaml
# ~/.shared/roll/loop/state.yaml
status: running
current_item: US-AUTO-004
started_at: "2026-05-10T02:00:00+08:00"
agent: claude
run_id: loop-20260510-0200
```

### Step 4 — Post-Item Cleanup

After each item completes:

1. Update state file: `status: idle`
2. Check if a Feature is now fully complete (all its Stories ✅)
3. If yes and `brief_on_feature_complete: true` → invoke `Skill("roll-brief")`

### Step 5 — Write Run Summary

After all items in this cycle:

```yaml
# ~/.shared/roll/loop/state.yaml
status: idle
last_run: "2026-05-10T02:15:00+08:00"
last_run_items: [US-AUTH-003, FIX-007]
last_run_outcome: success
```

## Failure Handling

### Network Error (transient)

```
Attempt 1 fails
  → wait 2s → Attempt 2
  → wait 4s → Attempt 3
  → wait 8s → Attempt 4
  → wait 16s → Attempt 5
  → still failing → escalate to token/agent failure path
```

### Token Exhausted / Agent Unavailable

```
Primary agent fails (non-network error)
  → switch to fallback_agent from config
  → retry current item with fallback
  → if fallback also fails → PAUSE
```

### Pause + Alert

When both agents fail:

1. Write state:
```yaml
status: paused
paused_at: "2026-05-10T02:07:00+08:00"
paused_on: US-AUTH-003
reason: "both primary (claude) and fallback (deepseek) unavailable"
```

2. Write alert:
```markdown
# ALERT — roll-loop paused

**Time**: 2026-05-10 02:07
**Paused on**: US-AUTH-003
**Reason**: claude: token exhausted; deepseek: network error after 5 retries

**Action required** (choose one):
- Top up credits and run: `roll loop resume`
- Switch agent: edit `~/.roll/config.yaml` → `loop.primary_agent`
- Take over manually: `$roll-build US-AUTH-003`
```

3. Write alert file to `~/.shared/roll/loop/ALERT.md`

## Resuming After Pause

```bash
roll loop resume   # picks up from state.yaml current_item
roll loop status   # show current state without running
roll loop reset    # clear state and start fresh next scheduled run
```

## Scheduler Configuration

roll-loop runs **locally** — it needs access to the local codebase, local
test runner, and local agent CLI. GitHub Actions runs on remote servers and
cannot fulfill these requirements.

### Local cron (default)

Install once with `roll loop install`:

```bash
# What roll loop install writes to crontab:
0 * * * * cd /path/to/project && claude -p "$(cat ~/.roll/skills/roll-loop/SKILL.md)" >> ~/.shared/roll/loop/cron.log 2>&1
```

The agent invoked (`claude`, `kimi`, `deepseek`, etc.) is read from
`~/.roll/config.yaml → loop.primary_agent`. The command is agent-agnostic:

```bash
# claude
claude -p "$(cat ~/.roll/skills/roll-loop/SKILL.md)"

# kimi
kimi --quiet "$(cat ~/.roll/skills/roll-loop/SKILL.md)"

# deepseek
deepseek "$(cat ~/.roll/skills/roll-loop/SKILL.md)"
```

### Agent with native scheduling support

Some agents support scheduled prompts natively (e.g., Claude Code hooks,
opencode scheduled tasks). If your agent supports it, prefer that over cron
— the agent handles its own lifecycle and the setup is cleaner.

Consult your agent's documentation for scheduling configuration.

### Manual run (for testing)

```bash
roll loop run      # execute one cycle immediately
roll loop status   # show current state without running
```

### Local cron

```bash
# Every hour
0 * * * * cd /path/to/project && claude -p "$(cat ~/.roll/skills/roll-loop/SKILL.md)" >> ~/.shared/roll/loop/cron.log 2>&1
```

## Integration Map

```
roll-loop
  ├── reads      BACKLOG.md
  ├── invokes    $roll-build (US-XXX, REFACTOR-XXX)
  ├── invokes    $roll-fix (FIX-XXX)
  ├── invokes    $roll-brief (on Feature completion)
  ├── reads      ~/.roll/config.yaml (agent routing)
  ├── writes     ~/.shared/roll/loop/state.yaml
  └── writes     ~/.shared/roll/loop/ALERT.md (on failure)
```
