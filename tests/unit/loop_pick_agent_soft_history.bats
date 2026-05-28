#!/usr/bin/env bats
# US-AGENT-005: history-driven soft preference on top of hard rules.

ROLL="${BATS_TEST_DIRNAME}/../../bin/roll"
LIB="${BATS_TEST_DIRNAME}/../../lib/loop_pick_agent.py"

setup() {
  TEST_TMP=$(mktemp -d)
  cd "$TEST_TMP"
  mkdir -p .roll/features/test
  cat > .roll/agent-routes.yaml <<'YAML'
schema: v1
agents:
  pi:
    types: [FIX, US]
    est_min: { min: 0, max: 15 }
    risk: [low, medium]
  deepseek:
    types: [FIX, US]
    est_min: { min: 0, max: 15 }
    risk: [low, medium]
history:
  window_cycles: 50
  prefer_threshold: 0.6
  cold_start_default: pi
YAML
  cat > .roll/backlog.md <<'MD'
| [US-TEST-100](.roll/features/test/t.md#us-test-100) | story | 📋 Todo |
MD
  cat > .roll/features/test/t.md <<'MD'
<a id="us-test-100"></a>
## US-TEST-100 test story

**Agent profile:**
- est_min: 8
- risk_zone: low
- chain_depth: 0
MD
}

teardown() { cd /; rm -rf "$TEST_TMP"; }

# Build a runs.jsonl with N records pairing agent×type×outcome.
# Args: agent type built_count total_count
mk_history() {
  local agent="$1" stype="$2" built="$3" total="$4"
  local out=".roll/runs.jsonl"
  : > "$out"
  local i
  for ((i = 0; i < total; i++)); do
    local status="built"; (( i >= built )) && status="idle"
    local story_id="${stype}-OLD-${i}"
    echo "{\"run_id\":\"r$i\",\"agent\":\"$agent\",\"story_type\":\"$stype\",\"status\":\"$status\",\"built\":[\"$story_id\"]}" >> "$out"
  done
}

@test "soft pref: both match hard, deepseek 8/10 hits → deepseek wins" {
  # Pre-populate history: pi 2/10 (20%), deepseek 8/10 (80%); threshold 60%
  : > .roll/runs.jsonl
  for i in 1 2; do echo "{\"run_id\":\"p$i\",\"agent\":\"pi\",\"story_type\":\"US\",\"status\":\"built\",\"built\":[\"x$i\"]}" >> .roll/runs.jsonl; done
  for i in 1 2 3 4 5 6 7 8; do echo "{\"run_id\":\"pf$i\",\"agent\":\"pi\",\"story_type\":\"US\",\"status\":\"idle\",\"built\":[]}" >> .roll/runs.jsonl; done
  for i in 1 2 3 4 5 6 7 8; do echo "{\"run_id\":\"d$i\",\"agent\":\"deepseek\",\"story_type\":\"US\",\"status\":\"built\",\"built\":[\"y$i\"]}" >> .roll/runs.jsonl; done
  for i in 1 2; do echo "{\"run_id\":\"df$i\",\"agent\":\"deepseek\",\"story_type\":\"US\",\"status\":\"idle\",\"built\":[]}" >> .roll/runs.jsonl; done

  run python3 "$LIB" --story-id US-TEST-100 --backlog .roll/backlog.md --routes .roll/agent-routes.yaml --runs .roll/runs.jsonl
  [ "$status" -eq 0 ]
  [[ "$output" == *"deepseek"* ]]
  [[ "$output" == *"soft"* ]]
}

@test "soft pref: sample size < 5 → falls back to hard order (pi first declared)" {
  : > .roll/runs.jsonl
  echo "{\"run_id\":\"d1\",\"agent\":\"deepseek\",\"story_type\":\"US\",\"status\":\"built\",\"built\":[\"x\"]}" >> .roll/runs.jsonl
  echo "{\"run_id\":\"d2\",\"agent\":\"deepseek\",\"story_type\":\"US\",\"status\":\"built\",\"built\":[\"y\"]}" >> .roll/runs.jsonl

  run python3 "$LIB" --story-id US-TEST-100 --backlog .roll/backlog.md --routes .roll/agent-routes.yaml --runs .roll/runs.jsonl
  [ "$status" -eq 0 ]
  # Hard rule first-declared wins → pi
  [[ "$output" == *"pi"* ]]
  [[ "$output" == *"hard"* ]]
}

@test "soft pref: neither hits threshold → hard order" {
  : > .roll/runs.jsonl
  # pi 2/10 = 20%, deepseek 2/10 = 20% — neither ≥ 60%
  mk_history pi US 2 10
  for i in 1 2 3 4 5 6 7 8 9 10; do
    local s="built"; (( i > 2 )) && s="idle"
    echo "{\"run_id\":\"d$i\",\"agent\":\"deepseek\",\"story_type\":\"US\",\"status\":\"$s\",\"built\":[]}" >> .roll/runs.jsonl
  done

  run python3 "$LIB" --story-id US-TEST-100 --backlog .roll/backlog.md --routes .roll/agent-routes.yaml --runs .roll/runs.jsonl
  [ "$status" -eq 0 ]
  [[ "$output" == *"pi"* ]]
}

@test "soft pref: no --runs arg → hard order (no history) " {
  run python3 "$LIB" --story-id US-TEST-100 --backlog .roll/backlog.md --routes .roll/agent-routes.yaml
  [ "$status" -eq 0 ]
  [[ "$output" == *"pi"* ]]
  [[ "$output" == *"hard"* ]]
}

@test "soft pref: window_cycles=0 disables history (uses hard order)" {
  : > .roll/runs.jsonl
  # 10 deepseek hits, but window_cycles overridden to 0 should skip history
  sed -i.bak 's/window_cycles: 50/window_cycles: 0/' .roll/agent-routes.yaml && rm -f .roll/agent-routes.yaml.bak
  for i in $(seq 1 10); do echo "{\"run_id\":\"d$i\",\"agent\":\"deepseek\",\"story_type\":\"US\",\"status\":\"built\",\"built\":[\"x\"]}" >> .roll/runs.jsonl; done

  run python3 "$LIB" --story-id US-TEST-100 --backlog .roll/backlog.md --routes .roll/agent-routes.yaml --runs .roll/runs.jsonl
  [ "$status" -eq 0 ]
  [[ "$output" == *"pi"* ]]
  [[ "$output" == *"hard"* ]]
}
