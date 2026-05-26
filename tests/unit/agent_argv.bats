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

@test "_agent_argv kimi → kimi --quiet -p prompt" {
  _agent_argv kimi text "p"
  [ "${_AGENT_ARGV[0]}" = "kimi" ]
  [ "${_AGENT_ARGV[1]}" = "--quiet" ]
  [ "${_AGENT_ARGV[2]}" = "-p" ]
  [ "${_AGENT_ARGV[3]}" = "p" ]
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
@test "_agent_skill_cmd kimi → kimi --quiet -p \"\$(awk ...)\"" {
  _project_agent() { echo kimi; }
  run _agent_skill_cmd "/tmp/skill.md"
  [ "$status" -eq 0 ]
  [[ "$output" == kimi\ --quiet\ -p\ \"\$\(awk* ]]
  case "$output" in *"'/tmp/skill.md')\""*) :;; *) false;; esac
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
