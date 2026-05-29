#!/usr/bin/env bats
# US-AGENT-028: `roll loop agent-routes <show|lint|path>` is now a DEPRECATED
# alias of `roll agent`. The schema-v1 agent-routes.yaml (three-dimensional
# type/est/risk routing + history soft-preference) is retired; agents.yaml
# (schema v3, four complexity slots) replaces it. These tests assert the alias
# forwards + emits a deprecation notice, and that `lint` is a no-op.

setup() {
  TEST_TMP=$(mktemp -d)
  cd "$TEST_TMP"
  mkdir -p .roll
  export ROLL_LANG=en
}

teardown() {
  cd /
  rm -rf "$TEST_TMP"
}

ROLL="${BATS_TEST_DIRNAME}/../../bin/roll"

@test "agent-routes lint: deprecated no-op (schema v3 needs no lint)" {
  run "$ROLL" loop agent-routes lint
  [ "$status" -eq 0 ]
  [[ "$output" == *"deprecated"* ]]
  [[ "$output" == *"schema v3"* ]]
}

@test "agent-routes lint: no-op even with a stale v1 file present" {
  cat > .roll/agent-routes.yaml <<'YAML'
schema: v1
agents:
  pi:
    types: [FIX]
YAML
  run "$ROLL" loop agent-routes lint
  # v3 needs no lint — must not fail on a malformed legacy file.
  [ "$status" -eq 0 ]
  [[ "$output" == *"deprecated"* ]]
}

@test "agent-routes show: deprecated alias of 'roll agent'" {
  run "$ROLL" loop agent-routes show
  [ "$status" -eq 0 ]
  [[ "$output" == *"deprecated"* ]]
  [[ "$output" == *"roll agent"* ]]
}

@test "agent-routes path: deprecated alias; resolves agents.yaml when present" {
  printf 'schema: v3\ndefault: { agent: pi }\n' > .roll/agents.yaml
  run "$ROLL" loop agent-routes path
  [ "$status" -eq 0 ]
  [[ "$output" == *"deprecated"* ]]
  [[ "$output" == *".roll/agents.yaml"* ]]
}

@test "agent-routes: unknown subcommand prints deprecated usage and fails" {
  run "$ROLL" loop agent-routes bogus
  [ "$status" -ne 0 ]
  [[ "$output" == *"DEPRECATED"* ]]
}
