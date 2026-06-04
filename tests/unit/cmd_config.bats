#!/usr/bin/env bats
# US-LOOP-033: roll config — unified read / list / set for loop schedule keys.
#
# Each test sources bin/roll (defines functions without running main), points
# ROLL_CONFIG at an isolated temp global file, and cds into a throwaway project
# dir so .roll/local.yaml writes never touch the real checkout.

setup() {
  local _saved_trap; _saved_trap="$(trap -p DEBUG 2>/dev/null || true)"
  trap - DEBUG
  source "${BATS_TEST_DIRNAME}/../../bin/roll"
  [[ -n "$_saved_trap" ]] && eval "$_saved_trap"

  TESTDIR="$(mktemp -d)"
  export ROLL_CONFIG="${TESTDIR}/global.yaml"
  printf 'editor: vim\nloop_dream_hour: 3\n' > "$ROLL_CONFIG"
  PROJ="${TESTDIR}/project"
  mkdir -p "${PROJ}/.roll"
  cd "$PROJ"
}

teardown() {
  cd /
  rm -rf "$TESTDIR"
}

@test "config: reading a missing key returns its default and 'default' source" {
  run cmd_config loop_active_start
  [ "$status" -eq 0 ]
  [ "$output" = "loop_active_start = 0  (from default)" ]
}

@test "config: reading an existing global key reports the global file as source" {
  run cmd_config loop_dream_hour
  [ "$status" -eq 0 ]
  [[ "$output" == *"loop_dream_hour = 3"* ]]
  [[ "$output" == *"global.yaml"* ]]
}

@test "config: --list shows every key with value + source" {
  run cmd_config --list
  [ "$status" -eq 0 ]
  [[ "$output" == *"loop_active_start"* ]]
  [[ "$output" == *"loop_schedule.period_minutes"* ]]
  # FIX-195: brief retired — loop_dream_minute is the daily-schedule key now.
  [[ "$output" == *"loop_dream_minute"* ]]
  [[ "$output" == *"(default)"* ]]
}

@test "config: writing a new project key creates .roll/local.yaml and reads back" {
  run cmd_config loop_active_start 9
  [ "$status" -eq 0 ]
  [[ "$output" == *"set loop_active_start = 9 in .roll/local.yaml"* ]]
  run cmd_config loop_active_start
  [ "$status" -eq 0 ]
  [[ "$output" == *"loop_active_start = 9"* ]]
  [[ "$output" == *".roll/local.yaml"* ]]
}

@test "config: writing an existing key replaces it in place (idempotent)" {
  cmd_config loop_active_end 18 >/dev/null
  cmd_config loop_active_end 20 >/dev/null
  # Exactly one occurrence — the old value was replaced, not appended.
  run grep -c 'active_end:' .roll/local.yaml
  [ "$output" = "1" ]
  run cmd_config loop_active_end
  [[ "$output" == *"loop_active_end = 20"* ]]
}

@test "config: nested key writes under the loop_schedule block" {
  cmd_config loop_schedule.period_minutes 30 >/dev/null
  run cat .roll/local.yaml
  [[ "$output" == *"loop_schedule:"* ]]
  [[ "$output" == *"period_minutes: 30"* ]]
  run cmd_config loop_schedule.period_minutes
  [[ "$output" == *"loop_schedule.period_minutes = 30"* ]]
}

@test "config: two nested keys share one loop_schedule block" {
  cmd_config loop_schedule.period_minutes 30 >/dev/null
  cmd_config loop_schedule.offset_minute 7 >/dev/null
  run grep -c '^loop_schedule:' .roll/local.yaml
  [ "$output" = "1" ]
  run cmd_config loop_schedule.offset_minute
  [[ "$output" == *"loop_schedule.offset_minute = 7"* ]]
}

@test "config: --global writes the global file, not the project file" {
  # FIX-195: loop_brief_hour retired — exercise the global write path with the
  # surviving global-scoped daily key loop_dream_hour.
  run cmd_config loop_dream_hour 8 --global
  [ "$status" -eq 0 ]
  [[ "$output" == *"global.yaml"* ]]
  run grep -c '^loop_dream_hour:' "$ROLL_CONFIG"
  [ "$output" = "1" ]
  [ ! -f .roll/local.yaml ]
}

@test "config: non-numeric value is rejected with exit code 2" {
  run cmd_config loop_active_start abc
  [ "$status" -eq 2 ]
  [[ "$output" == *"expects an integer"* ]]
  [[ "$output" == *"需要整数"* ]]
}

@test "config: out-of-range value is rejected with exit code 2" {
  run cmd_config loop_active_start 30
  [ "$status" -eq 2 ]
  [[ "$output" == *"must be <= 23"* ]]
  [[ "$output" == *"必须 <= 23"* ]]
}

@test "config: unknown key is rejected with exit code 2" {
  run cmd_config not_a_real_key 5
  [ "$status" -eq 2 ]
  [[ "$output" == *"unknown key"* ]]
}

@test "config: --help lists supported keys and ranges" {
  run cmd_config --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"loop_schedule.period_minutes"* ]]
  [[ "$output" == *"1-1440"* ]]
  [[ "$output" == *"--global"* ]]
}

@test "config: a flat set preserves other lines and comments" {
  printf '# header\neditor: vim\nloop_dream_hour: 3  # note\nfoo: bar\n' > "$ROLL_CONFIG"
  cmd_config loop_dream_hour 5 --global >/dev/null
  run cat "$ROLL_CONFIG"
  [[ "$output" == *"# header"* ]]
  [[ "$output" == *"editor: vim"* ]]
  [[ "$output" == *"foo: bar"* ]]
  [[ "$output" == *"loop_dream_hour: 5"* ]]
}
