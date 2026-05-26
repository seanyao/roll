#!/usr/bin/env bats
# Tests for roll loop pause / resume (US-AUTO-023)

load helpers
setup() {
  unit_setup_cd
  _test_dir="$TEST_TMP"
  export _LOOP_STATE="${TEST_TMP}/state.yaml"
}
teardown() { unit_teardown_cd; }

# ─── Dispatch routing ─────────────────────────────────────────────────────────

@test "cmd_loop: 'pause' subcommand is wired in dispatch table" {
  local body
  body=$(awk '/^cmd_loop\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$body" | grep -qE '\bpause\)'
}

@test "cmd_loop: 'resume' subcommand is wired in dispatch table" {
  local body
  body=$(awk '/^cmd_loop\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$body" | grep -qE '\bresume\)'
}

# ─── _loop_pause function body ────────────────────────────────────────────────

@test "_loop_pause: function exists in bin/roll" {
  grep -qF '_loop_pause()' "$ROLL_BIN"
}

# ─── _loop_pause state file behavior ─────────────────────────────────────────
# (Structural body-inspection tests removed: the behavioral tests below cover
# the same state-file assertions via actual _loop_pause invocation.)

@test "_loop_pause: state file contains 'status: paused' after invocation (mocked launchd)" {
  # Override launchd helpers to no-op
  _launchd_is_loaded() { return 0; }
  _launchd_plist_path() { echo "/tmp/fake.plist"; }
  launchctl() { return 0; }
  _project_slug() { echo "test-abc123"; }

  _loop_pause
  grep -q "status: paused" "$_LOOP_STATE"
}

@test "_loop_pause: state file contains 'paused_at' after invocation (mocked launchd)" {
  _launchd_is_loaded() { return 0; }
  _launchd_plist_path() { echo "/tmp/fake.plist"; }
  launchctl() { return 0; }
  _project_slug() { echo "test-abc123"; }

  _loop_pause
  grep -q "paused_at:" "$_LOOP_STATE"
}

# ─── _loop_resume scheduler path ─────────────────────────────────────────────

@test "_loop_resume: handles 'status: paused' state (scheduler resume)" {
  local body
  body=$(awk '/^_loop_resume\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$body" | grep -q 'paused'
}

@test "_loop_resume: re-enables launchd when state is paused (macOS)" {
  local body
  body=$(awk '/^_loop_resume\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  # Must reference launchctl load for scheduler resume. Post-FIX-101 the call
  # goes through the _launchctl_safe wrapper, so accept either literal form.
  echo "$body" | grep -qE '_?launchctl(_safe)? load'
}

@test "_loop_resume: clears paused state after scheduler resume (mocked launchd)" {
  # Pre-write a paused state
  cat > "$_LOOP_STATE" << 'EOF'
status: paused
paused_at: "2026-05-11T10:00:00Z"
paused_reason: manual
EOF
  _launchd_is_loaded() { return 1; }
  _launchd_plist_path() { echo "/tmp/fake.plist"; }
  _launchd_label() { echo "com.roll.loop.test-abc"; }
  launchctl() { return 0; }
  _project_slug() { echo "test-abc"; }

  _loop_resume
  ! grep -q "status: paused" "$_LOOP_STATE"
}

# ─── Dashboard ─────────────────────────────────────────────────────────────────

@test "_legacy_home: references paused state display" {
  local body
  body=$(awk '/^_legacy_home\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$body" | grep -qE '⏸|paused'
}

# ─── _loop_status ─────────────────────────────────────────────────────────────

@test "_loop_status: references pause display" {
  # After US-VIEW-001 the v1 implementation lives in _legacy_loop_status;
  # the v2 Python renderer reads paused state via roll-loop-status.py.
  local body
  body=$(awk '/^_legacy_loop_status\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$body" | grep -qE '⏸|paused'
}

# ─── Linux: runner script PAUSE check ────────────────────────────────────────

@test "_write_loop_runner_script: generated script checks PAUSE marker file" {
  local script_path="${_test_dir}/run-test-pause.sh"
  _write_loop_runner_script "$script_path" "/tmp/proj" "echo hi" "/tmp/log" 10 18
  grep -qE 'PAUSE' "$script_path"
}
