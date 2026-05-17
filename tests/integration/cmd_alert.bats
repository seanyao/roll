#!/usr/bin/env bats
# E2E integration tests for: roll alert command

load helpers

ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"

setup()    { integration_setup; }
teardown() { integration_teardown; }

_make_alert_file() {
  # FIX-052: per-project ALERT path (was global ALERT.md before the namespace fix).
  local alert_path; alert_path=$(roll_loop_path alert)
  mkdir -p "$(dirname "$alert_path")"
  cat > "$alert_path" << 'EOF'
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
  grep -q "Acknowledged" "$(roll_loop_path alert)"
}

@test "roll alert resolve: removes alert file" {
  _make_alert_file
  run_roll alert resolve
  [ "$status" -eq 0 ]
  [ ! -f "$(roll_loop_path alert)" ]
}
