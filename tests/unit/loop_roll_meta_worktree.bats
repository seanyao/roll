#!/usr/bin/env bats
# US-LOOP-068: roll-meta worktree helpers — setup, publish, cleanup.

ROLL="${BATS_TEST_DIRNAME}/../../bin/roll"

setup() {
  TEST_TMP=$(mktemp -d)
  cd "$TEST_TMP"
  # CI runners have no global git identity; the temp repos below commit, so
  # provide one via env vars (covers every repo this test creates).
  export GIT_AUTHOR_NAME="Test" GIT_AUTHOR_EMAIL="test@test"
  export GIT_COMMITTER_NAME="Test" GIT_COMMITTER_EMAIL="test@test"
}

teardown() { cd /; rm -rf "$TEST_TMP"; }

@test "roll_meta_worktree_setup: creates .roll/ as roll-meta worktree inside product worktree" {
  # Product repo
  git init --quiet product
  mkdir -p product/.roll
  git -C product/.roll init --quiet
  git -C product/.roll remote add origin https://github.com/seanyao/roll-meta.git
  # Seed roll-meta with a commit so origin/main exists
  touch product/.roll/README.md
  git -C product/.roll add README.md
  git -C product/.roll commit -m "init" --quiet
  git -C product/.roll update-ref refs/remotes/origin/main HEAD

  mkdir -p worktrees/wt
  source "$ROLL"
  run _loop_roll_meta_worktree_setup "${TEST_TMP}/worktrees/wt" "loop/cycle-test" "${TEST_TMP}/product"
  [ "$status" -eq 0 ]
  [ -e "${TEST_TMP}/worktrees/wt/.roll/.git" ]
  [ -f "${TEST_TMP}/worktrees/wt/.roll/README.md" ]
}

@test "roll_meta_worktree_setup: fails when .roll/ is not a git repo" {
  mkdir -p product/.roll
  mkdir -p worktrees/wt
  source "$ROLL"
  run _loop_roll_meta_worktree_setup "${TEST_TMP}/worktrees/wt" "loop/cycle-test" "${TEST_TMP}/product"
  [ "$status" -eq 1 ]
  [ ! -d "${TEST_TMP}/worktrees/wt/.roll" ]
}

@test "roll_meta_worktree_cleanup: removes roll-meta worktree and branch" {
  git init --quiet product
  mkdir -p product/.roll
  git -C product/.roll init --quiet
  git -C product/.roll remote add origin https://github.com/seanyao/roll-meta.git
  touch product/.roll/README.md
  git -C product/.roll add README.md
  git -C product/.roll commit -m "init" --quiet
  git -C product/.roll update-ref refs/remotes/origin/main HEAD

  mkdir -p worktrees/wt
  source "$ROLL"
  _loop_roll_meta_worktree_setup "${TEST_TMP}/worktrees/wt" "loop/cycle-test" "${TEST_TMP}/product"

  run _loop_roll_meta_worktree_cleanup "${TEST_TMP}/worktrees/wt" "loop/cycle-test" "${TEST_TMP}/product"
  [ "$status" -eq 0 ]
  [ ! -d "${TEST_TMP}/worktrees/wt/.roll" ]
  # Branch should be deleted
  run git -C product/.roll rev-parse --verify --quiet "loop/cycle-test"
  [ "$status" -ne 0 ]
}

@test "roll_meta_worktree_cleanup: no-op when .roll/ is not a git repo" {
  mkdir -p product/.roll
  source "$ROLL"
  run _loop_roll_meta_worktree_cleanup "${TEST_TMP}/worktrees/wt" "loop/cycle-test" "${TEST_TMP}/product"
  [ "$status" -eq 0 ]
}

# Runner script generation tests ──────────────────────────────────────────────

@test "runner script: inner contains roll-meta detection" {
  source "$ROLL"
  _write_loop_runner_script "${TEST_TMP}/run.sh" "${TEST_TMP}" "echo ok" "${TEST_TMP}/log" 0 24 >/dev/null 2>&1 || true
  local inner="${TEST_TMP}/run-inner.sh"
  [ -f "$inner" ]
  grep -qF '_loop_is_roll_meta_story' "$inner"
}

@test "runner script: inner contains roll-meta worktree setup" {
  source "$ROLL"
  _write_loop_runner_script "${TEST_TMP}/run.sh" "${TEST_TMP}" "echo ok" "${TEST_TMP}/log" 0 24 >/dev/null 2>&1 || true
  local inner="${TEST_TMP}/run-inner.sh"
  [ -f "$inner" ]
  grep -qF '_loop_roll_meta_worktree_setup' "$inner"
}

@test "runner script: inner contains roll-meta publish path" {
  source "$ROLL"
  _write_loop_runner_script "${TEST_TMP}/run.sh" "${TEST_TMP}" "echo ok" "${TEST_TMP}/log" 0 24 >/dev/null 2>&1 || true
  local inner="${TEST_TMP}/run-inner.sh"
  [ -f "$inner" ]
  grep -qF '_loop_roll_meta_publish' "$inner"
}

@test "runner script: inner contains roll-meta cleanup" {
  source "$ROLL"
  _write_loop_runner_script "${TEST_TMP}/run.sh" "${TEST_TMP}" "echo ok" "${TEST_TMP}/log" 0 24 >/dev/null 2>&1 || true
  local inner="${TEST_TMP}/run-inner.sh"
  [ -f "$inner" ]
  grep -qF '_loop_roll_meta_worktree_cleanup' "$inner"
}

@test "runner script: inner contains target field in runs.jsonl" {
  source "$ROLL"
  _write_loop_runner_script "${TEST_TMP}/run.sh" "${TEST_TMP}" "echo ok" "${TEST_TMP}/log" 0 24 >/dev/null 2>&1 || true
  local inner="${TEST_TMP}/run-inner.sh"
  [ -f "$inner" ]
  grep -qF 'target' "$inner"
  grep -qF '_target_field' "$inner"
}

@test "roll_meta_test_gate: no ops changes → pass" {
  git init --quiet product
  mkdir -p product/.roll
  git -C product/.roll init --quiet
  git -C product/.roll remote add origin https://github.com/seanyao/roll-meta.git
  touch product/.roll/README.md
  git -C product/.roll add README.md
  git -C product/.roll commit -m "init" --quiet
  git -C product/.roll update-ref refs/remotes/origin/main HEAD
  touch product/.roll/backlog.md
  git -C product/.roll add backlog.md
  git -C product/.roll commit -m "tcr: backlog update" --quiet

  source "$ROLL"
  run _loop_roll_meta_test_gate "${TEST_TMP}/product"
  [ "$status" -eq 0 ]
}

@test "roll_meta_test_gate: ops changed + tests pass → pass" {
  command -v bats >/dev/null 2>&1 || skip "bats not installed"
  git init --quiet product
  mkdir -p product/.roll/ops/tests
  git -C product/.roll init --quiet
  git -C product/.roll remote add origin https://github.com/seanyao/roll-meta.git
  touch product/.roll/README.md
  git -C product/.roll add README.md
  git -C product/.roll commit -m "init" --quiet
  git -C product/.roll update-ref refs/remotes/origin/main HEAD
  touch product/.roll/ops/config.sh
  cat > product/.roll/ops/tests/config.bats <<'BAT'
@test "dummy" { true; }
BAT
  git -C product/.roll add ops/
  git -C product/.roll commit -m "tcr: ops change" --quiet

  source "$ROLL"
  run _loop_roll_meta_test_gate "${TEST_TMP}/product"
  [ "$status" -eq 0 ]
}

@test "roll_meta_test_gate: ops changed + tests fail → fail" {
  command -v bats >/dev/null 2>&1 || skip "bats not installed"
  git init --quiet product
  mkdir -p product/.roll/ops/tests
  git -C product/.roll init --quiet
  git -C product/.roll remote add origin https://github.com/seanyao/roll-meta.git
  touch product/.roll/README.md
  git -C product/.roll add README.md
  git -C product/.roll commit -m "init" --quiet
  git -C product/.roll update-ref refs/remotes/origin/main HEAD
  touch product/.roll/ops/config.sh
  cat > product/.roll/ops/tests/config.bats <<'BAT'
@test "failing" { false; }
BAT
  git -C product/.roll add ops/
  git -C product/.roll commit -m "tcr: ops change" --quiet

  source "$ROLL"
  run _loop_roll_meta_test_gate "${TEST_TMP}/product"
  [ "$status" -eq 1 ]
}

@test "runner script: inner contains roll-meta test gate" {
  source "$ROLL"
  _write_loop_runner_script "${TEST_TMP}/run.sh" "${TEST_TMP}" "echo ok" "${TEST_TMP}/log" 0 24 >/dev/null 2>&1 || true
  local inner="${TEST_TMP}/run-inner.sh"
  [ -f "$inner" ]
  grep -qF '_loop_roll_meta_test_gate' "$inner"
}
