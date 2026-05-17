#!/usr/bin/env bats
# REFACTOR-023: CI self-heal counter consolidated into state.yaml.
# Counter was previously stored in separate heal/<story>.count files;
# if cleanup was missed after a successful heal the files accumulated.
# Now stored as `heal_count: N` in state.yaml — reset/replace clears it atomically.

load helpers

setup() {
  unit_setup_cd
  export ROLL_LOOP_DIR="${TEST_TMP}/loop"
  export _LOOP_STATE="${TEST_TMP}/loop/state.yaml"
  mkdir -p "$ROLL_LOOP_DIR"
}

teardown() {
  unset ROLL_LOOP_DIR _LOOP_STATE ROLL_LOOP_NO_HEAL ROLL_LOOP_HEAL_MAX
  unit_teardown_cd
}

@test "_loop_self_heal_ci: first call allowed, heal_count written to state.yaml" {
  run _loop_self_heal_ci US-AUTO-999
  [ "$status" -eq 0 ]
  [ "$(grep '^heal_count:' "$_LOOP_STATE" | awk '{print $2}')" = "1" ]
}

@test "_loop_self_heal_ci: no heal/ subdirectory created (old pattern gone)" {
  run _loop_self_heal_ci US-AUTO-999
  [ "$status" -eq 0 ]
  [ ! -d "$ROLL_LOOP_DIR/heal" ]
}

@test "_loop_self_heal_ci: second call allowed, heal_count bumped to 2" {
  printf 'status: running\nheal_count: 1\n' > "$_LOOP_STATE"
  run _loop_self_heal_ci US-AUTO-999
  [ "$status" -eq 0 ]
  [ "$(grep '^heal_count:' "$_LOOP_STATE" | awk '{print $2}')" = "2" ]
}

@test "_loop_self_heal_ci: third call denied (>=ROLL_LOOP_HEAL_MAX), heal_count untouched" {
  printf 'status: running\nheal_count: 2\n' > "$_LOOP_STATE"
  run _loop_self_heal_ci US-AUTO-999
  [ "$status" -eq 1 ]
  [ "$(grep '^heal_count:' "$_LOOP_STATE" | awk '{print $2}')" = "2" ]
}

@test "_loop_self_heal_ci: ROLL_LOOP_NO_HEAL=1 denies without touching state.yaml" {
  export ROLL_LOOP_NO_HEAL=1
  run _loop_self_heal_ci US-AUTO-999
  [ "$status" -eq 1 ]
  [ ! -f "$_LOOP_STATE" ]
}

@test "_loop_clear_heal_state: removes heal_count line from state.yaml" {
  printf 'status: running\ncurrent_item: US-AUTO-999\nheal_count: 2\n' > "$_LOOP_STATE"
  run _loop_clear_heal_state US-AUTO-999
  [ "$status" -eq 0 ]
  ! grep -q '^heal_count:' "$_LOOP_STATE"
}

@test "_loop_clear_heal_state: preserves other state.yaml fields" {
  printf 'status: running\ncurrent_item: US-AUTO-999\nheal_count: 2\n' > "$_LOOP_STATE"
  run _loop_clear_heal_state US-AUTO-999
  grep -q '^status: running' "$_LOOP_STATE"
  grep -q '^current_item: US-AUTO-999' "$_LOOP_STATE"
}

@test "_loop_clear_heal_state: idempotent when no heal_count in state.yaml" {
  printf 'status: idle\n' > "$_LOOP_STATE"
  run _loop_clear_heal_state US-AUTO-999
  [ "$status" -eq 0 ]
}

@test "_loop_clear_heal_state: idempotent when state.yaml absent" {
  run _loop_clear_heal_state US-AUTO-999
  [ "$status" -eq 0 ]
}

@test "_loop_reset: removing state.yaml automatically clears heal_count" {
  printf 'status: running\nheal_count: 2\n' > "$_LOOP_STATE"
  run _loop_reset
  [ "$status" -eq 0 ]
  [ ! -f "$_LOOP_STATE" ]
}

@test "_loop_self_heal_ci: ROLL_LOOP_HEAL_MAX=3 allows third attempt" {
  export ROLL_LOOP_HEAL_MAX=3
  printf 'status: running\nheal_count: 2\n' > "$_LOOP_STATE"
  run _loop_self_heal_ci US-AUTO-999
  [ "$status" -eq 0 ]
  [ "$(grep '^heal_count:' "$_LOOP_STATE" | awk '{print $2}')" = "3" ]
}

@test "replacing state.yaml automatically drops old heal_count (key benefit)" {
  printf 'status: running\nheal_count: 1\n' > "$_LOOP_STATE"
  # Simulate a new cycle overwriting state.yaml — heal_count is gone
  printf 'status: idle\n' > "$_LOOP_STATE"
  ! grep -q '^heal_count:' "$_LOOP_STATE"
}
