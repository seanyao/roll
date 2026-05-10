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
  local runner="${tmp_dir}/run.sh"

  _write_launchd_plist "$plist" "$label" "$proj" "0" "1" "$runner"
  local mtime1; mtime1=$(stat -f "%m" "$plist" 2>/dev/null || stat -c "%Y" "$plist")

  # Small sleep to ensure mtime would change if file is rewritten
  sleep 1
  _write_launchd_plist "$plist" "$label" "$proj" "0" "1" "$runner"
  local mtime2; mtime2=$(stat -f "%m" "$plist" 2>/dev/null || stat -c "%Y" "$plist")

  [ "$mtime1" = "$mtime2" ]
  rm -rf "$tmp_dir"
}

@test "_write_launchd_plist: creates valid plist XML" {
  local tmp_dir; tmp_dir=$(mktemp -d)
  local plist="${tmp_dir}/test.plist"
  local runner="${tmp_dir}/run.sh"

  _write_launchd_plist "$plist" "com.roll.loop.test" "/tmp/proj" "0" "1" "$runner"

  [ -f "$plist" ]
  grep -q "com.roll.loop.test" "$plist"
  grep -q "StartCalendarInterval" "$plist"
  grep -q "<integer>0</integer>" "$plist"
  rm -rf "$tmp_dir"
}

@test "_write_launchd_plist: hourly plist omits Hour key" {
  local tmp_dir; tmp_dir=$(mktemp -d)
  local plist="${tmp_dir}/test.plist"

  _write_launchd_plist "$plist" "com.roll.loop.test" "/tmp/proj" "0" "" "${tmp_dir}/run.sh"

  ! grep -q "<key>Hour</key>" "$plist"
  rm -rf "$tmp_dir"
}

@test "_write_runner_script: creates executable script" {
  local tmp_dir; tmp_dir=$(mktemp -d)
  local script="${tmp_dir}/run.sh"

  _write_runner_script "$script" "/tmp/proj" "claude -p prompt" "/tmp/run.log"

  [ -f "$script" ]
  [ -x "$script" ]
  grep -q "/tmp/proj" "$script"
  rm -rf "$tmp_dir"
}

# ─── _install_launchd_plists ──────────────────────────────────────────────────

@test "_install_launchd_plists: creates three plist files" {
  local tmp_dir; tmp_dir=$(mktemp -d)
  local proj="${tmp_dir}/proj"
  mkdir -p "$proj"
  _LAUNCHD_DIR="${tmp_dir}/LaunchAgents"
  _SHARED_ROOT="${tmp_dir}/shared"

  _install_launchd_plists "$proj"

  [ -f "$(_launchd_plist_path "loop" "$proj")" ]
  [ -f "$(_launchd_plist_path "dream" "$proj")" ]
  [ -f "$(_launchd_plist_path "brief" "$proj")" ]
  rm -rf "$tmp_dir"
}

@test "_install_launchd_plists: creates three runner scripts" {
  local tmp_dir; tmp_dir=$(mktemp -d)
  local proj="${tmp_dir}/proj"
  mkdir -p "$proj"
  _LAUNCHD_DIR="${tmp_dir}/LaunchAgents"
  _SHARED_ROOT="${tmp_dir}/shared"

  _install_launchd_plists "$proj"

  [ -x "${_SHARED_ROOT}/loop/run.sh" ]
  [ -x "${_SHARED_ROOT}/dream/run.sh" ]
  [ -x "${_SHARED_ROOT}/brief/run.sh" ]
  rm -rf "$tmp_dir"
}

@test "_install_launchd_plists: idempotent — no plist mtime change on second call" {
  local tmp_dir; tmp_dir=$(mktemp -d)
  local proj="${tmp_dir}/proj"
  mkdir -p "$proj"
  _LAUNCHD_DIR="${tmp_dir}/LaunchAgents"
  _SHARED_ROOT="${tmp_dir}/shared"

  _install_launchd_plists "$proj"
  local plist; plist=$(_launchd_plist_path "loop" "$proj")
  local mtime1; mtime1=$(stat -f "%m" "$plist" 2>/dev/null || stat -c "%Y" "$plist")

  sleep 1
  _install_launchd_plists "$proj"
  local mtime2; mtime2=$(stat -f "%m" "$plist" 2>/dev/null || stat -c "%Y" "$plist")

  [ "$mtime1" = "$mtime2" ]
  rm -rf "$tmp_dir"
}

@test "_install_launchd_plists: loop plist is hourly (no Hour key)" {
  local tmp_dir; tmp_dir=$(mktemp -d)
  local proj="${tmp_dir}/proj"
  mkdir -p "$proj"
  _LAUNCHD_DIR="${tmp_dir}/LaunchAgents"
  _SHARED_ROOT="${tmp_dir}/shared"

  _install_launchd_plists "$proj"

  local loop_plist; loop_plist=$(_launchd_plist_path "loop" "$proj")
  ! grep -q "<key>Hour</key>" "$loop_plist"
  rm -rf "$tmp_dir"
}

@test "_install_launchd_plists: dream plist fires at hour 3" {
  local tmp_dir; tmp_dir=$(mktemp -d)
  local proj="${tmp_dir}/proj"
  mkdir -p "$proj"
  _LAUNCHD_DIR="${tmp_dir}/LaunchAgents"
  _SHARED_ROOT="${tmp_dir}/shared"

  _install_launchd_plists "$proj"

  local dream_plist; dream_plist=$(_launchd_plist_path "dream" "$proj")
  grep -q "<key>Hour</key>" "$dream_plist"
  grep -A1 "<key>Hour</key>" "$dream_plist" | grep -q "<integer>3</integer>"
  rm -rf "$tmp_dir"
}

@test "_install_launchd_plists: brief plist fires at hour 9" {
  local tmp_dir; tmp_dir=$(mktemp -d)
  local proj="${tmp_dir}/proj"
  mkdir -p "$proj"
  _LAUNCHD_DIR="${tmp_dir}/LaunchAgents"
  _SHARED_ROOT="${tmp_dir}/shared"

  _install_launchd_plists "$proj"

  local brief_plist; brief_plist=$(_launchd_plist_path "brief" "$proj")
  grep -q "<key>Hour</key>" "$brief_plist"
  grep -A1 "<key>Hour</key>" "$brief_plist" | grep -q "<integer>9</integer>"
  rm -rf "$tmp_dir"
}
