#!/usr/bin/env bats
# US-AUTO-044 Phase 1: dedicated PR Loop helpers.
#
# Covers the route table of _loop_pr_route plus the individual handlers
# (_loop_pr_merge_self, _loop_pr_rebase, _loop_pr_empty_diff,
#  _loop_pr_close_with_comment). gh / git are mocked; _gh_resolve is stubbed
# to a fixed slug so no network or repo state is touched.

load helpers

setup() {
  unit_setup_cd
  _LOOP_ALERT="${TEST_TMP}/ALERT.md"
  _LOOP_STATE="${TEST_TMP}/state.yaml"
  GH_LOG="${TEST_TMP}/gh.log"
  GIT_LOG="${TEST_TMP}/git.log"
  : > "$GH_LOG"
  : > "$GIT_LOG"
  # Silence/observe logging.
  info() { :; }
  warn() { :; }
  # Always resolve to a fixed slug so helpers proceed past _gh_resolve.
  _gh_resolve() { printf -v "$1" '%s' "owner/repo"; }
}
teardown() { unit_teardown_cd; }

# Default gh mock: records args; honours $GH_DIFF for `pr diff` and
# $GH_AUTOMERGE for `pr view ... autoMergeRequest`.
_mock_gh() {
  gh() {
    echo "gh $*" >> "$GH_LOG"
    case "$*" in
      *"pr diff"*)            printf '%s' "${GH_DIFF-}"; return 0 ;;
      *autoMergeRequest*)     printf '%s' "${GH_AUTOMERGE-null}"; return 0 ;;
      *headRefName*)          printf '%s' "${GH_HEADREF-loop/cycle-x}"; return 0 ;;
    esac
    return 0
  }
}

_json() { printf '%s' "$1"; }

# ── _loop_pr_route: branch routing ──────────────────────────────────────────

@test "_loop_pr_route: claude/* → skip_claude" {
  _mock_gh
  run _loop_pr_route '{"number":1,"headRefName":"claude/review","isDraft":false}'
  [ "$status" -eq 0 ]
  [ "$output" = "skip_claude" ]
}

@test "_loop_pr_route: loop/* with autoMergeRequest → skip_loop_auto_armed" {
  _mock_gh
  run _loop_pr_route '{"number":2,"headRefName":"loop/cycle-a","autoMergeRequest":{"enabledBy":"x"}}'
  [ "$status" -eq 0 ]
  [ "$output" = "skip_loop_auto_armed" ]
}

@test "_loop_pr_route: loop/* without autoMergeRequest → merge_self" {
  _mock_gh
  run _loop_pr_route '{"number":3,"headRefName":"loop/cycle-b","autoMergeRequest":null}'
  [ "$status" -eq 0 ]
  [ "$output" = "merge_self" ]
}

@test "_loop_pr_route: isDraft → skip_draft" {
  _mock_gh
  run _loop_pr_route '{"number":4,"headRefName":"feat/x","isDraft":true}'
  [ "$status" -eq 0 ]
  [ "$output" = "skip_draft" ]
}

@test "_loop_pr_route: BEHIND → rebase" {
  _mock_gh
  git() { echo "git $*" >> "$GIT_LOG"; return 0; }
  run _loop_pr_route '{"number":5,"headRefName":"feat/y","isDraft":false,"mergeStateStatus":"BEHIND"}'
  [ "$status" -eq 0 ]
  [ "$output" = "rebase" ]
}

@test "_loop_pr_route: CLEAN+MERGEABLE+no auto-merge → set_auto_merge" {
  _mock_gh
  run _loop_pr_route '{"number":6,"headRefName":"feat/z","isDraft":false,"mergeStateStatus":"CLEAN","mergeable":"MERGEABLE","autoMergeRequest":null}'
  [ "$status" -eq 0 ]
  [ "$output" = "set_auto_merge" ]
}

@test "_loop_pr_route: empty diff → close_empty" {
  GH_DIFF=""
  _mock_gh
  # not BEHIND, not CLEAN+MERGEABLE → falls through to empty-diff check
  run _loop_pr_route '{"number":7,"headRefName":"feat/q","isDraft":false,"mergeStateStatus":"UNKNOWN","mergeable":"UNKNOWN"}'
  [ "$status" -eq 0 ]
  [ "$output" = "close_empty" ]
}

@test "_loop_pr_route: non-empty diff + no other match → skip" {
  GH_DIFF="diff --git a/x b/x"
  _mock_gh
  run _loop_pr_route '{"number":8,"headRefName":"feat/q","isDraft":false,"mergeStateStatus":"BLOCKED","mergeable":"UNKNOWN"}'
  [ "$status" -eq 0 ]
  [ "$output" = "skip" ]
}

@test "_loop_pr_route: empty json → skip" {
  _mock_gh
  run _loop_pr_route ''
  [ "$status" -eq 0 ]
  [ "$output" = "skip" ]
}

@test "_loop_pr_route: json missing number → skip" {
  _mock_gh
  run _loop_pr_route '{"headRefName":"feat/no-number"}'
  [ "$status" -eq 0 ]
  [ "$output" = "skip" ]
}

@test "_loop_pr_route: CLEAN+MERGEABLE but auto-merge already armed → not set_auto_merge" {
  GH_DIFF="diff --git a/x b/x"
  _mock_gh
  run _loop_pr_route '{"number":9,"headRefName":"feat/z","isDraft":false,"mergeStateStatus":"CLEAN","mergeable":"MERGEABLE","autoMergeRequest":{"enabledBy":"x"}}'
  [ "$status" -eq 0 ]
  [ "$output" = "skip" ]
}

# ── _loop_pr_merge_self ──────────────────────────────────────────────────────

@test "_loop_pr_merge_self: arms auto-merge when none present" {
  _mock_gh
  _loop_pr_merge_self "42" "false"
  grep -q "pr merge 42 --auto" "$GH_LOG"
}

@test "_loop_pr_merge_self: skips when auto-merge already armed" {
  _mock_gh
  _loop_pr_merge_self "42" "true"
  ! grep -q "pr merge 42" "$GH_LOG"
}

@test "_loop_pr_merge_self: queries autoMergeRequest when arg omitted (present → skip)" {
  GH_AUTOMERGE='{"enabledBy":"x"}'
  _mock_gh
  _loop_pr_merge_self "42"
  ! grep -q "pr merge 42 --auto" "$GH_LOG"
}

# ── _loop_pr_empty_diff ──────────────────────────────────────────────────────

@test "_loop_pr_empty_diff: exit 0 when diff empty" {
  GH_DIFF=""
  _mock_gh
  run _loop_pr_empty_diff "42"
  [ "$status" -eq 0 ]
}

@test "_loop_pr_empty_diff: exit 1 when diff non-empty" {
  GH_DIFF="diff --git a/f b/f"
  _mock_gh
  run _loop_pr_empty_diff "42"
  [ "$status" -eq 1 ]
}

# ── _loop_pr_close_with_comment ──────────────────────────────────────────────

@test "_loop_pr_close_with_comment: closes PR and writes warn alert" {
  _mock_gh
  _loop_pr_close_with_comment "42" "empty diff"
  grep -q "pr close 42" "$GH_LOG"
  grep -q "warn" "$_LOOP_ALERT"
  grep -q "PR #42" "$_LOOP_ALERT"
}

# ── _loop_pr_rebase ──────────────────────────────────────────────────────────

@test "_loop_pr_rebase: clean rebase pushes and returns 0" {
  _mock_gh
  git() { echo "git $*" >> "$GIT_LOG"; return 0; }
  run _loop_pr_rebase "42" "feat/branch"
  [ "$status" -eq 0 ]
  grep -q "push --force-with-lease origin feat/branch" "$GIT_LOG"
}

@test "_loop_pr_rebase: conflict records attempt and returns 1" {
  _mock_gh
  # rebase fails → returns 1; circuit breaker records the attempt in state.
  git() {
    echo "git $*" >> "$GIT_LOG"
    case "$1" in
      rebase) [ "$2" = "--abort" ] && return 0 || return 1 ;;
      checkout) return 0 ;;
    esac
    return 0
  }
  run _loop_pr_rebase "77" "feat/conflict"
  [ "$status" -eq 1 ]
  grep -q '"77":' "$_LOOP_STATE"
}

@test "_loop_pr_rebase: breaker tripped (>=3 attempts) closes PR" {
  _mock_gh
  # Pre-seed 3 recent attempts so the next failure trips the breaker.
  local now; now=$(date -u +%s)
  cat > "$_LOOP_STATE" <<EOF
pr_state:
  "88":
    attempts_at: "$now $now $now"
EOF
  git() {
    echo "git $*" >> "$GIT_LOG"
    case "$1" in
      rebase) [ "$2" = "--abort" ] && return 0 || return 1 ;;
    esac
    return 0
  }
  run _loop_pr_rebase "88" "feat/stuck"
  [ "$status" -eq 1 ]
  grep -q "pr close 88" "$GH_LOG"
}

# ── _loop_pr_prune_local (US-AUTO-044 Phase 2: local branch cleanup) ──────────
# After a self-PR merges (remote branch already removed via --delete-branch),
# prune the now-stale LOCAL branch. Uses -D because squash-merge leaves the
# local branch looking unmerged to git; skips branches still checked out in a
# worktree (kimi peer-review Q3 — `git branch -d/-D` errors on those).

@test "_loop_pr_prune_local: deletes local branch with -D when not checked out" {
  GIT_WORKTREES=""
  git() {
    echo "git $*" >> "$GIT_LOG"
    [ "$1 $2" = "worktree list" ] && printf '%s' "$GIT_WORKTREES"
    return 0
  }
  _loop_pr_prune_local "feat/merged"
  grep -q "git branch -D feat/merged" "$GIT_LOG"
}

@test "_loop_pr_prune_local: skips when branch checked out in a worktree" {
  GIT_WORKTREES=$'worktree /tmp/wt\nbranch refs/heads/feat/inuse'
  git() {
    echo "git $*" >> "$GIT_LOG"
    [ "$1 $2" = "worktree list" ] && printf '%s' "$GIT_WORKTREES"
    return 0
  }
  _loop_pr_prune_local "feat/inuse"
  ! grep -q "branch -D feat/inuse" "$GIT_LOG"
}

@test "_loop_pr_prune_local: empty branch arg is a no-op" {
  git() { echo "git $*" >> "$GIT_LOG"; return 0; }
  run _loop_pr_prune_local ""
  [ "$status" -eq 0 ]
  ! grep -q "branch -D" "$GIT_LOG"
}

# ── _write_pr_loop_runner_script (US-AUTO-044 Phase 2: PR Loop runner) ────────
# Generates the script the com.roll.pr.<slug> launchd plist runs every 5 min:
# portable PATH, a single-flight re-entry lock (pid+ts staleness), then drives
# the existing _loop_pr_inbox orchestrator via the `roll _loop_pr_inbox` dispatch.

@test "_write_pr_loop_runner_script: drives _loop_pr_inbox under a re-entry lock" {
  local sp="${TEST_TMP}/pr-runner.sh"
  _write_pr_loop_runner_script "$sp" "/proj" "/usr/bin/roll" "/proj/.roll/loop/pr.log"
  [ -x "$sp" ]
  grep -q 'bash "/usr/bin/roll" _loop_pr_inbox' "$sp"
  grep -q '.pr-loop.lock' "$sp"
  grep -q 'kill -0' "$sp"
  grep -q 'cd "/proj"' "$sp"
}

@test "_write_pr_loop_runner_script: generated script is valid bash" {
  local sp="${TEST_TMP}/pr-runner.sh"
  _write_pr_loop_runner_script "$sp" "/proj" "/usr/bin/roll" "/proj/log"
  bash -n "$sp"
}
