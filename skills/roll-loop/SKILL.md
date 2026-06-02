---
name: roll-loop
license: MIT
allowed-tools: "Read, Glob, Grep, Write, Edit, Bash(git:*), Bash(cat:*), Skill"
description: |
  Autonomous BACKLOG executor. Runs on a schedule (hourly via cron or GitHub
  Actions), scans .roll/backlog.md for 📋 Todo items, and routes each to the
  appropriate skill: US-XXX → $roll-build, FIX-XXX → $roll-fix,
  REFACTOR-XXX → $roll-build. Retries the primary agent up to 3 times on
  transient failure; pauses with ALERT on persistent failure.
  Never cuts a release autonomously — release is always a human decision.
  Triggers roll-brief when a Feature completes.
---

# Roll Loop (Autonomous BACKLOG Executor)

> Follows the Architecture Constraints, Development Discipline, and Engineering
> Common Sense defined in the project AGENTS.md.

Runs on a schedule. Picks up pending BACKLOG items and executes them without
human intervention. The human stays informed via `roll-brief` and retains
sole authority over releases.

## Execution Boundary

**What roll-loop executes autonomously:**
- US-XXX (User Stories) → `$roll-build`
- FIX-XXX (Bug fixes) → `$roll-fix`
- REFACTOR-XXX (Refactors) → `$roll-build`

**What roll-loop never executes:**
- Releases — production deployment is always a human decision (requires 2FA in real terminal)
- Any Story marked 🚫 Hold or flagged for human review
- Destructive operations outside normal skill scope

**Human bypass path** — roll-loop 是默认调度器，不垄断执行权。任何时刻人可直接
`$roll-build US-XXX` 或 `$roll-fix FIX-XXX` 绕过 loop 立即执行（紧急 bug、中断插入、
故事评审等场景）。loop 通过 LOCK 和 `🔨 In Progress` 状态识别并跳过人正在做的故事，
人机并行不会撞车（见 Concurrency Safety）。

## Environment Constraints (autonomous loop)

You are running inside an autonomous cycle. No human is watching this turn.
Adapt commands to the constraints below — otherwise you will burn turns on
denied operations and the cycle will idle-exit.

- **No `AskUserQuestion`**: no human can answer. If you genuinely cannot
  proceed without a decision, write an entry to `${HOME}/.shared/roll/loop/ALERT-<slug>.md`
  describing what's needed and exit cleanly.
- **Avoid compound bash**: each `Bash` call must run a single command.
  No `cmd1 && cmd2`, no `cmd1 ; cmd2`, no pipes (`|`), no `$(...)` /
  backtick subshells, no `bash -c '...'` with nested quoting. These are
  rejected by static analysis before they run. Chain operations as
  separate Bash calls and read intermediate output yourself.
- **Prefer Read/Edit over cat/sed**: use the `Read` tool for any file
  lookup, `Edit` for modifications. They cross sandbox boundaries that
  `cat` / `ls` / `sed` cannot.
- **CWD-relative paths first**: the cycle's CWD is the per-cycle worktree.
  Files inside it (.roll/backlog.md, bin/roll, tests/, docs/) are always
  accessible. Files at `~/.shared/roll/...` are reachable via the `Read`
  tool but not via shell commands.
- **Quote every glob**: the `Bash` tool runs commands through the user's
  login shell, which on macOS is typically `zsh`. zsh's default `nomatch`
  aborts unquoted globs that find no match with `(eval):1: no matches
  found: <pattern>` and exit 1, burning a turn on a meaningless error.
  Quote literal globs (`ls 'tests/integration/helpers.*'`) or — better —
  use the `Glob` tool, which is shell-agnostic and never aborts on empty
  matches.
- **Skill invocation is the work**: route US/REFACTOR via `$roll-build`,
  FIX via `$roll-fix`. Do not try to re-implement those flows inline.

## Configuration

```yaml
# ~/.roll/config.yaml
loop:
  primary_agent: claude          # claude | deepseek | kimi | pi | ...
  max_items_per_run: 1           # one story per cycle — atomic delivery, predictable cycle time
  brief_on_feature_complete: true
  retry_backoff: [2, 4, 8, 16]  # seconds, exponential
```

## Workflow

> **One story per cycle (强约束)**: 每个 cycle 只 pick 一个 Todo、跑完 Step 4
> 立刻退出，不再回 Step 2 找下一个。理由：
> - cycle 时间可预测（不会因贪心一连串 PR 撞 45 分钟 hard timeout）
> - PR / events / dashboard 每行一个故事，归因清晰
> - 一个故事一个 PR 一次 review，blast radius 最小
>
> 唯一例外是依赖修复（CI self-heal 等）已经内嵌在当前故事的 Step 4 里——
> 那部分不算"新挑故事"。
>
> 实现层：max_items_per_run 默认 1，executor skill 跑完 Step 5 必须 exit。
> 不要在同一个 cycle 内多次 emit `pick_todo` 事件。

### Step 1 — Orphan 🔨 Recovery

Process-level crash recovery (LOCK, heartbeat, retry budget) is handled by
the runner in `bin/roll:_write_loop_runner_script` — the per-project LOCK
guarantees only one cycle for this slug is alive when you start. So at
this point, any `🔨 In Progress` row in `.roll/backlog.md` belongs to a
previous cycle that crashed before flipping it back; reclaim it before
scanning.

**Important — skip `manual-only:*` rows.** A row tagged `manual-only:*`
means a human (or another non-loop process) has explicitly claimed it;
it is not loop's to reclaim. Reverting it would silently undo the
human's claim and cause confusing churn for `roll-brief` / dashboard
readers. The rule mirrors the gate in Step 2.

1. Scan .roll/backlog.md for all rows whose Status column contains `🔨 In Progress`.
2. For each candidate row, run the manual-only gate before touching it:
   ```bash
   bash -c 'source "$(command -v roll)"; _loop_is_manual_only "<story-id>" .roll/backlog.md'
   #   exit 0 → row has `manual-only:*` → SKIP (human-claimed; not orphan)
   #   exit 1 → reclaimable orphan; continue to step 3
   ```
3. For each row that passes the gate: revert the status back to
   `📋 Todo`, commit `chore: revert orphan 🔨 US-XXX to 📋`, and append
   a line to `~/.shared/roll/loop/ALERT-<slug>.md` recording the orphan
   id and time so the next brief surfaces it.
4. After orphan sweep, proceed to Step 1.5 (Pre-run CI health check) before scanning.

### Step 1.5 — Pre-run CI Health Check

Call `roll loop precheck-ci` before scanning BACKLOG. This is a **defensive gate**
against building on a broken base. Check the **exit code** and route accordingly:

| Exit code | Meaning | Action |
|-----------|---------|--------|
| `0` | CI green / pending / unknown | Proceed to Step 1.6 (PR Inbox) and Step 2 (BACKLOG scan) |
| `1` | CI red AND heal exhausted or `ROLL_LOOP_NO_HEAL=1` | ALERT already written; exit cleanly this cycle |
| `2` | CI red AND heal attempt allowed (US-LOOP-046) | **Hot-fix path** — skip BACKLOG, fix CI instead (see below) |

`gh` missing or repo unparseable → `precheck-ci` returns `0`; graceful skip.

**Hot-fix path (exit code 2) — US-LOOP-046:**

Do NOT pick any BACKLOG stories this cycle. Instead:

1. Capture context: `roll loop hotfix-head-context` → prints path to context log
2. Invoke `Skill("roll-fix")` with brief:
   `"CI red on HEAD. Failing run logs at <context-log-path>. Diagnose root cause, fix via TCR, commit, push. Do NOT change BACKLOG status."`
3. After `roll-fix` completes, re-run `roll ci --wait` to verify the fix
4. If CI is still red: run `roll loop precheck-ci` again; if it returns `1` (heal exhausted),
   exit cleanly — ALERT was already written by the precheck

### Step 1.6 — PR Inbox (US-AUTO-034)

Before scanning BACKLOG, process open PRs first. PRs are also units of work:
external contributors and human teammates expect their PRs to be reviewed and
moved forward, not starved while loop opens new fronts.

Call `_loop_pr_inbox` after the pre-run CI check passes. It walks
`gh pr list --state open` and routes each PR by classification:

| Classification | Action |
|---|---|
| `loop_self` (head ref starts with `loop/`, CI not red) | Skip — let GitHub auto-merge handle it; never AI-review your own commit |
| `loop_self_ci_red` (loop/* PR whose CI went red) | **US-LOOP-062a**: `_loop_pr_heal_self` — background-heal (per-PR lock + heal budget `ROLL_LOOP_HEAL_MAX`, default 2, via `_project_agent`); on `ROLL_LOOP_NO_HEAL=1` / budget exhausted → deduped `[TYPE:loop-pr-ci-red]` ALERT (never silently dropped) |
| `blocked_human_request_changes` | Skip — last human review requested changes; wait for the author to push fixes |
| `blocked_human_approved` | **US-LOOP-062b**: `_loop_pr_merge_approved` — merge directly (`gh pr merge --squash`) when CI green + mergeable, instead of relying on repo auto-merge (which may be off); merge failure is non-fatal (retried next tick) |
| `stale` (CI failed or branch behind/conflicting) | Try `_loop_pr_rebase_stale` after the circuit breaker allows it |
| `eligible` (clean external PR, no blocking review) | Invoke `_loop_pr_review_external` — the actual decision is provided by US-AUTO-035's GitHub Action |

**Rebase circuit breaker** — `_loop_pr_rebase_circuit <pr>` records each rebase
attempt under `pr_state.<PR>.attempts_at` in the per-slug state file
(`~/.shared/roll/loop/state-<slug>.yaml`, FIX-052), pruning entries older
than 24 h. Once ≥3 attempts land within 24 h, further rebases are blocked and an
ALERT is written (typical cause: a broken workflow file makes CI never run,
which would otherwise drive infinite rebase loops).

**Lenient on infrastructure** — `gh` missing, repo unparseable, or any
`gh` API failure → `_loop_pr_inbox` returns 0 and the loop falls through to
Step 2 (BACKLOG scan). Same posture as the pre-run CI check.

### Step 2 — Scan BACKLOG

Read `.roll/backlog.md`. Collect all rows where Status = `📋 Todo`, in order:

Priority: FIX-XXX first (bugs block progress), then US-XXX, then REFACTOR-XXX.

**Skip rows with Status = `🔨 In Progress`**. These are currently being executed by:
- Another concurrent executor (human via `$roll-build`, peer agent)
- An earlier loop iteration that hasn't finished yet (rare; should be guarded by LOCK)
- A previous interrupted run (the resume logic in Step 1 will pick these up)

**In-flight PR gate** (FIX-048). Before picking, also exclude stories already
claimed by an **open `loop/*` PR**. Each cycle's worktree is branched from
`origin/main`, so a story another cycle has marked 🔨 In Progress is invisible
locally until that cycle's PR merges. Without this gate, two cycles started
back-to-back will both pick the same Todo row and produce duplicate PRs.

```bash
bash -c 'source "$(command -v roll)"; _loop_pr_claimed_stories'
#   stdout: one story ID per line (deduped) — these are claimed by open
#           loop/* PRs on the remote. SKIP any candidate whose ID appears.
#   exit 0 always (lenient: gh missing / API error → empty output).
```

**Dependency gate** (FIX-032). For each `📋 Todo` candidate, before picking:

```bash
# Source bin/roll once per cycle, then call the helpers per candidate.
source "$(command -v roll)"

bash -c 'source "$(command -v roll)"; _loop_is_manual_only "<story-id>" .roll/backlog.md'
#   exit 0 → row has `manual-only:true` → SKIP this story, log to runs.jsonl
#            `skipped`, append INFO line ("manual-only — requires $roll-build")

bash -c 'source "$(command -v roll)"; _loop_check_depends_on "<story-id>" .roll/backlog.md'
#   exit 0 → all `depends-on:US-X,US-Y` are ✅ Done → eligible
#   exit 1 → stdout lists unsatisfied dep IDs; SKIP this story, log to
#            runs.jsonl `skipped` with reason "depends-on: <unsatisfied>"
```

Move to the next candidate when skipping. The two gates are pure functions
over .roll/backlog.md text — no side effects, no LOCK interaction.

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

> **US-AGENT-006 — Per-story agent routing (pre-cycle)**
>
> Before this skill even starts, the runner inner script has already:
> 1. Picked the next eligible Todo via `_loop_pick_next_story` (priority FIX > US > REFACTOR, manual-only / depends-on gates respected)
> 2. Read its Agent profile (est_min / risk_zone) and routed an agent via `_loop_pick_agent_for_story` (hard rules from `.roll/agent-routes.yaml` + soft preference from `runs.jsonl`)
> 3. Exported `ROLL_LOOP_ROUTED_STORY` / `ROLL_LOOP_ROUTED_AGENT` / `ROLL_LOOP_ROUTED_RULE` and printed `[loop] story <id> routed to <agent> via <rule_kind>` to cron.log
>
> When `ROLL_LOOP_ROUTED_STORY` is set, prefer it as `US_ID` for this cycle. The story has already been chosen by hard+soft routing rules — and, per FIX-146, the runner re-validates it against the authoritative backlog right before handing it to you (re-picking the next eligible Todo if it went ✅ Done / In Progress / ineligible between pick and handoff, emitting a `story_stale` event). So treat `ROLL_LOOP_ROUTED_STORY` as already-eligible and just work it. Only if you still find at cycle start that it is no longer 📋 Todo in BACKLOG (a residual concurrent flip), re-pick the next eligible Todo via `_loop_pick_next_story` rather than idling the whole cycle.
>
> Old single-agent fallback (`primary_agent` from `~/.roll/config.yaml`) still applies when:
> - no story is pickable (empty Todo / all manual-only)
> - the matching agent-routes.yaml has no agent that fits the story profile (then `cold_start_default` is used)

For each item, **before invoking the executor skill**, mark the story 🔨 In Progress in the **main repo's** .roll/backlog.md so brief and peer agents can see it being worked on. The cycle worktree is gitignored at .roll/, so editing the worktree's own copy + committing carries no change back to main — write directly via the helper instead:

```bash
bash -c 'source "$(command -v roll)"; _loop_mark_in_progress US-XXX'
# Updates ${ROLL_MAIN_PROJECT}/.roll/backlog.md in place: flips the row
# containing US-XXX from "📋 Todo" to "🔨 In Progress". Idempotent.
```

If the executor fails (TCR aborts, CI red, etc.), revert the marker so the next cycle can re-pick the story:

```bash
bash -c 'source "$(command -v roll)"; _loop_mark_todo US-XXX'
```

Status flips happen in main directly — no per-cycle commit needed. `roll-brief` reads main's backlog, so the 🔨 marker is visible the moment the helper returns.

选定故事后，调用 `_loop_event` 发出 pick_todo 事件，让 dashboard / monitor / attach 都能把"这个 cycle 选了哪个 story"正确归类：

```bash
# 选定故事后立即 emit（在调用 executor skill 之前）
# label 必须是 cycle_id（来自 bin/roll 注入的 LOOP_CYCLE_ID 环境变量），
# 不是 US_ID — dashboard 按 label 聚类，US_ID 当 label 会让事件分到错的桶
# 里，cycle 看起来"有 token 没 ID"。
_loop_event pick_todo "$LOOP_CYCLE_ID" "$US_ID" ""
```

Then invoke the executor:

```
Item type         → Skill invoked
─────────────────────────────────
US-XXX            → Skill("roll-build", "US-XXX")
FIX-XXX           → Skill("roll-fix", "FIX-XXX")
REFACTOR-XXX      → Skill("roll-build", "REFACTOR-XXX")
```

The executor will update the row to `✅ Done` on success (it transitions from `🔨 In Progress` → `✅ Done`, same Edit logic as from `📋 Todo`).

Before invoking, also write current item to the per-slug state file
(`~/.shared/roll/loop/state-<slug>.yaml`, FIX-052):

```yaml
status: running
current_item: US-AUTO-004
started_at: "2026-05-10T02:00:00+08:00"
agent: claude
run_id: loop-20260510-0200
```

### Step 4 — Post-Item Cleanup

After each item completes:

1. **TCR 硬校验** — call `roll loop enforce-tcr <story_id> <started_at>`:
   - Count `tcr:` prefix commits since `started_at` via `git log --oneline --since=<started_at>`
   - Count == 0 → revert story status in .roll/backlog.md from ✅ Done → 📋 Todo; write ALERT to `~/.shared/roll/loop/ALERT-<slug>.md` with story ID, time, reason "zero tcr: commits since story start", and suggested actions (`roll loop now` / `$roll-build <id>` / `roll loop reset`)
   - Count > 0 → continue normally
2. **CI Gate** — **MUST** invoke `roll ci --wait` (the `_loop_enforce_ci`
   wrapper). **Do NOT call `gh` directly** (no `gh run list`, no `gh run watch`,
   no ad-hoc shell checks): `roll ci --wait` is the only sanctioned entry —
   it derives `owner/repo` from the git remote and uses `gh -R <slug>`, which
   is required to work through `~/.ssh/config` host rewrites that break gh's
   auto-detection.
   - CI passes → clear any `heal_count:` entry in `~/.shared/roll/loop/state-<slug>.yaml` (idempotent — drop the line if present, no-op otherwise) and continue normally
   - CI fails / times out / `gh` call fails → enter **CI self-heal** (US-AUTO-041)
   - `gh` binary not installed (`command -v gh` fails) → skip gracefully
     (return 0). Any other `gh` error is **not** "gh unavailable" — it is a
     hard failure and must block the gate.

   **CI self-heal (US-AUTO-041)** — bounded auto-fix before ALERT.

   Read `heal_count:` from `~/.shared/roll/loop/state-<slug>.yaml`; treat a missing line as `0`. If the count is below `ROLL_LOOP_HEAL_MAX` (default 2) and `ROLL_LOOP_NO_HEAL` is not set, increment it and take Path A. Otherwise take Path B.

   **Path A — attempt allowed (counter incremented in `state-<slug>.yaml`):**

   1. Capture failure summary:
      ```
      gh run view --log-failed --repo <slug> \
        $(gh run list --commit HEAD --json databaseId,conclusion -L 5 \
          | jq -r '.[] | select(.conclusion=="failure") | .databaseId' | head -1) \
        2>/dev/null | head -200 > /tmp/roll-heal-<story_id>.log
      ```
   2. Invoke `Skill("roll-fix")` with brief:
      `"CI red after <story_id>. Failing run logs at /tmp/roll-heal-<story_id>.log.
      Diagnose root cause, fix via TCR, commit, push. Do NOT change <story_id>'s
      BACKLOG status — it stays ✅ Done. The fix is a follow-up."`
   3. After `roll-fix` completes, return to step 2 (CI Gate) — re-run `roll ci --wait`.
      The counter in `state-<slug>.yaml` prevents infinite loops.

   **Path B — heal exhausted (≥`ROLL_LOOP_HEAL_MAX`, default 2) or disabled (`ROLL_LOOP_NO_HEAL=1`) (exit 1):**

   1. Do NOT force ✅ Done here. CI red means the PR will not merge. Under
      **US-AUTO-044** the main loop no longer waits for merge — it publishes the
      PR and exits; the dedicated PR Loop (`com.roll.pr.<slug>`, every 5 min)
      merges / rebases / closes it asynchronously. There is no false-Done risk:
      with worktree isolation the ✅ Done lives only in the unmerged PR, never on
      the loop's main checkout, and the story is not re-picked meanwhile via the
      open-PR eligibility gate (`_loop_story_is_eligible`, FIX-146). The story's
      ✅ Done lands on main only when the PR Loop actually merges the PR.
   2. Write ALERT to `~/.shared/roll/loop/ALERT-<slug>.md` with:
      - story ID, time, commit SHA
      - heal attempts made (read `heal_count:` from `state-<slug>.yaml`)
      - last failure summary (head of `/tmp/roll-heal-<story_id>.log`)
      - suggested actions: `$roll-fix` manually / inspect CI / `roll loop reset`
   3. Skip to next story.

   **Bypass for debugging / cost control:** set `ROLL_LOOP_NO_HEAL=1` to restore
   pre-US-AUTO-041 fail-fast behaviour.
3. Update state file: `status: idle`
4. Check if a Feature is now fully complete (all its Stories ✅)
5. If yes and `brief_on_feature_complete: true` → invoke `Skill("roll-brief")`
6. **EXIT the cycle.** 不要回 Step 2 找下一个故事，不要再 emit `pick_todo`。
   一个 cycle 只交付一个故事；剩下的 Todo 等下一个 launchd tick 起新 cycle 处理。

### Step 5 — Write Run Summary

> **FIX-044**: The inner runner script (`_write_loop_runner_script` in `bin/roll`)
> now appends this record deterministically at cycle end. The shell write is the
> authoritative record; the agent should still emit a run summary in the cycle's
> final report for `cron.log` visibility.

After all items in this cycle:

```yaml
# ~/.shared/roll/loop/state-<slug>.yaml (FIX-052)
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
| `run_id` | string | Matches `state-<slug>.yaml` `run_id` exactly. Format: `loop-YYYYMMDD-HHMM`. |
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
  → 3 attempts at the agent_invoke phase (with 30s back-off between)
  → still failing → PAUSE
```

### Pause + Alert

When the primary agent exhausts its retry budget:

1. Write state:
```yaml
status: paused
paused_at: "2026-05-10T02:07:00+08:00"
paused_on: US-AUTH-003
reason: "primary agent (claude) unavailable after 3 attempts"
```

2. Write alert:
```markdown
# ALERT — roll-loop paused

**Time**: 2026-05-10 02:07
**Paused on**: US-AUTH-003
**Reason**: claude exited non-zero on 3 consecutive attempts

**Action required** (choose one):
- Top up credits and run: `roll loop resume`
- Switch agent: edit `~/.roll/config.yaml` → `primary_agent`
- Take over manually: `$roll-build US-AUTH-003`
```

3. Write alert file to `~/.shared/roll/loop/ALERT-<slug>.md`

## Resuming After Pause

```bash
roll loop resume   # picks up from state-<slug>.yaml current_item
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
  ├── reads      .roll/backlog.md
  ├── invokes    $roll-build (US-XXX, REFACTOR-XXX)
  ├── invokes    $roll-fix (FIX-XXX)
  ├── invokes    $roll-brief (on Feature completion)
  ├── reads      ~/.roll/config.yaml (agent routing)
  ├── writes     ~/.shared/roll/loop/state-<slug>.yaml
  └── writes     ~/.shared/roll/loop/ALERT-<slug>.md (on failure)
```
