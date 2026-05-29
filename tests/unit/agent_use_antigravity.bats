#!/usr/bin/env bats
# Tests for US-AI-005: Antigravity (agy) agent registration
#
# `roll agent use antigravity` (canonical) and its aliases `agy` and the legacy
# `gemini` all resolve to the canonical `agy` token, which dispatches to the
# Antigravity CLI. Antigravity reuses ~/.gemini/ + GEMINI.md from the deprecated
# Google Gemini CLI, so the convention-sync target is unchanged.
#
# US-AGENT-027 updated the semantics of `roll agent use <name>`: it now locks
# the easy/default/hard complexity tiers in .roll/agents.yaml (instead of only
# writing a single per-project pref) and requires the agent to be installed.
# These tests therefore stage a fake `agy` binary on PATH.

load helpers

setup() {
  unit_setup_cd
  export HOME="$TEST_TMP/home"
  mkdir -p "$HOME"
  export ROLL_AGENT_CACHE_DIR="$TEST_TMP/cache"
  export FAKE_BIN="$TEST_TMP/bin"
  mkdir -p "$FAKE_BIN"
  cat > "$FAKE_BIN/agy" <<'EOF'
#!/bin/sh
exit 0
EOF
  chmod +x "$FAKE_BIN/agy"
}
teardown() { unit_teardown_cd; }

# ── Registration: canonical name + aliases all normalize to `agy` ────────────

@test "roll agent use antigravity locks the tiers to canonical agy" {
  PATH="$FAKE_BIN:/usr/bin:/bin" run bash "$ROLL_BIN" agent use antigravity
  [ "$status" -eq 0 ]
  grep -q 'default:.*agy' .roll/agents.yaml
}

@test "roll agent use agy locks the tiers to agy" {
  PATH="$FAKE_BIN:/usr/bin:/bin" run bash "$ROLL_BIN" agent use agy
  [ "$status" -eq 0 ]
  grep -q 'default:.*agy' .roll/agents.yaml
}

@test "roll agent use gemini (legacy alias) normalizes to agy" {
  PATH="$FAKE_BIN:/usr/bin:/bin" run bash "$ROLL_BIN" agent use gemini
  [ "$status" -eq 0 ]
  grep -q 'default:.*agy' .roll/agents.yaml
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

# ── Acceptance (exit 0 for canonical + both aliases) ─────────────────────────

@test "roll agent use antigravity is accepted (exit 0)" {
  PATH="$FAKE_BIN:/usr/bin:/bin" run bash "$ROLL_BIN" agent use antigravity
  [ "$status" -eq 0 ]
}

@test "roll agent use agy is accepted (exit 0)" {
  PATH="$FAKE_BIN:/usr/bin:/bin" run bash "$ROLL_BIN" agent use agy
  [ "$status" -eq 0 ]
}

# ── Dispatch registry ────────────────────────────────────────────────────────

@test "agy + antigravity appear in the _agent_argv case statement" {
  grep -q 'gemini|agy|antigravity' "$ROLL_BIN"
}
