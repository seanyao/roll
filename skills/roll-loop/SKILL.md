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

**Human bypass path** — roll-loop 是默认调度器，不垄断执行权。任何时刻人可直接
`$roll-build US-XXX` 或 `$roll-fix FIX-XXX` 绕过 loop 立即执行（紧急 bug、中断插入、
故事评审等场景）。loop 通过 LOCK 和 `🔨 In Progress` 状态识别并跳过人正在做的故事，
人机并行不会撞车（见 Concurrency Safety）。

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

**Orphan 🔨 recovery** — clean up stories left in `🔨 In Progress` by a crashed previous run:

1. Scan BACKLOG.md for all rows whose Status column contains `🔨 In Progress`.
2. For each such story, check `state.yaml`:
   - If `current_item` matches the story id AND `status: running` → this is the resume case (handled above), leave it.
   - Otherwise → this is an **orphan 🔨** (the loop that marked it crashed before finishing). Revert the status back to `📋 Todo`, commit `chore: revert orphan 🔨 US-XXX to 📋`, and append a line to `~/.shared/roll/loop/ALERT.md` recording the orphan id and time so the next brief surfaces it.
3. After orphan sweep, proceed to Step 2 (Scan BACKLOG) — the reverted stories will be picked up normally if they're top of the queue.

### Step 2 — Scan BACKLOG

Read `BACKLOG.md`. Collect all rows where Status = `📋 Todo`, in order:

Priority: FIX-XXX first (bugs block progress), then US-XXX, then REFACTOR-XXX.

**Skip rows with Status = `🔨 In Progress`**. These are currently being executed by:
- Another concurrent executor (human via `$roll-build`, peer agent)
- An earlier loop iteration that hasn't finished yet (rare; should be guarded by LOCK)
- A previous interrupted run (the resume logic in Step 1 will pick these up)

Cap at `max_items_per_run` to limit blast radius per cycle.

### Concurrency Safety

Loop has two layers of concurrency protection:

1. **Per-project LOCK** (enforced by runner script, see `bin/roll:_write_loop_runner_script`):
   - LOCK file path: `~/.shared/roll/loop/.LOCK-<project-slug>`
   - On launch: if LOCK exists and the PID inside is alive → exit 0 (previous loop still running)
   - On launch: if LOCK exists but PID is dead → clean up stale LOCK and continue
   - On exit (normal or via trap): LOCK is removed
   - One LOCK per project — different projects' loops run independently

2. **🔨 In Progress story status** (enforced here):
   - Before picking a story, check its status is `📋 Todo`
   - Skip any `🔨 In Progress` row (someone else is on it)
   - Mark each story `🔨 In Progress` BEFORE invoking the executor skill (see Step 3)
   - On completion: update to `✅ Done`; on TCR failure: revert to `📋 Todo`

Together these mean: only one loop runs at a time per project (LOCK), and within a loop, stories already claimed by humans or peer agents are skipped (status check).

### Step 3 — Route and Execute

For each item, **before invoking the executor skill**, mark the story 🔨 In Progress in BACKLOG.md so brief and peer agents can see it's being worked on:

1. Edit BACKLOG.md: change the row's Status column from `📋 Todo` to `🔨 In Progress`.
2. Commit: `git commit -am "chore: mark US-XXX in progress"` (use the actual story id).

This commit is what makes the work visible — without it, tcr micro-commits during execution are invisible to `roll-brief`.

Then invoke the executor:

```
Item type         → Skill invoked
─────────────────────────────────
US-XXX            → Skill("roll-build", "US-XXX")
FIX-XXX           → Skill("roll-fix", "FIX-XXX")
REFACTOR-XXX      → Skill("roll-build", "REFACTOR-XXX")
```

The executor will update the row to `✅ Done` on success (it transitions from `🔨 In Progress` → `✅ Done`, same Edit logic as from `📋 Todo`).

Before invoking, also write current item to state file:

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

1. **TCR 硬校验** — call `_loop_enforce_tcr <story_id> <started_at>`:
   - Count `tcr:` prefix commits since `started_at` via `git log --oneline --since=<started_at>`
   - Count == 0 → revert story status in BACKLOG.md from ✅ Done → 📋 Todo; write ALERT to `~/.shared/roll/loop/ALERT.md` with story ID, time, reason "zero tcr: commits since story start", and suggested actions (`roll loop now` / `$roll-build <id>` / `roll loop reset`)
   - Count > 0 → continue normally
2. **CI Gate** — **MUST** invoke `roll ci --wait` (the `_loop_enforce_ci`
   wrapper). **Do NOT call `gh` directly** (no `gh run list`, no `gh run watch`,
   no ad-hoc shell checks): `roll ci --wait` is the only sanctioned entry —
   it derives `owner/repo` from the git remote and uses `gh -R <slug>`, which
   is required to work through `~/.ssh/config` host rewrites that break gh's
   auto-detection.
   - CI passes → continue normally
   - CI fails / times out / `gh` call fails → keep story as `🔨 In Progress`
     (do NOT mark ✅ Done); write ALERT; skip to next story
   - `gh` binary not installed (`command -v gh` fails) → skip gracefully
     (return 0). Any other `gh` error is **not** "gh unavailable" — it is a
     hard failure and must block the gate.
3. Update state file: `status: idle`
4. Check if a Feature is now fully complete (all its Stories ✅)
5. If yes and `brief_on_feature_complete: true` → invoke `Skill("roll-brief")`

### Step 5 — Write Run Summary

After all items in this cycle:

```yaml
# ~/.shared/roll/loop/state.yaml
status: idle
last_run: "2026-05-10T02:15:00+08:00"
last_run_items: [US-AUTH-003, FIX-007]
last_run_outcome: success
```

Then append a JSONL record to `~/.shared/roll/loop/runs.jsonl` for per-iteration
visibility (one line per cycle, append-only — never delete or rewrite earlier lines).

**⚠️ Strict schema contract — do NOT deviate.** Every field has exactly one
canonical form. Synonyms like `"success"`, `"noop"`, `"completed"` are forbidden
for `status`. Numbers and arrays cannot be interchanged. UTC `Z` suffix only,
no timezone offsets. **No extra fields** — emit only the keys listed below (plus
optional `reason` when `status="failed"`); do not add `note`, `comment`,
`details`, `info`, etc. If you feel the urge to annotate, put it in the cycle's
final report in `cron.log` instead.

**Canonical record (copy this exact shape, fill in real values):**

```json
{"ts":"2026-05-11T11:46:43Z","project":"roll-d9dfa0","run_id":"loop-20260511-1911","status":"built","built":["US-AUTO-024","US-AUTO-025"],"skipped":[],"alerts":[],"tcr_count":5,"duration_sec":2080}
```

**Field contract — types are enforced**:

| Field | Type | Format / Enum |
|---|---|---|
| `ts` | string | ISO 8601 **UTC** with `Z` suffix. Get via `date -u +%Y-%m-%dT%H:%M:%SZ`. Never use `+08:00` or other offsets. |
| `project` | string | Project **slug** only (e.g. `roll-d9dfa0`), NOT the absolute path and NOT plain `basename`. Compute via: `p=$(pwd -P); base=$(basename "$p" | tr -cs '[:alnum:]' '-' | sed 's/-*$//'); hash=$(printf '%s' "$p" | md5 | cut -c1-6 2>/dev/null || printf '%s' "$p" | md5sum | cut -c1-6); echo "${base}-${hash}"` |
| `run_id` | string | Matches `state.yaml` `run_id` exactly. Format: `loop-YYYYMMDD-HHMM`. |
| `status` | enum | Exactly one of: `built` (≥1 story shipped), `idle` (no Todo items found), `failed` (paused/error). **No synonyms.** |
| `built` | array&lt;string&gt; | Story ids completed this cycle. `[]` when none. **Always array, never null/number.** |
| `skipped` | array&lt;string&gt; | Story ids skipped because they were `🔨 In Progress`. `[]` when none. **Always array.** |
| `alerts` | array&lt;string&gt; | Newly raised ALERT identifiers/tags this cycle. `[]` when none. **Always array, never number.** |
| `tcr_count` | integer | Total `tcr:` prefix commits made this cycle. `0` when none. |
| `duration_sec` | integer | Seconds from cycle start to completion. Integer only, no decimals. |

Optional field, only when `status == "failed"`:
- `reason` (string): short human-readable explanation.

**Write recipe:**

```bash
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
# Compute project slug — inlined equivalent of bin/roll's _project_slug
# (Claude sessions can't call roll's internal functions, so we inline).
# Must produce identical output to _project_slug to match `roll loop runs` filter.
_p=$(pwd -P)
_base=$(basename "$_p" | tr -cs '[:alnum:]' '-' | sed 's/-*$//')
_hash=$(printf '%s' "$_p" | md5 | cut -c1-6 2>/dev/null || printf '%s' "$_p" | md5sum | cut -c1-6)
project="${_base}-${_hash}"  # e.g. roll-d9dfa0 — must match roll loop runs filter
# duration_sec = cycle_end_epoch - cycle_start_epoch (track at Step 1)
# tcr_count = git log --oneline --since="<cycle_start>" | grep -c '^[a-f0-9]* tcr:'

jq -nc \
  --arg ts "$ts" \
  --arg project "$project" \
  --arg run_id "$run_id" \
  --arg status "built" \
  --argjson built '["US-AUTO-024"]' \
  --argjson skipped '[]' \
  --argjson alerts '[]' \
  --argjson tcr_count 14 \
  --argjson duration_sec 1680 \
  '{ts:$ts, project:$project, run_id:$run_id, status:$status,
    built:$built, skipped:$skipped, alerts:$alerts,
    tcr_count:$tcr_count, duration_sec:$duration_sec}' \
  >> ~/.shared/roll/loop/runs.jsonl
```

The companion read-side is `roll loop runs [N] [--all]` — shows the most recent
N records (default 10) for the current project, or across all projects with `--all`.

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

Install once with `roll loop on` — it reads the configured agent from
`.roll.yaml` or `~/.roll/config.yaml` and writes the correct cron entry
automatically. No agent-specific command needed.

```bash
roll loop on      # install cron for loop + dream + brief
roll loop off     # remove cron entries
roll loop status  # show current state
```

### Manual run (for testing)

```bash
roll loop now     # execute one cycle immediately
```

### Live attach (transparency)

Each loop iteration runs inside a detached tmux session named
`roll-loop-<slug>` (tmux is a required dependency — `roll setup` auto-installs
it via Homebrew on macOS, or prints the install command elsewhere).

**Default — auto-attach popup**: when the loop fires, a background Terminal
window pops up running `tmux attach -t roll-loop-<slug>`. You can watch the
agent work in real time without typing anything. The popup is best-effort
focus-retaining (it captures the previously-active app and restores focus
after the window appears) and the tmux session keeps running even if you
close the window.

**Manual attach** (any time):

```bash
roll loop attach   # exec tmux attach -t roll-loop-<slug>
```

Press `Ctrl-B D` to detach — the loop continues running uninterrupted.

**Mute / unmute the popup**:

```bash
roll loop mute     # 🔇 — suppress auto-attach popup (loop still runs in tmux)
roll loop unmute   # 🔔 — re-enable the popup
```

Mute state is a single marker file at `~/.shared/roll/mute` and is shared
across all projects on this machine. Check the current state with
`roll loop status` — it shows an `Auto-attach: live | muted` line.

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
