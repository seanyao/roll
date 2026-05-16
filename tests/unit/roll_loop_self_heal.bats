#!/usr/bin/env bats
# US-AUTO-041: bounded CI self-heal counter for loop CI gate.
#
# When a just-shipped story turns CI red, the loop SKILL calls
# `_loop_self_heal_ci <story-id>` to decide whether another heal attempt is
# permitted. The function is the gate; the actual fix flow lives in SKILL.md.

load helpers

setup() {
  unit_setup_cd
  export ROLL_LOOP_DIR="${TEST_TMP}/loop"
  mkdir -p "$ROLL_LOOP_DIR"
}

teardown() {
  unset ROLL_LOOP_DIR ROLL_LOOP_NO_HEAL ROLL_LOOP_HEAL_MAX
  unit_teardown_cd
}

@test "_loop_self_heal_ci: first call allowed, counter bumped to 1" {
  run _loop_self_heal_ci US-AUTO-999
  [ "$status" -eq 0 ]
  [ "$(cat "$ROLL_LOOP_DIR/heal/US-AUTO-999.count")" = "1" ]
}

@test "_loop_self_heal_ci: second call allowed, counter bumped to 2" {
  echo 1 > "$ROLL_LOOP_DIR/heal/US-AUTO-999.count" || mkdir -p "$ROLL_LOOP_DIR/heal" && echo 1 > "$ROLL_LOOP_DIR/heal/US-AUTO-999.count"
  run _loop_self_heal_ci US-AUTO-999
  [ "$status" -eq 0 ]
  [ "$(cat "$ROLL_LOOP_DIR/heal/US-AUTO-999.count")" = "2" ]
}

@test "_loop_self_heal_ci: third call denied (>=ROLL_LOOP_HEAL_MAX), counter untouched" {
  mkdir -p "$ROLL_LOOP_DIR/heal"
  echo 2 > "$ROLL_LOOP_DIR/heal/US-AUTO-999.count"
  run _loop_self_heal_ci US-AUTO-999
  [ "$status" -eq 1 ]
  [ "$(cat "$ROLL_LOOP_DIR/heal/US-AUTO-999.count")" = "2" ]
}

@test "_loop_self_heal_ci: ROLL_LOOP_NO_HEAL=1 denies without incrementing" {
  export ROLL_LOOP_NO_HEAL=1
  run _loop_self_heal_ci US-AUTO-999
  [ "$status" -eq 1 ]
  [ ! -f "$ROLL_LOOP_DIR/heal/US-AUTO-999.count" ]
}

@test "_loop_clear_heal_state: removes counter file" {
  mkdir -p "$ROLL_LOOP_DIR/heal"
  echo 2 > "$ROLL_LOOP_DIR/heal/US-AUTO-999.count"
  run _loop_clear_heal_state US-AUTO-999
  [ "$status" -eq 0 ]
  [ ! -f "$ROLL_LOOP_DIR/heal/US-AUTO-999.count" ]
}

@test "_loop_clear_heal_state: idempotent when no counter exists" {
  run _loop_clear_heal_state US-AUTO-999
  [ "$status" -eq 0 ]
}

@test "_loop_self_heal_ci: ROLL_LOOP_HEAL_MAX=3 allows third attempt" {
  export ROLL_LOOP_HEAL_MAX=3
  mkdir -p "$ROLL_LOOP_DIR/heal"
  echo 2 > "$ROLL_LOOP_DIR/heal/US-AUTO-999.count"
  run _loop_self_heal_ci US-AUTO-999
  [ "$status" -eq 0 ]
  [ "$(cat "$ROLL_LOOP_DIR/heal/US-AUTO-999.count")" = "3" ]
}
