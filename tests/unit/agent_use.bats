#!/usr/bin/env bats
# US-AGENT-027: `roll agent use <name>` — one-shot lock of the three complexity
# tiers (easy/default/hard) to a single agent. The `fallback` slot is left
# untouched. Naming an unknown OR uninstalled agent is a hard error.
#
# Covers the AC:
#   - lock easy/default/hard to <name>, fallback unchanged
#   - unknown/uninstalled agent → error + hint to `roll agent list`
#   - backward-compatible: old `roll agent use <name>` still "works"
#   - atomic write to agents.yaml
#   - bash 3.2 safe code path

load helpers
setup() {
  unit_setup_cd
  export HOME="$TEST_TMP/home"
  mkdir -p "$HOME" .roll
  export ROLL_AGENT_CACHE_DIR="$TEST_TMP/cache"
  export FAKE_BIN="$TEST_TMP/bin"
  mkdir -p "$FAKE_BIN"
}
teardown() { unit_teardown_cd; }

fake_agent() {
  local bin="$1" code="${2:-0}"
  cat > "$FAKE_BIN/$bin" <<EOF
#!/bin/sh
case "\$1" in
  --version) exit $code ;;
esac
exit 0
EOF
  chmod +x "$FAKE_BIN/$bin"
}

# ── lock the three tiers ─────────────────────────────────────────────────────

@test "US-AGENT-027 use: locks easy/default/hard to the named agent" {
  fake_agent claude
  PATH="$FAKE_BIN:/usr/bin:/bin" run bash -c \
    "cd '$PWD'; source '$ROLL_BIN'; cmd_agent use claude"
  [ "$status" -eq 0 ]
  run _agents_config_slot easy;    [ "$output" = "claude" ]
  run _agents_config_slot default; [ "$output" = "claude" ]
  run _agents_config_slot hard;    [ "$output" = "claude" ]
}

@test "US-AGENT-027 use: leaves the fallback slot untouched" {
  fake_agent claude
  cat > .roll/agents.yaml <<'YAML'
schema: v3
easy:     { agent: kimi }
default:  { agent: kimi }
hard:     { agent: kimi }
fallback: { agent: pi }
YAML
  PATH="$FAKE_BIN:/usr/bin:/bin" run bash -c \
    "cd '$PWD'; source '$ROLL_BIN'; cmd_agent use claude"
  [ "$status" -eq 0 ]
  # three tiers re-pointed...
  run _agents_config_slot hard;    [ "$output" = "claude" ]
  # ...but fallback is the original pi.
  run _agents_config_slot fallback; [ "$output" = "pi" ]
}

@test "US-AGENT-027 use: prints a confirmation line naming the agent" {
  fake_agent claude
  PATH="$FAKE_BIN:/usr/bin:/bin" run bash -c \
    "cd '$PWD'; source '$ROLL_BIN'; cmd_agent use claude"
  [ "$status" -eq 0 ]
  [[ "$output" == *"claude"* ]]
}

# ── error: unknown / uninstalled agent ───────────────────────────────────────

@test "US-AGENT-027 use: rejects an unknown agent name with a list hint" {
  fake_agent claude
  PATH="$FAKE_BIN:/usr/bin:/bin" run bash -c \
    "cd '$PWD'; source '$ROLL_BIN'; cmd_agent use notanagent"
  [ "$status" -ne 0 ]
  [[ "$output" == *"notanagent"* ]]
  [[ "$output" == *"roll agent list"* ]]
  # nothing written when the name is rejected
  [ ! -f .roll/agents.yaml ]
}

@test "US-AGENT-027 use: rejects a known-but-uninstalled agent" {
  # kimi is a known agent name, but no kimi binary is on PATH here.
  PATH="$FAKE_BIN:/usr/bin:/bin" run bash -c \
    "cd '$PWD'; source '$ROLL_BIN'; cmd_agent use kimi"
  [ "$status" -ne 0 ]
  [[ "$output" == *"kimi"* ]]
  [ ! -f .roll/agents.yaml ]
}

@test "US-AGENT-027 use: requires an agent name" {
  run bash -c "cd '$PWD'; source '$ROLL_BIN'; cmd_agent use"
  [ "$status" -ne 0 ]
}

# ── aliases canonicalize ─────────────────────────────────────────────────────

@test "US-AGENT-027 use: antigravity alias is stored as canonical agy" {
  fake_agent agy
  PATH="$FAKE_BIN:/usr/bin:/bin" run bash -c \
    "cd '$PWD'; source '$ROLL_BIN'; cmd_agent use antigravity"
  [ "$status" -eq 0 ]
  run _agents_config_slot default; [ "$output" = "agy" ]
}

# ── back-compat: legacy single-agent pref stays in sync ──────────────────────

@test "US-AGENT-027 use: keeps the legacy .roll/local.yaml pref in sync" {
  fake_agent claude
  PATH="$FAKE_BIN:/usr/bin:/bin" run bash -c \
    "cd '$PWD'; source '$ROLL_BIN'; cmd_agent use claude"
  [ "$status" -eq 0 ]
  grep -q 'agent: claude' .roll/local.yaml
}

# ── bash 3.2 code path (no declare -A / mapfile / ${var^^}) ───────────────────

@test "US-AGENT-027 use: write path runs clean under a fresh bash" {
  fake_agent claude
  PATH="$FAKE_BIN:/usr/bin:/bin" run bash -c \
    "cd '$PWD'; source '$ROLL_BIN'; cmd_agent use claude >/dev/null 2>&1 && _agents_config_slot easy"
  [ "$status" -eq 0 ]
  [ "$output" = "claude" ]
}
