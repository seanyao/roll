#!/usr/bin/env bats
# US-LOOP-006: cycle wrapper must export ROLL_MAIN_SLUG so every subprocess
# inherits the main-project identity. Generated runner scripts are inspected
# directly — invoking them end-to-end requires launchd / claude, which integration
# tests cannot drive. The contract is the exported variable in the inner script.

load helpers

setup()    { integration_setup; }
teardown() { integration_teardown; }

# Source bin/roll into the test shell so _write_loop_runner_script is callable.
_source_roll() {
  # shellcheck disable=SC1090
  source "$ROLL_BIN"
}

@test "_write_loop_runner_script: inner script exports ROLL_MAIN_SLUG" {
  _source_roll
  local out_dir="${TEST_TMP}/loop"
  mkdir -p "$out_dir"
  local script_path="${out_dir}/run-projid-aaa111.sh"
  _write_loop_runner_script "$script_path" "/tmp/projid-loop006" "echo hi" "/tmp/log" 0 24
  local inner_path="${script_path%.sh}-inner.sh"
  [ -f "$inner_path" ]
  # Exported (not bare assignment) so child processes inherit
  grep -qE '^export ROLL_MAIN_SLUG=' "$inner_path"
}

@test "_write_loop_runner_script: inner ROLL_MAIN_SLUG value matches main-repo slug" {
  _source_roll
  local out_dir="${TEST_TMP}/loop"
  mkdir -p "$out_dir"
  local proj="/tmp/projid-loop006-match"
  local expected; expected=$(_project_slug "$proj")
  local script_path="${out_dir}/run-projid-bbb222.sh"
  _write_loop_runner_script "$script_path" "$proj" "echo hi" "/tmp/log" 0 24
  local inner_path="${script_path%.sh}-inner.sh"
  grep -qE "^export ROLL_MAIN_SLUG=\"${expected}\"" "$inner_path"
}

@test "_loop_event: writes events under main slug when ROLL_MAIN_SLUG is set" {
  _source_roll
  export _SHARED_ROOT="${TEST_TMP}/shared"
  export ROLL_MAIN_SLUG="mainproj-zzzzzz"
  mkdir -p "${_SHARED_ROOT}/loop"

  # Invoke from a non-git tmp dir on purpose — the legacy fallback would slug
  # this as basename of cwd ("nogit-tmp-*"). With ROLL_MAIN_SLUG honored,
  # _loop_event must write to events-mainproj-zzzzzz.ndjson.
  local nogit="${TEST_TMP}/nogit-tmp-loop006"
  mkdir -p "$nogit"
  ( cd "$nogit" && _loop_event story "US-LOOP-006" "test" "" >/dev/null )

  local expected_file="${_SHARED_ROOT}/loop/events-mainproj-zzzzzz.ndjson"
  [ -f "$expected_file" ]
  grep -q '"label":"US-LOOP-006"' "$expected_file"

  # No tmp-* / nogit-* event file leaked
  ! ls "${_SHARED_ROOT}/loop/" | grep -E '^events-(tmp-|nogit-)' >/dev/null
}

@test "runner inner script: runs.jsonl jq invocation uses baked main slug for project field" {
  _source_roll
  local out_dir="${TEST_TMP}/loop"
  mkdir -p "$out_dir"
  local proj="/tmp/projid-loop006-runs"
  local expected; expected=$(_project_slug "$proj")
  local script_path="${out_dir}/run-projid-ccc333.sh"
  _write_loop_runner_script "$script_path" "$proj" "echo hi" "/tmp/log" 0 24
  local inner_path="${script_path%.sh}-inner.sh"
  # The jq --arg project line must reference the expected slug literally so
  # runs.jsonl `project` is bound to the main slug, not derived from cwd at run time.
  grep -qE "^[[:space:]]*--arg project \"${expected}\"" "$inner_path"
}
