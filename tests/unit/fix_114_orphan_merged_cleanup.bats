#!/usr/bin/env bats
# FIX-114: orphan worktree whose branch is already squash-merged remotely
# should be cleaned at cycle entry instead of being re-published / preserved.
# bats tier: fast

load helpers

setup() { unit_setup; }
teardown() { unit_teardown; }

@test "FIX-114: inner script has gh pr view MERGED check before republish path" {
  local runner_dir="${TEST_TMP}/runner"
  mkdir -p "$runner_dir"
  _write_loop_runner_script "${runner_dir}/run.sh" "${TEST_TMP}" "echo claude" "${runner_dir}/log.txt" 0 24
  local inner="${runner_dir}/run-inner.sh"
  [ -f "$inner" ]
  grep -q 'FIX-114' "$inner"
  grep -q 'gh pr view.*--json state' "$inner"
  grep -q 'MERGED' "$inner"
}

@test "FIX-114: merged check runs BEFORE the 'needs republish' commit count" {
  local runner_dir="${TEST_TMP}/runner2"
  mkdir -p "$runner_dir"
  _write_loop_runner_script "${runner_dir}/run.sh" "${TEST_TMP}" "echo claude" "${runner_dir}/log.txt" 0 24
  local inner="${runner_dir}/run-inner.sh"
  # Capture line numbers; merged-check must precede "origin/main..HEAD" count
  local merged_line republish_line
  merged_line=$(grep -n 'FIX-114' "$inner" | head -1 | cut -d: -f1)
  republish_line=$(grep -n '_orphan_commits=' "$inner" | head -1 | cut -d: -f1)
  [ -n "$merged_line" ]
  [ -n "$republish_line" ]
  [ "$merged_line" -lt "$republish_line" ]
}

@test "FIX-114: merged branch path calls _worktree_cleanup and continues to next iter" {
  local runner_dir="${TEST_TMP}/runner3"
  mkdir -p "$runner_dir"
  _write_loop_runner_script "${runner_dir}/run.sh" "${TEST_TMP}" "echo claude" "${runner_dir}/log.txt" 0 24
  local inner="${runner_dir}/run-inner.sh"
  # Extract the FIX-114 if-block and check both _worktree_cleanup + continue
  local block
  block=$(awk '/FIX-114/{f=1} f{print} /continue$/&&f{exit}' "$inner")
  [[ "$block" == *"_worktree_cleanup"* ]]
  [[ "$block" == *"continue"* ]]
}

@test "FIX-114: gh-unavailable path falls through gracefully (no abort)" {
  local runner_dir="${TEST_TMP}/runner4"
  mkdir -p "$runner_dir"
  _write_loop_runner_script "${runner_dir}/run.sh" "${TEST_TMP}" "echo claude" "${runner_dir}/log.txt" 0 24
  local inner="${runner_dir}/run-inner.sh"
  # When gh missing the check is wrapped in command -v gh, falls through to
  # the existing republish logic — confirm by structure.
  grep -q 'command -v gh' "$inner"
}
