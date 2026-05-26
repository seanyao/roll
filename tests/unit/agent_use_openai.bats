#!/usr/bin/env bats
# Tests for US-AI-004: openai agent registration
#
# `roll agent use openai` maps to codex CLI.
# Token/cost capture is out of scope (US-LOOP-028).

load helpers

setup()   { unit_setup_cd; }
teardown() { unit_teardown_cd; }

# ── Agent registration ─────────────────────────────────────────────────────

@test "roll agent use openai sets agent in .roll/local.yaml" {
  run bash "$ROLL_BIN" agent use openai
  grep -q 'agent: openai' .roll/local.yaml
}

@test "roll agent list includes openai in available agents" {
  run bash "$ROLL_BIN" agent list
  grep -q 'openai' <<< "$output"
}

# ── Error messages include openai in agent list ─────────────────────────────

@test "agent use usage message includes openai" {
  run bash "$ROLL_BIN" agent use
  grep -q 'openai' <<< "$output"
}

@test "roll agent use openai is accepted as valid" {
  run bash "$ROLL_BIN" agent use openai
  [ "$status" -eq 0 ]
}

# ── Registry entry ──────────────────────────────────────────────────────────

@test "openai appears in _agent_argv case statement" {
  grep -q 'openai' "$ROLL_BIN"
}
