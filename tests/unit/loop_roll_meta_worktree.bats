#!/usr/bin/env bats
# US-LOOP-068: roll-meta worktree helpers — setup, publish, cleanup.

ROLL="${BATS_TEST_DIRNAME}/../../bin/roll"

setup() {
  TEST_TMP=$(mktemp -d)
  cd "$TEST_TMP"
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
