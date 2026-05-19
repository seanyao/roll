#!/usr/bin/env bats
# US-LOOP-006: cycle 写入身份归一 — `_project_slug` 必须以 `ROLL_MAIN_SLUG`
# 环境变量为最高优先级，使得 worktree / tmp / 任意 cwd 中调用都能归一到主项目身份。

load helpers

setup()    { unit_setup; }
teardown() {
  unset ROLL_MAIN_SLUG
  unit_teardown
}

@test "_project_slug: ROLL_MAIN_SLUG overrides path-based computation" {
  export ROLL_MAIN_SLUG="my-main-abc123"
  local s
  s=$(_project_slug "/tmp/some-other-place")
  [ "$s" = "my-main-abc123" ]
}

@test "_project_slug: ROLL_MAIN_SLUG wins even when called with no path argument" {
  export ROLL_MAIN_SLUG="canon-slug-zzzzzz"
  local s
  s=$(_project_slug)
  [ "$s" = "canon-slug-zzzzzz" ]
}

@test "_project_slug: empty ROLL_MAIN_SLUG is ignored (falls back to path-based)" {
  export ROLL_MAIN_SLUG=""
  local s1 s2
  s1=$(_project_slug "/tmp/roll-loop006-a")
  unset ROLL_MAIN_SLUG
  s2=$(_project_slug "/tmp/roll-loop006-a")
  [ "$s1" = "$s2" ]
}

@test "_project_slug: without ROLL_MAIN_SLUG distinct paths still differ" {
  unset ROLL_MAIN_SLUG
  local s1 s2
  s1=$(_project_slug "/tmp/roll-loop006-aaa")
  s2=$(_project_slug "/tmp/roll-loop006-bbb")
  [ "$s1" != "$s2" ]
}

# US-LOOP-006 AC1: cycle wrapper inner script must export ROLL_MAIN_SLUG so
# subprocesses (claude / loop-fmt.py / _loop_event subshells) inherit the
# main project identity regardless of where they cd to.
@test "_write_loop_runner_script: inner script exports ROLL_MAIN_SLUG with main slug" {
  ROLL_PKG_DIR="${BATS_TEST_DIRNAME}/../.."
  local script="${TEST_TMP}/run-loop006.sh"
  _write_loop_runner_script "$script" "/some/project" "claude -p hi" "${TEST_TMP}/log" 10 24
  local inner="${TEST_TMP}/run-loop006-inner.sh"
  # The exported value should be the same slug computed for the project_path
  local expected; expected=$(_project_slug "/some/project")
  grep -qE "export ROLL_MAIN_SLUG=\"${expected}\"" "$inner"
}
