#!/usr/bin/env bats
# Unit tests for: roll alert command (cmd_alert)

load helpers

setup()    { unit_setup; }
teardown() { unit_teardown; }

_make_alert() {
  local dir="${TEST_TMP}/.shared/roll/loop"
  mkdir -p "$dir"
  cat > "${dir}/ALERT.md" << 'EOF'
# ALERT — CI gate failed

**Time**: 2026-05-12 10:00
**Story**: US-TEST-001
**Reason**: CI timed out after 300s
EOF
  # Override the variable so cmd_alert sees the temp file
  _LOOP_ALERT="${dir}/ALERT.md"
  export _LOOP_ALERT
}

# ── list ──────────────────────────────────────────────────────────────────────

@test "alert: no alert file shows no-alerts message" {
  _LOOP_ALERT="${TEST_TMP}/.shared/roll/loop/ALERT.md"
  export _LOOP_ALERT
  run cmd_alert list
  [ "$status" -eq 0 ]
  [[ "$output" == *"No active alerts"* ]] || [[ "$output" == *"no active alerts"* ]] || [[ "$output" == *"暂无告警"* ]]
}

@test "alert: default (no subcmd) same as list" {
  _LOOP_ALERT="${TEST_TMP}/.shared/roll/loop/ALERT.md"
  export _LOOP_ALERT
  run cmd_alert
  [ "$status" -eq 0 ]
  [[ "$output" == *"No active alerts"* ]] || [[ "$output" == *"no active alerts"* ]] || [[ "$output" == *"暂无告警"* ]]
}

@test "alert: shows alert content when file exists" {
  _make_alert
  run cmd_alert list
  [ "$status" -eq 0 ]
  [[ "$output" == *"CI gate failed"* ]]
}

@test "alert: shows management hint when alert exists" {
  _make_alert
  run cmd_alert list
  [ "$status" -eq 0 ]
  [[ "$output" == *"resolve"* ]] || [[ "$output" == *"ack"* ]]
}

# ── ack ───────────────────────────────────────────────────────────────────────

@test "alert ack: no alert file warns gracefully" {
  _LOOP_ALERT="${TEST_TMP}/.shared/roll/loop/ALERT.md"
  export _LOOP_ALERT
  run cmd_alert ack
  [ "$status" -eq 0 ]
  [[ "$output" == *"No active"* ]] || [[ "$output" == *"no active"* ]] || [[ "$output" == *"暂无"* ]]
}

@test "alert ack: appends Acknowledged marker to file" {
  _make_alert
  run cmd_alert ack
  [ "$status" -eq 0 ]
  grep -q "Acknowledged" "$_LOOP_ALERT"
}

@test "alert ack: file still exists after ack" {
  _make_alert
  cmd_alert ack
  [ -f "$_LOOP_ALERT" ]
}

# ── resolve ───────────────────────────────────────────────────────────────────

@test "alert resolve: no alert file exits ok" {
  _LOOP_ALERT="${TEST_TMP}/.shared/roll/loop/ALERT.md"
  export _LOOP_ALERT
  run cmd_alert resolve
  [ "$status" -eq 0 ]
}

@test "alert resolve: removes alert file" {
  _make_alert
  [ -f "$_LOOP_ALERT" ]
  cmd_alert resolve
  [ ! -f "$_LOOP_ALERT" ]
}

@test "alert resolve: shows cleared confirmation" {
  _make_alert
  run cmd_alert resolve
  [ "$status" -eq 0 ]
  [[ "$output" == *"cleared"* ]] || [[ "$output" == *"已解决"* ]] || [[ "$output" == *"resolved"* ]]
}

@test "alert clear: alias for resolve — removes file" {
  _make_alert
  cmd_alert clear
  [ ! -f "$_LOOP_ALERT" ]
}

# ── unknown subcommand ────────────────────────────────────────────────────────

@test "alert: unknown subcommand returns non-zero" {
  _LOOP_ALERT="${TEST_TMP}/.shared/roll/loop/ALERT.md"
  export _LOOP_ALERT
  run cmd_alert bogus
  [ "$status" -ne 0 ]
}
