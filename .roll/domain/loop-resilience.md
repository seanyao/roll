# Loop Resilience — Recovery & Publish Reliability

> Bounded Context: **Autonomous Operation**
> Engineering-layer documentation. English only.

---

## Problem Statement

The roll loop executes Claude Code inside a tmux session with a per-cycle worktree.
When Claude is interrupted (macOS sleep, terminal window closure, process kill),
the loop's publish step never runs, leaving orphan commits in the local worktree
that are never pushed to GitHub.

Secondary issue: `gh` does not auto-detect the GitHub remote in worktree contexts,
causing `gh pr create` to fail silently, which falls through to the `_worktree_merge_back`
path (also broken when local `main` has diverged from `origin/main`).

---

## Root Causes

### 1. No Crash Recovery Path

```
Claude (inner script)
  ├── executes story → TCR commits
  ├── updates BACKLOG
  ├── exits 0 → publish runs ✅
  └── killed/crashed → script process dies → publish never runs ❌
```

The inner script runs inside the tmux session. If the tmux session is killed:
- LOCK files are cleaned up by bash EXIT traps (good)
- But `state.yaml` is never written to `idle` (stays `running` forever)
- The cycle branch exists locally but is never pushed
- No recovery logic at cycle start to detect orphan state

### 2. PR Publish Fragility

The `_loop_publish_pr` function pushes the cycle branch and creates a PR:

1. `git push origin <branch>` — can fail if branch already exists or remote issues
2. `gh -R <slug> pr create` — `gh` may not resolve the remote in some contexts
3. Both failures fall through to `_worktree_merge_back` which does `pull --ff-only origin main`
   — this fails when local `main` has diverged from `origin/main` (common after manual merges)

### 3. Orphan Worktree Accumulation

When `_worktree_merge_back` fails, the worktree is preserved + an alert written.
But no automated cleanup of orphan worktrees exists. Over time, dozens of stale
worktrees accumulate consuming disk space (observed: 20+ orphan worktrees).

### 4. State File Inconsistency

`state.yaml` is only written on successful cycle completion. When interrupted:
- `status: running` is never cleared
- `current_item: FIX-034` stays set
- No heartbeat timestamp exists to detect staleness

---

## Resolution Design

### Principle: Lock → Detect → Heal → Execute

Recovery must happen **after** lock acquisition to prevent race conditions
(two concurrent instances attempting recovery on same orphan). The
lock-holding process is the designated healer.

```
cycle_start:
  1. Acquire LOCK (fail-fast if already held)
  2. Detect orphan state → heal state.yaml
  3. Detect orphan worktrees → attempt publish + cleanup
  4. Resume normal cycle
```

**Note**: This means LOCK acquisition is no longer the last pre-Claude step.
LOCK must be acquired early enough to exclude concurrent healers, then held
through the entire recovery + execution + publish lifecycle.

### R1: Orphan State Detection & Healing

**Trigger**: Beginning of every cycle (before LOCK acquisition).

```yaml
# Proposed state.yaml schema
status: idle|running|recovering
current_item: ""            # cleared on heal
started_at: null            # cleared on heal
last_heartbeat: null        # new field — updated periodically by inner script
```

**Heal logic (state recovery, ordered by reliability):**
```python
if state.status == "running":
    # 1. Heartbeat is the primary liveness signal (avoids PID reuse race)
    if heatbeat_file_exists():
        age = now - read_heartbeat()
        if age < HEARTBEAT_TIMEOUT:
            # Genuinely running — exit
            return
    # 2. Fall back to lock PID check (for backward compat, no heartbeat)
    lock_pid = read_lock_file()
    if lock_pid and process_exists(lock_pid):
        return  # genuinely running
    # 3. Orphan — heal
    state.status = "recovering"
    state.current_item = ""
    state.started_at = null
```

Heartbeat is the primary liveness signal; lock PID is secondary/legacy.
This eliminates PID reuse race conditions.

**Critical**: LOCK files may survive SIGKILL (EXIT traps don't fire on `kill -9`).
The healer must also clean stale lock files matching orphan state.

After heal, write ALERT with context of what was recovered.

### R2: Orphan Worktree Recovery

After state heal, scan for orphan worktrees (cycle branches not on origin):

1. Fetch origin to get latest refs
2. For each worktree with a branch not on origin:
   - `git fetch` the worktree to get its refs
   - Check if the branch has commits ahead of `origin/main`
   - If yes → attempt recovery publish (same logic as normal publish)
   - If no (empty cycle, no changes) → clean up worktree
3. After publish → clean up worktree

**Recovery ordering (R2 concurrency):** If multiple orphan branches exist,
recovering them arbitrarily produces merge conflicts. Sort orphan worktrees
by commit timestamp, recover the oldest first, merge to main, then rebase
the next orphan on the new main. This ensures sequential ordering.

**Recovery publish (reuses existing `_loop_publish_pr`):**
```bash
# Push the orphan branch
git push origin <branch>

# Create PR targeting main
pr_url=$(gh -R <slug> pr create --base main --head <branch> \
         --title "recovery: <description>" --body "Recovered from orphan cycle")

# Do NOT auto-merge — recovery PRs must pass CI + have a human review window
echo "Recovery PR created: $pr_url — waiting for CI + review"
# Optionally: add a revert-commit path if the recovery breaks main
```

### R3: Heartbeat-Based Liveness

Add periodic heartbeat from the inner script to detect stale executions:

```bash
# Inside the inner script, every ~60 seconds:
echo "$(date -u +%s)" > "$state_dir/.heartbeat-<project>"
```

**At cycle start / monitor:**
```bash
if state.status == "running" and heartbeat file exists:
    age = now - heartbeat_timestamp
    if age > heartbeat_timeout (e.g., 30 min):
        # Claude is likely dead — treat as orphan
        heal()
```

Combined with R1: if state says `running` but no lock process AND heartbeat
is stale, it's definitively orphan.

### R4: Robust gh Detection

For `_loop_publish_pr`, ensure `gh` always works regardless of context.
`_gh_repo_slug()` already extracts `seanyao/Roll` from the remote origin
URL, and `gh -R "$slug"` is already used throughout. The issue is that `gh`
fails to auto-resolve the remote in worktree/launchd contexts.

```bash
# Recommended: Derive GH_REPO from git remote (not hardcoded)
export GH_REPO=$(git config --get remote.origin.url | sed 's/.*://;s/\.git$//')
# Ensure gh remote resolution (workaround for gh 2.92.0 bug)
git config remote.origin.gh-resolved github.com 2>/dev/null
# The -R flag is already in use — verify after GH_REPO export
gh -R "$GH_REPO" pr create ...
```

**Key**: Derive from git remote, not hardcoded — roll supports arbitrary repos.

### R5: Atomic State File Writes

If the outer script is killed mid-write to `state.yaml`, the file is corrupted
with no recovery. Use the standard atomic write pattern:

```bash
# Write to temp file, then atomic rename (renames are atomic on same filesystem)
cat > "${state_file}.tmp" <<< "status: idle"
mv "${state_file}.tmp" "$state_file"
```

### R6: Graceful Degradation on Publish

If publish fails completely (both PR and merge-back), do NOT leave the worktree
as orphan. Instead:

```bash
# Final fallback: write an ALERT + tag the branch for manual recovery
git tag "orphan/$(date +%Y%m%d%H%M)-$(git rev-parse --short HEAD)" <branch>
git push origin --tags 2>/dev/null || true
# Push the branch to origin so at least the code is safe
git push origin <branch> 2>/dev/null || true
# Then clean up local worktree
```

This ensures the commits are never lost even if automated publish fails.

Delete orphan worktrees only after the branch is confirmed pushed to origin
AND merged to main. No age-based deletion.

---

## Proposed BACKLOG Items

| ID | Title | Priority | Effort |
|---|---|---|---|
| FIX-037 | Add orphan state detection & healing at cycle start | High | S |
| FIX-038 | Add heartbeat mechanism to detect stale Claude | High | S |
| FIX-039 | Graceful degradation: push orphan branch + tag before cleanup | Medium | XS |
| FIX-040 | Orphan worktree recovery scan at cycle start | Medium | M |

---

## Sequence Diagram

```
┌─────────┐    ┌──────────────┐    ┌──────────┐    ┌──────────┐
│ Cron     │    │ Outer Script │    │ Recovery │    │ Claude   │
│ (launchd) │    │              │    │ Phase    │    │ (inner)  │
└────┬────┘    └──────┬───────┘    └────┬─────┘    └────┬─────┘
     │ fire            │                 │               │
     │────────────────>│                 │               │
     │                 │ read state      │               │
     │                 │──────────────>│ │               │
     │                 │                │ detect orphan  │
     │                 │               │ heal state      │
     │                 │<──────────────│ │               │
     │                 │                 │               │
     │                 │ scan orphan     │               │
     │                 │ worktrees       │               │
     │                 │──[recover]────>│ │               │
     │                 │<─[cleaned]─────│ │               │
     │                 │                 │               │
     │                 │ acquire LOCK    │               │
     │                 │ start Claude    │               │
     │                 │────────────────────────────────>│
     │                 │                 │    heartbeat  │
     │                 │<── [every 60s] ────────────────│
     │                 │                 │               │
     │                 │   done / killed │               │
     │                 │<────────────────│───────────────│
     │                 │                 │               │
     │                 │ publish changes │               │
     │                 │──[try PR]────>│ │               │
     │                 │──[or merge]──>│ │               │
     │                 │──[or push+tag]>│               │
     │                 │                 │               │
     │                 │ write idle state               │
```

---

## Design Decisions (Resolved)

| Question | Decision | Rationale |
|---|---|---|
| Heartbeat timeout | 30 min default, configurable via `ROLL_HEARTBEAT_TIMEOUT` | Balances false-positive vs stale-detection latency for typical Claude cycles |
| Recovery PR auto-merge? | No — must pass CI + human review window | Auto-merging orphan work risks breaking `main` with unreviewed code |
| Worktree cleanup policy | Delete only after branch confirmed pushed + merged. No age-based deletion | Safety over space; orphan worktrees are rare |
| ALERT on successful auto-heal? | Yes — always write ALERT, even on automated recovery | Transparency; human should know recovery happened |
| Lock file cleanup | Healer must clean stale lock files matching orphan state | SIGKILL bypasses EXIT traps, so lock files survive |
