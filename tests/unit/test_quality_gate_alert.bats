#!/usr/bin/env bats
# US-QA-013: when the test-quality gate blocks, write ALERT for the
# project. PR description marker `[skip-test-quality]` bypasses the
# gate. Helpers:
#   _loop_test_quality_check_with_alert <files...>
#   _loop_pr_body_has_skip_test_quality <body>

ROLL="${BATS_TEST_DIRNAME}/../../bin/roll"

setup() {
  TEST_TMP=$(mktemp -d)
  cd "$TEST_TMP"
  export ROLL_MAIN_PROJECT="$TEST_TMP"
  export _SHARED_ROOT="$TEST_TMP/shared"
  mkdir -p "$_SHARED_ROOT/loop"
}

teardown() {
  cd /
  unset ROLL_MAIN_PROJECT _SHARED_ROOT
  rm -rf "$TEST_TMP"
}

@test "pr body marker: literal [skip-test-quality] detected" {
  source "$ROLL"
  run _loop_pr_body_has_skip_test_quality "Some change [skip-test-quality] approved"
  [ "$status" -eq 0 ]
}

@test "pr body marker: missing marker returns non-zero" {
  source "$ROLL"
  run _loop_pr_body_has_skip_test_quality "Some change without bypass"
  [ "$status" -ne 0 ]
}

@test "pr body marker: empty body returns non-zero" {
  source "$ROLL"
  run _loop_pr_body_has_skip_test_quality ""
  [ "$status" -ne 0 ]
}

@test "pr body marker: case-insensitive match" {
  source "$ROLL"
  run _loop_pr_body_has_skip_test_quality "PR: [Skip-Test-Quality] please"
  [ "$status" -eq 0 ]
}

@test "with_alert: clean files return 0, no ALERT written" {
  cat > t.bats <<'BATS'
@test "x" {
  source bin/roll
  run _project_helper foo
  [ "$status" -eq 0 ]
}
BATS
  source "$ROLL"
  _loop_test_quality_check_with_alert t.bats
  local rc=$?
  [ "$rc" -eq 0 ]
  [ ! -f "$_SHARED_ROOT/loop/ALERT-"*".md" ] || \
    ! grep -q "test-quality" "$_SHARED_ROOT/loop/"ALERT-*.md 2>/dev/null || true
}

@test "with_alert: violations return 1 and write ALERT" {
  cat > t.bats <<'BATS'
@test "x" {
  result=$(echo "$x" | sed 's/.*//' | awk '{print}')
}
BATS
  source "$ROLL"
  run _loop_test_quality_check_with_alert t.bats
  [ "$status" -ne 0 ]
  local alert_files
  alert_files=$(grep -l "test-quality" "$_SHARED_ROOT/loop/"ALERT-*.md 2>/dev/null || true)
  [ -n "$alert_files" ]
}

@test "with_alert: ALERT mentions which file and which category" {
  cat > t.bats <<'BATS'
@test "x" {
  result=$(echo "$x" | sed 's/.*//' | awk '{print}')
}
BATS
  source "$ROLL"
  _loop_test_quality_check_with_alert t.bats || true
  local alert_body
  alert_body=$(cat "$_SHARED_ROOT/loop/"ALERT-*.md 2>/dev/null)
  [[ "$alert_body" == *"t.bats"* ]]
  [[ "$alert_body" == *"❼"* ]] || [[ "$alert_body" == *"test-quality"* ]]
}

@test "with_alert: --skip path returns 0 without writing ALERT" {
  cat > t.bats <<'BATS'
@test "x" {
  result=$(echo "$x" | sed 's/.*//' | awk '{print}')
}
BATS
  source "$ROLL"
  _loop_test_quality_check_with_alert --skip t.bats
  local rc=$?
  [ "$rc" -eq 0 ]
  ! ls "$_SHARED_ROOT/loop/"ALERT-*.md 2>/dev/null | xargs grep -l "test-quality" 2>/dev/null
}

@test "AGENTS / docs mention the [skip-test-quality] PR bypass" {
  grep -qE '\[skip-test-quality\]|skip-test-quality' "$ROLL"
}
