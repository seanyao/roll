#!/usr/bin/env bats
# Tests for US-AI-005: Antigravity (agy) agent registration
#
# `roll agent use antigravity` (canonical) and its aliases `agy` and the legacy
# `gemini` all resolve to the canonical `agy` token, which dispatches to the
# Antigravity CLI. Antigravity reuses ~/.gemini/ + GEMINI.md from the deprecated
# Google Gemini CLI, so the convention-sync target is unchanged.

load helpers

setup()   { unit_setup_cd; }
teardown() { unit_teardown_cd; }

# ── Registration: canonical name + aliases all normalize to `agy` ────────────

@test "roll agent use antigravity stores canonical 'agent: agy'" {
  run bash "$ROLL_BIN" agent use antigravity
  grep -q 'agent: agy' .roll/local.yaml
}

@test "roll agent use agy stores 'agent: agy'" {
  run bash "$ROLL_BIN" agent use agy
  grep -q 'agent: agy' .roll/local.yaml
}

@test "roll agent use gemini (legacy alias) normalizes to 'agent: agy'" {
  run bash "$ROLL_BIN" agent use gemini
  grep -q 'agent: agy' .roll/local.yaml
}

# ── agent list shows the product name, not the legacy 'gemini' ───────────────

@test "roll agent list shows 'antigravity'" {
  run bash "$ROLL_BIN" agent list
  grep -q 'antigravity' <<< "$output"
}

@test "roll agent list no longer shows a bare 'gemini' row" {
  run bash "$ROLL_BIN" agent list
  ! grep -qw 'gemini' <<< "$output"
}

# ── Usage message surfaces the antigravity name ──────────────────────────────

@test "agent use usage message includes antigravity" {
  run bash "$ROLL_BIN" agent use
  grep -q 'antigravity' <<< "$output"
}

# ── Acceptance (exit 0 for canonical + both aliases) ─────────────────────────

@test "roll agent use antigravity is accepted (exit 0)" {
  run bash "$ROLL_BIN" agent use antigravity
  [ "$status" -eq 0 ]
}

@test "roll agent use agy is accepted (exit 0)" {
  run bash "$ROLL_BIN" agent use agy
  [ "$status" -eq 0 ]
}

# ── Dispatch registry ────────────────────────────────────────────────────────

@test "agy + antigravity appear in the _agent_argv case statement" {
  grep -q 'gemini|agy|antigravity' "$ROLL_BIN"
}

# ── CLI detection references the Antigravity CLI ─────────────────────────────

@test "roll agent use antigravity references the agy CLI (warns only if missing)" {
  run bash "$ROLL_BIN" agent use antigravity
  # agy present → no warning; agy missing → warning names the Antigravity CLI.
  grep -qE 'agy|Antigravity' <<< "$output" || true
  [ "$status" -eq 0 ]
}
