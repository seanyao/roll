#!/usr/bin/env bats
# US-LOOP-034: roll config loop-window / loop-schedule — compact facades that
# translate `9-18` and `30/7` into the low-level loop schedule keys.
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
  printf 'editor: vim\n' > "$ROLL_CONFIG"
  PROJ="${TESTDIR}/project"
  mkdir -p "${PROJ}/.roll"
  cd "$PROJ"
}

teardown() {
  cd /
  rm -rf "$TESTDIR"
}

@test "loop-window: 9-18 writes both active_start and active_end" {
  run cmd_config loop-window 9-18
  [ "$status" -eq 0 ]
  [[ "$output" == *"set loop-window = 9-18"* ]]
  run cmd_config loop_active_start
  [[ "$output" == *"loop_active_start = 9"* ]]
  run cmd_config loop_active_end
  [[ "$output" == *"loop_active_end = 18"* ]]
}

@test "loop-window: end > 24 is rejected with exit code 2 (bilingual)" {
  run cmd_config loop-window 9-25
  [ "$status" -eq 2 ]
  [[ "$output" == *"end must be <= 24"* ]]
  [[ "$output" == *"结束时间必须 ≤ 24"* ]]
}

@test "loop-window: start >= end is rejected with exit code 2" {
  run cmd_config loop-window 18-9
  [ "$status" -eq 2 ]
  [[ "$output" == *"start must be < end"* ]]
}

@test "loop-window: malformed value is rejected with exit code 2" {
  run cmd_config loop-window abc
  [ "$status" -eq 2 ]
  [[ "$output" == *"<start>-<end>"* ]]
}

@test "loop-window: no value prints current effective window + source" {
  run cmd_config loop-window
  [ "$status" -eq 0 ]
  [[ "$output" == *"loop-window: 0-24 (from default)"* ]]
  cmd_config loop-window 8-20 >/dev/null
  run cmd_config loop-window
  [[ "$output" == *"loop-window: 8-20"* ]]
  [[ "$output" == *"local.yaml"* ]]
}

@test "loop-window: prints fallback apply hint" {
  run cmd_config loop-window 9-18
  [[ "$output" == *"roll loop on"* ]]
}

@test "loop-schedule: 30 sets period_minutes=30 and offset=0 default" {
  run cmd_config loop-schedule 30
  [ "$status" -eq 0 ]
  [[ "$output" == *"set loop-schedule = 30"* ]]
  run cmd_config loop_schedule.period_minutes
  [[ "$output" == *"loop_schedule.period_minutes = 30"* ]]
}

@test "loop-schedule: 30/7 sets both period and offset" {
  run cmd_config loop-schedule 30/7
  [ "$status" -eq 0 ]
  [[ "$output" == *"set loop-schedule = 30/7"* ]]
  run cmd_config loop_schedule.period_minutes
  [[ "$output" == *"period_minutes = 30"* ]]
  run cmd_config loop_schedule.offset_minute
  [[ "$output" == *"offset_minute = 7"* ]]
}

@test "loop-schedule: offset omitted does NOT write an offset line" {
  cmd_config loop-schedule 45 >/dev/null
  run grep -c 'offset_minute' .roll/local.yaml
  [ "$output" = "0" ]
}

@test "loop-schedule: both nested keys share one loop_schedule block" {
  cmd_config loop-schedule 30/7 >/dev/null
  run grep -c '^loop_schedule:' .roll/local.yaml
  [ "$output" = "1" ]
}

@test "loop-schedule: period out of range is rejected with exit code 2" {
  run cmd_config loop-schedule 0
  [ "$status" -eq 2 ]
  [[ "$output" == *"period must be in [1,1440]"* ]]
}

@test "loop-schedule: offset >= period is rejected with exit code 2" {
  run cmd_config loop-schedule 30/30
  [ "$status" -eq 2 ]
  [[ "$output" == *"offset must be in [0, period-1]"* ]]
}

@test "loop-schedule: malformed value is rejected with exit code 2" {
  run cmd_config loop-schedule 30/7/9
  [ "$status" -eq 2 ]
  [[ "$output" == *"<period>[/<offset>]"* ]]
}

@test "loop-schedule: no value prints current effective schedule + source" {
  cmd_config loop-schedule 30/7 >/dev/null
  run cmd_config loop-schedule
  [ "$status" -eq 0 ]
  [[ "$output" == *"every 30min"* ]]
  [[ "$output" == *":7"* ]]
}
