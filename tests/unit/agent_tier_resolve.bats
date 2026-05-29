#!/usr/bin/env bats
# US-AGENT-023: runtime tier→agent resolution (`_loop_pick_agent_for_story`).
#
# Chain under test: story est_min → complexity tier (lib/loop_pick_agent.py)
# → agents.yaml slot → agent. Output contract is "<agent> <tier> <rationale>"
# (field 1 = agent so the loop inner script's `awk '{print $1}'` reads the
# routed agent; field 2 = tier so it lands in runs.jsonl).
#
# Covers: easy/default/hard slot reads, empty-tier-slot → default fallback,
# default-slot empty → first-installed fallback, no estimate → default.

load helpers
setup() { unit_setup_cd; _seed_project; }
teardown() { unit_teardown_cd; }

# A backlog + feature md with stories spanning every tier boundary, plus an
# agents.yaml binding each slot to a distinct known agent.
_seed_project() {
  mkdir -p .roll/features/test-epic
  cat > .roll/backlog.md <<'MD'
# Project Backlog

| [US-EASY-005](.roll/features/test-epic/t.md#us-easy-005) | easy | 📋 Todo |
| [US-DEF-012](.roll/features/test-epic/t.md#us-def-012)   | default | 📋 Todo |
| [US-HARD-030](.roll/features/test-epic/t.md#us-hard-030) | hard | 📋 Todo |
| [US-NOEST-001](.roll/features/test-epic/t.md#us-noest-001) | none | 📋 Todo |
MD
  cat > .roll/features/test-epic/t.md <<'MD'
# Feature: test

<a id="us-easy-005"></a>
## US-EASY-005 easy
**Agent profile:**
- est_min: 5
- risk_zone: low
- chain_depth: 0

<a id="us-def-012"></a>
## US-DEF-012 default
**Agent profile:**
- est_min: 12
- risk_zone: low
- chain_depth: 0

<a id="us-hard-030"></a>
## US-HARD-030 hard
**Agent profile:**
- est_min: 30
- risk_zone: high
- chain_depth: 0

<a id="us-noest-001"></a>
## US-NOEST-001 none
This story has no Agent profile block.
MD
}

_write_agents() { cat > .roll/agents.yaml; }

# ── tier slot reads: each boundary routes to its own slot's agent ────────────

@test "easy story → easy slot agent, tier=easy" {
  _write_agents <<'YAML'
schema: v3
easy:     { agent: kimi }
default:  { agent: claude }
hard:     { agent: codex }
fallback: { agent: pi }
YAML
  run _loop_pick_agent_for_story US-EASY-005
  [ "$status" -eq 0 ]
  # field 1 = agent (the loop reads this), field 2 = tier.
  [ "$(echo "$output" | awk '{print $1}')" = "kimi" ]
  [ "$(echo "$output" | awk '{print $2}')" = "easy" ]
}

@test "default story → default slot agent, tier=default" {
  _write_agents <<'YAML'
schema: v3
easy:     { agent: kimi }
default:  { agent: claude }
hard:     { agent: codex }
YAML
  run _loop_pick_agent_for_story US-DEF-012
  [ "$status" -eq 0 ]
  [ "$(echo "$output" | awk '{print $1}')" = "claude" ]
  [ "$(echo "$output" | awk '{print $2}')" = "default" ]
}

@test "hard story → hard slot agent, tier=hard" {
  _write_agents <<'YAML'
schema: v3
easy:     { agent: kimi }
default:  { agent: claude }
hard:     { agent: codex }
YAML
  run _loop_pick_agent_for_story US-HARD-030
  [ "$status" -eq 0 ]
  [ "$(echo "$output" | awk '{print $1}')" = "codex" ]
  [ "$(echo "$output" | awk '{print $2}')" = "hard" ]
}

@test "no estimate → default tier → default slot agent" {
  _write_agents <<'YAML'
schema: v3
easy:    { agent: kimi }
default: { agent: claude }
YAML
  run _loop_pick_agent_for_story US-NOEST-001
  [ "$status" -eq 0 ]
  [ "$(echo "$output" | awk '{print $1}')" = "claude" ]
  [ "$(echo "$output" | awk '{print $2}')" = "default" ]
}

# ── fallback chain ───────────────────────────────────────────────────────────

@test "tier slot missing → falls back to default slot agent (tier still reported)" {
  # hard slot absent; default present → hard story resolves via default slot,
  # but the reported tier stays 'hard' so runs.jsonl records true complexity.
  _write_agents <<'YAML'
schema: v3
easy:    { agent: kimi }
default: { agent: claude }
YAML
  run _loop_pick_agent_for_story US-HARD-030
  [ "$status" -eq 0 ]
  [ "$(echo "$output" | awk '{print $1}')" = "claude" ]
  [ "$(echo "$output" | awk '{print $2}')" = "hard" ]
}

@test "tier slot + default slot both empty → first installed agent, non-empty" {
  # Only fallback slot is set, so both the easy slot and default slot are
  # absent. Resolver must not drop to empty — it uses _first_installed_agent.
  _write_agents <<'YAML'
schema: v3
fallback: { agent: pi }
YAML
  # Stub a known agent onto PATH so _first_installed_agent has something to find.
  mkdir -p "$TEST_TMP/stubbin"
  printf '#!/bin/sh\nexit 0\n' > "$TEST_TMP/stubbin/claude"
  chmod +x "$TEST_TMP/stubbin/claude"
  # stderr carries the WARN; assert only on stdout so the route-line contract
  # (field 1 = agent, field 2 = tier) is what we check.
  run env PATH="$TEST_TMP/stubbin:$PATH" bash -c "
    source '$ROLL_BIN'
    _loop_pick_agent_for_story US-EASY-005 2>/dev/null
  "
  [ "$status" -eq 0 ]
  # field 1 must be a non-empty real agent, field 2 the tier.
  [ -n "$(echo "$output" | awk '{print $1}')" ]
  [ "$(echo "$output" | awk '{print $2}')" = "easy" ]
}

# ── error paths ──────────────────────────────────────────────────────────────

@test "missing story id → exit 1" {
  run _loop_pick_agent_for_story ""
  [ "$status" -eq 1 ]
}

@test "unknown story id → exit 1 (cannot classify)" {
  _write_agents <<'YAML'
schema: v3
default: { agent: claude }
YAML
  run _loop_pick_agent_for_story US-DOES-NOT-EXIST
  [ "$status" -eq 1 ]
}
