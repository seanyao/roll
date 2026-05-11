#!/usr/bin/env bats
# Unit tests for: _dashboard — loop service schedule display

ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"

# ─── Service lines when loop enabled ─────────────────────────────────────────

@test "dashboard: shows per-service lines when loop is enabled (macOS)" {
  [[ "$(uname)" != "Darwin" ]] && skip "macOS only"
  local body
  body=$(awk '/^_dashboard\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  # Must reference all three services within the enabled branch
  echo "$body" | grep -q '"dream"'
  echo "$body" | grep -q '"brief"'
  echo "$body" | grep -q '"loop"'
}

@test "dashboard: service lines share schedule construction with _loop_monitor" {
  local monitor_body dashboard_body
  monitor_body=$(awk '/^_loop_monitor\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  dashboard_body=$(awk '/^_dashboard\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  # Both should use _loop_derive_minute to compute schedules (avoid hardcoded times)
  echo "$monitor_body"   | grep -q '_loop_derive_minute'
  echo "$dashboard_body" | grep -q '_loop_derive_minute'
  # Both should use _launchd_svc_state for state detection
  echo "$monitor_body"   | grep -q '_launchd_svc_state'
  echo "$dashboard_body" | grep -q '_launchd_svc_state'
}

@test "dashboard: service display is inside loop-enabled conditional" {
  local body
  body=$(awk '/^_dashboard\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  # The service display logic must appear after the _dash_loop_enabled check
  local enabled_line svc_line
  enabled_line=$(echo "$body" | grep -n "_dash_loop_enabled" | head -1 | cut -d: -f1)
  svc_line=$(echo "$body"     | grep -n "_launchd_svc_state" | head -1 | cut -d: -f1)
  [[ -n "$enabled_line" && -n "$svc_line" ]]
  [[ "$svc_line" -gt "$enabled_line" ]]
}
