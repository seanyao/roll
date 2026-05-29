#!/usr/bin/env bats
# US-AGENT-025: `roll agent` (no-arg) four-slot complexity-routing view.
# Asserts the view prints slot/agent/status/note for all four slots, surfaces
# the fallback slot's idle-vs-active state, renders recent runs.jsonl
# degradation traces, and guides the user when no config exists.

ROLL="${BATS_TEST_DIRNAME}/../../bin/roll"

setup() {
  TEST_TMP=$(mktemp -d)
  cd "$TEST_TMP"
  mkdir -p .roll/cache
  export ROLL_LANG=en
  # Deterministic availability: claude online, everything else offline.
  cat > probe.sh <<'SH'
#!/usr/bin/env bash
[ "$1" = "claude" ]
SH
  chmod +x probe.sh
  export ROLL_AGENT_PROBE_HOOK="$TEST_TMP/probe.sh"
  export ROLL_AGENT_CACHE_DIR="$TEST_TMP/.roll/cache/aa"
  export ROLL_AGENTS_CONFIG="$TEST_TMP/.roll/agents.yaml"
  export ROLL_AGENT_RUNS_FILE="$TEST_TMP/runs.jsonl"
}

teardown() {
  cd /
  unset ROLL_LANG ROLL_AGENT_PROBE_HOOK ROLL_AGENT_CACHE_DIR \
        ROLL_AGENTS_CONFIG ROLL_AGENT_RUNS_FILE
  rm -rf "$TEST_TMP"
}

write_config() {
  cat > "$ROLL_AGENTS_CONFIG" <<'YAML'
schema: v3
easy:     { agent: kimi }
default:  { agent: claude }
hard:     { agent: claude }
fallback: { agent: pi }
YAML
}

@test "no config: guides the user to set up or migrate" {
  rm -f "$ROLL_AGENTS_CONFIG"
  export ROLL_AGENTS_CONFIG="$TEST_TMP/.roll/does-not-exist.yaml"
  run "$ROLL" agent
  [ "$status" -eq 0 ]
  [[ "$output" == *"No .roll/agents.yaml yet"* ]]
  [[ "$output" == *"roll agent set"* ]]
}

@test "view: lists all four slots with their configured agents" {
  write_config
  run "$ROLL" agent
  [ "$status" -eq 0 ]
  [[ "$output" == *"easy"* && "$output" == *"kimi"* ]]
  [[ "$output" == *"default"* && "$output" == *"claude"* ]]
  [[ "$output" == *"hard"* ]]
  [[ "$output" == *"fallback"* && "$output" == *"pi"* ]]
}

@test "view: marks online agents ✓ and offline agents ✗" {
  write_config
  run "$ROLL" agent
  [ "$status" -eq 0 ]
  # claude is online (probe hook), kimi/pi are offline.
  [[ "$output" == *"✓"* ]]
  [[ "$output" == *"✗"* ]]
}

@test "view: fallback slot shows idle when no recent degradation" {
  write_config
  rm -f "$ROLL_AGENT_RUNS_FILE"
  run "$ROLL" agent
  [ "$status" -eq 0 ]
  [[ "$output" == *"fallback"* && "$output" == *"idle"* ]]
}

@test "view: fallback slot shows active and prints degradation trace" {
  write_config
  cat > "$ROLL_AGENT_RUNS_FILE" <<'JSONL'
{"cycle_id":"c1","agent":"claude","tier":"hard","fallback_from":""}
{"cycle_id":"c2","agent":"agy","tier":"hard","fallback_from":"claude"}
JSONL
  run "$ROLL" agent
  [ "$status" -eq 0 ]
  [[ "$output" == *"active"* ]]
  [[ "$output" == *"Recent downgrades"* ]]
  # "hard slot claude → ran agy"
  [[ "$output" == *"hard"* && "$output" == *"claude"* && "$output" == *"agy"* ]]
}

@test "view: degradation traces are newest-first" {
  write_config
  cat > "$ROLL_AGENT_RUNS_FILE" <<'JSONL'
{"cycle_id":"c1","agent":"pi","tier":"easy","fallback_from":"kimi"}
{"cycle_id":"c2","agent":"agy","tier":"hard","fallback_from":"claude"}
JSONL
  run "$ROLL" agent
  [ "$status" -eq 0 ]
  # The hard/claude/agy (newest) line must appear before the easy/kimi/pi line.
  local hard_pos easy_pos
  hard_pos=$(printf '%s\n' "$output" | grep -n "hard slot claude" | head -1 | cut -d: -f1)
  easy_pos=$(printf '%s\n' "$output" | grep -n "easy slot kimi" | head -1 | cut -d: -f1)
  [ -n "$hard_pos" ]
  [ -n "$easy_pos" ]
  [ "$hard_pos" -lt "$easy_pos" ]
}
