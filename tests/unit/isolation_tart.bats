#!/usr/bin/env bats
# US-ISO-002: Tart adapter — implements the IsolationAdapter interface
# (US-ISO-001) against the Tart macOS VM tool. Unit tests PATH-shadow the
# `tart` and `ssh` binaries with recording stubs so we can verify the
# invocation sequence without spinning a real VM.

bats_require_minimum_version 1.5.0  # `run --separate-stderr`

load helpers

setup() {
  unit_setup_cd
  err()  { echo "ERR: $*" >&2; }
  warn() { echo "WARN: $*" >&2; }
  info() { echo "INFO: $*"; }
  ok()   { echo "OK: $*"; }

  # Sandbox $HOME so any SSH known_hosts / config interaction is hermetic.
  export HOME="${TEST_TMP}/home"
  mkdir -p "$HOME"

  # Fixture state — tests append to / overwrite as needed.
  _STUB_BIN_DIR="${TEST_TMP}/stub-bin"
  mkdir -p "$_STUB_BIN_DIR"
  export PATH="${_STUB_BIN_DIR}:${PATH}"
  _STUB_LOG="${TEST_TMP}/stub-tart.log"
  : > "$_STUB_LOG"

  # Reset any per-test env overrides.
  unset _TART_VM_NAME _TART_BASE_IMAGE _TART_SSH_USER
}

teardown() { unit_teardown_cd; }

# Write a recording stub for any binary.
# Usage: _stub_bin <name> '<bash-body>'
# The body has access to $LOG (path) and "$@" (the original argv).
_stub_bin() {
  local name="$1" body="$2"
  cat > "${_STUB_BIN_DIR}/${name}" <<EOF
#!/usr/bin/env bash
LOG="${_STUB_LOG}"
echo "${name}: \$*" >> "\$LOG"
${body}
EOF
  chmod +x "${_STUB_BIN_DIR}/${name}"
}

# Shorthand for the common tart stub. State is encoded as env vars set
# before calling — _MOCK_TART_LIST contains the `tart list` output,
# _MOCK_TART_IP_OUTPUT contains the `tart ip` output, _MOCK_TART_IP_EXIT
# is the `tart ip` exit code.
_stub_tart() {
  _stub_bin tart '
case "$1" in
  list)
    [[ -n "${_MOCK_TART_LIST:-}" ]] && echo "$_MOCK_TART_LIST"
    ;;
  ip)
    [[ -n "${_MOCK_TART_IP_OUTPUT:-}" ]] && echo "$_MOCK_TART_IP_OUTPUT"
    exit "${_MOCK_TART_IP_EXIT:-0}"
    ;;
  clone|stop|delete|run)
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
'
}

# ── platform check ────────────────────────────────────────────────────────

@test "tart: check_platform fails on non-Darwin" {
  uname() { [[ "${1:-}" = "-m" ]] && echo "arm64" || echo "Linux"; }
  export -f uname
  run --separate-stderr _isolation_tart_check_platform
  [ "$status" -ne 0 ]
  [[ "$stderr" == *"Apple Silicon macOS"* ]]
}

@test "tart: check_platform fails on Intel Mac" {
  uname() { [[ "${1:-}" = "-m" ]] && echo "x86_64" || echo "Darwin"; }
  export -f uname
  run --separate-stderr _isolation_tart_check_platform
  [ "$status" -ne 0 ]
  [[ "$stderr" == *"Apple Silicon macOS"* ]]
}

@test "tart: check_platform passes on Darwin + arm64" {
  uname() { [[ "${1:-}" = "-m" ]] && echo "arm64" || echo "Darwin"; }
  export -f uname
  run _isolation_tart_check_platform
  [ "$status" -eq 0 ]
}

# ── status state machine ──────────────────────────────────────────────────

@test "tart: status = 'not-installed' when tart binary missing" {
  # No tart stub written → command -v tart fails.
  uname() { [[ "${1:-}" = "-m" ]] && echo "arm64" || echo "Darwin"; }
  export -f uname
  run _isolation_tart_status
  [ "$status" -eq 0 ]
  [ "$output" = "not-installed" ]
}

@test "tart: status = 'not-installed' when VM not in list" {
  uname() { [[ "${1:-}" = "-m" ]] && echo "arm64" || echo "Darwin"; }
  export -f uname
  export _MOCK_TART_LIST=""
  _stub_tart
  run _isolation_tart_status
  [ "$status" -eq 0 ]
  [ "$output" = "not-installed" ]
}

@test "tart: status = 'stopped' when VM exists but tart ip fails" {
  uname() { [[ "${1:-}" = "-m" ]] && echo "arm64" || echo "Darwin"; }
  export -f uname
  export _MOCK_TART_LIST="roll-dev-test"
  export _MOCK_TART_IP_EXIT=1
  export _MOCK_TART_IP_OUTPUT=""
  _stub_tart
  run _isolation_tart_status
  [ "$status" -eq 0 ]
  [ "$output" = "stopped" ]
}

@test "tart: status = 'running' when tart ip returns a valid IP" {
  uname() { [[ "${1:-}" = "-m" ]] && echo "arm64" || echo "Darwin"; }
  export -f uname
  export _MOCK_TART_LIST="roll-dev-test"
  export _MOCK_TART_IP_OUTPUT="192.168.64.5"
  export _MOCK_TART_IP_EXIT=0
  _stub_tart
  # ssh fails — VM up but provision not verified → 'running' (not 'ready').
  _stub_bin ssh 'exit 255'
  run _isolation_tart_status
  [ "$status" -eq 0 ]
  [ "$output" = "running" ]
}

@test "tart: status = 'ready' when running AND SSH responsive (provisioned)" {
  uname() { [[ "${1:-}" = "-m" ]] && echo "arm64" || echo "Darwin"; }
  export -f uname
  export _MOCK_TART_LIST="roll-dev-test"
  export _MOCK_TART_IP_OUTPUT="192.168.64.5"
  _stub_tart
  # ssh succeeds → ready.
  _stub_bin ssh 'echo ok; exit 0'
  run _isolation_tart_status
  [ "$status" -eq 0 ]
  [ "$output" = "ready" ]
}

# ── init ──────────────────────────────────────────────────────────────────

@test "tart: init clones base_image when VM not yet present" {
  uname() { [[ "${1:-}" = "-m" ]] && echo "arm64" || echo "Darwin"; }
  export -f uname
  export _MOCK_TART_LIST=""   # VM absent
  _stub_tart
  run _isolation_tart_init
  [ "$status" -eq 0 ]
  grep -q "^tart: clone" "$_STUB_LOG"
  grep -q "roll-dev-test" "$_STUB_LOG"
}

@test "tart: init is idempotent when VM already present" {
  uname() { [[ "${1:-}" = "-m" ]] && echo "arm64" || echo "Darwin"; }
  export -f uname
  export _MOCK_TART_LIST="roll-dev-test"   # VM present
  _stub_tart
  run _isolation_tart_init
  [ "$status" -eq 0 ]
  ! grep -q "^tart: clone" "$_STUB_LOG"
}

@test "tart: init fails with install hint when tart binary missing" {
  uname() { [[ "${1:-}" = "-m" ]] && echo "arm64" || echo "Darwin"; }
  export -f uname
  run --separate-stderr _isolation_tart_init
  [ "$status" -ne 0 ]
  [[ "$stderr" == *"brew install"* ]] || [[ "$stderr" == *"tart"* ]]
}

@test "tart: init refuses on non-Darwin without invoking tart" {
  uname() { [[ "${1:-}" = "-m" ]] && echo "x86_64" || echo "Linux"; }
  export -f uname
  _stub_tart
  run --separate-stderr _isolation_tart_init
  [ "$status" -ne 0 ]
  [ ! -s "$_STUB_LOG" ]   # tart was never called
}

# ── destroy ───────────────────────────────────────────────────────────────

@test "tart: destroy invokes stop then delete" {
  uname() { [[ "${1:-}" = "-m" ]] && echo "arm64" || echo "Darwin"; }
  export -f uname
  export _MOCK_TART_LIST="roll-dev-test"
  _stub_tart
  run _isolation_tart_destroy
  [ "$status" -eq 0 ]
  grep -q "^tart: stop" "$_STUB_LOG"
  grep -q "^tart: delete" "$_STUB_LOG"
}

@test "tart: destroy is benign when VM not present" {
  uname() { [[ "${1:-}" = "-m" ]] && echo "arm64" || echo "Darwin"; }
  export -f uname
  export _MOCK_TART_LIST=""
  _stub_tart
  run _isolation_tart_destroy
  [ "$status" -eq 0 ]
}

# ── reset ────────────────────────────────────────────────────────────────

@test "tart: reset performs stop → delete → clone (provision skipped via stub)" {
  uname() { [[ "${1:-}" = "-m" ]] && echo "arm64" || echo "Darwin"; }
  export -f uname
  export _MOCK_TART_LIST="roll-dev-test"
  _stub_tart
  # Skip the real provision pass for this test — provision has its own test.
  _isolation_tart_provision() { return 0; }

  run _isolation_tart_reset
  [ "$status" -eq 0 ]
  # Order matters — stop before delete before clone.
  local order; order=$(grep -E "^tart: (stop|delete|clone)" "$_STUB_LOG" | awk '{print $2}' | tr '\n' ' ')
  [[ "$order" == "stop delete clone "* ]]
}

# ── exec ─────────────────────────────────────────────────────────────────

@test "tart: exec runs the command via ssh and forwards exit code" {
  uname() { [[ "${1:-}" = "-m" ]] && echo "arm64" || echo "Darwin"; }
  export -f uname
  export _MOCK_TART_LIST="roll-dev-test"
  export _MOCK_TART_IP_OUTPUT="192.168.64.5"
  _stub_tart
  _stub_bin ssh 'echo "via-ssh"; exit 7'

  run _isolation_tart_exec npm test
  [ "$status" -eq 7 ]
  [[ "$output" == *"via-ssh"* ]]
  # ssh was called with the SSH user@ip + the npm test command in the argv.
  grep -q "^ssh:.*192.168.64.5" "$_STUB_LOG"
  grep -q "^ssh:.*npm test" "$_STUB_LOG"
}

@test "tart: exec auto-starts a stopped VM before running the command" {
  uname() { [[ "${1:-}" = "-m" ]] && echo "arm64" || echo "Darwin"; }
  export -f uname
  export _MOCK_TART_LIST="roll-dev-test"
  # First `tart ip` call returns nothing (VM stopped); the stub doesn't switch
  # mid-test, so we model "auto-start required" by exit code 1 on first IP
  # check. Our impl is responsible for calling `tart run` to kick the VM,
  # then re-checking IP. We assert here only that `tart run` was invoked.
  export _MOCK_TART_IP_EXIT=1
  export _MOCK_TART_IP_OUTPUT=""
  _stub_tart
  _stub_bin ssh 'exit 0'

  # exec is allowed to fail (no IP ever resolves in this fixture); we only
  # care that the run-up code path fired.
  run _isolation_tart_exec true || true
  grep -q "^tart: run" "$_STUB_LOG"
}

