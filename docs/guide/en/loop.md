# roll loop — Autonomous BACKLOG Executor

`roll loop` schedules and manages the autonomous execution of BACKLOG stories.
When enabled, it wakes up every hour (within your active window), picks the top
pending story, and executes it — committing changes in TCR micro-steps.

## How It Works

1. Reads `BACKLOG.md`, picks the highest-priority `📋 Todo` item.
2. Marks it `🔨 In Progress` and commits.
3. Invokes `$roll-build <story-id>` or `$roll-fix <bug-id>`.
4. On success: marks `✅ Done`, commits, appends to `runs.jsonl`.
5. On failure: reverts to `📋 Todo`, writes an `ALERT.md` entry.

Loop runs inside a **tmux session** named `roll-loop-<project-slug>`.
When not muted, a terminal window pops up automatically so you can watch in real time.

## Scheduling

Loop is scheduled via **launchd** (macOS). Default: every hour at `:05` past.

```
Active window: 10am – 6pm (configurable)
```

Outside the active window, loop silently exits without doing anything.
Configure in `~/.roll/config.yaml`:

```yaml
loop:
  active_start: 10    # hour (24h)
  active_end: 18
  loop_minute: 5      # minute past the hour
  primary_agent: claude
  fallback_agent: deepseek
```

## Subcommands

```bash
roll loop on          # Install launchd scheduler (loop + dream + brief)
roll loop off         # Remove launchd scheduler

roll loop now         # Run one cycle immediately (same as launchd fires)
roll loop test        # Quick smoke test: verify tmux/popup/stream chain works

roll loop status      # Show scheduler state and current loop state
roll loop monitor     # Live dashboard: launchd status, queue, recent runs

roll loop runs        # Show last 10 run summaries (story IDs, TCR count, duration)
roll loop runs 20     # Show last 20 runs
roll loop runs --all  # Show all projects' run history

roll loop attach      # Attach to running loop tmux session (Ctrl-B D to detach)
roll loop mute        # Suppress auto-attach popup (loop still runs in tmux)
roll loop unmute      # Re-enable auto-attach popup

roll loop pause       # Pause scheduling (keep plist, skip execution)
roll loop resume      # Resume scheduling after pause

roll loop reset       # Clear loop state (start fresh on next fire)
```

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

ALERT entries surface in the next `roll loop monitor` and `roll-brief` output.

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

## Session Cleanup

At the end of every cycle, loop automatically prunes stale local worktrees:

- Any directory under `.claude/worktrees/` whose branch has been fully merged
  into `main` is removed (`git worktree remove --force` + `git branch -D`).
- `git worktree prune` runs afterward to clear stale metadata.

This keeps `git worktree list` clean and prevents `.claude/worktrees/` from
accumulating old entries over time. Active worktrees (branches ahead of `main`)
are left untouched.

## State Files

| File | Content |
|------|---------|
| `~/.shared/roll/loop/state.yaml` | Current/last run: status, story, agent, run_id |
| `~/.shared/roll/loop/runs.jsonl` | Append-only run history (one JSON line per cycle) |
| `~/.shared/roll/loop/ALERT.md` | Accumulated alerts (failures, TCR violations) |
| `~/.shared/roll/loop/PAUSE-<slug>` | Pause marker (created by `roll loop pause`) |
| `~/.shared/roll/mute` | Auto-attach mute marker (shared across projects) |
