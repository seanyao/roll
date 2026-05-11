#!/usr/bin/env bats
# Unit tests for _for_each_ai_tool helper (REFACTOR-005)

setup() {
  source "${BATS_TEST_DIRNAME}/../../bin/roll"
  TEST_TMP="$(mktemp -d)"
  ROLL_CONFIG="$TEST_TMP/config.yaml"
}

teardown() {
  rm -rf "$TEST_TMP"
}

# Helper: write a minimal config with two AI tool entries
_write_two_tool_config() {
  cat > "$ROLL_CONFIG" << 'EOF'
ai_claude: ~/.claude|CLAUDE.md|CLAUDE.md
ai_kimi: ~/.kimi|AGENTS.md|AGENTS.md
EOF
}

@test "_for_each_ai_tool: calls callback once per configured tool" {
  _write_two_tool_config
  local out="$TEST_TMP/calls.txt"
  _record_call() { echo "called" >> "$out"; }
  _for_each_ai_tool _record_call
  [ -f "$out" ]
  local count
  count=$(wc -l < "$out" | tr -d ' ')
  [ "$count" -eq 2 ]
}

@test "_for_each_ai_tool: callback receives ai_dir as second arg" {
  _write_two_tool_config
  local out="$TEST_TMP/dirs.txt"
  _record_dir() { echo "$2" >> "$out"; }
  _for_each_ai_tool _record_dir
  grep -qF "$HOME/.claude" "$out"
}

@test "_for_each_ai_tool: callback receives ai_config as third arg" {
  _write_two_tool_config
  local out="$TEST_TMP/cfgs.txt"
  _record_cfg() { echo "$3" >> "$out"; }
  _for_each_ai_tool _record_cfg
  grep -qF "CLAUDE.md" "$out"
}

@test "_for_each_ai_tool: callback receives ai_src as fourth arg" {
  _write_two_tool_config
  local out="$TEST_TMP/srcs.txt"
  _record_src() { echo "$4" >> "$out"; }
  _for_each_ai_tool _record_src
  grep -qF "CLAUDE.md" "$out"
}

@test "_for_each_ai_tool: extra args forwarded to callback" {
  _write_two_tool_config
  local out="$TEST_TMP/extras.txt"
  _record_extra() { echo "$5" >> "$out"; }
  _for_each_ai_tool _record_extra "hello"
  grep -q "^hello$" "$out"
}

@test "_for_each_ai_tool: no-op when config has no ai_ entries" {
  echo "primary_agent: claude" > "$ROLL_CONFIG"
  local out="$TEST_TMP/calls.txt"
  _record_noop() { echo "called" >> "$out"; }
  _for_each_ai_tool _record_noop
  [ ! -f "$out" ]
}
