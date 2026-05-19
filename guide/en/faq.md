# Roll FAQ — Autonomous AI Delivery

Answers to the most common "why is this happening" and "what do I do" questions
when running Roll's autonomous delivery system. Each entry includes a one-line
rationale so you can build a mental model, not just follow steps.

---

## 1. Loop is stuck — a story stays "In Progress" and nothing is moving

**Symptoms:** `roll loop status` shows `running` or a story is stuck at
`🔨 In Progress` in BACKLOG.md for longer than one cycle.

**Why this happens:** Loop marks a story `🔨 In Progress` before invoking the
build skill. If the agent crashes, the session times out, or CI blocks the gate,
the story stays in that state. The next cycle's orphan recovery should revert it
— but if the LOCK file also went stale, the next cycle may not start at all.

**Under the hood:** Each loop cycle acquires a per-project LOCK file
(`~/.shared/roll/loop/.LOCK-<slug>`). If the PID inside the LOCK is dead, the
next cycle cleans it up. But if the process is alive (e.g. a hung tmux session),
the LOCK stays and no new cycle starts.

**Fix:**

```bash
roll loop status          # check if LOCK exists and what PID holds it
roll loop attach          # see what the agent is doing in the tmux session
# If the tmux session is dead or hung:
roll loop reset           # clear state + LOCK, start fresh next cycle
roll loop now             # trigger a new cycle immediately
```

---

## 2. Loop finished but BACKLOG was not updated to Done

**Symptoms:** The agent ran successfully (you saw TCR commits), but the story is
still `🔨 In Progress` or was not marked `✅ Done`.

**Why this happens:** The build skill updates BACKLOG at the end (Phase 11).
If the agent session dies after TCR commits but before Phase 11, or if the CI
gate fails, the story status is intentionally kept as-is. The loop does not mark
Done unless both TCR and CI pass.

**Under the hood:** The post-item cleanup runs two hard gates: (1) TCR commit
count > 0, (2) CI green via `roll ci --wait`. Either gate failing prevents the
Done transition — this is by design to avoid false-positive completions.

**Fix:**

```bash
roll loop runs            # check the last cycle's outcome and alerts
roll alert                # see if a CI or TCR alert was raised
# If the code is actually done and tests pass:
$roll-build US-XXX        # re-run the story manually to complete Phase 11
```

---

## 3. Agent review rejected its own PR (CHANGES_REQUESTED)

**Symptoms:** A loop-opened PR shows `CHANGES_REQUESTED` from the AI reviewer,
blocking auto-merge.

**Why this happens:** The AI code review workflow (US-AUTO-035) runs
independently from the build agent. When the reviewer detects issues — even in
code the loop itself wrote — it requests changes. This is intentional: the
review agent acts as an independent quality gate.

**Under the hood:** Loop classifies PRs in its inbox. A PR with
`CHANGES_REQUESTED` by a human is classified as `blocked_human_request_changes`
and skipped. If the review came from the AI workflow, the loop's next cycle
will attempt to address the feedback or the human can intervene.

**Fix:**

```bash
gh pr view <number>                # read the review comments
gh pr review <number> --approve    # override if the feedback is wrong
# Or let the loop's next cycle pick it up automatically
```

---

## 4. PR has merge conflicts or rebase failed

**Symptoms:** `gh pr checks` shows "This branch has conflicts" or
`roll loop runs` reports a rebase failure alert.

**Why this happens:** While the loop was building in a worktree, another commit
landed on `main` that conflicts with the PR. The loop's PR inbox tries
`_loop_pr_rebase_stale` but rebase fails when both sides touched the same lines.

**Under the hood:** A rebase circuit breaker tracks attempts per PR — after 3
failed rebases within 24 hours, further attempts are blocked and an ALERT is
written. This prevents infinite rebase loops when a structural conflict exists.

**Fix:**

```bash
gh pr view <number>               # see which files conflict
git fetch origin main
git checkout <pr-branch>
git rebase origin/main            # resolve conflicts manually
git push --force-with-lease
# The PR will re-enter CI and merge when green
```

---

## 5. Switched agents but loop behavior changed unexpectedly

**Symptoms:** After running `roll agent use kimi` (or editing
`~/.roll/config.yaml`), the loop works differently — slower, skips steps,
or produces different commit patterns.

**Why this happens:** Each agent (Claude, DeepSeek, Kimi) interprets skill
prompts with different strengths. Claude tends to follow TCR strictly; others
may batch more aggressively or interpret ACs differently. The skills are the
same, but execution varies by model capability.

**Under the hood:** `primary_agent` in `~/.roll/config.yaml` controls which CLI
the loop invokes. The fallback agent kicks in only when the primary fails
(token exhaustion, network error). Switching the primary changes the default
for all future cycles.

**Fix:**

```bash
cat ~/.roll/config.yaml            # verify which agent is configured
roll loop runs                     # compare recent run quality
# To revert:
roll agent use claude              # or edit ~/.roll/config.yaml directly
```

---

## 6. Multiple projects running loop — are they interfering?

**Symptoms:** Two projects both have `roll loop on`, and you suspect they're
stepping on each other (skipping cycles, sharing state, or fighting for the
agent).

**Why this happens:** They shouldn't interfere. Each project has its own LOCK
file (`~/.shared/roll/loop/.LOCK-<project-slug>`), its own `state.yaml` entries,
and its own launchd plist. Loops are per-project and isolated.

**Under the hood:** The LOCK file path includes a project slug derived from the
absolute directory path (`basename + md5 hash`). Two projects with the same
directory name on different paths still get different slugs and different locks.

**Fix:**

```bash
roll loop status                   # run in each project directory
# Confirm each shows its own scheduler, its own LOCK path
ls ~/.shared/roll/loop/.LOCK-*     # see all active locks
# If a stale lock from another project exists:
roll loop reset                    # in the affected project
```

---

## 7. `gh` authentication failed or no PR write permission

**Symptoms:** Loop writes an ALERT about `gh` failure, or PRs are not being
created. `gh auth status` shows "not logged in" or missing scopes.

**Why this happens:** Roll's CI gate and PR lifecycle rely on `gh` (GitHub CLI)
being authenticated with `repo` scope. If the token expired, was revoked, or
the repo is under an org that requires SSO authorization, `gh` calls fail.

**Under the hood:** The loop's CI gate (`roll ci --wait`) uses `gh -R owner/repo`
to check workflow runs. The PR creation step uses `gh pr create`. Both need a
valid token. The loop treats a missing `gh` binary as a graceful skip, but an
auth error is a hard failure that blocks the gate.

**Fix:**

```bash
gh auth status                     # check current auth state
gh auth login                      # re-authenticate
gh auth refresh -s repo,workflow   # add missing scopes
# For SSO-protected orgs:
gh auth refresh -h github.com      # triggers SSO authorization flow
```

---

## 8. How to pause loop without uninstalling the scheduler

**Symptoms:** You want the loop to stop picking up stories temporarily (e.g.,
during a code freeze or manual work session) but keep the launchd plist
installed so you can resume easily.

**Why this happens:** `roll loop off` removes the launchd plist entirely,
requiring `roll loop on` to reinstall. `roll loop pause` is lighter — it sets a
marker that makes the loop exit immediately at the start of each cycle without
doing any work.

**Under the hood:** Pause writes a marker to `state.yaml` (`status: paused`).
The loop runner checks this marker before acquiring the LOCK. The launchd
scheduler still fires on schedule, but the runner exits in seconds.

**Fix:**

```bash
roll loop pause                    # stop executing, keep scheduler
roll loop status                   # confirms "paused"
# When ready to resume:
roll loop resume                   # clear pause marker
roll loop now                      # optionally trigger a cycle right away
```

---

## 9. How to see what loop did (logs, runs, brief)

**Symptoms:** Loop ran while you were away. You want to know what it did,
whether it succeeded, and what changed.

**Why this happens:** Loop writes structured records after every cycle, but
there are multiple places to look depending on what you need.

**Under the hood:** Each cycle appends a JSONL record to
`~/.shared/roll/loop/runs.jsonl` with the story IDs, TCR commit count, duration,
and outcome. `roll-brief` aggregates this into a human-readable summary. The
tmux session retains the full agent conversation until the next cycle overwrites
it.

**How it works — the observability stack:**

| What you want | Command |
|---|---|
| Last N cycle summaries | `roll loop runs` (default 10) |
| Live dashboard | `roll loop monitor` |
| Watch agent in real time | `roll loop attach` |
| Human-readable daily summary | `roll brief` |
| Alerts that need attention | `roll alert` |
| Full agent transcript | Attach to tmux session and scroll up |

---

## 10. When does loop need human help vs. auto-recover?

**Symptoms:** You're not sure whether to intervene or wait for the next cycle.

**Why this happens:** Loop is designed to auto-recover from transient failures
(network errors, token exhaustion with fallback agent) but intentionally stops
on structural problems that need human judgment.

**Under the hood:** The failure handling has three tiers: (1) retry with
exponential backoff for network errors, (2) switch to fallback agent for
primary agent failures, (3) pause + ALERT for everything else.

**Auto-recovery (no human intervention needed):**
- Network timeout → retries with backoff (2s, 4s, 8s, 16s)
- Primary agent token exhausted → switches to fallback agent
- Stale LOCK from crashed process → next cycle cleans it up
- Orphan `🔨 In Progress` from crashed loop → next cycle reverts to `📋 Todo`

**Manual intervention required:**
- Both primary and fallback agents fail → `roll loop resume` after fixing
- CI persistently red → fix the failing test/build, then `roll loop now`
- Merge conflict on PR → resolve manually, push
- `gh` auth expired → `gh auth login`
- Story keeps reverting (TCR count = 0 every attempt) → the story spec may be
  unclear; rewrite the AC in `.roll/features/` or execute manually via `$roll-build`

**Rationale:** Loop optimizes for forward progress on clear work. When the work
itself is ambiguous or the environment is broken, it stops and tells you rather
than guessing.
