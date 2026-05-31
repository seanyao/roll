#!/usr/bin/env bats
# US-AUTO-046 Phase 2: dedicated Alert Loop runner — integration.
# Generates the runner via _write_alert_loop_runner_script and executes it
# against a stub `roll` binary, verifying (a) the happy path dispatches
# _alert_dispatch, (b) the single-flight lock blocks a concurrent pass from
# re-running, (c) a stale (dead-PID) lock is reclaimed, and (d) the lock dir
# is created. Mirrors cmd_loop_ci.bats (US-AUTO-045).

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

@test "Alert runner happy path: dispatches _alert_dispatch" {
  local runner="${TEST_TMP}/alert-runner.sh"
  _write_alert_loop_runner_script "$runner" "$PROJ" "$STUB" "${PROJ}/.roll/loop/alert.log"
  [ -x "$runner" ]
  bash "$runner"
  grep -q "_alert_dispatch" "$CALLS"
}

@test "Alert runner single-flight lock: a live concurrent pass exits without re-running" {
  local runner="${TEST_TMP}/alert-runner.sh"
  _write_alert_loop_runner_script "$runner" "$PROJ" "$STUB" "${PROJ}/.roll/loop/alert.log"
  # Pre-seed a live lock (this process's PID + fresh ts) so the runner sees a
  # pass already in flight and exits 0 before dispatching.
  local lock="${PROJ}/.roll/loop/.alert-loop.lock"
  printf '%s:%s\n' "$$" "$(date -u +%s)" > "$lock"
  bash "$runner"
  ! grep -q "_alert_dispatch" "$CALLS"
}

@test "Alert runner stale lock: a dead-PID lock is reclaimed and the pass runs" {
  local runner="${TEST_TMP}/alert-runner.sh"
  _write_alert_loop_runner_script "$runner" "$PROJ" "$STUB" "${PROJ}/.roll/loop/alert.log"
  # Dead PID (99999 unused) → stale lock → runner reclaims it and dispatches.
  local lock="${PROJ}/.roll/loop/.alert-loop.lock"
  printf '%s:%s\n' "99999" "$(date -u +%s)" > "$lock"
  bash "$runner"
  grep -q "_alert_dispatch" "$CALLS"
}

@test "Alert runner creates the lock dir if missing (state dir auto-created)" {
  # Remove the pre-made .roll/loop so the runner must mkdir -p the lock dir.
  rm -rf "${PROJ}/.roll/loop"
  local runner="${TEST_TMP}/alert-runner.sh"
  _write_alert_loop_runner_script "$runner" "$PROJ" "$STUB" "${PROJ}/.roll/loop/alert.log"
  bash "$runner"
  [ -d "${PROJ}/.roll/loop" ]
  grep -q "_alert_dispatch" "$CALLS"
}

@test "Alert runner end-to-end: consumes _LOOP_ALERT → writes jsonl + rotates" {
  # Drive the REAL roll _alert_dispatch (not the stub) so we exercise the full
  # Phase-1 consumer: parse → notify → record → rotate.
  mkdir -p "${PROJ}/.roll/state"
  local af="${PROJ}/.roll/loop/ALERT.md"
  printf '%s\n' '[2026-06-01T10:00:00] [error] [TYPE:ci-real-failure] CI failed run #999' > "$af"
  local runner="${TEST_TMP}/alert-runner.sh"
  _write_alert_loop_runner_script "$runner" "$PROJ" "$ROLL_BIN" "${PROJ}/.roll/loop/alert.log"
  # Override _LOOP_ALERT so the dispatched roll reads our seeded file.
  _LOOP_ALERT="$af" bash "$runner"
  # Source file rotated away (emptied) and a .prev snapshot left behind.
  [ ! -s "$af" ]
  [ -f "${af}.prev" ]
  # An error-level alert is always notified → notified:1 in the jsonl log.
  local jsonl="${PROJ}/.roll/state/alert-log.jsonl"
  [ -f "$jsonl" ]
  grep -q '"category":"ci-real-failure"' "$jsonl"
  grep -q '"notified":1' "$jsonl"
}
