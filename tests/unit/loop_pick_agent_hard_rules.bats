#!/usr/bin/env bats
# US-AGENT-004: _loop_pick_agent_for_story hard-rule path.
#
# Reads story profile (est_min / risk_zone / chain_depth) from the linked
# feature md, matches against .roll/agent-routes.yaml hard rules, and prints
# the chosen agent on stdout. Falls back to history.cold_start_default when
# no agent matches.

ROLL="${BATS_TEST_DIRNAME}/../../bin/roll"
ROLL_HOME="${BATS_TEST_DIRNAME}/../.."

setup() {
  TEST_TMP=$(mktemp -d)
  cd "$TEST_TMP"
  mkdir -p .roll/features/test-epic
  cat > .roll/agent-routes.yaml <<'YAML'
schema: v1
agents:
  pi:
    types: [FIX]
    est_min: { min: 0, max: 5 }
    risk: [low]
  deepseek:
    types: [FIX, US, REFACTOR]
    est_min: { min: 0, max: 15 }
    risk: [low, medium]
  claude:
    types: [US, REFACTOR]
    est_min: { min: 5, max: 30 }
    risk: [low, medium, high]
history:
  window_cycles: 50
  prefer_threshold: 0.6
  cold_start_default: pi
YAML
  cat > .roll/backlog.md <<'MD'
# Project Backlog

## Epic: Test
### Feature: test-feature
| Story | Description | Status |
|-------|-------------|--------|
| [US-TEST-001](.roll/features/test-epic/test-feature.md#us-test-001) | small fix | 📋 Todo |
| [US-TEST-002](.roll/features/test-epic/test-feature.md#us-test-002) | medium story | 📋 Todo |
| [US-TEST-003](.roll/features/test-epic/test-feature.md#us-test-003) | high-risk story | 📋 Todo |
| [FIX-TEST-001](.roll/features/test-epic/test-feature.md#fix-test-001) | tiny bug | 📋 Todo |
MD
  cat > .roll/features/test-epic/test-feature.md <<'MD'
# Feature: test-feature

<a id="us-test-001"></a>
## US-TEST-001 small fix story

**Agent profile:**
- est_min: 3
- risk_zone: low
- chain_depth: 0

<a id="us-test-002"></a>
## US-TEST-002 medium story

**Agent profile:**
- est_min: 12
- risk_zone: medium
- chain_depth: 0

<a id="us-test-003"></a>
## US-TEST-003 high risk story

**Agent profile:**
- est_min: 20
- risk_zone: high
- chain_depth: 0

<a id="fix-test-001"></a>
## FIX-TEST-001 tiny bug

**Agent profile:**
- est_min: 3
- risk_zone: low
- chain_depth: 0
MD
}

teardown() {
  cd /
  rm -rf "$TEST_TMP"
}

@test "pick_agent: FIX small low-risk → pi (first matching hard rule)" {
  # All three agents match types/est/risk for this story (FIX:3min:low),
  # so first declared wins → pi
  source "$ROLL"
  run _loop_pick_agent_for_story FIX-TEST-001
  [ "$status" -eq 0 ]
  [[ "$output" == *"pi"* ]]
}

@test "pick_agent: US medium-risk story → deepseek (pi rejects US, claude est too low for 12 inside range; both match → first declared)" {
  source "$ROLL"
  run _loop_pick_agent_for_story US-TEST-002
  [ "$status" -eq 0 ]
  # US 12min medium: pi rejects (no US), deepseek matches, claude matches; first = deepseek
  [[ "$output" == *"deepseek"* ]]
}

@test "pick_agent: US 20min high-risk → claude (only one matching)" {
  source "$ROLL"
  run _loop_pick_agent_for_story US-TEST-003
  [ "$status" -eq 0 ]
  [[ "$output" == *"claude"* ]]
}

@test "pick_agent: emits rule_kind=hard in output" {
  source "$ROLL"
  run _loop_pick_agent_for_story US-TEST-003
  [ "$status" -eq 0 ]
  [[ "$output" == *"hard"* ]]
}

@test "pick_agent: story without profile → cold_start_default + warn" {
  cat > .roll/features/test-epic/test-feature.md <<'MD'
<a id="us-test-orphan"></a>
## US-TEST-ORPHAN no agent profile here
MD
  cat > .roll/backlog.md <<'MD'
| [US-TEST-ORPHAN](.roll/features/test-epic/test-feature.md#us-test-orphan) | x | 📋 Todo |
MD
  source "$ROLL"
  run _loop_pick_agent_for_story US-TEST-ORPHAN
  # Falls back to cold_start_default (pi) even on missing profile
  [ "$status" -eq 0 ]
  [[ "$output" == *"pi"* ]]
}

@test "pick_agent: no matching agent → cold_start_default" {
  # Override routes to leave no agent matching FIX 3min low
  cat > .roll/agent-routes.yaml <<'YAML'
schema: v1
agents:
  claude:
    types: [US, REFACTOR]
    est_min: { min: 10, max: 30 }
    risk: [medium, high]
history:
  cold_start_default: claude
YAML
  source "$ROLL"
  run _loop_pick_agent_for_story FIX-TEST-001
  [ "$status" -eq 0 ]
  [[ "$output" == *"claude"* ]]
}

@test "pick_agent: missing story id → non-zero exit" {
  source "$ROLL"
  run _loop_pick_agent_for_story "US-DOES-NOT-EXIST"
  [ "$status" -ne 0 ]
}
