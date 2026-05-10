#!/usr/bin/env bats
# Unit tests for: _dashboard — loop service schedule display

ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"

# ─── Service lines when loop enabled ─────────────────────────────────────────

@test "dashboard: shows per-service lines when loop is enabled (macOS)" {
  [[ "$(uname)" != "Darwin" ]] && skip "macOS only"
  local body
  body=$(awk '/^_dashboard\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  # Must reference service schedule display inside the enabled branch
  echo "$body" | grep -q "dream:"
  echo "$body" | grep -q "brief:"
}

@test "dashboard: service lines use same svc_info format as _loop_monitor" {
  local monitor_body dashboard_body
  monitor_body=$(awk '/^_loop_monitor\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  dashboard_body=$(awk '/^_dashboard\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  # Both should reference the same service names
  echo "$monitor_body"  | grep -q '"dream:'
  echo "$dashboard_body" | grep -q '"dream:'
}

@test "dashboard: service display is inside loop-enabled conditional" {
  local body
  body=$(awk '/^_dashboard\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  # The service lines must appear after the _dash_loop_enabled check
  local enabled_line dream_line
  enabled_line=$(echo "$body" | grep -n "_dash_loop_enabled" | head -1 | cut -d: -f1)
  dream_line=$(echo "$body"   | grep -n '"dream:'           | head -1 | cut -d: -f1)
  [[ -n "$enabled_line" && -n "$dream_line" ]]
  [[ "$dream_line" -gt "$enabled_line" ]]
}
