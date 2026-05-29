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

# US-AGENT-028: templates are now schema v3 (four complexity slots), not v1.
@test "templates: all three are schema v3 with the four complexity slots" {
  local tpl
  for tpl in default minimal heavy; do
    run grep -q "^schema: v3" "$TPL_DIR/${tpl}.yaml"
    [ "$status" -eq 0 ]
    local slot
    for slot in easy default hard fallback; do
      run grep -qE "^${slot}:" "$TPL_DIR/${tpl}.yaml"
      [ "$status" -eq 0 ]
    done
  done
}

# US-AGENT-028 AC: minimal = all three complexity tiers on the same agent.
@test "templates: minimal locks easy/default/hard to one agent" {
  source "$ROLL"
  local easy def hard
  easy=$(_agents_config_slot easy "$TPL_DIR/minimal.yaml")
  def=$(_agents_config_slot default "$TPL_DIR/minimal.yaml")
  hard=$(_agents_config_slot hard "$TPL_DIR/minimal.yaml")
  [ -n "$easy" ]
  [ "$easy" = "$def" ]
  [ "$def" = "$hard" ]
}

# default/heavy split the tiers: easy and hard need not be the same agent.
@test "templates: default splits easy vs hard tiers" {
  source "$ROLL"
  local easy hard
  easy=$(_agents_config_slot easy "$TPL_DIR/default.yaml")
  hard=$(_agents_config_slot hard "$TPL_DIR/default.yaml")
  [ -n "$easy" ]
  [ -n "$hard" ]
  [ "$easy" != "$hard" ]
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
