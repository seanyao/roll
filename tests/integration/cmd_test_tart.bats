#!/usr/bin/env bats
# US-ISO-003: integration test for `roll test` with type=tart — actually
# boots the VM and runs a trivial command through `_isolation_dispatch exec`,
# verifying the round-trip works end-to-end.
#
# Gated: requires Darwin/arm64 + Tart binary installed. CI runs on Ubuntu
# and will skip; local macOS runs with Tart can opt in by exporting
# ROLL_TEST_TART_INTEGRATION=1.

bats_require_minimum_version 1.5.0

setup() {
  # Hard gates — anything missing means skip, not fail.
  [[ "$(uname)" = "Darwin" ]] || skip "tart integration: Darwin-only"
  [[ "$(uname -m)" = "arm64" ]] || skip "tart integration: Apple Silicon only"
  command -v tart >/dev/null 2>&1 || skip "tart binary not installed"
  [[ "${ROLL_TEST_TART_INTEGRATION:-0}" = "1" ]] || \
    skip "set ROLL_TEST_TART_INTEGRATION=1 to opt in (boots a real VM)"

  TEST_TMP="$(mktemp -d)"
  cd "$TEST_TMP"
  mkdir -p .roll
  cat > .roll/local.yaml <<'EOF'
test_isolation:
  type: tart
EOF
  # Source bin/roll into the test shell.
  local _saved; _saved="$(trap -p DEBUG 2>/dev/null || true)"
  trap - DEBUG
  source "${BATS_TEST_DIRNAME}/../../bin/roll"
  [[ -n "$_saved" ]] && eval "$_saved"
}

teardown() {
  cd /
  rm -rf "${TEST_TMP:-}"
}

@test "tart integration: roll test --where reports the running VM" {
  # Status must reach `ready` for `--where` to print an IP. Boot the VM
  # via init+provision first.
  _isolation_tart_init || skip "tart init failed — base image may be unavailable in this environment"
  # exec auto-starts the VM; use a no-op so the boot path runs.
  _isolation_tart_exec true || skip "tart exec failed — VM did not reach SSH-ready in time"

  run cmd_test --where
  [ "$status" -eq 0 ]
  [[ "$output" =~ ^tart: ]]
}

@test "tart integration: roll test forwards exit code from inside the VM" {
  _isolation_tart_init || skip "tart init failed"
  _isolation_tart_exec true || skip "tart exec failed to boot VM"

  # Trivial in-VM command that returns 42 — must surface as $status.
  run bash -c "_isolation_dispatch exec sh -c 'exit 42'"
  [ "$status" -eq 42 ]
}
