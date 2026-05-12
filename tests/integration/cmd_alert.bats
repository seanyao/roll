#!/usr/bin/env bats
# E2E integration tests for: roll alert command

load helpers

ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"

setup()    { integration_setup; }
teardown() { integration_teardown; }

_make_alert_file() {
  local alert_dir="${TEST_TMP}/.shared/roll/loop"
  mkdir -p "$alert_dir"
  cat > "${alert_dir}/ALERT.md" << 'EOF'
# ALERT — CI gate failed

**Time**: 2026-05-12 10:00
**Story**: US-TEST-001
**Reason**: CI timed out
EOF
}

@test "roll alert: no alert shows no-alerts message" {
  run_roll alert
  [ "$status" -eq 0 ]
  [[ "$output" == *"No active alerts"* ]] || [[ "$output" == *"暂无告警"* ]]
}

@test "roll alert: shows content when alert file exists" {
  _make_alert_file
  run_roll alert
  [ "$status" -eq 0 ]
  [[ "$output" == *"CI gate failed"* ]]
}

@test "roll alert ack: adds Acknowledged to file" {
  _make_alert_file
  run_roll alert ack
  [ "$status" -eq 0 ]
  grep -q "Acknowledged" "${TEST_TMP}/.shared/roll/loop/ALERT.md"
}

@test "roll alert resolve: removes alert file" {
  _make_alert_file
  run_roll alert resolve
  [ "$status" -eq 0 ]
  [ ! -f "${TEST_TMP}/.shared/roll/loop/ALERT.md" ]
}
