#!/usr/bin/env bats
# Tests for launchd plist helpers (macOS loop scheduling)

setup() {
  source "${BATS_TEST_DIRNAME}/../../bin/roll"
}

# ─── _project_slug ────────────────────────────────────────────────────────────

@test "_project_slug: includes basename" {
  run _project_slug "/Users/sean/myproject"
  [ "$status" -eq 0 ]
  [[ "$output" == myproject-* ]]
}

@test "_project_slug: only alphanumeric and dashes" {
  run _project_slug "/Users/sean/my project"
  [ "$status" -eq 0 ]
  [[ "$output" =~ ^[a-z0-9A-Z-]+$ ]]
}

@test "_project_slug: same path gives same slug" {
  local s1; s1=$(_project_slug "/Users/sean/proj")
  local s2; s2=$(_project_slug "/Users/sean/proj")
  [ "$s1" = "$s2" ]
}

@test "_project_slug: different paths give different slugs" {
  local s1; s1=$(_project_slug "/Users/sean/proj-a")
  local s2; s2=$(_project_slug "/Users/sean/proj-b")
  [ "$s1" != "$s2" ]
}

# ─── _launchd_label ───────────────────────────────────────────────────────────

@test "_launchd_label: format is com.roll.<service>.<slug>" {
  run _launchd_label "loop" "/Users/sean/myproject"
  [ "$status" -eq 0 ]
  [[ "$output" == com.roll.loop.myproject-* ]]
}

# ─── _launchd_plist_path ──────────────────────────────────────────────────────

@test "_launchd_plist_path: path ends in .plist" {
  run _launchd_plist_path "loop" "/Users/sean/myproject"
  [ "$status" -eq 0 ]
  [[ "$output" == *".plist" ]]
}

@test "_launchd_plist_path: path includes LaunchAgents dir" {
  run _launchd_plist_path "loop" "/Users/sean/myproject"
  [ "$status" -eq 0 ]
  [[ "$output" == *"/Library/LaunchAgents/"* ]]
}

# ─── _write_launchd_plist idempotency ─────────────────────────────────────────

@test "_write_launchd_plist: idempotent — same content no mtime change" {
  local tmp_dir; tmp_dir=$(mktemp -d)
  local plist="${tmp_dir}/test.plist"
  local label="com.roll.loop.test"
  local proj="/tmp/proj"
  local roll_bin="/usr/local/bin/roll"
  local log_dir="${tmp_dir}"

  _write_launchd_plist "$plist" "$label" "$proj" "0" "1" "$roll_bin" "loop now" "$log_dir"
  local mtime1; mtime1=$(stat -f "%m" "$plist" 2>/dev/null || stat -c "%Y" "$plist")

  # Small sleep to ensure mtime would change if file is rewritten
  sleep 1
  _write_launchd_plist "$plist" "$label" "$proj" "0" "1" "$roll_bin" "loop now" "$log_dir"
  local mtime2; mtime2=$(stat -f "%m" "$plist" 2>/dev/null || stat -c "%Y" "$plist")

  [ "$mtime1" = "$mtime2" ]
  rm -rf "$tmp_dir"
}

@test "_write_launchd_plist: creates valid plist XML" {
  local tmp_dir; tmp_dir=$(mktemp -d)
  local plist="${tmp_dir}/test.plist"

  _write_launchd_plist "$plist" "com.roll.loop.test" "/tmp/proj" "0" "1" \
    "/usr/local/bin/roll" "loop now" "$tmp_dir"

  [ -f "$plist" ]
  grep -q "com.roll.loop.test" "$plist"
  grep -q "StartCalendarInterval" "$plist"
  grep -q "<integer>0</integer>" "$plist"
  rm -rf "$tmp_dir"
}
