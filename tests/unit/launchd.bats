#!/usr/bin/env bats
# Tests for launchd plist helpers (macOS loop scheduling)

setup() {
  # Skip on Linux — launchd is macOS only. Run locally on macOS before committing.
  [[ "$(uname)" == "Darwin" ]] || skip "launchd tests require macOS (skip on Linux CI)"
  # FIX-093: gate every `launchctl` call inside `_install_launchd_plists`.
  # Without this, each of the 41 `_install_launchd_plists` calls in this file
  # hits the host gui domain and leaks ghost entries into
  # /private/var/db/com.apple.xpc.launchd/disabled.<UID>.plist — observed
  # +111 ghost rows per full-suite run before the gate was added.
  export _LAUNCHD_SKIP_REGISTRY=1
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

@test "_project_slug: resolves to main worktree when git-common-dir returns absolute path" {
  # Simulate a git worktree: git-common-dir returns the main tree's absolute .git path.
  # The worktree basename (cycleXYZ-roll) differs from the main basename (mainproj-fix034)
  # so without the fix the slugs would be distinct and the assertion would fail.
  local fake_main="/tmp/mainproj-fix034"
  mkdir -p "$fake_main"
  git() {
    if [[ "${*}" == *"--git-common-dir"* ]]; then
      printf '%s/.git\n' "$fake_main"
      return 0
    fi
    command git "$@"
  }
  run _project_slug "/some/worktrees/cycleXYZ-roll"
  rm -rf "$fake_main"
  [ "$status" -eq 0 ]
  # with fix: slug is based on main tree basename
  [[ "$output" == mainproj-fix034-* ]]
  # without fix it would start with "cycleXYZ-roll-"
  [[ "$output" != cycleXYZ-* ]]
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

@test "_launchd_plist_path: path is _LAUNCHD_DIR/<label>.plist" {
  local proj="/Users/sean/myproject"
  local expected="${_LAUNCHD_DIR}/$(_launchd_label "loop" "$proj").plist"
  run _launchd_plist_path "loop" "$proj"
  [ "$status" -eq 0 ]
  [ "$output" = "$expected" ]
}

# ─── _write_launchd_plist idempotency ─────────────────────────────────────────

@test "_write_launchd_plist: idempotent — same content no mtime change" {
  local tmp_dir; tmp_dir=$(mktemp -d)
  local plist="${tmp_dir}/test.plist"
  local label="com.roll.loop.test"
  local proj="/tmp/proj"
  local runner="${tmp_dir}/run.sh"

  _write_launchd_plist "$plist" "$label" "$proj" "60" "0" "1" "$runner"
  local mtime1; mtime1=$(stat -c "%Y" "$plist" 2>/dev/null || stat -f "%m" "$plist")

  # Small sleep to ensure mtime would change if file is rewritten
  sleep 1
  _write_launchd_plist "$plist" "$label" "$proj" "60" "0" "1" "$runner"
  local mtime2; mtime2=$(stat -c "%Y" "$plist" 2>/dev/null || stat -f "%m" "$plist")

  [ "$mtime1" = "$mtime2" ]
  rm -rf "$tmp_dir"
}

@test "_write_launchd_plist: creates valid plist XML" {
  # US-LOOP-032/FIX-105: every schedule now emits StartInterval (seconds), never
  # StartCalendarInterval. The hourly loop path (empty hour) uses
  # StartInterval = period * 60 = 60 * 60 = 3600.
  local tmp_dir; tmp_dir=$(mktemp -d)
  local plist="${tmp_dir}/test.plist"
  local runner="${tmp_dir}/run.sh"

  _write_launchd_plist "$plist" "com.roll.loop.test" "/tmp/proj" "60" "0" "" "$runner"

  [ -f "$plist" ]
  grep -q "com.roll.loop.test" "$plist"
  grep -q "<key>StartInterval</key>" "$plist"
  grep -A1 "<key>StartInterval</key>" "$plist" | grep -q "<integer>3600</integer>"
  ! grep -q "StartCalendarInterval" "$plist"
  rm -rf "$tmp_dir"
}

@test "_write_launchd_plist: hourly plist omits Hour key" {
  local tmp_dir; tmp_dir=$(mktemp -d)
  local plist="${tmp_dir}/test.plist"

  _write_launchd_plist "$plist" "com.roll.loop.test" "/tmp/proj" "60" "0" "" "${tmp_dir}/run.sh"

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

@test "_write_loop_runner_script: always dispatches popup to Terminal.app via open -g" {
  # FIX-054: terminal preference detection removed — fixed to macOS Terminal.app.
  # FIX-092: dispatch switched from osascript do-script to `open -g -a Terminal`
  # so the window appears in the background and does not steal focus.
  local tmp_dir; tmp_dir=$(mktemp -d)
  local script="${tmp_dir}/run.sh"
  _write_loop_runner_script "$script" "/tmp/proj" "claude -p prompt" "/tmp/run.log" "10" "18"
  grep -qF 'open -g -a Terminal' "$script"
  rm -rf "$tmp_dir"
}

@test "_write_loop_runner_script: no Ghostty.app reference in runner body" {
  # FIX-054: Ghostty branch removed entirely.
  local tmp_dir; tmp_dir=$(mktemp -d)
  local script="${tmp_dir}/run.sh"
  _write_loop_runner_script "$script" "/tmp/proj" "claude -p prompt" "/tmp/run.log" "10" "18"
  run grep -F 'Ghostty.app' "$script"
  [ "$status" -ne 0 ]
  rm -rf "$tmp_dir"
}

@test "_write_loop_runner_script: no iTerm2 reference in runner body" {
  # FIX-054: iTerm2 branch removed entirely.
  local tmp_dir; tmp_dir=$(mktemp -d)
  local script="${tmp_dir}/run.sh"
  _write_loop_runner_script "$script" "/tmp/proj" "claude -p prompt" "/tmp/run.log" "10" "18"
  run grep -F 'iTerm2' "$script"
  [ "$status" -ne 0 ]
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
  local mtime1; mtime1=$(stat -c "%Y" "$plist" 2>/dev/null || stat -f "%m" "$plist")

  sleep 1
  _install_launchd_plists "$proj"
  local mtime2; mtime2=$(stat -c "%Y" "$plist" 2>/dev/null || stat -f "%m" "$plist")

  [ "$mtime1" = "$mtime2" ]
  rm -rf "$tmp_dir"
}

@test "_install_launchd_plists: custom loop period from .roll/local.yaml drives StartInterval (US-LOOP-032)" {
  # Pre-US-LOOP-032 this asserted a custom loop_minute landed in the loop plist
  # as <Minute>7</Minute>. The offset (loop_minute) is no longer emitted — the
  # loop plist now carries StartInterval = period * 60. A custom period_minutes
  # in .roll/local.yaml therefore drives the StartInterval, overriding the
  # default period=60 (→3600): period=30 → 1800. (Global loop_minute → spec
  # offset is covered in loop_schedule_display.bats.)
  local tmp_dir; tmp_dir=$(mktemp -d)
  local proj="${tmp_dir}/proj"; mkdir -p "$proj/.roll"
  _LAUNCHD_DIR="${tmp_dir}/LaunchAgents"
  _SHARED_ROOT="${tmp_dir}/shared"
  ROLL_CONFIG=$(mktemp)
  printf 'loop_schedule:\n  period_minutes: 30\n  offset_minute: 0\n' > "$proj/.roll/local.yaml"

  _install_launchd_plists "$proj"

  local loop_plist; loop_plist=$(_launchd_plist_path "loop" "$proj")
  grep -q "<key>StartInterval</key>" "$loop_plist"
  grep -A1 "<key>StartInterval</key>" "$loop_plist" | grep -q "<integer>1800</integer>"
  ! grep -q "<key>Minute</key>" "$loop_plist"
  ! grep -q "<key>StartCalendarInterval</key>" "$loop_plist"
  rm -rf "$tmp_dir"; rm -f "$ROLL_CONFIG"
}

@test "_install_launchd_plists: two different projects get different default loop_minute" {
  local tmp_dir; tmp_dir=$(mktemp -d)
  mkdir -p "${tmp_dir}/projA" "${tmp_dir}/projB"

  # US-LOOP-012: _loop_schedule_spec derives offsets from project paths;
  # two different paths must produce different offsets (period=60 for both).
  local specA specB offA offB
  specA=$(_loop_schedule_spec "${tmp_dir}/projA")
  specB=$(_loop_schedule_spec "${tmp_dir}/projB")
  offA="${specA##* }"
  offB="${specB##* }"
  [ "$offA" != "$offB" ]
  rm -rf "$tmp_dir"
}

@test "_install_launchd_plists: loop uses StartInterval=3600, dream/brief use array-style StartCalendarInterval (US-LOOP-032/US-LOOP-035)" {
  # Pre-US-LOOP-032 this test asserted loop carried StartCalendarInterval+Minute
  # while dream/brief used StartInterval. US-LOOP-032 moved loop onto
  # StartInterval = period * 60. US-LOOP-035 (resolving FIX-105) then moved daily
  # dream/brief OFF the legacy StartInterval=86400 workaround and onto an
  # array-style StartCalendarInterval (Hour+Minute), so launchd fires at the
  # exact configured HH:MM. Current invariant:
  #   - loop (sub-daily, empty hour): StartInterval = period * 60; default
  #     period 60 → 3600; no calendar interval, no Hour.
  #   - dream/brief (daily): array-style StartCalendarInterval with Hour+Minute;
  #     no StartInterval, no legacy 86400. Default dream hour=3, brief hour=9.
  # The unit-level form + legacy ROLL_DREAM_LEGACY_INTERVAL fallback live in
  # plist_calendar_interval.bats; this asserts _install_launchd_plists wires the
  # services through the right code path.
  local tmp_dir; tmp_dir=$(mktemp -d)
  local proj="${tmp_dir}/proj"; mkdir -p "$proj"
  _LAUNCHD_DIR="${tmp_dir}/LaunchAgents"
  _SHARED_ROOT="${tmp_dir}/shared"
  ROLL_CONFIG=$(mktemp)

  _install_launchd_plists "$proj"

  local loop_p dream_p brief_p
  loop_p=$(_launchd_plist_path "loop" "$proj")
  dream_p=$(_launchd_plist_path "dream" "$proj")
  brief_p=$(_launchd_plist_path "brief" "$proj")

  # Loop: StartInterval=3600 (period 60 * 60), no calendar interval, no Hour.
  grep -q "<key>StartInterval</key>" "$loop_p"
  grep -A1 "<key>StartInterval</key>" "$loop_p" | grep -q "<integer>3600</integer>"
  ! grep -q "<key>StartCalendarInterval</key>" "$loop_p"
  ! grep -q "<key>Hour</key>" "$loop_p"

  # Dream: array-style StartCalendarInterval (Hour=3, Minute), no legacy 86400,
  # no StartInterval.
  grep -q "<key>StartCalendarInterval</key>" "$dream_p"
  grep -q "<array>" "$dream_p"
  grep -q "<key>Hour</key>" "$dream_p"
  grep -A1 "<key>Hour</key>" "$dream_p" | grep -q "<integer>3</integer>"
  grep -q "<key>Minute</key>" "$dream_p"
  ! grep -q "<key>StartInterval</key>" "$dream_p"
  ! grep -q "<integer>86400</integer>" "$dream_p"

  # Brief: array-style StartCalendarInterval (Hour=9, Minute), no legacy 86400,
  # no StartInterval.
  grep -q "<key>StartCalendarInterval</key>" "$brief_p"
  grep -q "<array>" "$brief_p"
  grep -q "<key>Hour</key>" "$brief_p"
  grep -A1 "<key>Hour</key>" "$brief_p" | grep -q "<integer>9</integer>"
  grep -q "<key>Minute</key>" "$brief_p"
  ! grep -q "<key>StartInterval</key>" "$brief_p"
  ! grep -q "<integer>86400</integer>" "$brief_p"

  rm -rf "$tmp_dir"; rm -f "$ROLL_CONFIG"
}

@test "_install_launchd_plists: loop runner contains active window bounds" {
  local tmp_dir; tmp_dir=$(mktemp -d)
  local proj="${tmp_dir}/proj"; mkdir -p "$proj"
  _LAUNCHD_DIR="${tmp_dir}/LaunchAgents"
  _SHARED_ROOT="${tmp_dir}/shared"
  local cfg; cfg=$(mktemp); ROLL_CONFIG="$cfg"
  # Active window now lives in per-project .roll/local.yaml loop_schedule block
  # (_loop_read_active_window), not global ROLL_CONFIG. Default is 0/24, so the
  # fixture must set the bounds here to drive 10/18 into the runner.
  mkdir -p "${proj}/.roll"
  printf 'loop_schedule:\n  active_start: 10\n  active_end: 18\n' > "${proj}/.roll/local.yaml"

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

@test "_install_launchd_plists: dream plist uses array-style StartCalendarInterval (US-LOOP-035)" {
  # FIX-105: macOS 26.4 launchd silently refuses a single-dict
  # StartCalendarInterval with both Hour and Minute. US-LOOP-035 resolves it by
  # wrapping Hour+Minute in a one-element array (launchd honors that), so daily
  # dream fires at the exact HH:MM instead of the legacy StartInterval=86400
  # drift. Default dream hour=3.
  local tmp_dir; tmp_dir=$(mktemp -d)
  local proj="${tmp_dir}/proj"
  mkdir -p "$proj"
  _LAUNCHD_DIR="${tmp_dir}/LaunchAgents"
  _SHARED_ROOT="${tmp_dir}/shared"
  # Isolate config so the host developer's ~/.roll/config.yaml can't override
  # the dream hour default (3) and make this assertion host-dependent.
  ROLL_CONFIG=$(mktemp)

  _install_launchd_plists "$proj"

  local dream_plist; dream_plist=$(_launchd_plist_path "dream" "$proj")
  grep -q "<key>StartCalendarInterval</key>" "$dream_plist"
  grep -q "<array>" "$dream_plist"
  grep -q "<key>Hour</key>" "$dream_plist"
  grep -A1 "<key>Hour</key>" "$dream_plist" | grep -q "<integer>3</integer>"
  grep -q "<key>Minute</key>" "$dream_plist"
  # The legacy drift workaround must not be present.
  ! grep -q "<key>StartInterval</key>" "$dream_plist"
  ! grep -q "<integer>86400</integer>" "$dream_plist"
  rm -rf "$tmp_dir"; rm -f "$ROLL_CONFIG"
}

@test "_install_launchd_plists: brief plist uses array-style StartCalendarInterval (US-LOOP-035)" {
  # US-LOOP-035 (resolves FIX-105): daily brief fires via array-style
  # StartCalendarInterval (Hour+Minute), not the legacy StartInterval=86400.
  # Default brief hour=9.
  local tmp_dir; tmp_dir=$(mktemp -d)
  local proj="${tmp_dir}/proj"
  mkdir -p "$proj"
  _LAUNCHD_DIR="${tmp_dir}/LaunchAgents"
  _SHARED_ROOT="${tmp_dir}/shared"
  # Isolate config so the host developer's ~/.roll/config.yaml can't override
  # the brief hour default (9) and make this assertion host-dependent.
  ROLL_CONFIG=$(mktemp)

  _install_launchd_plists "$proj"

  local brief_plist; brief_plist=$(_launchd_plist_path "brief" "$proj")
  grep -q "<key>StartCalendarInterval</key>" "$brief_plist"
  grep -q "<array>" "$brief_plist"
  grep -q "<key>Hour</key>" "$brief_plist"
  grep -A1 "<key>Hour</key>" "$brief_plist" | grep -q "<integer>9</integer>"
  grep -q "<key>Minute</key>" "$brief_plist"
  ! grep -q "<key>StartInterval</key>" "$brief_plist"
  ! grep -q "<integer>86400</integer>" "$brief_plist"
  rm -rf "$tmp_dir"; rm -f "$ROLL_CONFIG"
}

@test "_write_launchd_plist: daily schedule (hour set) emits array-style StartCalendarInterval (US-LOOP-035)" {
  # US-LOOP-035 (resolves FIX-105): daily services (hour set, here Hour=9
  # Minute=22) render an array-style StartCalendarInterval carrying Hour+Minute
  # so launchd fires at the exact HH:MM, replacing the legacy StartInterval=86400
  # drift. Arg order: plist label project period offset(minute) hour runner.
  local tmp_dir; tmp_dir=$(mktemp -d)
  local plist="${tmp_dir}/test.plist"
  _write_launchd_plist "$plist" "com.roll.dream.test" "/tmp/proj" "60" "22" "9" "${tmp_dir}/run.sh"
  grep -q "<key>StartCalendarInterval</key>" "$plist"
  grep -q "<array>" "$plist"
  grep -q "<key>Hour</key>" "$plist"
  grep -A1 "<key>Hour</key>" "$plist" | grep -q "<integer>9</integer>"
  grep -q "<key>Minute</key>" "$plist"
  grep -A1 "<key>Minute</key>" "$plist" | grep -q "<integer>22</integer>"
  ! grep -q "<key>StartInterval</key>" "$plist"
  ! grep -q "<integer>86400</integer>" "$plist"
  rm -rf "$tmp_dir"
}

@test "_write_launchd_plist: sub-daily schedule (hour empty) uses StartInterval=period*60 (US-LOOP-032)" {
  # US-LOOP-032: the sub-daily/hourly loop path (empty hour) switched from
  # StartCalendarInterval+<Minute> to StartInterval = period * 60. Verified here
  # with a non-60 period (30 → 1800) to pin the formula, not just the hourly
  # default. The calendar form is gone entirely. offset (arg 5) is accepted for
  # backward compat but no longer emitted.
  local tmp_dir; tmp_dir=$(mktemp -d)
  local plist="${tmp_dir}/test.plist"
  _write_launchd_plist "$plist" "com.roll.loop.test" "/tmp/proj" "30" "0" "" "${tmp_dir}/run.sh"
  grep -q "<key>StartInterval</key>" "$plist"
  grep -A1 "<key>StartInterval</key>" "$plist" | grep -q "<integer>1800</integer>"
  ! grep -q "<key>StartCalendarInterval</key>" "$plist"
  ! grep -q "<key>Minute</key>" "$plist"
  rm -rf "$tmp_dir"
}

@test "_install_launchd_plists: content changed + service loaded → reload via bootout+bootstrap (FIX-027)" {
  # FIX-093: this test asserts launchctl was called with specific args; opt out
  # of the unit_setup-wide skip so the function() override below catches them.
  unset _LAUNCHD_SKIP_REGISTRY
  # US-LOOP-032: the loop plist is driven by StartInterval = period * 60, so
  # changing loop_minute (the offset) no longer alters plist content. Vary
  # period_minutes in .roll/local.yaml instead to force a real content change
  # and trigger the reload path.
  local tmp_dir; tmp_dir=$(mktemp -d)
  local proj="${tmp_dir}/proj"; mkdir -p "$proj/.roll"
  _LAUNCHD_DIR="${tmp_dir}/LaunchAgents"
  _SHARED_ROOT="${tmp_dir}/shared"
  ROLL_CONFIG=$(mktemp)
  local reload_log="${tmp_dir}/launchctl_calls.log"

  # Install with first schedule (period=30 → loop StartInterval=1800)
  printf 'loop_schedule:\n  period_minutes: 30\n  offset_minute: 0\n' > "$proj/.roll/local.yaml"
  _install_launchd_plists "$proj"

  # Simulate service is loaded and capture launchctl calls
  _launchd_is_loaded() { return 0; }
  launchctl() { echo "$*" >> "$reload_log"; }
  export -f _launchd_is_loaded launchctl 2>/dev/null || true

  # Change schedule so loop plist content changes (period=45 → StartInterval=2700)
  printf 'loop_schedule:\n  period_minutes: 45\n  offset_minute: 0\n' > "$proj/.roll/local.yaml"
  _install_launchd_plists "$proj"

  # FIX-027: reload must use bootout/bootstrap (doesn't touch overrides db),
  # not unload/load no-`-w` (which wipes the label's enabled flag on Sonoma+).
  grep -q "bootout" "$reload_log"
  grep -q "bootstrap" "$reload_log"
  ! grep -qE '^unload ' "$reload_log"
  ! grep -qE '^load ' "$reload_log"
  rm -rf "$tmp_dir"; rm -f "$ROLL_CONFIG"
}

@test "_install_launchd_plists: bootout targets gui/<uid>/<label> and bootstrap targets gui/<uid> <plist> (FIX-027)" {
  # FIX-093: see sibling FIX-027 test above — opt out so launchctl override fires.
  unset _LAUNCHD_SKIP_REGISTRY
  # US-LOOP-032: drive the loop plist content change via period_minutes
  # (loop_minute is only the offset and no longer appears in the plist — see
  # sibling test).
  local tmp_dir; tmp_dir=$(mktemp -d)
  local proj="${tmp_dir}/proj"; mkdir -p "$proj/.roll"
  _LAUNCHD_DIR="${tmp_dir}/LaunchAgents"
  _SHARED_ROOT="${tmp_dir}/shared"
  ROLL_CONFIG=$(mktemp)
  local reload_log="${tmp_dir}/launchctl_calls.log"

  printf 'loop_schedule:\n  period_minutes: 30\n  offset_minute: 0\n' > "$proj/.roll/local.yaml"
  _install_launchd_plists "$proj"

  _launchd_is_loaded() { return 0; }
  launchctl() { echo "$*" >> "$reload_log"; }
  export -f _launchd_is_loaded launchctl 2>/dev/null || true

  printf 'loop_schedule:\n  period_minutes: 45\n  offset_minute: 0\n' > "$proj/.roll/local.yaml"
  _install_launchd_plists "$proj"

  local uid; uid=$(id -u)
  local label; label=$(_launchd_label "loop" "$proj")
  local plist; plist=$(_launchd_plist_path "loop" "$proj")
  grep -qF "bootout gui/${uid}/${label}" "$reload_log"
  grep -qF "bootstrap gui/${uid} ${plist}" "$reload_log"
  rm -rf "$tmp_dir"; rm -f "$ROLL_CONFIG"
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

# ─── terminal popup in generated runner (FIX-054: always Terminal.app) ───────

@test "_install_launchd_plists: runner uses Terminal.app regardless of TERM_PROGRAM" {
  # FIX-054: TERM_PROGRAM=ghostty must not change the generated runner — the
  # popup target is hard-coded to macOS Terminal.app for predictability.
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
  grep -qF 'open -g -a Terminal' "$runner"
  run grep -F 'Ghostty.app' "$runner"
  [ "$status" -ne 0 ]
  run grep -F 'iTerm2' "$runner"
  [ "$status" -ne 0 ]
  rm -rf "$tmp_dir"; rm -f "$cfg"
}

@test "_install_launchd_plists: brand-new plist + not loaded → launchctl disable blocks FSEvents auto-load (FIX-059)" {
  # FIX-093: this test asserts launchctl disable was emitted; opt out of the
  # unit_setup gate so the function() override below catches the call.
  unset _LAUNCHD_SKIP_REGISTRY
  local tmp_dir; tmp_dir=$(mktemp -d)
  local proj="${tmp_dir}/proj"; mkdir -p "$proj"
  _LAUNCHD_DIR="${tmp_dir}/LaunchAgents"
  _SHARED_ROOT="${tmp_dir}/shared"
  local disable_log="${tmp_dir}/launchctl_calls.log"

  # Label is NOT loaded — user has never run 'roll loop on'
  _launchd_is_loaded() { return 1; }
  launchctl() { echo "$*" >> "$disable_log"; }

  _install_launchd_plists "$proj"

  local uid; uid=$(id -u)
  local loop_label; loop_label=$(_launchd_label "loop" "$proj")
  local dream_label; dream_label=$(_launchd_label "dream" "$proj")
  local brief_label; brief_label=$(_launchd_label "brief" "$proj")

  grep -qF "disable gui/${uid}/${loop_label}" "$disable_log"
  grep -qF "disable gui/${uid}/${dream_label}" "$disable_log"
  grep -qF "disable gui/${uid}/${brief_label}" "$disable_log"
  rm -rf "$tmp_dir"
}

@test "_install_launchd_plists: disable not called when label already loaded (FIX-059)" {
  local tmp_dir; tmp_dir=$(mktemp -d)
  local proj="${tmp_dir}/proj"; mkdir -p "$proj"
  _LAUNCHD_DIR="${tmp_dir}/LaunchAgents"
  _SHARED_ROOT="${tmp_dir}/shared"
  local cfg; cfg=$(mktemp); echo "loop_minute: 11" > "$cfg"; ROLL_CONFIG="$cfg"
  _install_launchd_plists "$proj"

  local launchctl_log="${tmp_dir}/launchctl_calls.log"
  _launchd_is_loaded() { return 0; }
  launchctl() { echo "$*" >> "$launchctl_log"; }

  echo "loop_minute: 22" > "$cfg"
  _install_launchd_plists "$proj"

  [ ! -f "$launchctl_log" ] || ! grep -q "^disable" "$launchctl_log"
  rm -rf "$tmp_dir"; rm -f "$cfg"
}

@test "_install_launchd_plists: ignores loop_attach_terminal config" {
  # FIX-054: the loop_attach_terminal config key is no longer honored —
  # generator always emits Terminal.app dispatch.
  local tmp_dir; tmp_dir=$(mktemp -d)
  local proj="${tmp_dir}/proj"; mkdir -p "$proj"
  _LAUNCHD_DIR="${tmp_dir}/LaunchAgents"
  _SHARED_ROOT="${tmp_dir}/shared"
  local cfg; cfg=$(mktemp)
  printf 'loop_attach_terminal: ghostty\n' > "$cfg"; ROLL_CONFIG="$cfg"

  _install_launchd_plists "$proj"

  local slug; slug=$(_project_slug "$proj")
  local runner="${tmp_dir}/shared/loop/run-${slug}.sh"
  run grep -F 'Ghostty.app' "$runner"
  [ "$status" -ne 0 ]
  grep -qF 'open -g -a Terminal' "$runner"
  rm -rf "$tmp_dir"; rm -f "$cfg"
}
