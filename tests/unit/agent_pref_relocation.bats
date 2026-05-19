#!/usr/bin/env bats
# REFACTOR-040: per-machine agent preference moved from `.roll.yaml` (project
# root) to `.roll/local.yaml`. Both locations are gitignored, but the new
# location keeps the project root clean and groups the file with other
# per-machine state inside .roll/.

load helpers
setup()    { unit_setup_cd; }
teardown() { unit_teardown_cd; }

@test "_project_agent: prefers new .roll/local.yaml when present" {
  mkdir -p .roll
  echo "agent: deepseek" > .roll/local.yaml
  # Legacy file with a different value — new location must win.
  echo "agent: kimi" > .roll.yaml

  local out; out=$(_project_agent)
  [ "$out" = "deepseek" ]
}

@test "_project_agent: falls back to legacy .roll.yaml when new file is absent" {
  echo "agent: codex" > .roll.yaml
  local out; out=$(_project_agent)
  [ "$out" = "codex" ]
}

@test "_project_agent: defaults to claude when neither file exists" {
  local out; out=$(_project_agent)
  [ "$out" = "claude" ]
}

@test "roll agent use: writes to .roll/local.yaml, not the project root" {
  # Stub the noisy side effects so the function-under-test runs cleanly.
  err()  { echo "ERR: $*" >&2; }
  warn() { echo "WARN: $*" >&2; }
  ok()   { echo "OK: $*"; }
  _install_launchd_plists() { :; }
  _SHARED_ROOT="$TEST_TMP/shared"
  mkdir -p "$_SHARED_ROOT/loop"

  run cmd_agent use kimi
  [ "$status" -eq 0 ]
  [ -f .roll/local.yaml ]
  grep -qF 'agent: kimi' .roll/local.yaml
  [ ! -f .roll.yaml ]
}

@test "roll agent use: migrates value from legacy .roll.yaml and removes empty file" {
  err()  { echo "ERR: $*" >&2; }
  warn() { echo "WARN: $*" >&2; }
  ok()   { echo "OK: $*"; }
  _install_launchd_plists() { :; }
  _SHARED_ROOT="$TEST_TMP/shared"
  mkdir -p "$_SHARED_ROOT/loop"

  echo "agent: claude" > .roll.yaml
  run cmd_agent use deepseek
  [ "$status" -eq 0 ]

  # New file holds the new value
  grep -qF 'agent: deepseek' .roll/local.yaml
  # Legacy file is gone (was empty after stripping the agent line)
  [ ! -f .roll.yaml ]
}

@test "roll agent use: preserves unrelated keys in legacy .roll.yaml" {
  err()  { echo "ERR: $*" >&2; }
  warn() { echo "WARN: $*" >&2; }
  ok()   { echo "OK: $*"; }
  _install_launchd_plists() { :; }
  _SHARED_ROOT="$TEST_TMP/shared"
  mkdir -p "$_SHARED_ROOT/loop"

  printf 'agent: claude\nother: keepme\n' > .roll.yaml
  run cmd_agent use codex
  [ "$status" -eq 0 ]

  grep -qF 'agent: codex' .roll/local.yaml
  # Legacy file still exists because it had a non-agent line
  [ -f .roll.yaml ]
  grep -qF 'other: keepme' .roll.yaml
  ! grep -q '^agent:' .roll.yaml
}
