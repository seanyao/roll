#!/usr/bin/env bats
# US-ISO-003: `roll test` command — routes the project test suite through
# the isolation dispatcher (US-ISO-001) per `.roll/local.yaml`'s
# `test_isolation.type`. Unit tests stub `_isolation_dispatch` so we don't
# spin a real VM and don't recurse into `npm test`.

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

# ── --help ────────────────────────────────────────────────────────────────

@test "cmd_test: --help prints usage and exits 0" {
  run cmd_test --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"Usage"* ]]
  [[ "$output" == *"test_isolation"* ]]
  [[ "$output" == *"none"* ]]
  [[ "$output" == *"tart"* ]]
  [[ "$output" == *"--where"* ]]
}

@test "cmd_test: -h is an alias for --help" {
  run cmd_test -h
  [ "$status" -eq 0 ]
  [[ "$output" == *"Usage"* ]]
}

# ── --where ───────────────────────────────────────────────────────────────

@test "cmd_test --where: prints 'host' when type=none (default)" {
  run cmd_test --where
  [ "$status" -eq 0 ]
  [ "$output" = "host" ]
}

@test "cmd_test --where: explicit type=none also prints 'host'" {
  _write_iso_yaml "$(cat <<EOF
test_isolation:
  type: none
EOF
)"
  run cmd_test --where
  [ "$status" -eq 0 ]
  [ "$output" = "host" ]
}

@test "cmd_test --where: prints 'tart:<ip>' when VM running" {
  _write_iso_yaml "$(cat <<EOF
test_isolation:
  type: tart
EOF
)"
  _isolation_tart_status() { echo "ready"; }
  _isolation_tart_ip() { echo "192.168.64.5"; }
  run cmd_test --where
  [ "$status" -eq 0 ]
  [ "$output" = "tart:192.168.64.5" ]
}

@test "cmd_test --where: prints 'tart:stopped' when VM exists but stopped" {
  _write_iso_yaml "$(cat <<EOF
test_isolation:
  type: tart
EOF
)"
  _isolation_tart_status() { echo "stopped"; }
  _isolation_tart_ip() { return 1; }
  run cmd_test --where
  [ "$status" -eq 0 ]
  [ "$output" = "tart:stopped" ]
}

@test "cmd_test --where: prints 'tart:not-installed' when VM not cloned" {
  _write_iso_yaml "$(cat <<EOF
test_isolation:
  type: tart
EOF
)"
  _isolation_tart_status() { echo "not-installed"; }
  run cmd_test --where
  [ "$status" -eq 0 ]
  [ "$output" = "tart:not-installed" ]
}

# ── routing to dispatcher ────────────────────────────────────────────────

@test "cmd_test: with no args defaults to --affected (keeps VM runs fast)" {
  _DISPATCH_LOG="${TEST_TMP}/dispatch.log"
  _isolation_dispatch() {
    echo "DISPATCH: $*" >> "$_DISPATCH_LOG"
    return 0
  }
  export -f _isolation_dispatch

  run cmd_test
  [ "$status" -eq 0 ]
  grep -q "^DISPATCH: exec npm test -- --affected$" "$_DISPATCH_LOG"
}

@test "cmd_test: forwards extra args after -- to npm test (via -- separator)" {
  _DISPATCH_LOG="${TEST_TMP}/dispatch.log"
  _isolation_dispatch() {
    echo "DISPATCH: $*" >> "$_DISPATCH_LOG"
    return 0
  }
  export -f _isolation_dispatch

  run cmd_test -- --tier=fast tests/unit
  [ "$status" -eq 0 ]
  grep -q "^DISPATCH: exec npm test -- --tier=fast tests/unit$" "$_DISPATCH_LOG"
}

@test "cmd_test: also accepts extra args without explicit -- (via -- separator)" {
  _DISPATCH_LOG="${TEST_TMP}/dispatch.log"
  _isolation_dispatch() {
    echo "DISPATCH: $*" >> "$_DISPATCH_LOG"
    return 0
  }
  export -f _isolation_dispatch

  # When the first arg isn't a known flag, treat the whole list as forwarded.
  run cmd_test tests/unit/some_file.bats
  [ "$status" -eq 0 ]
  grep -q "^DISPATCH: exec npm test -- tests/unit/some_file.bats$" "$_DISPATCH_LOG"
}

# ── exit code passthrough (AC: VM test fail → host roll test non-zero) ──

@test "cmd_test: propagates dispatcher exit code 0" {
  _isolation_dispatch() { return 0; }
  export -f _isolation_dispatch
  run cmd_test
  [ "$status" -eq 0 ]
}

@test "cmd_test: propagates dispatcher exit code 1" {
  _isolation_dispatch() { return 1; }
  export -f _isolation_dispatch
  run cmd_test
  [ "$status" -eq 1 ]
}

@test "cmd_test: propagates dispatcher exit code 7 (arbitrary non-zero)" {
  _isolation_dispatch() { return 7; }
  export -f _isolation_dispatch
  run cmd_test
  [ "$status" -eq 7 ]
}

# ── never silently fall back to host when type=tart fails ────────────────

@test "cmd_test: with type=tart, dispatcher failure surfaces non-zero (no host fallback)" {
  _write_iso_yaml "$(cat <<EOF
test_isolation:
  type: tart
EOF
)"
  # Dispatcher fails (e.g. VM won't start). cmd_test must NOT then re-run
  # the suite on host — it must surface the failure.
  _isolation_dispatch() {
    err "VM failed to start"
    return 1
  }
  export -f _isolation_dispatch

  # If we silently fell back to host, this would invoke real npm test —
  # which we can detect by the absence of any "fallback" indicator in stderr
  # and the propagated non-zero exit.
  run --separate-stderr cmd_test
  [ "$status" -ne 0 ]
  [[ "$stderr" != *"falling back to host"* ]]
}
