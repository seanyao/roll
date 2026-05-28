#!/usr/bin/env bats
# US-ISO-001: isolation-adapter dispatch — reads test_isolation.type from
# .roll/local.yaml and routes to provider-specific _isolation_<type>_<method>.
# Supports `none` (default, direct host execution) and `tart` (US-ISO-002).

bats_require_minimum_version 1.5.0  # `run --separate-stderr`

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

# ── _isolation_get_type ──────────────────────────────────────────────────

@test "_isolation_get_type: missing .roll/local.yaml → 'none'" {
  run _isolation_get_type
  [ "$status" -eq 0 ]
  [ "$output" = "none" ]
}

@test "_isolation_get_type: yaml without test_isolation key → 'none'" {
  _write_iso_yaml "loop_minute: 7"
  run _isolation_get_type
  [ "$status" -eq 0 ]
  [ "$output" = "none" ]
}

@test "_isolation_get_type: test_isolation.type=tart → 'tart'" {
  _write_iso_yaml "$(cat <<EOF
test_isolation:
  type: tart
EOF
)"
  run _isolation_get_type
  [ "$status" -eq 0 ]
  [ "$output" = "tart" ]
}

@test "_isolation_get_type: test_isolation.type=none → 'none'" {
  _write_iso_yaml "$(cat <<EOF
test_isolation:
  type: none
EOF
)"
  run _isolation_get_type
  [ "$status" -eq 0 ]
  [ "$output" = "none" ]
}

# ── _isolation_dispatch routing ──────────────────────────────────────────

@test "_isolation_dispatch: defaults to 'none' when no config exists" {
  # Fallback INFO goes to stderr — assert stdout is exactly the status string.
  run --separate-stderr _isolation_dispatch status
  [ "$status" -eq 0 ]
  [ "$output" = "ready" ]
}

@test "_isolation_dispatch: routes to none provider when type=none" {
  _write_iso_yaml "$(cat <<EOF
test_isolation:
  type: none
EOF
)"
  run _isolation_dispatch status
  [ "$status" -eq 0 ]
  [ "$output" = "ready" ]
}

@test "_isolation_dispatch: routes to tart provider when type=tart" {
  _write_iso_yaml "$(cat <<EOF
test_isolation:
  type: tart
EOF
)"
  # Stub the tart provider — US-ISO-002 ships the real one.
  _isolation_tart_status() { echo "stopped-by-stub"; return 0; }
  run _isolation_dispatch status
  [ "$status" -eq 0 ]
  [ "$output" = "stopped-by-stub" ]
}

@test "_isolation_dispatch: unknown type → exit 1 + lists supported types" {
  _write_iso_yaml "$(cat <<EOF
test_isolation:
  type: bogus
EOF
)"
  run --separate-stderr _isolation_dispatch status
  [ "$status" -ne 0 ]
  # Error + supported-types hint go to stderr.
  [[ "$stderr" == *"none"* ]]
  [[ "$stderr" == *"tart"* ]]
}

@test "_isolation_dispatch: emits one INFO line when falling back to none" {
  # No config → falls back to none. INFO note appears on stderr so users know
  # they're not running in an isolated environment when they might expect to.
  run --separate-stderr _isolation_dispatch status
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"falling back"* ]]
}

@test "_isolation_dispatch: type=none does NOT emit fallback INFO (explicit choice)" {
  _write_iso_yaml "$(cat <<EOF
test_isolation:
  type: none
EOF
)"
  run --separate-stderr _isolation_dispatch status
  [ "$status" -eq 0 ]
  # Explicit type=none — no fallback warning needed on either stream.
  [[ "$output" != *"falling back"* ]]
  [[ "$stderr" != *"falling back"* ]]
}

# ── none adapter stubs ────────────────────────────────────────────────────

@test "_isolation_none_status: returns 'ready'" {
  run _isolation_none_status
  [ "$status" -eq 0 ]
  [ "$output" = "ready" ]
}

@test "_isolation_none_init: returns 0 (no-op)" {
  run _isolation_none_init
  [ "$status" -eq 0 ]
}

@test "_isolation_none_provision: returns 0 (no-op)" {
  run _isolation_none_provision
  [ "$status" -eq 0 ]
}

@test "_isolation_none_destroy: returns 0 (no-op)" {
  run _isolation_none_destroy
  [ "$status" -eq 0 ]
}

@test "_isolation_none_exec: runs the command directly in host shell" {
  run _isolation_none_exec echo "host-direct"
  [ "$status" -eq 0 ]
  [ "$output" = "host-direct" ]
}

@test "_isolation_none_exec: propagates non-zero exit codes" {
  run _isolation_none_exec sh -c "exit 42"
  [ "$status" -eq 42 ]
}

@test "_isolation_none_reset: returns 0 with explanatory message (no-op)" {
  run _isolation_none_reset
  [ "$status" -eq 0 ]
  # AC: 'none isolation 无需重置', so reset is benign.
}
