#!/usr/bin/env bats
# US-AUTO-045 Phase 2: dedicated CI Loop runner — integration.
# Generates the runner via _write_ci_loop_runner_script and executes it against
# a stub `roll` binary, verifying (a) the happy path dispatches _ci_scan,
# (b) the single-flight lock blocks a concurrent pass from re-running,
# (c) a stale (dead-PID) lock is reclaimed, and (d) the state dir is created.

ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"

setup() {
  TEST_TMP="$(mktemp -d)"
  PROJ="${TEST_TMP}/proj"
  mkdir -p "${PROJ}/.roll/loop"
  CALLS="${TEST_TMP}/calls.log"
  : > "$CALLS"
  # Stub `roll`: records its dispatched subcommand and exits 0.
  STUB="${TEST_TMP}/roll-stub.sh"
  cat > "$STUB" <<EOF
#!/bin/bash
echo "\$@" >> "${CALLS}"
EOF
  chmod +x "$STUB"
  source "$ROLL_BIN"
}
teardown() { rm -rf "${TEST_TMP:-}"; }

@test "CI runner happy path: dispatches _ci_scan" {
  local runner="${TEST_TMP}/ci-runner.sh"
  _write_ci_loop_runner_script "$runner" "$PROJ" "$STUB" "${PROJ}/.roll/loop/ci.log"
  [ -x "$runner" ]
  bash "$runner"
  grep -q "_ci_scan" "$CALLS"
}

@test "CI runner single-flight lock: a live concurrent pass exits without re-running" {
  local runner="${TEST_TMP}/ci-runner.sh"
  _write_ci_loop_runner_script "$runner" "$PROJ" "$STUB" "${PROJ}/.roll/loop/ci.log"
  # Pre-seed a live lock (this process's PID + fresh ts) so the runner sees a
  # pass already in flight and exits 0 before dispatching.
  local lock="${PROJ}/.roll/loop/.ci-loop.lock"
  printf '%s:%s\n' "$$" "$(date -u +%s)" > "$lock"
  bash "$runner"
  ! grep -q "_ci_scan" "$CALLS"
}

@test "CI runner stale lock: a dead-PID lock is reclaimed and the pass runs" {
  local runner="${TEST_TMP}/ci-runner.sh"
  _write_ci_loop_runner_script "$runner" "$PROJ" "$STUB" "${PROJ}/.roll/loop/ci.log"
  # Dead PID (99999 unused) → stale lock → runner reclaims it and dispatches.
  local lock="${PROJ}/.roll/loop/.ci-loop.lock"
  printf '%s:%s\n' "99999" "$(date -u +%s)" > "$lock"
  bash "$runner"
  grep -q "_ci_scan" "$CALLS"
}

@test "CI runner creates the lock dir if missing (state dir auto-created)" {
  # Remove the pre-made .roll/loop so the runner must mkdir -p the lock dir.
  rm -rf "${PROJ}/.roll/loop"
  local runner="${TEST_TMP}/ci-runner.sh"
  _write_ci_loop_runner_script "$runner" "$PROJ" "$STUB" "${PROJ}/.roll/loop/ci.log"
  bash "$runner"
  [ -d "${PROJ}/.roll/loop" ]
  grep -q "_ci_scan" "$CALLS"
}
