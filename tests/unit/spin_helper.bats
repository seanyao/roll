#!/usr/bin/env bats
# Unit tests for US-REL-003: _spin / _spin_setup
#
# _spin writes spinner output to FD 3 only. Wrapped command's stdout/stderr
# pass through untouched. TTY-detected via [ -t 3 ] (or ROLL_SPIN_FORCE_TTY=1
# escape hatch for tests that need to exercise braille branch).
#
# Note: bats itself uses FD 3 for its reporting channel, so tests redirect
# FD 3 per-call (e.g. `_spin ... 3>"$file"`) instead of `exec 3>...`.

load helpers

setup() { unit_setup; }
teardown() { unit_teardown; }

# ─── _spin_setup (smoke — invocation does not error) ────────────────────────

@test "_spin_setup off: invocation does not error" {
  # _spin_setup off would clobber bats's FD 3 if called naively; verify it
  # runs in a subshell without crashing.
  run bash -c 'source "$0"; _spin_setup off; printf hello >&3' "$ROLL_BIN"
  [ "$status" -eq 0 ]
}

# ─── _spin plain mode (FD 3 not a TTY) ──────────────────────────────────────

@test "_spin plain: success prints » start + done end on FD 3" {
  local out="$TEST_TMP/fd3.out"
  _spin "demo" true 3>"$out"
  local rc=$?
  [ "$rc" -eq 0 ]
  grep -q '^» demo\.\.\.$' "$out"
  grep -qE '^done demo \([0-9]+s\)$' "$out"
}

@test "_spin plain: failure prints fail line with rc and seconds" {
  local out="$TEST_TMP/fd3.out"
  _spin "boom" sh -c 'exit 7' 3>"$out" || _rc=$?
  [ "${_rc:-0}" -eq 7 ]
  grep -qE '^fail boom \(rc=7, [0-9]+s\)$' "$out"
}

@test "_spin plain: wrapped command stdout passes through untouched" {
  local fd3="$TEST_TMP/fd3.out"
  local cap="$TEST_TMP/cap.out"
  _spin "echo-test" sh -c 'echo PAYLOAD-STDOUT' 3>"$fd3" > "$cap"
  [ "$(cat "$cap")" = "PAYLOAD-STDOUT" ]
  # And spinner status stayed on FD 3.
  grep -q '^» echo-test' "$fd3"
}

@test "_spin plain: wrapped command stderr passes through untouched" {
  local fd3="$TEST_TMP/fd3.out"
  local fd2="$TEST_TMP/fd2.out"
  _spin "stderr-test" sh -c 'echo PAYLOAD-STDERR >&2' 3>"$fd3" 2>"$fd2"
  grep -q '^PAYLOAD-STDERR$' "$fd2"
  # Spinner output went only to FD 3, not stderr.
  ! grep -q PAYLOAD "$fd3"
}

@test "_spin plain: stdout redirection on caller leaves spinner on FD 3" {
  local fd3="$TEST_TMP/fd3.out"
  local cap="$TEST_TMP/cap.out"
  _spin "redir" sh -c 'printf payload' 3>"$fd3" > "$cap"
  [ "$(cat "$cap")" = "payload" ]
  grep -q '^» redir' "$fd3"
  grep -qE '^done redir \([0-9]+s\)$' "$fd3"
}

# ─── _spin TTY mode (forced via env) ────────────────────────────────────────

@test "_spin TTY-forced: success prints ✓ with seconds and ANSI line-clear" {
  local fd3="$TEST_TMP/fd3.out"
  ROLL_SPIN_FORCE_TTY=1 _spin "ttyOK" true 3>"$fd3"
  # Final completion line should contain ✓ and elapsed seconds.
  grep -qE '✓ ttyOK \([0-9]+s\)' "$fd3"
  # \r (carriage return) + ESC[2K (clear line) must appear in the output.
  grep -q $'\r\033\[2K' "$fd3"
}

@test "_spin TTY-forced: failure prints ✗ with rc and seconds" {
  local fd3="$TEST_TMP/fd3.out"
  ROLL_SPIN_FORCE_TTY=1 _spin "ttyBoom" sh -c 'exit 9' 3>"$fd3" || _rc=$?
  [ "${_rc:-0}" -eq 9 ]
  grep -qE '✗ ttyBoom \(rc=9, [0-9]+s\)' "$fd3"
}
