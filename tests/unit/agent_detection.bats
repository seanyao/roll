#!/usr/bin/env bats
# FIX-128: agent detection requires binary on PATH for known CLI agents,
# so Roll's own convention sync (which creates ~/.<agent>/ dirs) no
# longer fakes a Claude install.

load helpers
setup() {
  unit_setup
  # Sandbox HOME so the dir-existence side of detection is deterministic.
  export HOME="$TEST_TMP/home"
  mkdir -p "$HOME"
}
teardown() { unit_teardown; }

# ── _agent_installed_by_name: 4 combinations ─────────────────────────────────

@test "FIX-128 _agent_installed_by_name: dir exists but binary missing → not installed" {
  mkdir -p "$HOME/.claude"
  PATH="/usr/bin:/bin" run _agent_installed_by_name "claude" "$HOME/.claude"
  [ "$status" -eq 1 ]
}

@test "FIX-128 _agent_installed_by_name: binary on PATH, no dir → installed" {
  mkdir -p "$TEST_TMP/bin"
  printf '#!/bin/sh\n' > "$TEST_TMP/bin/claude"
  chmod +x "$TEST_TMP/bin/claude"
  PATH="$TEST_TMP/bin:/usr/bin:/bin" run _agent_installed_by_name "claude" "$HOME/.claude"
  [ "$status" -eq 0 ]
}

@test "FIX-128 _agent_installed_by_name: both binary and dir → installed" {
  mkdir -p "$HOME/.claude" "$TEST_TMP/bin"
  printf '#!/bin/sh\n' > "$TEST_TMP/bin/claude"
  chmod +x "$TEST_TMP/bin/claude"
  PATH="$TEST_TMP/bin:/usr/bin:/bin" run _agent_installed_by_name "claude" "$HOME/.claude"
  [ "$status" -eq 0 ]
}

@test "FIX-128 _agent_installed_by_name: no binary and no dir → not installed" {
  PATH="/usr/bin:/bin" run _agent_installed_by_name "claude" "$HOME/.claude"
  [ "$status" -eq 1 ]
}

# ── Kimi multi-binary fallback (mirrors FIX-126) ─────────────────────────────

@test "FIX-128 _agent_installed_by_name: kimi accepts kimi-code | kimi-cli | kimi" {
  mkdir -p "$TEST_TMP/bin"
  printf '#!/bin/sh\n' > "$TEST_TMP/bin/kimi-cli"
  chmod +x "$TEST_TMP/bin/kimi-cli"
  PATH="$TEST_TMP/bin:/usr/bin:/bin" run _agent_installed_by_name "kimi"
  [ "$status" -eq 0 ]
}

# ── Unknown agent: fall back to dir presence ─────────────────────────────────

@test "FIX-128 _agent_installed_by_name: unknown agent uses dir check" {
  mkdir -p "$HOME/.mycustom"
  PATH="/usr/bin:/bin" run _agent_installed_by_name "mycustom" "$HOME/.mycustom"
  [ "$status" -eq 0 ]

  PATH="/usr/bin:/bin" run _agent_installed_by_name "mycustom" "$HOME/.nope"
  [ "$status" -eq 1 ]
}

# ── _is_ai_installed (path-based shim) routes through the new check ──────────

@test "FIX-128 _is_ai_installed: ~/.claude with no claude binary → not installed" {
  mkdir -p "$HOME/.claude"
  PATH="/usr/bin:/bin" run _is_ai_installed "$HOME/.claude"
  [ "$status" -eq 1 ]
}

@test "FIX-128 _is_ai_installed: ~/.kimi-code routes to kimi binary check" {
  mkdir -p "$HOME/.kimi-code" "$TEST_TMP/bin"
  printf '#!/bin/sh\n' > "$TEST_TMP/bin/kimi-code"
  chmod +x "$TEST_TMP/bin/kimi-code"
  PATH="$TEST_TMP/bin:/usr/bin:/bin" run _is_ai_installed "$HOME/.kimi-code"
  [ "$status" -eq 0 ]
}

# ── _first_installed_agent: pick first hit, never crash ──────────────────────

@test "FIX-128 _first_installed_agent: returns codex when only codex is on PATH" {
  mkdir -p "$TEST_TMP/bin"
  printf '#!/bin/sh\n' > "$TEST_TMP/bin/codex"
  chmod +x "$TEST_TMP/bin/codex"
  PATH="$TEST_TMP/bin:/usr/bin:/bin" run _first_installed_agent
  [ "$status" -eq 0 ]
  [ "$output" = "codex" ]
}

@test "FIX-128 _first_installed_agent: no installed agents → nonzero exit, empty stdout" {
  PATH="/usr/bin:/bin" run _first_installed_agent
  [ "$status" -ne 0 ]
  [ -z "$output" ]
}

# ── _onboard_discover_agents: uses binary check, dedupes ai_kimi/_code ───────

@test "FIX-128 _onboard_discover_agents: claude dir but no claude binary → MISSING" {
  local cfg="$TEST_TMP/roll-cfg"
  mkdir -p "$HOME/.claude"
  cat > "$cfg" <<EOF
ai_claude: $HOME/.claude|x|y
EOF
  PATH="/usr/bin:/bin" ROLL_CONFIG="$cfg" _onboard_discover_agents
  [ "${#_ONBOARD_INSTALLED[@]}" -eq 0 ]
  [ "${_ONBOARD_MISSING[0]}" = "claude" ]
}

@test "FIX-128 _onboard_discover_agents: deduplicates ai_kimi and ai_kimi_code" {
  local cfg="$TEST_TMP/roll-cfg"
  mkdir -p "$TEST_TMP/bin"
  printf '#!/bin/sh\n' > "$TEST_TMP/bin/kimi-code"
  chmod +x "$TEST_TMP/bin/kimi-code"
  cat > "$cfg" <<EOF
ai_kimi: ~/.kimi|x|y
ai_kimi_code: ~/.kimi-code|x|y
EOF
  PATH="$TEST_TMP/bin:/usr/bin:/bin" ROLL_CONFIG="$cfg" _onboard_discover_agents
  local count=0 a
  for a in "${_ONBOARD_INSTALLED[@]}"; do
    [[ "$a" == "kimi" ]] && count=$((count+1))
  done
  [ "$count" -eq 1 ]
}

# ── _replace_primary_agent: in-place rewrite preserves rest of file ──────────

@test "FIX-128 _replace_primary_agent: rewrites the primary_agent line only" {
  local cfg="$TEST_TMP/roll-cfg"
  cat > "$cfg" <<EOF
ai_claude: ~/.claude|x|y
primary_agent: claude
default_language: zh
EOF
  ROLL_CONFIG="$cfg" _replace_primary_agent "kimi"
  grep -q "^primary_agent: kimi$" "$cfg"
  grep -q "^ai_claude: " "$cfg"
  grep -q "^default_language: zh$" "$cfg"
}
