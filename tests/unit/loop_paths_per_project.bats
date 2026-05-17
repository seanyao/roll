#!/usr/bin/env bats
# FIX-052: roll-loop shared state files (ALERT/state/mute) must be namespaced
# per project so concurrent projects don't bleed into each other's runs.
# Aligns with existing per-project namespacing for events-<slug>.ndjson,
# run-<slug>.sh, .LOCK-<slug>, .heartbeat-<slug>, PAUSE-<slug>.

load helpers

setup()    { unit_setup; }
teardown() { unit_teardown; }

# ── default paths carry project slug suffix ───────────────────────────────────

@test "_LOOP_ALERT default contains project slug suffix" {
  [ -n "${_LOOP_ALERT:-}" ]
  # Legacy global path must no longer be the default.
  [ "$_LOOP_ALERT" != "${_SHARED_ROOT}/loop/ALERT.md" ]
  [[ "$_LOOP_ALERT" =~ /ALERT-.+\.md$ ]]
}

@test "_LOOP_STATE default contains project slug suffix" {
  [ -n "${_LOOP_STATE:-}" ]
  [ "$_LOOP_STATE" != "${_SHARED_ROOT}/loop/state.yaml" ]
  [[ "$_LOOP_STATE" =~ /state-.+\.yaml$ ]]
}

@test "_LOOP_MUTE_FILE default contains project slug suffix" {
  [ -n "${_LOOP_MUTE_FILE:-}" ]
  # Legacy global mute lived outside loop/ dir as ~/.shared/roll/mute.
  [ "$_LOOP_MUTE_FILE" != "${HOME}/.shared/roll/mute" ]
  [[ "$_LOOP_MUTE_FILE" =~ /mute-.+$ ]]
}

# ── distinct projects must not collide ────────────────────────────────────────

@test "two project paths produce distinct slugs (no path collision)" {
  local s1 s2
  s1=$(_project_slug "/tmp/foo-roll-fix052-a")
  s2=$(_project_slug "/tmp/foo-roll-fix052-b")
  [ -n "$s1" ] && [ -n "$s2" ]
  [ "$s1" != "$s2" ]
}

# ── defaults sit under the shared loop directory (no leaking elsewhere) ──────

@test "all three default paths live under \${_SHARED_ROOT}/loop/" {
  [[ "$_LOOP_ALERT" == "${_SHARED_ROOT}/loop/"* ]]
  [[ "$_LOOP_STATE" == "${_SHARED_ROOT}/loop/"* ]]
  [[ "$_LOOP_MUTE_FILE" == "${_SHARED_ROOT}/loop/"* ]]
}

# ── generated runner scripts embed per-project state paths ────────────────────

@test "_write_loop_runner_script: outer script's STATE_FILE includes slug suffix" {
  local out_dir="${TEST_TMP}/loop"
  mkdir -p "$out_dir"
  local script_path="${out_dir}/run-projx-abc123.sh"
  _write_loop_runner_script "$script_path" "/tmp/projx-fix052" "echo hi" "/tmp/log" 0 24
  [ -f "$script_path" ]
  # Per-project STATE_FILE; legacy global state.yaml must not appear.
  grep -qE 'STATE_FILE="[^"]+/state-[^"]+\.yaml"' "$script_path"
  ! grep -q 'STATE_FILE=".*/state\.yaml"' "$script_path"
}

@test "_write_loop_runner_script: outer script's heal _alert_file includes slug suffix" {
  local out_dir="${TEST_TMP}/loop"
  mkdir -p "$out_dir"
  local script_path="${out_dir}/run-projy-def456.sh"
  _write_loop_runner_script "$script_path" "/tmp/projy-fix052" "echo hi" "/tmp/log" 0 24
  [ -f "$script_path" ]
  # _alert_file used by FIX-037 auto-heal must target ALERT-<slug>.md, not the
  # legacy global ALERT.md. Path contains nested quotes from $(dirname "$0"),
  # so just check the suffix shape.
  grep -qE '_alert_file=".*/ALERT-[^"]+\.md"' "$script_path"
  ! grep -qE '_alert_file=".*/ALERT\.md"' "$script_path"
}

# ── no remaining legacy hardcoded shared paths in bin/roll ────────────────────

@test "bin/roll: no legacy hardcoded shared ALERT.md path remains" {
  # Any literal "/.shared/roll/loop/ALERT.md" (no slug) would re-introduce
  # cross-project bleed. Acceptable patterns must include the slug suffix.
  ! grep -nE '/\.shared/roll/loop/ALERT\.md' "$ROLL_BIN"
}

@test "bin/roll: no legacy hardcoded shared state.yaml path remains" {
  ! grep -nE '/\.shared/roll/loop/state\.yaml' "$ROLL_BIN"
}

@test "bin/roll: no legacy hardcoded shared mute path remains" {
  # Old default lived at ~/.shared/roll/mute (outside loop/). New default is
  # ~/.shared/roll/loop/mute-<slug>.
  ! grep -nE '/\.shared/roll/mute"' "$ROLL_BIN"
}

@test "bin/roll: no shared cron.log path (each project gets its own cron-<slug>.log)" {
  # Multiple projects writing to the same cron.log interleaves their cycle
  # output. Per-project log keeps each project's record clean and aligns with
  # the "no cross-project loop state" rule.
  ! grep -nE '/cron\.log' "$ROLL_BIN"
}
