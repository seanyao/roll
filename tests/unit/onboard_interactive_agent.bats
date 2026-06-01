#!/usr/bin/env bats
# US-ONBOARD-018: `roll init` auto-launches the chosen agent in interactive
# mode with the $roll-onboard skill content pre-loaded as the initial prompt,
# then chains into `roll init --apply` once the conversation ends.
#
# These tests cover:
#   - _agent_argv interactive — one row per supported agent
#   - _onboard_initial_prompt — composes a kickoff line + skill body
#   - _onboard_select_agent   — auto-pick, multi-pick, env override
#   - _onboard_failure_hint   — wording for SIGINT and other non-zero exits
#   - _run_onboard_agent      — exit-code branching (plan present / missing / SIGINT / non-zero)

load helpers
setup()    { unit_setup; }
teardown() { unit_teardown; }

# ─── _agent_argv interactive — argv per agent ─────────────────────────────────

@test "interactive argv: claude → claude <prompt> (no -p, no --output-format)" {
  _agent_argv claude interactive "hello"
  [ "${_AGENT_ARGV[0]}" = "claude" ]
  [ "${_AGENT_ARGV[1]}" = "hello" ]
  [ "${#_AGENT_ARGV[@]}" -eq 2 ]
}

@test "interactive argv: codex → codex <prompt> (no exec)" {
  _agent_argv codex interactive "hi"
  [ "${_AGENT_ARGV[0]}" = "codex" ]
  [ "${_AGENT_ARGV[1]}" = "hi" ]
  [ "${#_AGENT_ARGV[@]}" -eq 2 ]
}

@test "interactive argv: kimi → kimi <prompt> (no --quiet, no -p)" {
  # FIX-126: with no kimi-* on PATH the binary falls back to legacy 'kimi'.
  PATH="/usr/bin:/bin" _agent_argv kimi interactive "hi"
  [ "${_AGENT_ARGV[0]}" = "kimi" ]
  [ "${_AGENT_ARGV[1]}" = "hi" ]
  [ "${#_AGENT_ARGV[@]}" -eq 2 ]
}

@test "interactive argv: pi → pi <prompt> (no -p)" {
  _agent_argv pi interactive "hi"
  [ "${_AGENT_ARGV[0]}" = "pi" ]
  [ "${_AGENT_ARGV[1]}" = "hi" ]
  [ "${#_AGENT_ARGV[@]}" -eq 2 ]
}

@test "interactive argv: deepseek → deepseek <prompt>" {
  _agent_argv deepseek interactive "hi"
  [ "${_AGENT_ARGV[0]}" = "deepseek" ]
  [ "${_AGENT_ARGV[1]}" = "hi" ]
  [ "${#_AGENT_ARGV[@]}" -eq 2 ]
}

@test "interactive argv: opencode → opencode <prompt> (no run)" {
  _agent_argv opencode interactive "hi"
  [ "${_AGENT_ARGV[0]}" = "opencode" ]
  [ "${_AGENT_ARGV[1]}" = "hi" ]
  [ "${#_AGENT_ARGV[@]}" -eq 2 ]
}

@test "interactive argv: agy → agy -i <prompt> (Antigravity, replacing Gemini CLI)" {
  _agent_argv agy interactive "hi"
  [ "${_AGENT_ARGV[0]}" = "agy" ]
  [ "${_AGENT_ARGV[1]}" = "-i" ]
  [ "${_AGENT_ARGV[2]}" = "hi" ]
}

@test "interactive argv: unknown agent returns 1" {
  run _agent_argv bogus interactive "p"
  [ "$status" -eq 1 ]
}

@test "interactive argv: prompts with quotes survive intact (one arg)" {
  _agent_argv claude interactive 'multi line "quoted" with $vars'
  [ "${_AGENT_ARGV[1]}" = 'multi line "quoted" with $vars' ]
}

# Regression guard: existing non-interactive modes must still work.
@test "non-interactive argv unchanged: claude plain remains 'claude -p <prompt>'" {
  _agent_argv claude plain "x"
  [ "${_AGENT_ARGV[0]}" = "claude" ]
  [ "${_AGENT_ARGV[1]}" = "-p" ]
  [ "${_AGENT_ARGV[2]}" = "x" ]
}

@test "non-interactive argv unchanged: codex text remains 'codex exec <prompt>'" {
  _agent_argv codex text "x"
  [ "${_AGENT_ARGV[0]}" = "codex" ]
  [ "${_AGENT_ARGV[1]}" = "exec" ]
  [ "${_AGENT_ARGV[2]}" = "x" ]
}

@test "non-interactive argv: agy plain → agy -p --dangerously-skip-permissions (FIX-153)" {
  _agent_argv agy plain "x"
  [ "${_AGENT_ARGV[0]}" = "agy" ]
  [ "${_AGENT_ARGV[1]}" = "-p" ]
  [ "${_AGENT_ARGV[2]}" = "--dangerously-skip-permissions" ]
  [ "${_AGENT_ARGV[3]}" = "x" ]
}

# ─── _onboard_initial_prompt — kickoff line + skill body ─────────────────────

@test "_onboard_initial_prompt: includes the kickoff line" {
  run _onboard_initial_prompt
  [ "$status" -eq 0 ]
  [[ "$output" == *"Run the \$roll-onboard skill"* ]]
}

@test "_onboard_initial_prompt: includes the skill body header" {
  run _onboard_initial_prompt
  [ "$status" -eq 0 ]
  # SKILL.md's body starts with the H1 "# Roll Onboard" (frontmatter stripped).
  [[ "$output" == *"# Roll Onboard"* ]]
}

@test "_onboard_initial_prompt: strips YAML frontmatter — no leading ---" {
  run _onboard_initial_prompt
  [ "$status" -eq 0 ]
  # First non-empty line should be the kickoff sentence, not '---'.
  first=$(echo "$output" | grep -m1 -v '^$')
  [[ "$first" != "---"* ]]
}

@test "_onboard_initial_prompt: fails when skill file missing" {
  local saved="$ROLL_PKG_DIR"
  ROLL_PKG_DIR="/nonexistent/path"
  run _onboard_initial_prompt
  ROLL_PKG_DIR="$saved"
  [ "$status" -ne 0 ]
}

# ─── _onboard_select_agent — picking logic ───────────────────────────────────

@test "_onboard_select_agent: single candidate auto-picks" {
  run _onboard_select_agent claude
  [ "$status" -eq 0 ]
  [ "$output" = "claude" ]
}

@test "_onboard_select_agent: ROLL_ONBOARD_AGENT env overrides when present" {
  ROLL_ONBOARD_AGENT=codex run _onboard_select_agent claude codex kimi
  [ "$status" -eq 0 ]
  [ "$output" = "codex" ]
}

@test "_onboard_select_agent: ROLL_ONBOARD_AGENT errors when not installed" {
  ROLL_ONBOARD_AGENT=bogus run _onboard_select_agent claude codex
  [ "$status" -ne 0 ]
}

@test "_onboard_select_agent: multi candidates prompt — picks by number from stdin" {
  # Capture stdout only (the chosen name); prompt goes to stderr (suppressed).
  local result
  result=$(bash -c "
    source '$ROLL_BIN'
    echo '2' | _onboard_select_agent claude codex kimi 2>/dev/null
  ")
  [ "$result" = "codex" ]
}

@test "_onboard_select_agent: invalid choice (not a number) returns non-zero" {
  run bash -c "
    source '$ROLL_BIN'
    echo 'oops' | _onboard_select_agent claude codex
  "
  [ "$status" -ne 0 ]
}

@test "_onboard_select_agent: out-of-range choice returns non-zero" {
  run bash -c "
    source '$ROLL_BIN'
    echo '9' | _onboard_select_agent claude codex
  "
  [ "$status" -ne 0 ]
}

@test "_onboard_select_agent: zero candidates returns 1 immediately" {
  run _onboard_select_agent
  [ "$status" -eq 1 ]
}

# ─── _onboard_failure_hint — wording ─────────────────────────────────────────

@test "_onboard_failure_hint: SIGINT (130) message says 'cancelled' / 'Ctrl-C'" {
  run _onboard_failure_hint claude 130
  [[ "$output" == *"cancelled"* || "$output" == *"取消"* || "$output" == *"Ctrl-C"* ]]
}

@test "_onboard_failure_hint: non-130 message mentions agent name and exit code" {
  run _onboard_failure_hint codex 2
  [[ "$output" == *"codex"* ]]
  [[ "$output" == *"2"* ]]
}

@test "_onboard_failure_hint: always points the user at retry / switch options" {
  run _onboard_failure_hint claude 1
  [[ "$output" == *"roll init"* ]]
  [[ "$output" == *"ROLL_ONBOARD_AGENT"* ]]
}

# ─── _run_onboard_agent — exit-code branching ───────────────────────────────
#
# The agent binary is stubbed by overriding _agent_argv to point at /usr/bin/true
# (success), /usr/bin/false (non-zero), or a bash that exits 130 (SIGINT).

@test "_run_onboard_agent: exit 0 + plan present → calls _init_apply" {
  mkdir -p "$TEST_TMP/proj/.roll"
  # Drop a stub plan so the present-check passes. Real _init_apply would barf
  # on schema, so stub it too — we only care that it was reached.
  echo "version: 1" > "$TEST_TMP/proj/.roll/onboard-plan.yaml"

  _agent_argv() { _AGENT_ARGV=(/usr/bin/true); return 0; }
  _init_apply() { echo "APPLY_CALLED"; return 0; }
  _onboard_initial_prompt() { echo "stub-prompt"; return 0; }

  run _run_onboard_agent claude "$TEST_TMP/proj"
  [ "$status" -eq 0 ]
  [[ "$output" == *"APPLY_CALLED"* ]]
}

@test "_run_onboard_agent: exit 0 + plan missing → warns, does NOT call _init_apply" {
  mkdir -p "$TEST_TMP/proj/.roll"

  _agent_argv() { _AGENT_ARGV=(/usr/bin/true); return 0; }
  _init_apply() { echo "APPLY_CALLED"; return 0; }
  _onboard_initial_prompt() { echo "stub-prompt"; return 0; }

  run _run_onboard_agent claude "$TEST_TMP/proj"
  [ "$status" -ne 0 ]
  [[ "$output" != *"APPLY_CALLED"* ]]
  [[ "$output" == *"onboard-plan.yaml"* ]]
}

@test "_run_onboard_agent: non-zero exit → prints failure hint, no apply" {
  mkdir -p "$TEST_TMP/proj/.roll"
  echo "version: 1" > "$TEST_TMP/proj/.roll/onboard-plan.yaml"

  _agent_argv() { _AGENT_ARGV=(/usr/bin/false); return 0; }
  _init_apply() { echo "APPLY_CALLED"; return 0; }
  _onboard_initial_prompt() { echo "stub-prompt"; return 0; }

  run _run_onboard_agent codex "$TEST_TMP/proj"
  [ "$status" -ne 0 ]
  [[ "$output" != *"APPLY_CALLED"* ]]
  [[ "$output" == *"codex"* ]]
  [[ "$output" == *"ROLL_ONBOARD_AGENT"* ]]
}

@test "_run_onboard_agent: SIGINT (exit 130) → 'cancelled' hint, no apply" {
  mkdir -p "$TEST_TMP/proj/.roll"

  _agent_argv() { _AGENT_ARGV=(bash -c "exit 130"); return 0; }
  _init_apply() { echo "APPLY_CALLED"; return 0; }
  _onboard_initial_prompt() { echo "stub-prompt"; return 0; }

  run _run_onboard_agent claude "$TEST_TMP/proj"
  [ "$status" -eq 130 ]
  [[ "$output" != *"APPLY_CALLED"* ]]
  [[ "$output" == *"cancelled"* || "$output" == *"取消"* || "$output" == *"Ctrl-C"* ]]
}

@test "_run_onboard_agent: unknown agent → returns 1 with 'no interactive mode' hint" {
  _onboard_initial_prompt() { echo "stub-prompt"; return 0; }

  run _run_onboard_agent bogus "$TEST_TMP"
  [ "$status" -ne 0 ]
  [[ "$output" == *"interactive"* ]]
}

# ─── _onboard_discover_agents — config parsing ───────────────────────────────

@test "_onboard_discover_agents: installed binaries go to _ONBOARD_INSTALLED (FIX-128)" {
  # FIX-128: "installed" now means the CLI binary is on PATH, not just
  # that Roll's convention-sync dir exists.
  local cfg="$TEST_TMP/roll-cfg"
  mkdir -p "$TEST_TMP/bin"
  printf '#!/bin/sh\n' > "$TEST_TMP/bin/claude"
  printf '#!/bin/sh\n' > "$TEST_TMP/bin/codex"
  chmod +x "$TEST_TMP/bin/claude" "$TEST_TMP/bin/codex"
  cat > "$cfg" <<EOF
ai_claude: $TEST_TMP/has-claude|x|y
ai_codex: $TEST_TMP/has-codex|x|y
ai_kimi: $TEST_TMP/no-kimi|x|y
EOF
  PATH="$TEST_TMP/bin:/usr/bin:/bin" ROLL_CONFIG="$cfg" _onboard_discover_agents
  printf '%s\n' "${_ONBOARD_INSTALLED[@]}" | grep -qx claude
  printf '%s\n' "${_ONBOARD_INSTALLED[@]}" | grep -qx codex
  printf '%s\n' "${_ONBOARD_MISSING[@]}"   | grep -qx kimi
}

@test "_onboard_discover_agents: ignores non-ai_ keys (FIX-128)" {
  local cfg="$TEST_TMP/roll-cfg"
  mkdir -p "$TEST_TMP/bin"
  printf '#!/bin/sh\n' > "$TEST_TMP/bin/claude"
  chmod +x "$TEST_TMP/bin/claude"
  cat > "$cfg" <<EOF
primary_agent: claude
ai_claude: $TEST_TMP/has-claude|x|y
some_other: $TEST_TMP|x|y
EOF
  PATH="$TEST_TMP/bin:/usr/bin:/bin" ROLL_CONFIG="$cfg" _onboard_discover_agents
  [ "${#_ONBOARD_INSTALLED[@]}" -eq 1 ]
  [ "${_ONBOARD_INSTALLED[0]}" = "claude" ]
}
