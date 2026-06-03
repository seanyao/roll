#!/usr/bin/env bats
# Unit tests for: FIX-150c — `_peer_call` hard-timeout + kill.
#
# Verifies that an agent invocation in `_peer_call`'s non-tmux path is killed
# when it exceeds the configured wall-clock budget (peer_call_timeout), and
# that the `_PEER_LAST_TIMED_OUT` global flag is set so downstream ledger
# writers can record a `timeout` verdict.
#
# Why a unit test (not integration): exercising the real agent CLIs would
# require credentials and minutes per call. Stubbing `_agent_argv` to return
# `/bin/sleep` lets us deterministically exercise the watchdog without any
# network, agent, or tmux dependencies.

ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"

setup() {
  TEST_TMP="$(mktemp -d)"
  export TEST_TMP
  # `_peer_call` reads `${_PEER_STATE_DIR}/logs/.last_stderr.log` — give it a
  # writable scratch so the function doesn't error on the path.
  export _PEER_STATE_DIR="${TEST_TMP}"
  mkdir -p "${_PEER_STATE_DIR}/logs"
}

teardown() {
  rm -rf "${TEST_TMP:-}"
}

# Source the `_peer_call` function from bin/roll plus the minimal stubs needed
# to run it standalone. Stubs override agent invocation + timeout config +
# loggers so the test is hermetic.
_load_peer_call() {
  # Stub the helpers `_peer_call` calls. Defined BEFORE sourcing so the real
  # implementations in bin/roll don't override us — bash uses last definition.
  # FIX-181: use a temp file instead of source <(...) for bash 3.2 compat.
  local _peer_call_tmp
  _peer_call_tmp="${TEST_TMP}/_peer_call.sh"
  awk '/^_peer_call\(\)/,/^}/' "$ROLL_BIN" > "$_peer_call_tmp"
  source "$_peer_call_tmp"

  # Stub agent invocation — caller picks the argv per test.
  _agent_argv() { :; }  # default no-op; tests overwrite

  # Stub config — caller passes timeout via env.
  config_get() { echo "${PEER_TEST_TIMEOUT:-180}"; }

  # Stub loggers.
  info() { :; }
  warn() { echo "warn:$*" >&2; }
  err()  { echo "err:$*"  >&2; }
  msg()  { echo "$*"; }
}

@test "FIX-150c: agent exceeding budget is killed within budget + grace" {
  _load_peer_call
  _agent_argv() { _AGENT_ARGV=("/bin/sleep" "10"); }
  PEER_TEST_TIMEOUT=1

  # NOTE: bats' `run` invokes the function in a subshell, so globals set
  # inside it (like _PEER_LAST_TIMED_OUT) don't propagate back. Call
  # directly and inspect the global in the current shell.
  local start_s=$SECONDS
  _peer_call "kimi" "any prompt" "" >/dev/null
  local elapsed=$((SECONDS - start_s))

  # Must terminate within budget + grace (2 s SIGKILL grace + slop).
  [ "$elapsed" -le 4 ]
  # And the watchdog must have raised the timeout flag.
  [ "${_PEER_LAST_TIMED_OUT:-0}" -eq 1 ]
}

@test "FIX-150c: agent finishing on time leaves _PEER_LAST_TIMED_OUT=0" {
  _load_peer_call
  # Stub agent that returns instantly with a one-line answer.
  _agent_argv() { _AGENT_ARGV=("/bin/echo" "AGREE: looks fine"); }
  PEER_TEST_TIMEOUT=10

  local out
  out=$(_peer_call "kimi" "any prompt" "")

  [[ "$out" == *"AGREE"* ]]
  [ "${_PEER_LAST_TIMED_OUT:-0}" -eq 0 ]
}

@test "FIX-150c: _PEER_LAST_TIMED_OUT resets between calls" {
  _load_peer_call

  # First call: times out, flag goes to 1.
  _agent_argv() { _AGENT_ARGV=("/bin/sleep" "5"); }
  PEER_TEST_TIMEOUT=1
  _peer_call "kimi" "p1" "" >/dev/null
  [ "${_PEER_LAST_TIMED_OUT}" -eq 1 ]

  # Second call: completes, flag must come back to 0 — not stick at 1.
  _agent_argv() { _AGENT_ARGV=("/bin/echo" "ok"); }
  PEER_TEST_TIMEOUT=10
  _peer_call "kimi" "p2" "" >/dev/null
  [ "${_PEER_LAST_TIMED_OUT}" -eq 0 ]
}
