#!/usr/bin/env bats
# US-LOOP-035: roll config dream-time — compact facade that translates `03:20`
# into the low-level loop_dream_hour + loop_dream_minute keys. The dream keys
# are global-scoped, so writes land in the isolated temp global file, not
# .roll/local.yaml. (FIX-195: the parallel brief-time facade was retired.)
#
# Each test sources bin/roll (defines functions without running main), points
# ROLL_CONFIG at an isolated temp global file, and cds into a throwaway project
# dir so no write touches the real checkout.

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

@test "dream-time: 03:20 writes both dream_hour and dream_minute" {
  run cmd_config dream-time 03:20
  [ "$status" -eq 0 ]
  [[ "$output" == *"set dream-time = 03:20"* ]]
  run cmd_config loop_dream_hour
  [[ "$output" == *"loop_dream_hour = 3"* ]]
  run cmd_config loop_dream_minute
  [[ "$output" == *"loop_dream_minute = 20"* ]]
}

@test "dream-time: writes to the global file (~/.roll/config.yaml)" {
  run cmd_config dream-time 03:20
  [ "$status" -eq 0 ]
  grep -q '^loop_dream_hour: 3' "$ROLL_CONFIG"
  grep -q '^loop_dream_minute: 20' "$ROLL_CONFIG"
  # project local.yaml must NOT receive these keys
  [ ! -f .roll/local.yaml ] || ! grep -q 'loop_dream_hour' .roll/local.yaml
}

# FIX-195: brief-time / loop_brief_* were retired with the brief loop.
@test "FIX-195: brief-time is no longer a recognized config facade" {
  run cmd_config brief-time 09:15
  [ "$status" -ne 0 ]
  run cmd_config loop_brief_hour 9
  [ "$status" -ne 0 ]
}

@test "dream-time: hour > 23 is rejected with exit code 2 (bilingual)" {
  run cmd_config dream-time 24:00
  [ "$status" -eq 2 ]
  [[ "$output" == *"hour must be in [0,23]"* ]]
  [[ "$output" == *"小时必须在 [0,23]"* ]]
}

@test "dream-time: minute > 59 is rejected with exit code 2 (bilingual)" {
  run cmd_config dream-time 03:60
  [ "$status" -eq 2 ]
  [[ "$output" == *"minute must be in [0,59]"* ]]
  [[ "$output" == *"分钟必须在 [0,59]"* ]]
}

@test "dream-time: malformed value is rejected with exit code 2" {
  run cmd_config dream-time 0320
  [ "$status" -eq 2 ]
  [[ "$output" == *"<HH:MM>"* ]]
}

@test "dream-time: no value prints current effective time + source" {
  cmd_config dream-time 03:20
  run cmd_config dream-time
  [ "$status" -eq 0 ]
  [[ "$output" == *"dream-time: 03:20"* ]]
  [[ "$output" == *"from ${ROLL_CONFIG}"* ]]
}

@test "dream-time: no value with nothing set prints default hour" {
  run cmd_config dream-time
  [ "$status" -eq 0 ]
  [[ "$output" == *"dream-time: 03:00 (from default)"* ]]
}

@test "dream-time: leading-zero minute is not octal-misread" {
  run cmd_config dream-time 03:08
  [ "$status" -eq 0 ]
  run cmd_config loop_dream_minute
  [[ "$output" == *"loop_dream_minute = 8"* ]]
}
