#!/usr/bin/env bats

load helpers
setup() { unit_setup; }
teardown() { unit_teardown; }

@test "ai_tool_name: ~/.claude → claude (strips leading dot)" {
  run ai_tool_name "$HOME/.claude"
  [ "$status" -eq 0 ]
  [ "$output" = "claude" ]
}

@test "ai_tool_name: ~/.gemini → agy (legacy dir name, now the Antigravity CLI)" {
  # agy (Antigravity) reuses ~/.gemini/ for its config; the basename is
  # mapped to the new agent identifier.
  run ai_tool_name "$HOME/.gemini"
  [ "$status" -eq 0 ]
  [ "$output" = "agy" ]
}

@test "ai_tool_name: ~/.openclaw/workspace → openclaw (workspace uses parent dir)" {
  run ai_tool_name "$HOME/.openclaw/workspace"
  [ "$status" -eq 0 ]
  [ "$output" = "openclaw" ]
}

@test "ai_tool_name: /home/user/.cursor → cursor (strips leading dot)" {
  run ai_tool_name "/home/user/.cursor"
  [ "$status" -eq 0 ]
  [ "$output" = "cursor" ]
}

@test "ai_tool_name: ~/.kimi → kimi (strips leading dot)" {
  run ai_tool_name "$HOME/.kimi"
  [ "$status" -eq 0 ]
  [ "$output" = "kimi" ]
}

@test "ai_tool_name: ~/.pi/agent → pi (agent uses parent dir)" {
  run ai_tool_name "$HOME/.pi/agent"
  [ "$status" -eq 0 ]
  [ "$output" = "pi" ]
}

@test "_is_ai_installed: ~/.pi/agent returns 0 when pi CLI is present" {
  pi_stub="$TEST_TMP/bin/pi"
  mkdir -p "$TEST_TMP/bin"
  printf '#!/bin/sh\n' > "$pi_stub"
  chmod +x "$pi_stub"
  PATH="$TEST_TMP/bin:$PATH" run _is_ai_installed "$TEST_TMP/.pi/agent"
  [ "$status" -eq 0 ]
}

@test "_is_ai_installed: ~/.pi/agent returns 1 when pi CLI is absent" {
  local fake_pi_agent="$TEST_TMP/.pi/agent"
  PATH="/usr/bin:/bin" run _is_ai_installed "$fake_pi_agent"
  [ "$status" -eq 1 ]
}

@test "_is_ai_installed: non-pi agent dir does not trigger pi check" {
  agent_dir="$TEST_TMP/.other/agent"
  PATH="/usr/bin:/bin" run _is_ai_installed "$agent_dir"
  [ "$status" -eq 1 ]
}
