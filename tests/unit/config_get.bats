#!/usr/bin/env bats

# Load the script (sourcing defines all functions without executing main)
setup() {
  source "${BATS_TEST_DIRNAME}/../../bin/roll"
  # Override ROLL_CONFIG after sourcing — the script assigns ROLL_CONFIG on load,
  # so we must set it afterwards to point at our fixture.
  export ROLL_CONFIG="${BATS_TEST_DIRNAME}/../fixtures/configs/basic.yaml"
}

@test "config_get: returns value for existing key" {
  run config_get "editor"
  [ "$status" -eq 0 ]
  [ "$output" = "vim" ]
}

@test "config_get: returns default for missing key" {
  run config_get "nonexistent_key" "fallback_value"
  [ "$status" -eq 0 ]
  [ "$output" = "fallback_value" ]
}

@test "config_get: expands ~ to HOME" {
  run config_get "sync_claude"
  [ "$status" -eq 0 ]
  [ "$output" = "${HOME}/.claude/CLAUDE.md" ]
}

@test "config_get: returns default when config file missing" {
  export ROLL_CONFIG="/tmp/roll_nonexistent_config_$$.yaml"
  run config_get "editor" "default_editor"
  [ "$status" -eq 0 ]
  [ "$output" = "default_editor" ]
}

@test "config_get: returns default when value is empty" {
  run config_get "empty_val" "default_for_empty"
  [ "$status" -eq 0 ]
  [ "$output" = "default_for_empty" ]
}

# FIX-082: inline `#` comments must be stripped from the value so users can
# annotate ~/.roll/config.yaml without silently falling back to defaults.

@test "config_get: strips inline comment from numeric value (FIX-082)" {
  export ROLL_CONFIG="${BATS_TEST_DIRNAME}/../fixtures/configs/with-comments.yaml"
  run config_get "loop_active_start"
  [ "$status" -eq 0 ]
  [ "$output" = "0" ]
}

@test "config_get: strips inline comment from string value (FIX-082)" {
  export ROLL_CONFIG="${BATS_TEST_DIRNAME}/../fixtures/configs/with-comments.yaml"
  run config_get "editor"
  [ "$status" -eq 0 ]
  [ "$output" = "vim" ]
}

@test "config_get: strips inline comment from pipe-separated path (FIX-082)" {
  export ROLL_CONFIG="${BATS_TEST_DIRNAME}/../fixtures/configs/with-comments.yaml"
  run config_get "ai_claude"
  [ "$status" -eq 0 ]
  [ "$output" = "${HOME}/.claude|CLAUDE.md|CLAUDE.md" ]
}

@test "config_get: value without comment unchanged (FIX-082)" {
  export ROLL_CONFIG="${BATS_TEST_DIRNAME}/../fixtures/configs/with-comments.yaml"
  run config_get "nocomment"
  [ "$status" -eq 0 ]
  [ "$output" = "pureval" ]
}
