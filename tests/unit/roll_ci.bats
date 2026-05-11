#!/usr/bin/env bats
# Tests for roll ci command and _loop_enforce_ci gate (FIX-024)

ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"

setup() {
  source "$ROLL_BIN"
  _orig_dir="$PWD"
  _test_dir=$(mktemp -d)
  cd "$_test_dir"
  git init -q
  git config user.email "test@roll.dev"
  git config user.name "Test"
  export _LOOP_ALERT="${_test_dir}/.alert"
}

teardown() {
  cd "$_orig_dir"
  rm -rf "$_test_dir"
}

# ─── Dispatch routing ─────────────────────────────────────────────────────────

@test "main: 'ci' subcommand is wired in dispatch table" {
  grep -qE '^\s+ci\)' "$ROLL_BIN"
}

@test "cmd_ci: function exists in bin/roll" {
  grep -qF 'cmd_ci()' "$ROLL_BIN"
}

# ─── _ci_wait function ────────────────────────────────────────────────────────

@test "_ci_wait: function exists in bin/roll" {
  grep -qF '_ci_wait()' "$ROLL_BIN"
}

@test "_ci_wait: returns 0 when gh is not installed (graceful skip)" {
  # Override PATH so gh is not found
  gh() { return 127; }
  command() {
    if [[ "$1" == "-v" && "$2" == "gh" ]]; then return 1; fi
    builtin command "$@"
  }

  run _ci_wait 10
  [ "$status" -eq 0 ]
}

@test "_ci_wait: polls gh run list with commit SHA" {
  local body
  body=$(awk '/^_ci_wait\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$body" | grep -qE 'gh run list'
}

@test "_ci_wait: uses --commit flag with current HEAD" {
  local body
  body=$(awk '/^_ci_wait\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$body" | grep -qE '\-\-commit'
}

# ─── _loop_enforce_ci function ────────────────────────────────────────────────

@test "_loop_enforce_ci: function exists in bin/roll" {
  grep -qF '_loop_enforce_ci()' "$ROLL_BIN"
}

@test "_loop_enforce_ci: returns 0 when _ci_wait succeeds" {
  _ci_wait() { return 0; }

  run _loop_enforce_ci "US-TEST-001"
  [ "$status" -eq 0 ]
}

@test "_loop_enforce_ci: returns 1 when _ci_wait fails" {
  _ci_wait() { return 1; }

  run _loop_enforce_ci "US-TEST-001"
  [ "$status" -eq 1 ]
}

@test "_loop_enforce_ci: writes ALERT file when CI fails" {
  _ci_wait() { return 1; }
  git commit --allow-empty -m "tcr: test" -q

  _loop_enforce_ci "US-TEST-001" || true

  [ -f "$_LOOP_ALERT" ]
  grep -q "US-TEST-001" "$_LOOP_ALERT"
}

@test "_loop_enforce_ci: ALERT contains commit reference" {
  _ci_wait() { return 1; }
  git commit --allow-empty -m "tcr: test" -q

  _loop_enforce_ci "US-FOO-007" || true

  grep -qE 'Commit|commit' "$_LOOP_ALERT"
}

# ─── cmd_ci function ─────────────────────────────────────────────────────────

@test "cmd_ci: accepts --wait flag without error" {
  _ci_wait() { return 0; }

  run cmd_ci --wait
  [ "$status" -eq 0 ]
}

@test "cmd_ci: rejects unknown flags" {
  run cmd_ci --bogus
  [ "$status" -ne 0 ]
}

@test "cmd_ci: handles gh not installed in non-wait mode" {
  command() {
    if [[ "$1" == "-v" && "$2" == "gh" ]]; then return 1; fi
    builtin command "$@"
  }

  run cmd_ci
  [ "$status" -eq 0 ]
}

# ─── usage documentation ─────────────────────────────────────────────────────

@test "usage: mentions 'roll ci' command" {
  local body
  body=$(awk '/^usage\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$body" | grep -qE 'roll ci|ci '
}
