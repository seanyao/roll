#!/usr/bin/env bats
# US-AGENT-003: roll init seeds .roll/agent-routes.yaml from a template.
# Three templates ship with the package: default / minimal / heavy.

ROLL="${BATS_TEST_DIRNAME}/../../bin/roll"
TPL_DIR="${BATS_TEST_DIRNAME}/../../templates/agent-routes"

setup() {
  TEST_TMP=$(mktemp -d)
  cd "$TEST_TMP"
}

teardown() {
  cd /
  rm -rf "$TEST_TMP"
}

@test "templates: default.yaml ships in repo" {
  [ -f "$TPL_DIR/default.yaml" ]
}

@test "templates: minimal.yaml ships in repo" {
  [ -f "$TPL_DIR/minimal.yaml" ]
}

@test "templates: heavy.yaml ships in repo" {
  [ -f "$TPL_DIR/heavy.yaml" ]
}

@test "templates: minimal.yaml is valid schema v1" {
  run python3 "${BATS_TEST_DIRNAME}/../../lib/agent_routes_lint.py" "$TPL_DIR/minimal.yaml"
  [ "$status" -eq 0 ]
}

@test "templates: heavy.yaml is valid schema v1" {
  run python3 "${BATS_TEST_DIRNAME}/../../lib/agent_routes_lint.py" "$TPL_DIR/heavy.yaml"
  [ "$status" -eq 0 ]
}

@test "templates: minimal lists fewer agents than default" {
  local min_count def_count
  min_count=$(grep -cE "^  [a-z]+:$" "$TPL_DIR/minimal.yaml")
  def_count=$(grep -cE "^  [a-z]+:$" "$TPL_DIR/default.yaml")
  [ "$min_count" -lt "$def_count" ] || [ "$min_count" -le 1 ]
}

@test "templates: heavy lists at least as many agents as default" {
  local heavy_count def_count
  heavy_count=$(grep -cE "^  [a-z]+:$" "$TPL_DIR/heavy.yaml")
  def_count=$(grep -cE "^  [a-z]+:$" "$TPL_DIR/default.yaml")
  [ "$heavy_count" -ge "$def_count" ]
}

@test "init helper: _init_seed_agent_routes default copies default.yaml" {
  source "$ROLL"
  mkdir -p .roll
  ROLL_TEMPLATES="${BATS_TEST_DIRNAME}/../../templates" _init_seed_agent_routes "default"
  [ -f .roll/agent-routes.yaml ]
  diff -q "$TPL_DIR/default.yaml" .roll/agent-routes.yaml
}

@test "init helper: _init_seed_agent_routes minimal copies minimal.yaml" {
  source "$ROLL"
  mkdir -p .roll
  ROLL_TEMPLATES="${BATS_TEST_DIRNAME}/../../templates" _init_seed_agent_routes "minimal"
  [ -f .roll/agent-routes.yaml ]
  diff -q "$TPL_DIR/minimal.yaml" .roll/agent-routes.yaml
}

@test "init helper: _init_seed_agent_routes invalid template rejected" {
  source "$ROLL"
  mkdir -p .roll
  run env ROLL_TEMPLATES="${BATS_TEST_DIRNAME}/../../templates" bash -c "
    source '$ROLL'
    _init_seed_agent_routes nonexistent
  "
  [ "$status" -ne 0 ]
  [[ "$output" == *"nonexistent"* ]] || [[ "$output" == *"template"* ]]
}

@test "init helper: _init_seed_agent_routes idempotent — does not overwrite existing" {
  source "$ROLL"
  mkdir -p .roll
  echo "# my custom config" > .roll/agent-routes.yaml
  ROLL_TEMPLATES="${BATS_TEST_DIRNAME}/../../templates" _init_seed_agent_routes "default"
  # Existing file preserved
  grep -q "my custom config" .roll/agent-routes.yaml
}
