#!/usr/bin/env bats
# Tests for _gh_available predicate (REFACTOR-018)

load helpers

setup() { unit_setup_cd; }
teardown() { unit_teardown_cd; }

@test "_gh_available: function exists in bin/roll" {
  grep -qF '_gh_available()' "$ROLL_BIN"
}

@test "_gh_available: returns 0 when gh is in PATH" {
  # Stub a fake gh that exists
  local fake_bin="$TEST_TMP/bin"
  mkdir -p "$fake_bin"
  touch "$fake_bin/gh"
  chmod +x "$fake_bin/gh"
  PATH="$fake_bin:$PATH" run _gh_available
  [ "$status" -eq 0 ]
}

@test "_gh_available: returns 1 when gh is not in PATH" {
  # Override PATH so gh cannot be found
  PATH="/nonexistent" run _gh_available
  [ "$status" -ne 0 ]
}

@test "_gh_available: produces no output" {
  PATH="/nonexistent" run _gh_available
  [ -z "$output" ]
}

@test "_loop_precheck_ci: returns 0 when _gh_available is false (regression)" {
  _gh_available() { return 1; }
  run _loop_precheck_ci
  [ "$status" -eq 0 ]
}

@test "_loop_publish_pr: returns 2 when _gh_available is false (regression)" {
  git init -q
  git config user.email "test@roll.dev"
  git config user.name "Test"
  _gh_available() { return 1; }
  _worktree_alert() { true; }
  run _loop_publish_pr "loop/test-branch"
  [ "$status" -eq 2 ]
}

@test "_dash_ci_status: echoes 'none' when _gh_available is false (regression)" {
  _gh_available() { return 1; }
  run _dash_ci_status
  [ "$status" -eq 0 ]
  [ "$output" = "none" ]
}
