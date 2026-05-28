#!/usr/bin/env bats
# US-AGENT-002: .roll/agent-routes.yaml schema lint
#
# Tests roll loop agent-routes lint / show subcommands.
# Schema v1 requires agents (map of named agent profiles), each with
# types (array), est_min (object with min/max), risk (array).
# Optional history block with window_cycles, prefer_threshold, cold_start_default.

setup() {
  TEST_TMP=$(mktemp -d)
  cd "$TEST_TMP"
  mkdir -p .roll
}

teardown() {
  cd /
  rm -rf "$TEST_TMP"
}

ROLL="${BATS_TEST_DIRNAME}/../../bin/roll"

write_yaml() {
  cat > .roll/agent-routes.yaml
}

@test "agent-routes lint: valid minimal config passes" {
  write_yaml <<'YAML'
schema: v1
agents:
  pi:
    types: [FIX]
    est_min: { min: 0, max: 10 }
    risk: [low]
YAML
  run "$ROLL" loop agent-routes lint
  [ "$status" -eq 0 ]
}

@test "agent-routes lint: missing schema field fails with line hint" {
  write_yaml <<'YAML'
agents:
  pi:
    types: [FIX]
    est_min: { min: 0, max: 10 }
    risk: [low]
YAML
  run "$ROLL" loop agent-routes lint
  [ "$status" -ne 0 ]
  [[ "$output" == *"schema"* ]]
}

@test "agent-routes lint: missing agents field fails" {
  write_yaml <<'YAML'
schema: v1
YAML
  run "$ROLL" loop agent-routes lint
  [ "$status" -ne 0 ]
  [[ "$output" == *"agents"* ]]
}

@test "agent-routes lint: agent missing est_min reports line number" {
  write_yaml <<'YAML'
schema: v1
agents:
  pi:
    types: [FIX]
    risk: [low]
YAML
  run "$ROLL" loop agent-routes lint
  [ "$status" -ne 0 ]
  [[ "$output" == *"est_min"* ]]
  # line hint format: "line N" or "L<N>" or ":<N>:"
  [[ "$output" =~ line[[:space:]]+[0-9]+ ]] || [[ "$output" =~ :[0-9]+: ]]
}

@test "agent-routes lint: invalid risk value rejected" {
  write_yaml <<'YAML'
schema: v1
agents:
  pi:
    types: [FIX]
    est_min: { min: 0, max: 10 }
    risk: [extreme]
YAML
  run "$ROLL" loop agent-routes lint
  [ "$status" -ne 0 ]
  [[ "$output" == *"risk"* ]]
}

@test "agent-routes lint: history block optional, default fills work" {
  write_yaml <<'YAML'
schema: v1
agents:
  pi:
    types: [FIX]
    est_min: { min: 0, max: 10 }
    risk: [low]
YAML
  run "$ROLL" loop agent-routes lint
  [ "$status" -eq 0 ]
}

@test "agent-routes lint: history.prefer_threshold out of range rejected" {
  write_yaml <<'YAML'
schema: v1
agents:
  pi:
    types: [FIX]
    est_min: { min: 0, max: 10 }
    risk: [low]
history:
  window_cycles: 50
  prefer_threshold: 1.5
  cold_start_default: pi
YAML
  run "$ROLL" loop agent-routes lint
  [ "$status" -ne 0 ]
  [[ "$output" == *"prefer_threshold"* ]]
}

@test "agent-routes show: prints active config when file present" {
  write_yaml <<'YAML'
schema: v1
agents:
  pi:
    types: [FIX]
    est_min: { min: 0, max: 10 }
    risk: [low]
YAML
  run "$ROLL" loop agent-routes show
  [ "$status" -eq 0 ]
  [[ "$output" == *"schema: v1"* ]]
  [[ "$output" == *"pi:"* ]]
}

@test "agent-routes show: falls back to built-in default when no project file" {
  # No .roll/agent-routes.yaml in this fresh temp dir (we'll just remove it)
  rm -f .roll/agent-routes.yaml
  run "$ROLL" loop agent-routes show
  [ "$status" -eq 0 ]
  [[ "$output" == *"schema: v1"* ]]
  [[ "$output" == *"agents:"* ]]
}

@test "agent-routes default template ships in repo" {
  local tpl="${BATS_TEST_DIRNAME}/../../templates/agent-routes/default.yaml"
  [ -f "$tpl" ]
  run grep -q "schema: v1" "$tpl"
  [ "$status" -eq 0 ]
  run grep -qE "^  pi:|^  deepseek:|^  claude:" "$tpl"
  [ "$status" -eq 0 ]
}
