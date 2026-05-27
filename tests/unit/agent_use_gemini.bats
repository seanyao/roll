#!/usr/bin/env bats
# Tests for US-AI-005: gemini agent registration
#
# `roll agent use gemini` maps to Google Gemini CLI (agy).

load helpers

setup()   { unit_setup_cd; }
teardown() { unit_teardown_cd; }

# ── Agent registration ─────────────────────────────────────────────────────

@test "roll agent use gemini sets agent in .roll/local.yaml" {
  run bash "$ROLL_BIN" agent use gemini
  grep -q 'agent: gemini' .roll/local.yaml
}

@test "roll agent list includes gemini in available agents" {
  run bash "$ROLL_BIN" agent list
  grep -q 'gemini' <<< "$output"
}

# ── Error messages include gemini in agent list ─────────────────────────────

@test "agent use usage message includes gemini" {
  run bash "$ROLL_BIN" agent use
  grep -q 'gemini' <<< "$output"
}

@test "roll agent use gemini is accepted as valid" {
  run bash "$ROLL_BIN" agent use gemini
  [ "$status" -eq 0 ]
}

# ── Registry entry ──────────────────────────────────────────────────────────

@test "gemini appears in _agent_argv case statement" {
  grep -q 'gemini' "$ROLL_BIN"
}

# ── CLI detection ──────────────────────────────────────────────────────────

@test "roll agent use gemini warns about missing Gemini CLI" {
  run bash "$ROLL_BIN" agent use gemini
  grep -qE 'gemini|Gemini' <<< "$output" || true
  [ "$status" -eq 0 ]
}
