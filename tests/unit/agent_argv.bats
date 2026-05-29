#!/usr/bin/env bats
# Unit tests for _agent_argv / _agent_cmd_str (REFACTOR-017)

load helpers
setup() { unit_setup; }
teardown() { unit_teardown; }

@test "_agent_argv claude text → claude -p --output-format text prompt" {
  _agent_argv claude text "hello"
  [ "${_AGENT_ARGV[0]}" = "claude" ]
  [ "${_AGENT_ARGV[1]}" = "-p" ]
  [ "${_AGENT_ARGV[2]}" = "--output-format" ]
  [ "${_AGENT_ARGV[3]}" = "text" ]
  [ "${_AGENT_ARGV[4]}" = "hello" ]
}

@test "_agent_argv claude plain → claude -p prompt (no --output-format)" {
  _agent_argv claude plain "hi"
  [ "${_AGENT_ARGV[0]}" = "claude" ]
  [ "${_AGENT_ARGV[1]}" = "-p" ]
  [ "${_AGENT_ARGV[2]}" = "hi" ]
}

@test "_agent_argv claude peer → claude -p --output-format text" {
  _agent_argv claude peer "q"
  [ "${_AGENT_ARGV[2]}" = "--output-format" ]
  [ "${_AGENT_ARGV[3]}" = "text" ]
}

@test "_agent_argv kimi (no kimi-* on PATH) → falls back to legacy 'kimi'" {
  # FIX-126: ensure the legacy binary name is the final fallback when
  # neither kimi-code nor kimi-cli is installed.
  PATH="/usr/bin:/bin" _agent_argv kimi text "p"
  [ "${_AGENT_ARGV[0]}" = "kimi" ]
  # FIX-133: kimi-code 无 --quiet，-p 自带 auto 审批
  [ "${_AGENT_ARGV[1]}" = "-p" ]
  [ "${_AGENT_ARGV[2]}" = "p" ]
}

@test "_agent_argv kimi (kimi-code on PATH) → uses kimi-code" {
  # FIX-126: new upstream binary name preferred when installed.
  mkdir -p "$TEST_TMP/bin"
  printf '#!/bin/sh\n' > "$TEST_TMP/bin/kimi-code"
  chmod +x "$TEST_TMP/bin/kimi-code"
  PATH="$TEST_TMP/bin:/usr/bin:/bin" _agent_argv kimi text "p"
  [ "${_AGENT_ARGV[0]}" = "kimi-code" ]
  [ "${_AGENT_ARGV[1]}" = "-p" ]
}

@test "_agent_argv kimi (only kimi-cli on PATH) → uses kimi-cli" {
  # FIX-126: transitional fallback for users mid-upgrade.
  mkdir -p "$TEST_TMP/bin"
  printf '#!/bin/sh\n' > "$TEST_TMP/bin/kimi-cli"
  chmod +x "$TEST_TMP/bin/kimi-cli"
  PATH="$TEST_TMP/bin:/usr/bin:/bin" _agent_argv kimi text "p"
  [ "${_AGENT_ARGV[0]}" = "kimi-cli" ]
}

@test "_agent_argv deepseek → deepseek prompt" {
  _agent_argv deepseek text "p"
  [ "${_AGENT_ARGV[0]}" = "deepseek" ]
  [ "${_AGENT_ARGV[1]}" = "p" ]
}

@test "_agent_argv pi → pi -p prompt" {
  _agent_argv pi text "p"
  [ "${_AGENT_ARGV[0]}" = "pi" ]
  [ "${_AGENT_ARGV[1]}" = "-p" ]
  [ "${_AGENT_ARGV[2]}" = "p" ]
}

@test "_agent_argv codex text → codex exec prompt" {
  _agent_argv codex text "p"
  [ "${_AGENT_ARGV[0]}" = "codex" ]
  [ "${_AGENT_ARGV[1]}" = "exec" ]
  [ "${_AGENT_ARGV[2]}" = "p" ]
}

@test "_agent_argv codex peer → codex exec --json --output-last-message prompt" {
  _agent_argv codex peer "p"
  [ "${_AGENT_ARGV[0]}" = "codex" ]
  [ "${_AGENT_ARGV[1]}" = "exec" ]
  [ "${_AGENT_ARGV[2]}" = "--json" ]
  [ "${_AGENT_ARGV[3]}" = "--output-last-message" ]
  [ "${_AGENT_ARGV[4]}" = "p" ]
}

@test "_agent_argv opencode → opencode run prompt" {
  _agent_argv opencode text "p"
  [ "${_AGENT_ARGV[0]}" = "opencode" ]
  [ "${_AGENT_ARGV[1]}" = "run" ]
  [ "${_AGENT_ARGV[2]}" = "p" ]
}

@test "_agent_argv qwen → qwen prompt" {
  _agent_argv qwen text "p"
  [ "${_AGENT_ARGV[0]}" = "qwen" ]
  [ "${_AGENT_ARGV[1]}" = "p" ]
}

@test "_agent_argv unknown agent returns 1" {
  run _agent_argv bogus text "p"
  [ "$status" -eq 1 ]
}

@test "_agent_argv preserves prompts with spaces and quotes as one arg" {
  _agent_argv claude text 'hello "world" with spaces'
  [ "${_AGENT_ARGV[4]}" = 'hello "world" with spaces' ]
}

@test "_agent_cmd_str codex peer includes --json --output-last-message" {
  result=$(_agent_cmd_str codex peer "x")
  [[ "$result" == "codex exec --json --output-last-message"* ]]
}

@test "_agent_cmd_str unknown agent returns 1" {
  run _agent_cmd_str bogus text "p"
  [ "$status" -eq 1 ]
}

# _agent_skill_cmd: emits a cron-ready shell string with $(strip-frontmatter) inline.
# We stub _project_agent and exercise each agent shape.
@test "_agent_skill_cmd kimi (no kimi-* on PATH) → kimi -p \"\$(awk ...)\"" {
  _project_agent() { echo kimi; }
  PATH="/usr/bin:/bin" run _agent_skill_cmd "/tmp/skill.md"
  [ "$status" -eq 0 ]
  # FIX-133: kimi-code 非交互是 -p（无 --quiet）
  [[ "$output" == kimi\ -p\ \"\$\(awk* ]]
  [[ "$output" != *"--quiet"* ]]
  case "$output" in *"'/tmp/skill.md')\""*) :;; *) false;; esac
}

@test "_agent_skill_cmd honors explicit agent arg over project agent (FIX-134)" {
  _project_agent() { echo claude; }
  PATH="/usr/bin:/bin" run _agent_skill_cmd "/tmp/skill.md" "kimi"
  [ "$status" -eq 0 ]
  [[ "$output" == kimi\ -p\ * ]]
}

@test "_loop_cycle_agent_cmd kimi → kimi -p, no claude-only flags (FIX-134)" {
  _project_agent() { echo claude; }
  PATH="/usr/bin:/bin" run _loop_cycle_agent_cmd "/tmp/skill.md" "kimi" "/tmp/wt"
  [ "$status" -eq 0 ]
  [[ "$output" == kimi\ -p\ * ]]
  [[ "$output" != *"--verbose"* ]]
  [[ "$output" != *"stream-json"* ]]
}

@test "_loop_cycle_agent_cmd claude → adds verbose/stream-json/add-dir (FIX-134)" {
  run _loop_cycle_agent_cmd "/tmp/skill.md" "claude" "/tmp/wt"
  [ "$status" -eq 0 ]
  [[ "$output" == *"--verbose"* ]]
  [[ "$output" == *"--output-format stream-json"* ]]
  [[ "$output" == *"--add-dir \"/tmp/wt\""* ]]
}

@test "_agent_skill_cmd codex → codex exec \"\$(awk ...)\"" {
  _project_agent() { echo codex; }
  run _agent_skill_cmd "/tmp/skill.md"
  [ "$status" -eq 0 ]
  [[ "$output" == codex\ exec\ \"\$\(awk* ]]
}

@test "_agent_skill_cmd opencode → opencode run \"\$(awk ...)\"" {
  _project_agent() { echo opencode; }
  run _agent_skill_cmd "/tmp/skill.md"
  [ "$status" -eq 0 ]
  [[ "$output" == opencode\ run\ \"\$\(awk* ]]
}

@test "_agent_skill_cmd claude → uses resolved absolute claude path" {
  _project_agent() { echo claude; }
  run _agent_skill_cmd "/tmp/skill.md"
  [ "$status" -eq 0 ]
  # Output begins with either /…/claude or literal claude, then -p, then bypass flag
  [[ "$output" == *claude\ -p\ --dangerously-skip-permissions\ \"\$\(awk* ]]
}

@test "_agent_skill_cmd qwen → qwen \"\$(awk ...)\"" {
  _project_agent() { echo qwen; }
  run _agent_skill_cmd "/tmp/skill.md"
  [ "$status" -eq 0 ]
  [[ "$output" == qwen\ \"\$\(awk* ]]
}

@test "_agent_skill_cmd unknown agent returns 1" {
  _project_agent() { echo bogus; }
  run _agent_skill_cmd "/tmp/skill.md"
  [ "$status" -eq 1 ]
}
