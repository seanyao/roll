#!/usr/bin/env bats
# US-AUTO-036: Tests for worktree helper functions (loop-safe additions).
#
# These helpers will be wired into _write_loop_runner_script in US-AUTO-037
# (manual-only). Phase 1 (this Story) delivers helpers + tests with **zero
# runner.sh changes**.
#
# Helper namespace: _worktree_*
#   _worktree_path <slug> <us-id>             → string
#   _worktree_create <path> <branch> <base>   → idempotent on branch reuse
#   _worktree_cleanup <path> <branch>         → remove worktree + branch
#   _worktree_fetch_origin <branch>           → lenient on failure
#   _worktree_submodule_init <path>           → init submodules in worktree
#   _worktree_merge_back <branch>             → ff-only merge + push, alert on fail
#   _worktree_alert <msg>                     → append to _LOOP_ALERT (internal)

load helpers

setup() {
  unit_setup
  _orig_dir="$PWD"
  cd "$TEST_TMP"

  # Bare upstream + local clone so fetch/push are exercisable without a real remote.
  git init -q --bare upstream.git
  git clone -q upstream.git repo
  cd repo
  git config user.email "test@example.com"
  git config user.name "Test"
  git config commit.gpgsign false
  git commit --allow-empty -m "init" -q
  git push -q origin master 2>/dev/null || git push -q origin main 2>/dev/null || true
  # Pin to main for predictability
  git branch -m main 2>/dev/null || true
  git push -q -u origin main 2>/dev/null || true

  # Override roll's shared dirs to land inside TEST_TMP
  _SHARED_ROOT="${TEST_TMP}/shared"
  _LOOP_ALERT="${_SHARED_ROOT}/loop/ALERT.md"
  mkdir -p "${_SHARED_ROOT}/worktrees" "${_SHARED_ROOT}/loop"
}
teardown() {
  # Clean any lingering worktrees registered against this repo
  if [ -d "${TEST_TMP}/repo" ]; then
    cd "${TEST_TMP}/repo" 2>/dev/null && git worktree list --porcelain 2>/dev/null \
      | awk '/^worktree /{print $2}' \
      | while read -r wt; do
          [ "$wt" != "${TEST_TMP}/repo" ] && git worktree remove --force "$wt" 2>/dev/null || true
        done
  fi
  cd "$_orig_dir"
  unit_teardown
}

# --- _worktree_path ---

@test "_worktree_path: returns <_SHARED_ROOT>/worktrees/<slug>-<us-id>" {
  run _worktree_path "myproj-abc123" "US-AUTO-036"
  [ "$status" -eq 0 ]
  [ "$output" = "${_SHARED_ROOT}/worktrees/myproj-abc123-US-AUTO-036" ]
}

# --- _worktree_create ---

@test "_worktree_create: fresh path + new branch succeeds" {
  local wt; wt=$(_worktree_path "test" "US-X")
  run _worktree_create "$wt" "loop/US-X" "main"
  [ "$status" -eq 0 ]
  [ -d "$wt" ]
  [ -f "$wt/.git" ] || [ -d "$wt/.git" ]
  git show-ref --verify --quiet "refs/heads/loop/US-X"
}

@test "_worktree_create: idempotent when branch already exists from prior failed run" {
  local wt; wt=$(_worktree_path "test" "US-Y")
  # First create
  _worktree_create "$wt" "loop/US-Y" "main"
  # Simulate prior run that registered branch but worktree dir was cleaned externally
  git worktree remove --force "$wt"
  # Branch still exists at this point
  git show-ref --verify --quiet "refs/heads/loop/US-Y"

  # Retry — must succeed even though branch already exists
  run _worktree_create "$wt" "loop/US-Y" "main"
  [ "$status" -eq 0 ]
  [ -d "$wt" ]
}

# --- _worktree_cleanup ---

@test "_worktree_cleanup: removes worktree dir and deletes branch" {
  local wt; wt=$(_worktree_path "test" "US-Z")
  _worktree_create "$wt" "loop/US-Z" "main"
  [ -d "$wt" ]
  git show-ref --verify --quiet "refs/heads/loop/US-Z"

  run _worktree_cleanup "$wt" "loop/US-Z"
  [ "$status" -eq 0 ]
  [ ! -d "$wt" ]
  ! git show-ref --verify --quiet "refs/heads/loop/US-Z"
}

@test "_worktree_cleanup: tolerant when worktree or branch already absent" {
  local wt; wt=$(_worktree_path "test" "US-MISSING")
  # Neither exists; cleanup should still succeed
  run _worktree_cleanup "$wt" "loop/US-MISSING"
  [ "$status" -eq 0 ]
}

# --- _worktree_alert ---

@test "_worktree_alert: appends timestamped message to _LOOP_ALERT" {
  run _worktree_alert "sample failure message"
  [ "$status" -eq 0 ]
  [ -f "$_LOOP_ALERT" ]
  grep -qF "sample failure message" "$_LOOP_ALERT"
}
