#!/usr/bin/env bash
# Shared helpers for unit tests.
# Load with: load helpers  (from a .bats file in tests/unit/)

ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"

# US-QA-004: standardised precondition helpers (require_not_in_real_loop, ...)
# shellcheck source=../preconditions.bash
source "${BATS_TEST_DIRNAME}/../preconditions.bash"

# FIX-065: every test gets a sandboxed _SHARED_ROOT so any subprocess
# invocation of bin/roll (which inherits the export) can never write its
# ALERT / state / heartbeat / events / LOCK files into the real
# ~/.shared/roll/ that the live loop cycle is monitoring. The export must
# happen BEFORE bin/roll is sourced so its `: "${_SHARED_ROOT:=...}"`
# fallback no-ops, and so _LOOP_ALERT / _LOOP_STATE / _LOOP_MUTE_FILE
# derive from the sandbox path rather than production HOME.
_sandbox_loop_state() {
  export _SHARED_ROOT="${TEST_TMP}/shared"
  mkdir -p "${_SHARED_ROOT}/loop"
}

# Source bin/roll, create isolated temp dir, suppress colour output.
unit_setup() {
  TEST_TMP="$(mktemp -d)"
  _sandbox_loop_state
  # FIX-093: gate every launchctl call inside _install_launchd_plists. Without
  # this, tests that call _install_launchd_plists directly (e.g. launchd.bats)
  # hit the host gui domain and leak ghost entries into
  # /private/var/db/com.apple.xpc.launchd/disabled.<UID>.plist. FIX-090's
  # auto-detect only fires when _LAUNCHD_DIR is under _SHARED_ROOT — many unit
  # tests set them as siblings, so the env gate is the reliable lever.
  export _LAUNCHD_SKIP_REGISTRY=1
  # US-QA-009: suspend bats DEBUG trap during source to avoid 10,764-call
  # overhead. bats installs 'trap bats_debug_trap DEBUG' via set -eET before
  # setup() runs; with functrace active, every command in bin/roll's 9,665
  # lines triggers the trap (~228μs each = ~2.5s per test). Suspending for
  # the source call and restoring afterwards cuts unit CI from ~27min to ~2min.
  local _saved_debug_trap
  _saved_debug_trap="$(trap -p DEBUG 2>/dev/null || true)"
  trap - DEBUG
  source "$ROLL_BIN"
  [[ -n "$_saved_debug_trap" ]] && eval "$_saved_debug_trap"
  export NO_COLOR=1
  export TERM=dumb
}

# Remove temp dir created by unit_setup.
unit_teardown() {
  rm -rf "${TEST_TMP:-}"
}

# Like unit_setup but also cds into TEST_TMP (for tests that use relative paths).
unit_setup_cd() {
  _UNIT_ORIG_DIR="$PWD"
  TEST_TMP="$(mktemp -d)"
  _sandbox_loop_state
  # FIX-093: see unit_setup above — gate launchctl calls so tests cannot leak
  # ghost entries into the host's disabled overrides db.
  export _LAUNCHD_SKIP_REGISTRY=1
  # US-QA-009: same DEBUG trap suspension as unit_setup (see above).
  local _saved_debug_trap
  _saved_debug_trap="$(trap -p DEBUG 2>/dev/null || true)"
  trap - DEBUG
  source "$ROLL_BIN"
  [[ -n "$_saved_debug_trap" ]] && eval "$_saved_debug_trap"
  cd "$TEST_TMP"
  export NO_COLOR=1
  export TERM=dumb
}

# Restore original directory and remove temp dir created by unit_setup_cd.
unit_teardown_cd() {
  cd "$_UNIT_ORIG_DIR"
  rm -rf "${TEST_TMP:-}"
}
