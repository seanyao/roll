#!/usr/bin/env bats
# US-AUTO-044 Phase 2: dedicated PR Loop runner — integration.
# Generates the runner via _write_pr_loop_runner_script and executes it against
# a stub `roll` binary, verifying (a) the happy path dispatches _loop_pr_inbox
# and (b) the single-flight lock blocks a concurrent pass from re-running.

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

@test "PR runner happy path: dispatches _loop_pr_inbox" {
  local runner="${TEST_TMP}/pr-runner.sh"
  _write_pr_loop_runner_script "$runner" "$PROJ" "$STUB" "${PROJ}/.roll/loop/pr.log"
  [ -x "$runner" ]
  bash "$runner"
  grep -q "_loop_pr_inbox" "$CALLS"
}

@test "PR runner single-flight lock: a live concurrent pass exits without re-running" {
  local runner="${TEST_TMP}/pr-runner.sh"
  _write_pr_loop_runner_script "$runner" "$PROJ" "$STUB" "${PROJ}/.roll/loop/pr.log"
  # Pre-seed a live lock (this process's PID + fresh ts) so the runner sees a
  # pass already in flight and exits 0 before dispatching.
  local lock="${PROJ}/.roll/loop/.pr-loop.lock"
  printf '%s:%s\n' "$$" "$(date -u +%s)" > "$lock"
  bash "$runner"
  ! grep -q "_loop_pr_inbox" "$CALLS"
}

@test "PR runner stale lock: a dead-PID lock is reclaimed and the pass runs" {
  local runner="${TEST_TMP}/pr-runner.sh"
  _write_pr_loop_runner_script "$runner" "$PROJ" "$STUB" "${PROJ}/.roll/loop/pr.log"
  # Dead PID (99999 unused) → stale lock → runner reclaims it and dispatches.
  local lock="${PROJ}/.roll/loop/.pr-loop.lock"
  printf '%s:%s\n' "99999" "$(date -u +%s)" > "$lock"
  bash "$runner"
  grep -q "_loop_pr_inbox" "$CALLS"
}
