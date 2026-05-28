# roll loop — Autonomous BACKLOG Executor

`roll loop` schedules and manages the autonomous execution of BACKLOG stories.
When enabled, it wakes up on a configurable schedule (within your active
window), picks the top pending story, and executes it — committing changes in
TCR micro-steps.

## How It Works

1. Reads `BACKLOG.md`, picks the highest-priority `📋 Todo` item.
2. Marks it `🔨 In Progress` and commits.
3. Invokes `$roll-build <story-id>` or `$roll-fix <bug-id>`.
4. On success: marks `✅ Done`, commits, appends to `runs.jsonl`.
5. On failure: reverts to `📋 Todo`, writes an `ALERT.md` entry.

Loop runs inside a **tmux session** named `roll-loop-<project-slug>`.
When not muted, a terminal window pops up automatically so you can watch in real time.

## Scheduling

Loop is scheduled via **launchd** (macOS). By default, every hour at a
project-derived minute (different projects get different offsets to avoid
collisions).

```
Active window: 10am – 6pm (configurable in ~/.roll/config.yaml)
```

Outside the active window, loop silently exits without doing anything.

### Per-project frequency

Configure in `.roll/local.yaml`:

```yaml
loop_schedule:
  period_minutes: 30   # 1-1440 (any minute interval)
  offset_minute: 7     # 0–59 (deprecated; for backward compat only)
```

- `period_minutes` — how often loop fires. Any value 1–1440.
- `offset_minute` — (deprecated since US-LOOP-032) no longer affects timing.
  Kept for backward compat; loop now uses `StartInterval = period × 60` seconds.

If no `.roll/local.yaml` or no `loop_schedule` block is present, Roll falls
back to the global `loop_minute` in `~/.roll/config.yaml`, or derives a
per-project default from the project path hash.

**Example:**

```yaml
# .roll/local.yaml — high-frequency project
loop_schedule:
  period_minutes: 45   # every 45 minutes (no longer restricted to divisors of 60)
```

`roll loop status` and `roll loop on` display the actual schedule frequency
so you can verify it at a glance. An invalid value (e.g. `period_minutes: 0` or
`1441`) triggers an ALERT and falls back to the hourly default.

### Global config (backward-compatible)

For a single global offset across all projects, `~/.roll/config.yaml` still
works:

```yaml
loop:
  active_start: 10    # hour (24h)
  active_end: 18
  loop_minute: 5      # minute past the hour (overridden by .roll/local.yaml)
  primary_agent: claude
```

Project-level `.roll/local.yaml` `loop_schedule` takes priority over
`loop_minute`.

## Subcommands

```bash
roll loop on          # Install launchd scheduler (loop + dream + brief)
roll loop off         # Remove launchd scheduler

roll loop now         # Run one cycle immediately (same as launchd fires)
roll loop test        # Quick smoke test: verify tmux/popup/stream chain works

roll loop status      # Show scheduler state and current loop state
roll loop monitor     # Live dashboard: launchd status, queue, recent runs

roll loop runs        # Show last 10 run summaries (story IDs, TCR count, duration, slowest phase)
roll loop runs 20     # Show last 20 runs
roll loop runs --all  # Show all projects' run history
roll loop runs --detail <cycle_id>  # Phase Breakdown panel for a single cycle

roll loop story <ID>  # Per-story rollup: cycles, span, duration, tokens, cost, PRs
roll loop story <ID> --json  # Machine-readable form for scripting

roll loop attach      # Attach to running loop tmux session (Ctrl-B D to detach)
roll loop mute        # Suppress auto-attach popup (loop still runs in tmux)
roll loop unmute      # Re-enable auto-attach popup

roll loop pause       # Pause scheduling (keep plist, skip execution)
roll loop resume      # Resume scheduling after pause

roll loop reset       # Clear loop state (start fresh on next fire)
```

## Status Dashboard

`roll loop status` prints a compact dashboard with per-cycle rows and daily rollup totals.

### Token column

Each cycle row shows token usage in a 4-component format:

```
·  19:18    13m    164/498.2K↑ 12.7M↓/63.3K   opus-4-7   $11.07   US-VIEW-012
             ↑      in   cw↑     cr↓    out
```

| Segment | Meaning |
|---------|---------|
| `164` (before first `/`) | Base input tokens |
| `498.2K↑` | Cache write tokens (billed at write rate) |
| `12.7M↓` | Cache read tokens (billed at read rate, much cheaper) |
| `63.3K` (after last `/`) | Output tokens |

When a cycle has no cache data (older cycles or non-Opus models), the column
falls back to the two-part `in/out` format.

### Rollup rows

Below the cycle list, daily totals break out all four components:

```
input tokens       164
cache writes    498.2K
cache reads      12.7M
output tokens    63.3K
```

This lets you verify that the displayed per-cycle cost (e.g. `$11.07`) matches
your Anthropic invoice — 86 % of the cost in that example comes from cache.

## Per-Story Rollup

`roll loop status` shows the rolling window (default 3 days). When you want the
**full lifetime** of a single story — every cycle that ever ran on it, including
cycles that have aged out of the dashboard window — use `roll loop story`.

```bash
roll loop story US-LOOP-004           # Compact panel for one story
roll loop story us-loop-004           # Case-insensitive
roll loop story US-LOOP-004 --days 90 # Widen the event-stream lookback
roll loop story US-LOOP-004 --json    # Emit JSON for scripting / dashboards
```

The panel reports the totals you'd otherwise have to hand-add across multiple
`status` runs:

```
── US-LOOP-004 · 把每轮 cycle 成本/token/耗时写进事件流 ──
  cycles    3  (✓ 2  ✗ 1  ⏵ 0)
  span      2026-05-18 14:22  →  2026-05-19 09:11
  duration  1h 47m   tokens  in 412k  out 18.3k  cache w 1.2M  r 7.8M
  cost      $4.92    model  claude-opus-4-7
  PRs       #128 ✓   #131 ✓   #134 ✗
  recent    20260518-142233-91  ✓  $2.10
            20260518-203045-12  ✗  $1.71
            20260519-091112-44  ✓  $1.11
```

**How history is preserved:** `bin/roll` rotates `events-<slug>.ndjson` at 10 MB,
keeping `.1` … `.4` archives. `roll loop status` and `roll loop story` both read
the head plus all rotated files, so cycles never disappear once they're on disk.

**Exit codes:** `0` when at least one cycle is found, `2` when no cycles match
the story id in the lookback window. The `--json` form follows the same exit
code contract so scripts can detect missing data.

## Visibility (tmux + popup)

Every loop run lives in a detached tmux session.
When you're not muted, a terminal window opens automatically.

```bash
roll loop attach      # join the running session at any time
# Ctrl-B D            # detach (loop continues)

roll loop mute        # 🔇 stop popup (mute file: ~/.shared/roll/mute)
roll loop unmute      # 🔔 re-enable popup
```

The `mute` file is shared across all projects and all autonomous activity
(loop + peer review). One switch controls everything.

## Concurrency Safety

Loop has two layers:

- **LOCK file** (`~/.shared/roll/loop/.LOCK-<slug>`): only one loop per project runs at a time.
  If loop is already running, a new fire exits immediately.
- **🔨 In Progress status**: stories being worked by humans or other agents are skipped.

You can always run `$roll-build US-XXX` to take over a story manually.
Loop sees the `🔨 In Progress` marker and skips it.

## Failure Handling

| Condition | What happens |
|-----------|-------------|
| API error | Retry up to 3×, 30s backoff |
| Primary agent fails | Switch to fallback agent |
| Both agents fail | Pause loop, write ALERT.md |
| TCR: 0 commits | Revert story to 📋 Todo, write ALERT.md |
| HEAD CI red | Hot-fix attempt (see below), or ALERT if exhausted |

ALERT entries surface in the next `roll loop monitor` and `roll-brief` output.

## CI Self-Healing (US-LOOP-046..050)

When loop detects that HEAD CI is red before picking a story, it no longer
immediately writes an ALERT and stops. Instead it tries to fix CI autonomously.

**How it works:**

1. `roll loop precheck-ci` runs before each BACKLOG scan.
2. If CI is green → cycle proceeds normally.
3. If CI is red AND heal is allowed:
   - Loop captures the failing CI log + commit diff via `roll loop hotfix-head-context`.
   - Invokes `roll-fix` with that context as a brief.
   - Waits for CI to go green.
   - If still red after `ROLL_LOOP_HEAL_MAX` attempts (default 2): writes ALERT and stops.
4. If CI is red AND heal is exhausted or `ROLL_LOOP_NO_HEAL=1`: writes ALERT (existing behavior).

**Loop's own PRs (`loop/*`) that turn red after merging** are also detected
(US-LOOP-049): classified as `loop_self_ci_red` and routed to `_loop_hot_fix_pr`
for a branch-level hot-fix, instead of being silently skipped.

**Environment variables:**

| Variable | Default | Effect |
|----------|---------|--------|
| `ROLL_LOOP_NO_HEAL=1` | unset | Disables all CI hot-fix attempts; reverts to fail-fast |
| `ROLL_LOOP_HEAL_MAX` | `2` | Maximum consecutive hot-fix attempts before ALERT |

## PR Inbox & Review

Each loop cycle processes open PRs before picking new stories.

**Review command:**

```bash
roll review-pr <number>   # AI review using the project's configured agent
```

The command fetches the PR title, body, and diff via `gh`, renders a review
prompt, and routes it to whatever agent `_project_agent()` returns (Claude,
Kimi, DeepSeek, etc.). The agent outputs a structured verdict:

| Verdict | Action |
|---------|--------|
| `APPROVE` | `gh pr review --approve` |
| `REQUEST_CHANGES` | `gh pr review --request-changes` with reason |
| `UNCERTAIN` | Writes an ALERT — human decides |

**Escape hatch:** Add `[skip-ai-review]` anywhere in the PR body to
auto-approve without invoking the agent.

**How the loop uses it:** `_loop_pr_inbox` classifies each open PR and routes
`eligible` PRs to `_loop_pr_review_external`, which calls `roll review-pr`.
Loop's own PRs (`loop/*` branches) are skipped to avoid same-source bias.

**Stale PR rebase:** PRs classified as `stale` (CI failed or branch behind/conflicting)
are automatically rebased onto `origin/main` via `_loop_pr_rebase_stale`. A circuit
breaker limits rebase attempts to 3 within 24 hours — after that, an ALERT is raised.
Fork PRs are skipped (no write access) with an ALERT.

**Bot review detection:** If a GitHub Actions bot has already reviewed the PR
(e.g. via the optional GHA workflow), `_loop_pr_inbox` defers:
- Bot `APPROVED` → skip, let auto-merge proceed
- Bot `CHANGES_REQUESTED` → write ALERT (loop PR rejected by GHA reviewer)

### Optional: Event-driven PR review (GHA)

Without extra setup, `_loop_pr_inbox` reviews eligible PRs each loop cycle
(up to ~1 hour delay). For seconds-fast feedback on GitHub-hosted repos,
install the event-driven workflow:

```bash
cp templates/workflows/pr-review-event.yml .github/workflows/
```

This triggers `roll review-pr` on every PR open/update. Fork PRs and PRs
with `[skip-ai-review]` in the body are automatically skipped. The template
requires only one API key secret — the one matching your configured agent.

The two modes coexist: the GHA workflow provides instant feedback, and
`_loop_pr_inbox` acts as a safety net if the workflow is not installed.

## Session Cleanup

At the end of every cycle, loop automatically prunes stale local worktrees:

- Any directory under `.claude/worktrees/` whose branch has been fully merged
  into `main` is removed (`git worktree remove --force` + `git branch -D`).
- `git worktree prune` runs afterward to clear stale metadata.

This keeps `git worktree list` clean and prevents `.claude/worktrees/` from
accumulating old entries over time. Active worktrees (branches ahead of `main`)
are left untouched.

## Cycle phases

Every cycle is sliced into seven named phases. Each phase emits a `phase_start`
event when entered and a `phase_end` event with duration + outcome when it
exits. Long-silent phases (claude, PR-merge wait) emit a `phase_tick` heartbeat
so the tmux viewer never looks frozen.

| # | Phase | When it runs | Typical duration |
|---|-------|--------------|------------------|
| 1 | `startup` | env / lock / heartbeat setup | < 1 s |
| 2 | `preflight` | meta sync + stale-branch GC + orphan-worktree recovery | 0 s — 30 s |
| 3 | `worktree_setup` | fetch origin + worktree create + meta sync | 2 – 10 s |
| 4 | `agent_invoke` | Agent executes with up to 3 retries | 5 – 45 min |
| 5 | `publish_push` | push branch + open PR (or doc-only merge) | 5 – 30 s |
| 6 | `publish_wait_merge` | poll until PR is MERGED (skipped for doc-only) | 0 – 10 min |
| 7 | `cleanup` | emit PR final state + worktree teardown | < 1 s |

Idle / failed / aborted cycles only emit the phases they actually entered.
At cycle exit, the inner runner prints a phase breakdown panel sorted by
duration descending, e.g.:

```
─── Cycle 20260523-114502-12345 Phase Breakdown ───
  agent_invoke           723s  ( 96.2%)  ████████████████████
  publish_wait_merge       19s  (  2.5%)  █
  worktree_setup            4s  (  0.5%)
  publish_push              2s  (  0.3%)
  preflight                 2s  (  0.3%)
  cleanup                   1s  (  0.1%)
  startup                   1s  (  0.1%)
  ──────────────────────────────────────
  Total                   752s
```

Each phase duration is also persisted to `runs.jsonl` in a new top-level
`phases` object (see [State Files](#state-files) below). `roll loop runs`
appends `slowest=<phase> <pct>%` to each built row so you can see which step
dominated without opening the cycle. For the full breakdown, use:

```bash
roll loop runs --detail 20260523-114502-12345
```

## Cycle Log Archive

Every cycle's full agent output is archived to `.roll/cycle-logs/<cycle-id>.log`
as an ANSI-stripped plain-text file — readable with `less`, `cat`, or any editor.

- **Per-cycle archive**: one `.log` file per cycle, saved to `.roll/cycle-logs/`
- **ANSI-stripped**: color codes and control characters removed, clean plain text
- **Retention**: keeps the 50 most recent cycles, older ones are auto-rotated
- **Works muted or not**: logs are saved even when `roll loop mute` is on

```bash
roll loop log                # View the most recent cycle's full log
roll loop log <cycle-id>     # View a specific cycle (e.g. 20260525-231803-39799)
roll loop log <prefix>       # Prefix match (e.g. 20260525 matches all May 25 cycles)
```

Cycle logs are stored inside `.roll/` (the project's meta directory) and are
gitignored — they won't pollute your repo.

## Cross-Machine Sync

When you run loop on multiple machines for the same project, Roll can sync cycle
records to a shared git repo. Every machine writes its own events file, and the
dashboard reads all of them — you get a unified view of every cycle across every
machine.

### Setup

Add a `roll_records_remote` field to `~/.roll/config.yaml`:

```yaml
roll_records_remote: "git@github.com:you/roll-loop-records.git"
```

**Private repo strongly recommended.** Cycle records contain prompt text, file
paths, and other potentially sensitive information. Treat the records repo the
same way you treat application logs — private, access-controlled, never public.

If `roll_records_remote` is not configured, cross-machine sync is entirely
skipped — no records leave your machine.

### How it works

- Each machine generates a unique machine-id (UUID v4) on first run, cached at
  `~/.shared/roll/machine-id`.
- Every cycle completion pushes an append-only `.ndjson` file to
  `<slug>/events/<machine-id>.ndjson` in the records repo. Each machine only
  writes to its own file — no merge conflicts.
- Before rendering the dashboard, Roll runs `git pull --ff-only` on a local
  clone at `~/.shared/roll/sync/`, reads every `*.ndjson` file, and merges
  them sorted by timestamp with `run_id` deduplication.
- Push and pull are best-effort background operations — if the remote is
  unreachable, the cycle continues normally and the dashboard shows only
  local data.

### Dashboard sync indicator

The dashboard footer shows one of three states:

| Indicator | Meaning |
|-----------|---------|
| `sync: ok (2m ago)` | Remote reachable, records merged successfully |
| `sync: offline` | Remote unreachable (network issue, auth expired) — showing local data only |
| `sync: not configured` | `roll_records_remote` not set — sync is off, this is expected |

### Fork caveat

Roll derives the project slug from `git remote get-url origin`. If you change
`origin` to point to a fork, the slug changes — records from the original repo
and the fork will land in different directories in the records repo. This is
intentional (different repos, different identities), but if you're temporarily
working from a fork, be aware that the dashboard won't show the upstream's
cycle history.

## Loop Meta Sync

At the start of every cycle, roll automatically pulls the latest project metadata
(`.roll/` directory — backlog, conventions, skills) from its git remote before
scanning for stories.

**How it works**

1. Detects whether `.roll/` has a configured `origin` remote.
   If not, the step is silently skipped (no side-effects for standard roll installs).
2. Runs `git fetch && git reset --hard origin/main` with a 15-second timeout.
3. On success: emits a `meta_sync ok` event; cycle proceeds with fresh backlog.
4. On failure: emits a `meta_sync stale` event; cycle continues with the existing
   `.roll/` contents (stale is better than no-op).

**After 3 consecutive failures** the loop writes an ALERT prompting you to check
your SSH key or network connectivity.

**Manual sync**

```bash
git -C .roll fetch && git -C .roll reset --hard origin/main
```

**FAQ: the loop runs but the dashboard shows an empty backlog**

This usually means `.roll/` is out of date:
- On a new machine: clone roll-meta manually into `.roll/` and configure the origin remote.
- After reinstalling the OS: same as above — SSH key may also need re-authorization.
- To confirm: `git -C .roll remote get-url origin` — if empty, no sync is attempted.

## State Files

| File | Content |
|------|---------|
| `~/.shared/roll/loop/state.yaml` | Current/last run: status, story, agent, run_id |
| `~/.shared/roll/loop/runs.jsonl` | Append-only run history (one JSON line per cycle) |
| `~/.shared/roll/loop/ALERT.md` | Accumulated alerts (failures, TCR violations) |
| `~/.shared/roll/loop/PAUSE-<slug>` | Pause marker (created by `roll loop pause`) |
| `~/.shared/roll/mute` | Auto-attach mute marker (shared across projects) |
