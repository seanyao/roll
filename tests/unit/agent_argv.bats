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
