#!/usr/bin/env bats
# Tests for roll loop mute/unmute + auto-attach runner injection (US-AUTO-026)

load helpers
setup() {
  unit_setup_cd
  _tmp="$TEST_TMP"
  _SHARED_ROOT="${TEST_TMP}/.shared/roll"
  _LOOP_MUTE_FILE="${_SHARED_ROOT}/mute"
  mkdir -p "$_SHARED_ROOT"
}
teardown() { unit_teardown_cd; }

# ─── Dispatch ─────────────────────────────────────────────────────────────────

@test "cmd_loop routes 'mute' to _loop_mute" {
  grep -qE 'mute\)[[:space:]]+_loop_mute' "$ROLL_BIN"
}

@test "cmd_loop routes 'unmute' to _loop_unmute" {
  grep -qE 'unmute\)[[:space:]]+_loop_unmute' "$ROLL_BIN"
}

@test "cmd_loop usage line lists 'mute' and 'unmute'" {
  grep -qE 'Usage: roll loop .*mute' "$ROLL_BIN"
  grep -qE 'Usage: roll loop .*unmute' "$ROLL_BIN"
}

# ─── _loop_mute behavior ──────────────────────────────────────────────────────

@test "_loop_mute: creates the mute marker file" {
  [ ! -f "$_LOOP_MUTE_FILE" ]
  run _loop_mute
  [ "$status" -eq 0 ]
  [ -f "$_LOOP_MUTE_FILE" ]
}

@test "_loop_mute: prints muted indicator" {
  run _loop_mute
  [ "$status" -eq 0 ]
  [[ "$output" == *"muted"* ]]
}

@test "_loop_mute: is idempotent when already muted" {
  _loop_mute >/dev/null
  run _loop_mute
  [ "$status" -eq 0 ]
  [ -f "$_LOOP_MUTE_FILE" ]
}

# ─── _loop_unmute behavior ────────────────────────────────────────────────────

@test "_loop_unmute: removes the mute marker file" {
  touch "$_LOOP_MUTE_FILE"
  run _loop_unmute
  [ "$status" -eq 0 ]
  [ ! -f "$_LOOP_MUTE_FILE" ]
}

@test "_loop_unmute: prints unmuted indicator" {
  touch "$_LOOP_MUTE_FILE"
  run _loop_unmute
  [ "$status" -eq 0 ]
  [[ "$output" == *"unmuted"* ]] || [[ "$output" == *"live"* ]]
}

@test "_loop_unmute: is idempotent when already unmuted" {
  [ ! -f "$_LOOP_MUTE_FILE" ]
  run _loop_unmute
  [ "$status" -eq 0 ]
  [ ! -f "$_LOOP_MUTE_FILE" ]
}

@test "_LOOP_MUTE_FILE constant is exported and resolves under shared root" {
  [[ "$_LOOP_MUTE_FILE" == *"/mute" ]]
}

# ─── _loop_status mute line ───────────────────────────────────────────────────

@test "_loop_status: shows 'Auto-attach' line — live when not muted" {
  run _loop_status
  [ "$status" -eq 0 ]
  [[ "$output" == *"Auto-attach"* ]]
  [[ "$output" == *"live"* ]]
}

@test "_loop_status: shows 'Auto-attach' line — muted when mute file exists" {
  touch "$_LOOP_MUTE_FILE"
  run _loop_status
  [ "$status" -eq 0 ]
  [[ "$output" == *"Auto-attach"* ]]
  [[ "$output" == *"muted"* ]]
}

# ─── Auto-attach injected into runner script ──────────────────────────────────

@test "_write_loop_runner_script: runner contains osascript Terminal popup" {
  local script="${_tmp}/run-test.sh"
  _write_loop_runner_script "$script" "/some/project" "echo hi" "${_tmp}/log" 10 24
  grep -qF 'osascript' "$script"
  grep -qF 'Terminal' "$script"
  grep -qF 'tmux attach' "$script"
}

@test "_write_loop_runner_script: runner skips osascript when mute file exists" {
  local script="${_tmp}/run-test.sh"
  _write_loop_runner_script "$script" "/some/project" "echo hi" "${_tmp}/log" 10 24
  # The runner checks for the mute marker before firing osascript.
  # FIX-052: mute is per-project (.shared/roll/loop/mute-<slug>).
  grep -qE '\.shared/roll/loop/mute-' "$script"
}

@test "_write_loop_runner_script: osascript is fired in background (no blocking)" {
  local script="${_tmp}/run-test.sh"
  _write_loop_runner_script "$script" "/some/project" "echo hi" "${_tmp}/log" 10 24
  # The osascript pipeline must end with & so it doesn't block the runner
  grep -qE 'osascript.*&[[:space:]]*$|osascript[^&]*\\\\$' "$script" || \
    grep -qE 'end try.*>.*2>.*&' "$script" || \
    grep -qE '\)[[:space:]]*&[[:space:]]*$' "$script"
}

@test "_write_loop_runner_script: osascript uses tmux session variable for attach target" {
  local script="${_tmp}/run-test.sh"
  _write_loop_runner_script "$script" "/some/project" "echo hi" "${_tmp}/log" 10 24
  grep -qF 'tmux attach -t' "$script"
}

# ─── _ensure_tmux: required dependency auto-install ───────────────────────────

@test "_ensure_tmux: function is defined" {
  type _ensure_tmux >/dev/null 2>&1
}

@test "_ensure_tmux: cmd_setup invokes _ensure_tmux" {
  grep -qE 'cmd_setup\(\)' "$ROLL_BIN"
  # Grab the cmd_setup body and verify it calls _ensure_tmux
  local body
  body=$(awk '/^cmd_setup\(\)/{p=1} p{print} p && /^}$/{p=0; exit}' "$ROLL_BIN")
  echo "$body" | grep -qF '_ensure_tmux'
}

@test "_ensure_tmux: source references 'brew install tmux' for macOS auto-install" {
  local body
  body=$(awk '/^_ensure_tmux\(\)/{p=1} p{print} p && /^}$/{p=0; exit}' "$ROLL_BIN")
  echo "$body" | grep -qF 'brew install tmux'
}

@test "_ensure_tmux: source returns 0 (non-blocking) when install fails" {
  # The function must always return 0 so setup main flow is not blocked.
  local body
  body=$(awk '/^_ensure_tmux\(\)/{p=1} p{print} p && /^}$/{p=0; exit}' "$ROLL_BIN")
  echo "$body" | grep -qE 'return 0'
}

@test "_ensure_tmux: no-op when tmux already installed" {
  command -v tmux >/dev/null 2>&1 || skip "tmux not installed on this host"
  run _ensure_tmux
  [ "$status" -eq 0 ]
  # Output should be empty (silent no-op) when tmux is already present
  [ -z "${output// /}" ]
}

# ─── SKILL.md doc contract ────────────────────────────────────────────────────

@test "roll-loop SKILL doc mentions roll loop mute" {
  grep -q 'roll loop mute' "${BATS_TEST_DIRNAME}/../../skills/roll-loop/SKILL.md"
}

@test "roll-loop SKILL doc mentions auto-attach popup behavior" {
  grep -qi 'auto-attach' "${BATS_TEST_DIRNAME}/../../skills/roll-loop/SKILL.md"
}
