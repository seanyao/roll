#!/usr/bin/env bats
# US-AGENT-026: `roll agent set` cascade picker → single slot.
#
# Covers:
#   - _agents_config_set_slot: create file, replace inline, replace nested,
#     append new slot, preserve comments + sibling slots, atomic write
#   - non-interactive `roll agent set <slot> <agent>` (pipe/CI shortcut)
#   - validation: unknown slot, unknown agent
#   - interactive cascade: slot chosen by number → agent from installed+online
#   - no model layer (agent name alone settles the slot)
#   - confirmation line on save

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

# ── _agents_config_set_slot write helper ─────────────────────────────────────

@test "US-AGENT-026 set_slot: creates agents.yaml with a v3 header when absent" {
  rm -f .roll/agents.yaml
  run _agents_config_set_slot hard claude
  [ "$status" -eq 0 ]
  grep -q '^schema: v3' .roll/agents.yaml
  # round-trips through the loader
  run _agents_config_slot hard
  [ "$status" -eq 0 ]
  [ "$output" = "claude" ]
}

@test "US-AGENT-026 set_slot: replaces an existing inline slot value in place" {
  cat > .roll/agents.yaml <<'YAML'
schema: v3
easy:    { agent: kimi }
default: { agent: pi }
YAML
  run _agents_config_set_slot easy claude
  [ "$status" -eq 0 ]
  run _agents_config_slot easy
  [ "$output" = "claude" ]
  # sibling slot untouched
  run _agents_config_slot default
  [ "$output" = "pi" ]
}

@test "US-AGENT-026 set_slot: replaces a nested-form slot value" {
  cat > .roll/agents.yaml <<'YAML'
schema: v3
hard:
  agent: pi
YAML
  run _agents_config_set_slot hard claude
  [ "$status" -eq 0 ]
  run _agents_config_slot hard
  [ "$output" = "claude" ]
  # the stale nested `agent: pi` line must be gone, not duplicated
  run grep -c 'agent: pi' .roll/agents.yaml
  [ "$output" = "0" ]
}

@test "US-AGENT-026 set_slot: appends a slot that is not yet present" {
  cat > .roll/agents.yaml <<'YAML'
schema: v3
default: { agent: pi }
YAML
  run _agents_config_set_slot fallback codex
  [ "$status" -eq 0 ]
  run _agents_config_slot fallback
  [ "$output" = "codex" ]
  run _agents_config_slot default
  [ "$output" = "pi" ]
}

@test "US-AGENT-026 set_slot: preserves comments and unrelated lines" {
  cat > .roll/agents.yaml <<'YAML'
# routing config — do not commit
schema: v3
easy: { agent: kimi }   # cheap tier
hard: { agent: pi }
YAML
  run _agents_config_set_slot hard claude
  [ "$status" -eq 0 ]
  grep -q '^# routing config — do not commit' .roll/agents.yaml
  grep -q 'cheap tier' .roll/agents.yaml
  run _agents_config_slot hard
  [ "$output" = "claude" ]
}

# ── non-interactive `roll agent set <slot> <agent>` ──────────────────────────

@test "US-AGENT-026 set: non-interactive assignment writes the slot + confirms" {
  fake_agent claude
  PATH="$FAKE_BIN:/usr/bin:/bin" run bash -c \
    "cd '$PWD'; source '$ROLL_BIN'; cmd_agent set hard claude"
  [ "$status" -eq 0 ]
  [[ "$output" == *"hard"* ]]
  [[ "$output" == *"claude"* ]]
  [[ "$output" == *"saved"* || "$output" == *"已保存"* ]]
  run _agents_config_slot hard
  [ "$output" = "claude" ]
}

@test "US-AGENT-026 set: rejects an unknown slot" {
  run bash -c "cd '$PWD'; source '$ROLL_BIN'; cmd_agent set bogus claude"
  [ "$status" -ne 0 ]
  [[ "$output" == *"bogus"* ]]
  # nothing written
  [ ! -f .roll/agents.yaml ]
}

@test "US-AGENT-026 set: rejects an unknown agent name" {
  run bash -c "cd '$PWD'; source '$ROLL_BIN'; cmd_agent set hard notanagent"
  [ "$status" -ne 0 ]
  [[ "$output" == *"notanagent"* ]]
  [ ! -f .roll/agents.yaml ]
}

@test "US-AGENT-026 set: accepts an antigravity alias and stores canonical agy" {
  run bash -c "cd '$PWD'; source '$ROLL_BIN'; cmd_agent set default antigravity"
  [ "$status" -eq 0 ]
  run _agents_config_slot default
  [ "$output" = "agy" ]
}

# ── interactive cascade (slot by number → agent from installed+online) ───────

@test "US-AGENT-026 set: interactive — slot #3 (hard) → online agent, no typing model" {
  fake_agent claude
  fake_agent pi
  # ROLL_ONBOARD_AGENT pins the second-stage agent pick; stdin feeds the slot.
  PATH="$FAKE_BIN:/usr/bin:/bin" ROLL_ONBOARD_AGENT=claude run bash -c \
    "cd '$PWD'; source '$ROLL_BIN'; printf '3\n' | cmd_agent set"
  [ "$status" -eq 0 ]
  # slot 3 in easy/default/hard/fallback order is 'hard'
  run _agents_config_slot hard
  [ "$output" = "claude" ]
}

@test "US-AGENT-026 set: interactive rejects an out-of-range slot number" {
  fake_agent claude
  PATH="$FAKE_BIN:/usr/bin:/bin" run bash -c \
    "cd '$PWD'; source '$ROLL_BIN'; printf '9\n' | cmd_agent set"
  [ "$status" -ne 0 ]
  [ ! -f .roll/agents.yaml ]
}

@test "US-AGENT-026 set: interactive only offers installed+online agents" {
  # claude online, pi offline (probe exits non-zero). Picking pi must fail.
  fake_agent claude
  fake_agent pi 1
  PATH="$FAKE_BIN:/usr/bin:/bin" ROLL_ONBOARD_AGENT=pi run bash -c \
    "cd '$PWD'; source '$ROLL_BIN'; printf '1\n' | cmd_agent set"
  # pi is not in the online candidate list → selection aborts non-zero.
  [ "$status" -ne 0 ]
}

# ── bash 3.2 code path (no declare -A / mapfile / ${var^^}) ───────────────────

@test "US-AGENT-026 set_slot: write path runs clean under a fresh bash" {
  run bash -c "cd '$PWD'; source '$ROLL_BIN'; _agents_config_set_slot easy kimi && _agents_config_slot easy"
  [ "$status" -eq 0 ]
  [ "$output" = "kimi" ]
}
