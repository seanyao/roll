#!/usr/bin/env bats
# US-ISO-004: `roll test --reset` — destroys and rebuilds the isolation
# environment to a clean state, with a lockfile so concurrent `roll test`
# invocations fast-fail with a clear message rather than racing into a
# half-rebuilt VM.

bats_require_minimum_version 1.5.0

load helpers

setup() {
  unit_setup_cd
  err()  { echo "ERR: $*" >&2; }
  warn() { echo "WARN: $*" >&2; }
  info() { echo "INFO: $*"; }
  ok()   { echo "OK: $*"; }
}

teardown() { unit_teardown_cd; }

_write_iso_yaml() {
  mkdir -p .roll
  cat > .roll/local.yaml <<EOF
$1
EOF
}

# ── --help mentions --reset ───────────────────────────────────────────────

@test "cmd_test --help: documents --reset" {
  run cmd_test --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"--reset"* ]]
}

# ── --reset on type=none degrades gracefully ─────────────────────────────

@test "cmd_test --reset on type=none: prints explanation + exits 0 (not a failure)" {
  # default config = none
  run --separate-stderr cmd_test --reset
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"nothing to reset"* ]] || [[ "$stderr" == *"无需"* ]]
}

@test "cmd_test --reset on explicit type=none: same degradation" {
  _write_iso_yaml "$(cat <<EOF
test_isolation:
  type: none
EOF
)"
  run --separate-stderr cmd_test --reset
  [ "$status" -eq 0 ]
}

# ── --reset on type=tart calls dispatcher reset ──────────────────────────

@test "cmd_test --reset on type=tart: invokes _isolation_dispatch reset" {
  _write_iso_yaml "$(cat <<EOF
test_isolation:
  type: tart
EOF
)"
  _DISPATCH_LOG="${TEST_TMP}/dispatch.log"
  _isolation_dispatch() {
    echo "DISPATCH: $*" >> "$_DISPATCH_LOG"
    return 0
  }
  export -f _isolation_dispatch

  run cmd_test --reset
  [ "$status" -eq 0 ]
  grep -q "^DISPATCH: reset$" "$_DISPATCH_LOG"
  # And reset MUST NOT have dispatched anything else (no accidental exec).
  ! grep -q "^DISPATCH: exec" "$_DISPATCH_LOG"
}

@test "cmd_test --reset: propagates dispatcher exit code (failure surfaces)" {
  _write_iso_yaml "$(cat <<EOF
test_isolation:
  type: tart
EOF
)"
  _isolation_dispatch() { return 3; }
  export -f _isolation_dispatch

  run cmd_test --reset
  [ "$status" -eq 3 ]
}

# ── lock semantics ───────────────────────────────────────────────────────

@test "lock: _isolation_reset_lock_held false when no lockfile exists" {
  run _isolation_reset_lock_held
  [ "$status" -ne 0 ]
}

@test "lock: acquire creates the lockfile" {
  _isolation_reset_acquire_lock
  run _isolation_reset_lock_held
  [ "$status" -eq 0 ]
}

@test "lock: acquire returns non-zero when lock already held" {
  _isolation_reset_acquire_lock
  run _isolation_reset_acquire_lock
  [ "$status" -ne 0 ]
}

@test "lock: release removes the lockfile" {
  _isolation_reset_acquire_lock
  _isolation_reset_release_lock
  run _isolation_reset_lock_held
  [ "$status" -ne 0 ]
}

# ── concurrent guard: lock blocks other roll test invocations ────────────

@test "cmd_test (exec path): fast-fails with clear error when reset in progress" {
  _write_iso_yaml "$(cat <<EOF
test_isolation:
  type: tart
EOF
)"
  _isolation_reset_acquire_lock
  # Should not even reach the dispatcher.
  _isolation_dispatch() { echo "REACHED" >&2; return 0; }
  export -f _isolation_dispatch

  run --separate-stderr cmd_test
  [ "$status" -ne 0 ]
  [[ "$stderr" == *"reset"* ]]
  [[ "$stderr" != *"REACHED"* ]]
}

@test "cmd_test --reset: refuses when another reset is already in progress" {
  _write_iso_yaml "$(cat <<EOF
test_isolation:
  type: tart
EOF
)"
  _isolation_reset_acquire_lock   # simulate first reset already running
  _isolation_dispatch() { echo "REACHED" >&2; return 0; }
  export -f _isolation_dispatch

  run --separate-stderr cmd_test --reset
  [ "$status" -ne 0 ]
  [[ "$stderr" == *"reset"* ]]
  [[ "$stderr" != *"REACHED"* ]]
}

@test "cmd_test --reset: releases the lock after dispatcher finishes (success path)" {
  _write_iso_yaml "$(cat <<EOF
test_isolation:
  type: tart
EOF
)"
  _isolation_dispatch() { return 0; }
  export -f _isolation_dispatch

  run cmd_test --reset
  [ "$status" -eq 0 ]
  # Subsequent reset should not see a stale lock.
  run _isolation_reset_lock_held
  [ "$status" -ne 0 ]
}

@test "cmd_test --reset: releases the lock even when dispatcher fails" {
  _write_iso_yaml "$(cat <<EOF
test_isolation:
  type: tart
EOF
)"
  _isolation_dispatch() { return 5; }
  export -f _isolation_dispatch

  run cmd_test --reset
  [ "$status" -eq 5 ]
  run _isolation_reset_lock_held
  [ "$status" -ne 0 ]
}

# ── --where is read-only, must work during reset ─────────────────────────

@test "cmd_test --where: stays usable while a reset is in progress" {
  _write_iso_yaml "$(cat <<EOF
test_isolation:
  type: tart
EOF
)"
  _isolation_tart_status() { echo "stopped"; }
  _isolation_reset_acquire_lock
  run cmd_test --where
  [ "$status" -eq 0 ]
  [[ "$output" == "tart:"* ]]
}

# ── --where post-reset reports the new state correctly (AC echo) ─────────

@test "cmd_test --where: after a clean reset, reports the configured type" {
  _write_iso_yaml "$(cat <<EOF
test_isolation:
  type: tart
EOF
)"
  _isolation_dispatch() { return 0; }
  export -f _isolation_dispatch
  cmd_test --reset >/dev/null 2>&1

  _isolation_tart_status() { echo "ready"; }
  _isolation_tart_ip() { echo "192.168.64.5"; }
  run cmd_test --where
  [ "$status" -eq 0 ]
  [ "$output" = "tart:192.168.64.5" ]
}
