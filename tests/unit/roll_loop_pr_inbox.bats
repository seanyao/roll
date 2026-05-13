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

@test "_loop_pr_classify: head_ref starting with loop/ → loop_self" {
  run _loop_pr_classify "loop/cycle-123" "" "success" "MERGEABLE"
  [ "$status" -eq 0 ]
  [ "$output" = "loop_self" ]
}

@test "_loop_pr_classify: human CHANGES_REQUESTED beats CI / mergeable" {
  run _loop_pr_classify "feat/foo" "CHANGES_REQUESTED" "success" "MERGEABLE"
  [ "$output" = "blocked_human_request_changes" ]
}

@test "_loop_pr_classify: human APPROVED → blocked_human_approved (let GitHub merge)" {
  run _loop_pr_classify "feat/foo" "APPROVED" "success" "MERGEABLE"
  [ "$output" = "blocked_human_approved" ]
}

@test "_loop_pr_classify: CI failure → stale" {
  run _loop_pr_classify "feat/foo" "" "failure" "MERGEABLE"
  [ "$output" = "stale" ]
}

@test "_loop_pr_classify: mergeable CONFLICTING → stale" {
  run _loop_pr_classify "feat/foo" "" "success" "CONFLICTING"
  [ "$output" = "stale" ]
}

@test "_loop_pr_classify: mergeable BEHIND (out-of-date) → stale" {
  run _loop_pr_classify "feat/foo" "" "success" "BEHIND"
  [ "$output" = "stale" ]
}

@test "_loop_pr_classify: clean external PR → eligible" {
  run _loop_pr_classify "feat/foo" "" "success" "MERGEABLE"
  [ "$output" = "eligible" ]
}

@test "_loop_pr_classify: human COMMENTED is not a block" {
  run _loop_pr_classify "feat/foo" "COMMENTED" "success" "MERGEABLE"
  [ "$output" = "eligible" ]
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
  # Mock gh to return one self-loop PR.
  cat > "${TEST_TMP}/gh-stub" <<'EOF'
#!/bin/bash
if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
  echo '[{"number":1,"headRefName":"loop/cycle-x","author":{"login":"seanyao"}}]'
  exit 0
fi
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  echo '{"reviews":[],"mergeStateStatus":"CLEAN","statusCheckRollup":[{"conclusion":"SUCCESS"}]}'
  exit 0
fi
exit 0
EOF
  chmod +x "${TEST_TMP}/gh-stub"
  PATH="${TEST_TMP}:$PATH"
  gh() { "${TEST_TMP}/gh-stub" "$@"; }
  export -f gh

  # Spy: review-hook should NOT fire on self-PR.
  _loop_pr_review_external() { touch "${TEST_TMP}/review-fired"; return 0; }
  export -f _loop_pr_review_external

  run _loop_pr_inbox
  [ "$status" -eq 0 ]
  [ ! -f "${TEST_TMP}/review-fired" ]
}
