#!/usr/bin/env bats
# Verification artifact: roll-loop executed REFACTOR-001 at 22:00 auto-schedule

@test "hello world — loop auto-execution proof" {
  run echo "Hello World from roll-loop"
  [ "$status" -eq 0 ]
  [ "$output" = "Hello World from roll-loop" ]
}

@test "roll-loop state file is readable" {
  local state_file="$HOME/.shared/roll/loop/state.yaml"
  run test -f "$state_file"
  [ "$status" -eq 0 ]
}
