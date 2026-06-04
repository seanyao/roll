#!/usr/bin/env bats
# Tests for _loop_pr_classify / _loop_pr_rebase_circuit / _loop_pr_inbox
# (US-AUTO-034 — PR-first inbox in roll loop).

load helpers
setup() {
  unit_setup_cd
  _test_repo="$TEST_TMP"
  git init -q
  git config user.email "test@roll.dev"
  git config user.name "Test"
  _LOOP_ALERT="${TEST_TMP}/.alert"
  _LOOP_STATE="${TEST_TMP}/state.yaml"
}
teardown() { unit_teardown_cd; }

# ─── _loop_pr_classify ────────────────────────────────────────────────────────
#
# Args: <head_ref> <latest_human_review> <ci_state> <mergeable_state>
# Prints exactly one of:
#   loop_self
#   blocked_human_request_changes
#   blocked_human_approved
#   stale
#   eligible

# FIX-194: classify contract follows the #440 architect rewrite — three
# tokens only (stale > ci_red > ready); branch prefix and human review are
# intentionally irrelevant (CI is the only gate). Old loop_self/eligible/
# blocked_human_* expectations below were updated to the new contract.
@test "_loop_pr_classify: green loop/* PR → ready" {
  run _loop_pr_classify "loop/cycle-123" "" "success" "MERGEABLE"
  [ "$status" -eq 0 ]
  [ "$output" = "ready" ]
}

# FIX-158 lineage: a loop/* PR whose CI is red must classify distinctly so
# the inbox routes it to heal instead of merge. Post-#440 the token is ci_red.
@test "_loop_pr_classify: loop/* with CI failure → ci_red" {
  run _loop_pr_classify "loop/cycle-123" "" "failure" "MERGEABLE"
  [ "$status" -eq 0 ]
  [ "$output" = "ci_red" ]
}

@test "_loop_pr_classify: human CHANGES_REQUESTED is irrelevant — CI green → ready" {
  run _loop_pr_classify "feat/foo" "CHANGES_REQUESTED" "success" "MERGEABLE"
  [ "$output" = "ready" ]
}

@test "_loop_pr_classify: human APPROVED is irrelevant — CI green → ready" {
  run _loop_pr_classify "feat/foo" "APPROVED" "success" "MERGEABLE"
  [ "$output" = "ready" ]
}

@test "_loop_pr_classify: CI failure → ci_red" {
  run _loop_pr_classify "feat/foo" "" "failure" "MERGEABLE"
  [ "$output" = "ci_red" ]
}

@test "_loop_pr_classify: mergeable CONFLICTING → stale" {
  run _loop_pr_classify "feat/foo" "" "success" "CONFLICTING"
  [ "$output" = "stale" ]
}

@test "_loop_pr_classify: mergeable BEHIND (out-of-date) → stale" {
  run _loop_pr_classify "feat/foo" "" "success" "BEHIND"
  [ "$output" = "stale" ]
}

@test "_loop_pr_classify: mergeStateStatus DIRTY (conflict) → stale" {
  run _loop_pr_classify "feat/foo" "" "success" "DIRTY"
  [ "$output" = "stale" ]
}

@test "_loop_pr_classify: claude/* branch (green) → ready" {
  run _loop_pr_classify "claude/ci-fix" "" "success" "CLEAN"
  [ "$output" = "ready" ]
}

@test "_loop_pr_classify: clean external PR → ready" {
  run _loop_pr_classify "feat/foo" "" "success" "MERGEABLE"
  [ "$output" = "ready" ]
}

@test "_loop_pr_classify: human COMMENTED is not a block" {
  run _loop_pr_classify "feat/foo" "COMMENTED" "success" "MERGEABLE"
  [ "$output" = "ready" ]
}

# ─── _loop_pr_rebase_circuit ──────────────────────────────────────────────────
#
# Records rebase attempts per PR in $_LOOP_STATE under pr_state.<PR>.attempts_at
# as a space-separated list of unix timestamps. Prunes entries older than 24h.
# Exit 0 (allowed) appends a new timestamp; exit 1 (blocked) does not.

@test "_loop_pr_rebase_circuit: first call records timestamp and allows" {
  run _loop_pr_rebase_circuit 42
  [ "$status" -eq 0 ]
  grep -q 'pr_state:' "$_LOOP_STATE"
  grep -qE '"42":' "$_LOOP_STATE"
}

@test "_loop_pr_rebase_circuit: 4th attempt within 24h is blocked (>=3)" {
  _loop_pr_rebase_circuit 7
  _loop_pr_rebase_circuit 7
  _loop_pr_rebase_circuit 7
  run _loop_pr_rebase_circuit 7
  [ "$status" -eq 1 ]
  [ -f "$_LOOP_ALERT" ]
  grep -q "PR #7" "$_LOOP_ALERT"
}

@test "_loop_pr_rebase_circuit: entries older than 24h are pruned" {
  # Seed state file with three stale timestamps (>24h ago) for PR #9.
  local stale_ts
  stale_ts=$(($(date -u +%s) - 90000))   # 25h ago
  printf 'pr_state:\n  "9":\n    attempts_at: "%s %s %s"\n' \
    "$stale_ts" "$stale_ts" "$stale_ts" > "$_LOOP_STATE"

  run _loop_pr_rebase_circuit 9
  [ "$status" -eq 0 ]
  # After call: stale entries pruned, only the fresh timestamp recorded.
  ! grep -q "$stale_ts" "$_LOOP_STATE"
  grep -qE "attempts_at: \"[0-9]+\"" "$_LOOP_STATE"
}

# ─── _loop_pr_inbox ───────────────────────────────────────────────────────────

@test "_loop_pr_inbox: returns 0 when gh is unavailable (lenient)" {
  # Shadow gh to simulate absent binary.
  gh() { return 127; }
  command() { if [ "$1" = "-v" ] && [ "$2" = "gh" ]; then return 1; fi; builtin command "$@"; }
  export -f gh command 2>/dev/null || true

  run _loop_pr_inbox
  [ "$status" -eq 0 ]
}

@test "_loop_pr_inbox: skips self-authored loop/* PR without invoking review" {
  git remote add origin git@github.com:test/repo.git
  # Override _gh_repo_slug rather than relying on remote URL parsing.
  _gh_repo_slug() { echo "test/repo"; }
  gh() {
    # Strip leading "-R <slug>" so the mock pattern-matches on the subcommand.
    if [ "$1" = "-R" ]; then shift 2; fi
    if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
      echo '[{"number":1,"headRefName":"loop/cycle-x","author":{"login":"seanyao"}}]'
      return 0
    fi
    if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
      echo '{"reviews":[],"mergeStateStatus":"CLEAN","statusCheckRollup":[{"conclusion":"SUCCESS"}]}'
      return 0
    fi
    return 0
  }
  _loop_pr_review_external() { touch "${TEST_TMP}/review-fired"; }

  run _loop_pr_inbox
  [ "$status" -eq 0 ]
  [ ! -f "${TEST_TMP}/review-fired" ]
}

# FIX-194: post-#440 the inbox no longer fires the external review hook —
# a green external PR is routed straight to the eager-merge path (CI is the
# only gate). The old review-fired assertion asserted removed behaviour.
@test "_loop_pr_inbox: green external PR routes to eager merge" {
  git remote add origin git@github.com:test/repo.git
  _gh_repo_slug() { echo "test/repo"; }
  gh() {
    # Strip leading "-R <slug>" so the mock pattern-matches on the subcommand.
    if [ "$1" = "-R" ]; then shift 2; fi
    if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
      echo '[{"number":42,"headRefName":"feat/foo","author":{"login":"contrib"}}]'
      return 0
    fi
    if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
      echo '{"reviews":[],"mergeStateStatus":"CLEAN","statusCheckRollup":[{"conclusion":"SUCCESS"}]}'
      return 0
    fi
    return 0
  }
  _loop_pr_merge_self_eager() { echo "$1" > "${TEST_TMP}/merge-fired"; }

  run _loop_pr_inbox
  [ "$status" -eq 0 ]
  [ -f "${TEST_TMP}/merge-fired" ]
  [ "$(cat "${TEST_TMP}/merge-fired")" = "42" ]
}

# PR-loop closure: a green claude/* PR (CLEAN) must be merged like a loop_self
# PR, not merely AI-reviewed — otherwise it sits open until a human acts.
@test "_loop_pr_inbox: green claude/* PR is merged (not just reviewed)" {
  git remote add origin git@github.com:test/repo.git
  _gh_repo_slug() { echo "test/repo"; }
  gh() {
    if [ "$1" = "-R" ]; then shift 2; fi
    if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
      echo '[{"number":99,"headRefName":"claude/ci-fix","author":{"login":"seanyao"}}]'
      return 0
    fi
    if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
      echo '{"reviews":[],"mergeStateStatus":"CLEAN","statusCheckRollup":[{"conclusion":"SUCCESS"}]}'
      return 0
    fi
    return 0
  }
  _loop_pr_merge_self_eager() { echo "$1" > "${TEST_TMP}/merge-fired"; }
  _loop_pr_review_external() { touch "${TEST_TMP}/review-fired"; }

  run _loop_pr_inbox
  [ "$status" -eq 0 ]
  [ -f "${TEST_TMP}/merge-fired" ]
  [ "$(cat "${TEST_TMP}/merge-fired")" = "99" ]
  [ ! -f "${TEST_TMP}/review-fired" ]
}

# PR-loop closure (PR #410 regression): a green self-PR that conflicts with
# main (DIRTY) must be rebased, not silently left — eager-merge can never
# merge it, so without the rebase branch it stays open forever.
@test "_loop_pr_inbox: green-but-DIRTY self-PR rebases instead of merging" {
  git remote add origin git@github.com:test/repo.git
  _gh_repo_slug() { echo "test/repo"; }
  gh() {
    if [ "$1" = "-R" ]; then shift 2; fi
    if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
      echo '[{"number":410,"headRefName":"loop/cycle-x","author":{"login":"seanyao"}}]'
      return 0
    fi
    if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
      echo '{"reviews":[],"mergeStateStatus":"DIRTY","statusCheckRollup":[{"conclusion":"SUCCESS"}]}'
      return 0
    fi
    return 0
  }
  _loop_pr_merge_self_eager() { touch "${TEST_TMP}/merge-fired"; }
  _loop_pr_rebase_stale() { echo "$1" > "${TEST_TMP}/rebase-fired"; }

  run _loop_pr_inbox
  [ "$status" -eq 0 ]
  [ -f "${TEST_TMP}/rebase-fired" ]
  [ "$(cat "${TEST_TMP}/rebase-fired")" = "410" ]
  # FIX-194: post-#440 the stale path legitimately re-checks the PR after the
  # rebase and attempts an eager merge (the real merge helper no-ops unless
  # CLEAN/MERGEABLE + green). Asserting "merge never called" tested old flow.
}

# FIX-158: a loop/* PR with red CI must NOT be silently dropped. The inbox
# routes loop_self_ci_red to a deduped ALERT (until full auto-heal lands) so
# the zombie self-PR is visible. Regression guard: the verdict must produce a
# side effect, never a no-op.
@test "_loop_pr_inbox: red loop/* PR writes loop-pr-ci-red ALERT (FIX-158, not silent)" {
  git remote add origin git@github.com:test/repo.git
  _gh_repo_slug() { echo "test/repo"; }
  gh() {
    if [ "$1" = "-R" ]; then shift 2; fi
    if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
      echo '[{"number":383,"headRefName":"loop/cycle-x","author":{"login":"seanyao"}}]'
      return 0
    fi
    if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
      echo '{"reviews":[],"mergeStateStatus":"BLOCKED","statusCheckRollup":[{"conclusion":"FAILURE"},{"conclusion":"SUCCESS"}]}'
      return 0
    fi
    return 0
  }
  # Guard against silent regression: merge-self must NOT be the handler here.
  _loop_pr_merge_self_eager() { touch "${TEST_TMP}/merge-self-fired"; }

  # US-LOOP-062a: a red loop/* PR routes to _loop_pr_heal_self. With heal
  # disabled (ROLL_LOOP_NO_HEAL=1) it falls back to the deduped ALERT — which
  # is exactly FIX-158's "never silently drop" guarantee.
  ROLL_LOOP_NO_HEAL=1 run _loop_pr_inbox
  [ "$status" -eq 0 ]
  [ -f "$_LOOP_ALERT" ]
  grep -q "TYPE:loop-pr-ci-red" "$_LOOP_ALERT"
  grep -q "PR #383" "$_LOOP_ALERT"
  [ ! -f "${TEST_TMP}/merge-self-fired" ]
}

# FIX-158: the ALERT is deduped — two inbox passes over the same still-red PR
# write only one loop-pr-ci-red line (no per-tick spam).
@test "_loop_pr_inbox: loop-pr-ci-red ALERT is deduped across passes (FIX-158)" {
  git remote add origin git@github.com:test/repo.git
  _gh_repo_slug() { echo "test/repo"; }
  gh() {
    if [ "$1" = "-R" ]; then shift 2; fi
    if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
      echo '[{"number":383,"headRefName":"loop/cycle-x","author":{"login":"seanyao"}}]'
      return 0
    fi
    if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
      echo '{"reviews":[],"mergeStateStatus":"BLOCKED","statusCheckRollup":[{"conclusion":"FAILURE"}]}'
      return 0
    fi
    return 0
  }
  ROLL_LOOP_NO_HEAL=1 run _loop_pr_inbox
  ROLL_LOOP_NO_HEAL=1 run _loop_pr_inbox
  [ "$(grep -c "TYPE:loop-pr-ci-red" "$_LOOP_ALERT")" -eq 1 ]
}

@test "_loop_pr_inbox: blocked_human_request_changes skips review" {
  git remote add origin git@github.com:test/repo.git
  _gh_repo_slug() { echo "test/repo"; }
  gh() {
    # Strip leading "-R <slug>" so the mock pattern-matches on the subcommand.
    if [ "$1" = "-R" ]; then shift 2; fi
    if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
      echo '[{"number":5,"headRefName":"feat/foo","author":{"login":"contrib"}}]'
      return 0
    fi
    if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
      echo '{"reviews":[{"authorAssociation":"COLLABORATOR","state":"CHANGES_REQUESTED"}],"mergeStateStatus":"CLEAN","statusCheckRollup":[{"conclusion":"SUCCESS"}]}'
      return 0
    fi
    return 0
  }
  _loop_pr_review_external() { touch "${TEST_TMP}/review-fired"; }

  run _loop_pr_inbox
  [ "$status" -eq 0 ]
  [ ! -f "${TEST_TMP}/review-fired" ]
}

@test "_loop_pr_inbox: writes tick on completion" {
  export ROLL_PROJECT_RUNTIME_DIR="${TEST_TMP}/.roll/loop"
  git remote add origin git@github.com:test/repo.git
  _gh_repo_slug() { echo "test/repo"; }
  gh() {
    if [ "$1" = "-R" ]; then shift 2; fi
    if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
      echo '[{"number":1,"headRefName":"loop/cycle-x","author":{"login":"seanyao"}}]'
      return 0
    fi
    if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
      echo '{"reviews":[],"mergeStateStatus":"CLEAN","statusCheckRollup":[{"conclusion":"SUCCESS"}]}'
      return 0
    fi
    return 0
  }
  run _loop_pr_inbox
  [ "$status" -eq 0 ]
  [ -f "${TEST_TMP}/.roll/loop/pr-tick.jsonl" ]
  run cat "${TEST_TMP}/.roll/loop/pr-tick.jsonl"
  [[ "$output" == *'"loop":"pr"'* ]]
}
