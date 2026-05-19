#!/usr/bin/env bats
# US-LOOP-006: cycle 写入身份归一 —
# 在 worktree / tmp / 任意 cwd 触发 _loop_event 时，所有写入都归一到主项目 slug
# 当 ROLL_MAIN_SLUG 已设置时（cycle wrapper 会预先设置）。

load helpers

setup() {
  integration_setup
  export HOME="$TEST_TMP"
  _SHARED_ROOT="${TEST_TMP}/.shared/roll"
  mkdir -p "${_SHARED_ROOT}/loop"

  ROLL_PKG_DIR="${BATS_TEST_DIRNAME}/../.."
  export ROLL_PKG_DIR
  source "$ROLL_BIN"
  _SHARED_ROOT="${TEST_TMP}/.shared/roll"
}

teardown() {
  unset ROLL_MAIN_SLUG
  integration_teardown
}

@test "loop_event from tmp cwd writes to events-<main_slug>.ndjson when ROLL_MAIN_SLUG set" {
  local tmp_cwd="${TEST_TMP}/unrelated-tmp-dir"
  mkdir -p "$tmp_cwd"
  cd "$tmp_cwd"

  export ROLL_MAIN_SLUG="main-proj-aaaaaa"
  _loop_event story "US-X-001" "test from tmp" "" >/dev/null

  local evfile="${_SHARED_ROOT}/loop/events-main-proj-aaaaaa.ndjson"
  [ -f "$evfile" ]
  grep -q '"label":"US-X-001"' "$evfile"

  # Phantom slug file (the tmp dir's path-based slug) must NOT be created
  ! ls "${_SHARED_ROOT}/loop/events-unrelated-"*.ndjson 2>/dev/null
}

@test "loop_event without ROLL_MAIN_SLUG falls back to path-based slug (regression)" {
  local tmp_cwd="${TEST_TMP}/path-based-fallback"
  mkdir -p "$tmp_cwd"
  cd "$tmp_cwd"

  unset ROLL_MAIN_SLUG
  _loop_event story "US-Y-002" "fallback case" "" >/dev/null

  # Some events-<slug>.ndjson should exist, but not under any forced main slug
  ls "${_SHARED_ROOT}/loop/events-"*.ndjson >/dev/null
}

@test "loop_event from a worktree-like cwd respects ROLL_MAIN_SLUG (no per-worktree fragmentation)" {
  # Simulate a worktree path containing 'cycle-' in basename — without
  # ROLL_MAIN_SLUG this would fragment to a 'cycle-*' phantom slug.
  local fake_wt="${TEST_TMP}/worktrees/main-proj-cycle-20260101-000000-42"
  mkdir -p "$fake_wt"
  cd "$fake_wt"

  export ROLL_MAIN_SLUG="main-proj-bbbbbb"
  _loop_event build "US-Z-003" "5 commits" "" >/dev/null

  local evfile="${_SHARED_ROOT}/loop/events-main-proj-bbbbbb.ndjson"
  [ -f "$evfile" ]
  grep -q '"label":"US-Z-003"' "$evfile"
  ! ls "${_SHARED_ROOT}/loop/events-main-proj-cycle-"*.ndjson 2>/dev/null
}
