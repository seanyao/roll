#!/usr/bin/env bats
# Integration tests for `roll prices` (US-VIEW-013).

load helpers

setup() {
  integration_setup
  export NO_COLOR=1
  export TERM=dumb
}

teardown() {
  integration_teardown
}

@test "roll prices help: bilingual usage block" {
  run "$ROLL_BIN" prices --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"Usage: roll prices"* ]]
  [[ "$output" == *"价格快照"* ]]
}

@test "roll prices show: prints snapshot meta and table" {
  run "$ROLL_BIN" prices show
  [ "$status" -eq 0 ]
  [[ "$output" == *"price snapshot"* ]]
  [[ "$output" == *"version"* ]]
  [[ "$output" == *"claude-opus-4-7"* ]]
  [[ "$output" == *"claude-sonnet-4-6"* ]]
  [[ "$output" == *"claude-haiku-4-5"* ]]
}

@test "roll prices refresh: graceful failure on unreachable URL" {
  run "$ROLL_BIN" prices refresh --url http://127.0.0.1:1/nope
  # exit code 2 = FetchError; user sees a message and existing snapshot is preserved.
  [ "$status" -eq 2 ]
  [[ "$output" == *"fetch failed"* ]]
  [[ "$output" == *"keeping existing snapshot"* ]]
}

@test "roll prices: unknown subcommand prints help and fails" {
  run "$ROLL_BIN" prices bogus
  [ "$status" -ne 0 ]
  [[ "$output" == *"Unknown subcommand"* ]]
  [[ "$output" == *"Usage: roll prices"* ]]
}
