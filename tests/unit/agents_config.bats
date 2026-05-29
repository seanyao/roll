#!/usr/bin/env bats
# US-AGENT-020: schema-v3 .roll/agents.yaml loader.
#
# `_agents_config_slot SLOT [PATH]` reads the agent name for a complexity
# slot (easy|default|hard|fallback). Covers: four-slot reads, missing-file /
# missing-slot fallback (empty + exit 1), unknown-agent WARN, and the
# bash-3.2 code path (no declare -A / mapfile / ${var^^}).

load helpers
setup() { unit_setup_cd; mkdir -p .roll; }
teardown() { unit_teardown; }

write_agents() {
  cat > .roll/agents.yaml
}

# ── four-slot reads ──────────────────────────────────────────────────────────

@test "US-AGENT-020 loader: reads each of the four slots (inline flow + nested)" {
  write_agents <<'YAML'
schema: v3
easy:     { agent: kimi }
default:  { agent: claude }
hard:
  agent: pi
fallback: { agent: codex }
YAML
  run _agents_config_slot easy
  [ "$status" -eq 0 ]
  [ "$output" = "kimi" ]

  run _agents_config_slot default
  [ "$status" -eq 0 ]
  [ "$output" = "claude" ]

  run _agents_config_slot hard
  [ "$status" -eq 0 ]
  [ "$output" = "pi" ]

  run _agents_config_slot fallback
  [ "$status" -eq 0 ]
  [ "$output" = "codex" ]
}

@test "US-AGENT-020 loader: tolerates quotes and trailing inline comment" {
  write_agents <<'YAML'
schema: v3
default: { agent: "claude" }   # the workhorse
YAML
  run _agents_config_slot default
  [ "$status" -eq 0 ]
  [ "$output" = "claude" ]
}

# ── missing-file / missing-slot fallback ─────────────────────────────────────

@test "US-AGENT-020 loader: missing file → empty output, exit 1" {
  rm -f .roll/agents.yaml
  run _agents_config_slot easy
  [ "$status" -eq 1 ]
  [ -z "$output" ]
}

@test "US-AGENT-020 loader: slot absent from file → empty output, exit 1" {
  write_agents <<'YAML'
schema: v3
default: { agent: claude }
YAML
  run _agents_config_slot hard
  [ "$status" -eq 1 ]
  [ -z "$output" ]
}

@test "US-AGENT-020 loader: present slot with empty agent value → exit 1" {
  write_agents <<'YAML'
schema: v3
easy: { agent: }
YAML
  run _agents_config_slot easy
  [ "$status" -eq 1 ]
}

# ── unknown-agent WARN ───────────────────────────────────────────────────────

@test "US-AGENT-020 loader: unknown agent name → WARN on stderr, still prints value" {
  write_agents <<'YAML'
schema: v3
hard: { agent: notanagent }
YAML
  # stdout must stay clean (just the value); WARN goes to stderr.
  run bash -c "source '$ROLL_BIN'; _agents_config_slot hard 2>/dev/null"
  [ "$status" -eq 0 ]
  [ "$output" = "notanagent" ]

  run bash -c "source '$ROLL_BIN'; _agents_config_slot hard 2>&1 >/dev/null"
  [ "$status" -eq 0 ]
  [[ "$output" == *"unknown agent"* ]]
  [[ "$output" == *"notanagent"* ]]
}

@test "US-AGENT-020 loader: deepseek is not a routable agent → WARN (ghost model)" {
  write_agents <<'YAML'
schema: v3
default: { agent: deepseek }
YAML
  run bash -c "source '$ROLL_BIN'; _agents_config_slot default 2>&1 >/dev/null"
  [ "$status" -eq 0 ]
  [[ "$output" == *"unknown agent"* ]]
}

@test "US-AGENT-020 loader: known agent name → no WARN" {
  write_agents <<'YAML'
schema: v3
default: { agent: claude }
YAML
  run bash -c "source '$ROLL_BIN'; _agents_config_slot default 2>&1 >/dev/null"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# ── path resolution + explicit PATH arg ──────────────────────────────────────

@test "US-AGENT-020 loader: explicit path arg overrides project file" {
  write_agents <<'YAML'
schema: v3
default: { agent: claude }
YAML
  cat > "$TEST_TMP/other.yaml" <<'YAML'
schema: v3
default: { agent: pi }
YAML
  run _agents_config_slot default "$TEST_TMP/other.yaml"
  [ "$status" -eq 0 ]
  [ "$output" = "pi" ]
}

@test "US-AGENT-020 loader: ROLL_AGENTS_CONFIG env wins over .roll/agents.yaml" {
  write_agents <<'YAML'
schema: v3
default: { agent: claude }
YAML
  cat > "$TEST_TMP/env.yaml" <<'YAML'
schema: v3
default: { agent: kimi }
YAML
  ROLL_AGENTS_CONFIG="$TEST_TMP/env.yaml" run _agents_config_slot default
  [ "$status" -eq 0 ]
  [ "$output" = "kimi" ]
}

# ── _agent_is_known predicate ────────────────────────────────────────────────

@test "US-AGENT-020 _agent_is_known: known PATH agents accepted" {
  for a in claude kimi pi codex openai qwen; do
    run _agent_is_known "$a"
    [ "$status" -eq 0 ]
  done
}

@test "US-AGENT-020 _agent_is_known: agy aliases (antigravity/gemini) accepted" {
  run _agent_is_known antigravity
  [ "$status" -eq 0 ]
  run _agent_is_known gemini
  [ "$status" -eq 0 ]
}

@test "US-AGENT-020 _agent_is_known: deepseek rejected (ghost model, not a route)" {
  run _agent_is_known deepseek
  [ "$status" -eq 1 ]
}

@test "US-AGENT-020 _agent_is_known: typo rejected" {
  run _agent_is_known notanagent
  [ "$status" -eq 1 ]
}

# ── token-boundary matching (peer-review hardening) ──────────────────────────

@test "US-AGENT-020 loader: a sibling key named *_agent does not false-match" {
  write_agents <<'YAML'
schema: v3
default:
  sub_agent: nonsense
  agent: claude
YAML
  run _agents_config_slot default
  [ "$status" -eq 0 ]
  [ "$output" = "claude" ]
}

@test "US-AGENT-020 loader: 'no_agent: true' is not read as the agent value" {
  write_agents <<'YAML'
schema: v3
default:
  no_agent: true
YAML
  run _agents_config_slot default
  [ "$status" -eq 1 ]
}

@test "US-AGENT-020 loader: slot name 'easy' does not match 'easy_mode'" {
  write_agents <<'YAML'
schema: v3
easy_mode: { agent: pi }
default:   { agent: claude }
YAML
  # No real `easy:` slot present → fallback (empty, exit 1).
  run _agents_config_slot easy
  [ "$status" -eq 1 ]
}

@test "US-AGENT-020 loader: CRLF line endings still parse" {
  printf 'schema: v3\r\neasy: { agent: kimi }\r\n' > .roll/agents.yaml
  run _agents_config_slot easy
  [ "$status" -eq 0 ]
  [ "$output" = "kimi" ]
}

# ── bash 3.2 path: file is parsed with no declare -A / mapfile / ${var^^} ─────

@test "US-AGENT-020 loader: source + slot read clean under explicit bash" {
  write_agents <<'YAML'
schema: v3
easy: { agent: kimi }
YAML
  # Re-source and read in a fresh bash to prove no interactive-only / array
  # features leak in. (CI runs bash >=4; this just guards the code path.)
  run bash -c "cd '$PWD'; source '$ROLL_BIN'; _agents_config_slot easy"
  [ "$status" -eq 0 ]
  [ "$output" = "kimi" ]
}
