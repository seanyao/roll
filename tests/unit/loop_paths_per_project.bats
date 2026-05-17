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
