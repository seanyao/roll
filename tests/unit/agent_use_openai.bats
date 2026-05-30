#!/usr/bin/env bats
# Tests for US-AI-004: openai agent registration
#
# `roll agent use openai` maps to the codex CLI.
# Token/cost capture is out of scope (US-LOOP-028).
#
# US-AGENT-027 updated the semantics of `roll agent use <name>`: it now locks
# the easy/default/hard complexity tiers in .roll/agents.yaml and requires the
# agent's CLI (codex, for openai) to be installed. These tests therefore stage
# a fake `codex` binary on PATH.

load helpers

setup() {
  unit_setup_cd
  export HOME="$TEST_TMP/home"
  mkdir -p "$HOME"
  export ROLL_AGENT_CACHE_DIR="$TEST_TMP/cache"
  export FAKE_BIN="$TEST_TMP/bin"
  mkdir -p "$FAKE_BIN"
  cat > "$FAKE_BIN/codex" <<'EOF'
#!/bin/sh
exit 0
EOF
  chmod +x "$FAKE_BIN/codex"
}
teardown() { unit_teardown_cd; }

# ── Agent registration ─────────────────────────────────────────────────────

@test "roll agent use openai locks the tiers in agents.yaml" {
  PATH="$FAKE_BIN:/usr/bin:/bin" run bash "$ROLL_BIN" agent use openai
  [ "$status" -eq 0 ]
  grep -q 'default:.*openai' .roll/agents.yaml
}

@test "roll agent list includes openai in available agents" {
  run bash "$ROLL_BIN" agent list
  grep -q 'openai' <<< "$output"
}

@test "roll agent use openai is accepted as valid" {
  PATH="$FAKE_BIN:/usr/bin:/bin" run bash "$ROLL_BIN" agent use openai
  [ "$status" -eq 0 ]
}

# ── Registry entry ──────────────────────────────────────────────────────────

@test "openai appears in _agent_argv case statement" {
  grep -q 'openai' "$ROLL_BIN"
}

# ── Uninstalled CLI is rejected ──────────────────────────────────────────────

@test "roll agent use openai errors when the codex CLI is missing" {
  # Empty PATH (no codex) → use must refuse to lock an unrunnable agent.
  EMPTY_BIN="$TEST_TMP/empty"; mkdir -p "$EMPTY_BIN"
  PATH="$EMPTY_BIN:/usr/bin:/bin" run bash "$ROLL_BIN" agent use openai
  [ "$status" -ne 0 ]
}
