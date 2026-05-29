#!/usr/bin/env bats
# US-LOOP-019: E2E — validate runner template generates project-local control-plane paths.

setup() {
  local _saved_trap; _saved_trap="$(trap -p DEBUG 2>/dev/null || true)"
  trap - DEBUG
  source "${BATS_TEST_DIRNAME}/../../bin/roll"
  [[ -n "$_saved_trap" ]] && eval "$_saved_trap"

  FIXTURE="${BATS_TMPDIR}/fixture-loop-019-${RANDOM}"
  mkdir -p "${FIXTURE}/.roll/loop"
  # Initialize a minimal git repo so _write_loop_runner_script works
  git -C "$FIXTURE" init -b main
  git -C "$FIXTURE" config user.email "test@example.com"
  git -C "$FIXTURE" config user.name "Test"
  # Create a minimal .gitignore
  echo ".roll/" > "${FIXTURE}/.gitignore"

  RUNNER_DIR="${BATS_TMPDIR}/runner-019-${RANDOM}"
  mkdir -p "$RUNNER_DIR"
}

teardown() {
  rm -rf "${FIXTURE}" "${RUNNER_DIR}" 2>/dev/null || true
}

@test "inner runner template uses project-local heartbeat paths" {
  local runner="${RUNNER_DIR}/run-test-inner.sh"
  local log_path="${FIXTURE}/.roll/loop/cron.log"

  # Generate the runner script (via _write_loop_runner_script)
  _write_loop_runner_script "$runner" "$FIXTURE" "cd \"${FIXTURE}\" && echo test" "$log_path"
  local inner="${runner%.sh}-inner.sh"

  [ -f "$inner" ]

  # Inner script should use _loop_runtime_dir for heartbeat
  grep -q '_LOOP_RT_DIR=\$(_loop_runtime_dir' "$inner"
  grep -q 'HEARTBEAT_FILE="\${_LOOP_RT_DIR}/.heartbeat-' "$inner"
}

@test "inner runner template uses project-local state/alert/mute paths" {
  local runner="${RUNNER_DIR}/run-test-inner.sh"
  local log_path="${FIXTURE}/.roll/loop/cron.log"

  _write_loop_runner_script "$runner" "$FIXTURE" "cd \"${FIXTURE}\" && echo test" "$log_path"
  local inner="${runner%.sh}-inner.sh"

  # Inner script should use project-local paths for control-plane files
  grep -q '_LOOP_ALERT="\${_LOOP_RT_DIR}/ALERT-' "$inner"
  grep -q '_LOOP_STATE="\${_LOOP_RT_DIR}/state-' "$inner"
  grep -q '_LOOP_MUTE_FILE="\${_LOOP_RT_DIR}/mute-' "$inner"
}

@test "outer runner template calls _loop_migrate_legacy_paths" {
  local runner="${RUNNER_DIR}/run-test-outer.sh"
  local log_path="${FIXTURE}/.roll/loop/cron.log"

  _write_loop_runner_script "$runner" "$FIXTURE" "cd \"${FIXTURE}\" && echo test" "$log_path"

  [ -f "$runner" ]

  # Outer runner should call migration before reading state
  grep -q '_loop_migrate_legacy_paths' "$runner"
  grep -q '_LOOP_RT_DIR=\$(_loop_runtime_dir' "$runner"
}

@test "outer runner template uses project-local STATE_FILE" {
  local runner="${RUNNER_DIR}/run-test-outer.sh"
  local log_path="${FIXTURE}/.roll/loop/cron.log"

  _write_loop_runner_script "$runner" "$FIXTURE" "cd \"${FIXTURE}\" && echo test" "$log_path"

  # Outer runner should use project-local state file
  grep -q 'STATE_FILE="\${_LOOP_RT_DIR}/state-' "$runner"
}

@test "outer runner template uses project-local PAUSE" {
  local runner="${RUNNER_DIR}/run-test-outer.sh"
  local log_path="${FIXTURE}/.roll/loop/cron.log"

  _write_loop_runner_script "$runner" "$FIXTURE" "cd \"${FIXTURE}\" && echo test" "$log_path"

  # Outer runner should use project-local PAUSE file
  grep -q 'PAUSE="\${_LOOP_RT_DIR}/PAUSE-' "$runner"
}

@test "outer runner template appends .roll/loop/ to .gitignore" {
  local runner="${RUNNER_DIR}/run-test-outer.sh"
  local log_path="${FIXTURE}/.roll/loop/cron.log"

  _write_loop_runner_script "$runner" "$FIXTURE" "cd \"${FIXTURE}\" && echo test" "$log_path"

  # Outer runner should append .roll/loop/ to .gitignore
  grep -q "echo '.roll/loop/' >> " "$runner"
}

@test "generated scripts have valid bash syntax" {
  local runner="${RUNNER_DIR}/run-test-syntax.sh"
  local log_path="${FIXTURE}/.roll/loop/cron.log"

  _write_loop_runner_script "$runner" "$FIXTURE" "cd \"${FIXTURE}\" && echo test" "$log_path"

  # Both runner and inner should be syntactically valid
  bash -n "$runner"
  bash -n "${runner%.sh}-inner.sh"
}
