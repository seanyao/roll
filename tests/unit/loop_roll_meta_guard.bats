#!/usr/bin/env bats
# US-LOOP-069: _loop_guard_roll_meta_boundary prevents roll-meta stories from
# touching product-repo files. Only .roll/ changes are allowed.

ROLL="${BATS_TEST_DIRNAME}/../../bin/roll"

setup() {
  TEST_TMP=$(mktemp -d)
  cd "$TEST_TMP"
}

teardown() { cd /; rm -rf "$TEST_TMP"; }

# Helper: create a git repo with origin/main ref at first commit
_setup_git_with_origin() {
  git init --quiet
  git checkout -b main 2>/dev/null || true
  git config user.email "test@test"
  git config user.name "Test"
  touch README.md
  git add README.md
  git commit -m "init"
  git update-ref refs/remotes/origin/main HEAD
}

@test "guard: non-roll-meta story → always allowed" {
  mkdir -p .roll
  cat > .roll/backlog.md <<'MD'
| [US-A-001](.roll/features/test/t.md#us-a-001) | plain | 📋 Todo |
MD
  _setup_git_with_origin
  mkdir -p bin && touch bin/roll
  git add bin/roll
  git commit -m "tcr: change"
  source "$ROLL"
  export ROLL_MAIN_PROJECT="$TEST_TMP"
  run _loop_guard_roll_meta_boundary "$TEST_TMP" "US-A-001"
  [ "$status" -eq 0 ]
}

@test "guard: roll-meta story with only .roll/ changes → allowed" {
  mkdir -p .roll
  cat > .roll/backlog.md <<'MD'
| [US-LOOP-069](.roll/features/test/t.md#us-loop-069) | meta manual-only:roll-meta | 📋 Todo |
MD
  _setup_git_with_origin
  touch .roll/somefile
  git add .roll/somefile
  git commit -m "tcr: change"
  source "$ROLL"
  export ROLL_MAIN_PROJECT="$TEST_TMP"
  run _loop_guard_roll_meta_boundary "$TEST_TMP" "US-LOOP-069"
  [ "$status" -eq 0 ]
}

@test "guard: roll-meta story touching product file → blocked + ALERT" {
  mkdir -p .roll
  cat > .roll/backlog.md <<'MD'
| [US-LOOP-069](.roll/features/test/t.md#us-loop-069) | meta manual-only:roll-meta | 📋 Todo |
MD
  _setup_git_with_origin
  mkdir -p bin && touch bin/roll
  git add bin/roll
  git commit -m "tcr: change"
  source "$ROLL"
  export ROLL_MAIN_PROJECT="$TEST_TMP"
  _LOOP_RT_DIR="$TEST_TMP/.roll/loop"
  mkdir -p "$_LOOP_RT_DIR"
  _LOOP_ALERT="$_LOOP_RT_DIR/ALERT-test.md"
  run _loop_guard_roll_meta_boundary "$TEST_TMP" "US-LOOP-069"
  [ "$status" -ne 0 ]
  [ -f "$_LOOP_ALERT" ]
  grep -q "US-LOOP-069" "$_LOOP_ALERT"
  grep -q "bin/roll" "$_LOOP_ALERT"
}

@test "guard: roll-meta story touching lib/ → blocked" {
  mkdir -p .roll lib
  cat > .roll/backlog.md <<'MD'
| [US-LOOP-069](.roll/features/test/t.md#us-loop-069) | meta manual-only:roll-meta | 📋 Todo |
MD
  _setup_git_with_origin
  touch lib/helper.sh
  git add lib/helper.sh
  git commit -m "tcr: change"
  source "$ROLL"
  export ROLL_MAIN_PROJECT="$TEST_TMP"
  _LOOP_RT_DIR="$TEST_TMP/.roll/loop"
  mkdir -p "$_LOOP_RT_DIR"
  _LOOP_ALERT="$_LOOP_RT_DIR/ALERT-test.md"
  run _loop_guard_roll_meta_boundary "$TEST_TMP" "US-LOOP-069"
  [ "$status" -ne 0 ]
  grep -q "lib/helper.sh" "$_LOOP_ALERT"
}

@test "guard: missing backlog → allowed (fail-safe)" {
  _setup_git_with_origin
  mkdir -p bin && touch bin/roll
  git add bin/roll
  git commit -m "tcr: change"
  source "$ROLL"
  export ROLL_MAIN_PROJECT="$TEST_TMP"
  run _loop_guard_roll_meta_boundary "$TEST_TMP" "US-LOOP-069"
  [ "$status" -eq 0 ]
}

@test "runner script: inner includes roll-meta boundary guard" {
  source "$ROLL"
  _write_loop_runner_script "${TEST_TMP}/run.sh" "${TEST_TMP}" "echo ok" "${TEST_TMP}/log" 0 24 >/dev/null 2>&1 || true
  local inner="${TEST_TMP}/run-inner.sh"
  [ -f "$inner" ]
  grep -qF '_loop_guard_roll_meta_boundary' "$inner"
}
