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

@test "_write_loop_runner_script: creates executable script with active window check" {
  local tmp_dir; tmp_dir=$(mktemp -d)
  local script="${tmp_dir}/run.sh"

  _write_loop_runner_script "$script" "/tmp/proj" "claude -p prompt" "/tmp/run.log" "10" "18"

  [ -f "$script" ]
  [ -x "$script" ]
  grep -q "10" "$script"
  grep -q "18" "$script"
  rm -rf "$tmp_dir"
}

@test "_write_loop_runner_script: terminal=ghostty embeds ghostty dispatch" {
  local tmp_dir; tmp_dir=$(mktemp -d)
  local script="${tmp_dir}/run.sh"
  _write_loop_runner_script "$script" "/tmp/proj" "claude -p prompt" "/tmp/run.log" "10" "18" "ghostty"
  grep -qF 'open -na Ghostty.app --args -e tmux attach' "$script"
  rm -rf "$tmp_dir"
}

@test "_write_loop_runner_script: terminal=iTerm2 embeds iTerm2 dispatch" {
  local tmp_dir; tmp_dir=$(mktemp -d)
  local script="${tmp_dir}/run.sh"
  _write_loop_runner_script "$script" "/tmp/proj" "claude -p prompt" "/tmp/run.log" "10" "18" "iTerm2"
  grep -qF 'iTerm2' "$script"
  rm -rf "$tmp_dir"
}

@test "_write_loop_runner_script: terminal=Terminal uses osascript Terminal" {
  local tmp_dir; tmp_dir=$(mktemp -d)
  local script="${tmp_dir}/run.sh"
  _write_loop_runner_script "$script" "/tmp/proj" "claude -p prompt" "/tmp/run.log" "10" "18" "Terminal"
  grep -qF 'tell application \"Terminal\"' "$script"
  rm -rf "$tmp_dir"
}

@test "_write_loop_runner_script: no terminal arg defaults to Terminal osascript" {
  local tmp_dir; tmp_dir=$(mktemp -d)
  local script="${tmp_dir}/run.sh"
  _write_loop_runner_script "$script" "/tmp/proj" "claude -p prompt" "/tmp/run.log" "10" "18"
  grep -qF 'tell application \"Terminal\"' "$script"
  rm -rf "$tmp_dir"
}

# ─── _config_read_int ─────────────────────────────────────────────────────────

@test "_config_read_int: returns default when key absent" {
  local tmp; tmp=$(mktemp)
  ROLL_CONFIG="$tmp"
  run _config_read_int "loop_active_start" "10"
  [ "$status" -eq 0 ]
  [ "$output" = "10" ]
  rm -f "$tmp"
}

@test "_config_read_int: returns value from config" {
  local tmp; tmp=$(mktemp)
  echo "loop_active_start: 8" > "$tmp"
  ROLL_CONFIG="$tmp"
  run _config_read_int "loop_active_start" "10"
  [ "$status" -eq 0 ]
  [ "$output" = "8" ]
  rm -f "$tmp"
}

# ─── _loop_derive_minute ──────────────────────────────────────────────────────

@test "_loop_derive_minute: result is in range 1-55" {
  local m; m=$(_loop_derive_minute "/Users/sean/myproject" 0)
  [ "$m" -ge 1 ]
  [ "$m" -le 55 ]
}

@test "_loop_derive_minute: different project paths give different minutes" {
  local m1; m1=$(_loop_derive_minute "/Users/sean/project-alpha" 0)
  local m2; m2=$(_loop_derive_minute "/Users/sean/project-beta" 0)
  [ "$m1" != "$m2" ]
}

@test "_loop_derive_minute: same project offsets 0/2/4 all differ" {
  local m0 m2 m4
  m0=$(_loop_derive_minute "/Users/sean/project-testX" 0)
  m2=$(_loop_derive_minute "/Users/sean/project-testX" 2)
  m4=$(_loop_derive_minute "/Users/sean/project-testX" 4)
  [ "$m0" != "$m2" ]
  [ "$m0" != "$m4" ]
  [ "$m2" != "$m4" ]
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

  local slug; slug=$(_project_slug "$proj")
  [ -x "${_SHARED_ROOT}/loop/run-${slug}.sh" ]
  [ -x "${_SHARED_ROOT}/dream/run-${slug}.sh" ]
  [ -x "${_SHARED_ROOT}/brief/run-${slug}.sh" ]
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

@test "_install_launchd_plists: custom loop_minute from config overrides hash" {
  local tmp_dir; tmp_dir=$(mktemp -d)
  local proj="${tmp_dir}/proj"; mkdir -p "$proj"
  _LAUNCHD_DIR="${tmp_dir}/LaunchAgents"
  _SHARED_ROOT="${tmp_dir}/shared"
  local cfg; cfg=$(mktemp); echo "loop_minute: 7" > "$cfg"; ROLL_CONFIG="$cfg"

  _install_launchd_plists "$proj"

  local loop_plist; loop_plist=$(_launchd_plist_path "loop" "$proj")
  grep -A1 "<key>Minute</key>" "$loop_plist" | grep -q "<integer>7</integer>"
  rm -rf "$tmp_dir"; rm -f "$cfg"
}

@test "_install_launchd_plists: two different projects get different default loop_minute" {
  local tmp_dir; tmp_dir=$(mktemp -d)
  mkdir -p "${tmp_dir}/projA" "${tmp_dir}/projB"
  _LAUNCHD_DIR="${tmp_dir}/LaunchAgents"
  _SHARED_ROOT="${tmp_dir}/shared"
  ROLL_CONFIG=$(mktemp)

  _install_launchd_plists "${tmp_dir}/projA"
  _install_launchd_plists "${tmp_dir}/projB"

  local pA pB mA mB
  pA=$(_launchd_plist_path "loop" "${tmp_dir}/projA")
  pB=$(_launchd_plist_path "loop" "${tmp_dir}/projB")
  mA=$(grep -A1 "<key>Minute</key>" "$pA" | grep -o "[0-9]*" | head -1)
  mB=$(grep -A1 "<key>Minute</key>" "$pB" | grep -o "[0-9]*" | head -1)
  [ "$mA" != "$mB" ]
  rm -rf "$tmp_dir"; rm -f "$ROLL_CONFIG"
}

@test "_install_launchd_plists: same project loop/dream/brief minutes all differ" {
  local tmp_dir; tmp_dir=$(mktemp -d)
  local proj="${tmp_dir}/proj"; mkdir -p "$proj"
  _LAUNCHD_DIR="${tmp_dir}/LaunchAgents"
  _SHARED_ROOT="${tmp_dir}/shared"
  ROLL_CONFIG=$(mktemp)

  _install_launchd_plists "$proj"

  local lm dm bm
  lm=$(grep -A1 "<key>Minute</key>" "$(_launchd_plist_path "loop" "$proj")" | grep -o "[0-9]*" | head -1)
  dm=$(grep -A1 "<key>Minute</key>" "$(_launchd_plist_path "dream" "$proj")" | grep -o "[0-9]*" | head -1)
  bm=$(grep -A1 "<key>Minute</key>" "$(_launchd_plist_path "brief" "$proj")" | grep -o "[0-9]*" | head -1)
  [ "$lm" != "$dm" ]
  [ "$lm" != "$bm" ]
  [ "$dm" != "$bm" ]
  rm -rf "$tmp_dir"; rm -f "$ROLL_CONFIG"
}

@test "_install_launchd_plists: loop runner contains active window bounds" {
  local tmp_dir; tmp_dir=$(mktemp -d)
  local proj="${tmp_dir}/proj"; mkdir -p "$proj"
  _LAUNCHD_DIR="${tmp_dir}/LaunchAgents"
  _SHARED_ROOT="${tmp_dir}/shared"
  local cfg; cfg=$(mktemp)
  printf 'loop_active_start: 10\nloop_active_end: 18\n' > "$cfg"; ROLL_CONFIG="$cfg"

  _install_launchd_plists "$proj"

  local slug; slug=$(_project_slug "$proj")
  local runner="${tmp_dir}/shared/loop/run-${slug}.sh"
  grep -q "10" "$runner"
  grep -q "18" "$runner"
  rm -rf "$tmp_dir"; rm -f "$cfg"
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

@test "_install_launchd_plists: content changed + service loaded → reload triggered" {
  local tmp_dir; tmp_dir=$(mktemp -d)
  local proj="${tmp_dir}/proj"; mkdir -p "$proj"
  _LAUNCHD_DIR="${tmp_dir}/LaunchAgents"
  _SHARED_ROOT="${tmp_dir}/shared"
  local reload_log="${tmp_dir}/launchctl_calls.log"

  # Install with first config
  local cfg; cfg=$(mktemp); echo "loop_minute: 11" > "$cfg"; ROLL_CONFIG="$cfg"
  _install_launchd_plists "$proj"

  # Simulate service is loaded and capture launchctl calls
  _launchd_is_loaded() { return 0; }
  launchctl() { echo "$*" >> "$reload_log"; }
  export -f _launchd_is_loaded launchctl 2>/dev/null || true

  # Change config so plist content changes
  echo "loop_minute: 22" > "$cfg"
  _install_launchd_plists "$proj"

  grep -q "unload" "$reload_log"
  grep -q "load" "$reload_log"
  rm -rf "$tmp_dir"; rm -f "$cfg"
}

@test "_install_launchd_plists: content unchanged → reload not triggered" {
  local tmp_dir; tmp_dir=$(mktemp -d)
  local proj="${tmp_dir}/proj"; mkdir -p "$proj"
  _LAUNCHD_DIR="${tmp_dir}/LaunchAgents"
  _SHARED_ROOT="${tmp_dir}/shared"
  local reload_log="${tmp_dir}/launchctl_calls.log"

  local cfg; cfg=$(mktemp); echo "loop_minute: 11" > "$cfg"; ROLL_CONFIG="$cfg"
  _install_launchd_plists "$proj"

  # Simulate service is loaded and capture launchctl calls
  _launchd_is_loaded() { return 0; }
  launchctl() { echo "$*" >> "$reload_log"; }
  export -f _launchd_is_loaded launchctl 2>/dev/null || true

  # Second install with same config — no content change
  _install_launchd_plists "$proj"

  [ ! -f "$reload_log" ] || ! grep -q "unload" "$reload_log"
  rm -rf "$tmp_dir"; rm -f "$cfg"
}

# ─── terminal preference in _install_launchd_plists ───────────────────────────

@test "_install_launchd_plists: loop_attach_terminal=ghostty bakes ghostty case value into runner" {
  local tmp_dir; tmp_dir=$(mktemp -d)
  local proj="${tmp_dir}/proj"; mkdir -p "$proj"
  _LAUNCHD_DIR="${tmp_dir}/LaunchAgents"
  _SHARED_ROOT="${tmp_dir}/shared"
  local cfg; cfg=$(mktemp)
  printf 'loop_attach_terminal: ghostty\n' > "$cfg"; ROLL_CONFIG="$cfg"

  _install_launchd_plists "$proj"

  local slug; slug=$(_project_slug "$proj")
  local runner="${tmp_dir}/shared/loop/run-${slug}.sh"
  # Check the case SWITCH VALUE is "ghostty", not just that the ghostty branch text exists
  grep -qE 'case "ghostty"' "$runner"
  rm -rf "$tmp_dir"; rm -f "$cfg"
}

@test "_install_launchd_plists: TERM_PROGRAM=ghostty bakes ghostty case value when no config override" {
  local tmp_dir; tmp_dir=$(mktemp -d)
  local proj="${tmp_dir}/proj"; mkdir -p "$proj"
  _LAUNCHD_DIR="${tmp_dir}/LaunchAgents"
  _SHARED_ROOT="${tmp_dir}/shared"
  local cfg; cfg=$(mktemp)
  printf '' > "$cfg"; ROLL_CONFIG="$cfg"

  local saved_TERM_PROGRAM="${TERM_PROGRAM:-}"
  TERM_PROGRAM=ghostty
  _install_launchd_plists "$proj"
  TERM_PROGRAM="$saved_TERM_PROGRAM"

  local slug; slug=$(_project_slug "$proj")
  local runner="${tmp_dir}/shared/loop/run-${slug}.sh"
  grep -qE 'case "ghostty"' "$runner"
  rm -rf "$tmp_dir"; rm -f "$cfg"
}

@test "_install_launchd_plists: config loop_attach_terminal wins over TERM_PROGRAM" {
  local tmp_dir; tmp_dir=$(mktemp -d)
  local proj="${tmp_dir}/proj"; mkdir -p "$proj"
  _LAUNCHD_DIR="${tmp_dir}/LaunchAgents"
  _SHARED_ROOT="${tmp_dir}/shared"
  local cfg; cfg=$(mktemp)
  printf 'loop_attach_terminal: Terminal\n' > "$cfg"; ROLL_CONFIG="$cfg"

  local saved_TERM_PROGRAM="${TERM_PROGRAM:-}"
  TERM_PROGRAM=ghostty
  _install_launchd_plists "$proj"
  TERM_PROGRAM="$saved_TERM_PROGRAM"

  local slug; slug=$(_project_slug "$proj")
  local runner="${tmp_dir}/shared/loop/run-${slug}.sh"
  # Case value should be "Terminal" even though TERM_PROGRAM is ghostty
  grep -qE 'case "Terminal"' "$runner"
  rm -rf "$tmp_dir"; rm -f "$cfg"
}
