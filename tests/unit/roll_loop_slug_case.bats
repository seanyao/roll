#!/usr/bin/env bats
# Tests for FIX-056: project slug must be consistent regardless of path case
# on macOS case-insensitive filesystem.

load helpers

setup()    { unit_setup; }
teardown() { unit_teardown; }

@test "_project_slug: applies realpath case-normalization on Darwin" {
  grep -A30 '^_project_slug()' "$ROLL_BIN" | grep -q 'realpath'
}

@test "_project_slug: guards realpath normalization with Darwin uname check" {
  grep -A30 '^_project_slug()' "$ROLL_BIN" | grep -q 'Darwin'
}

@test "_project_slug: same dir with different case produces same slug (macOS only)" {
  [[ "$(uname -s)" == "Darwin" ]] || skip "macOS case-insensitive filesystem only"
  local test_dir="${TEST_TMP}/TestDir-Fix056"
  mkdir -p "$test_dir"
  local lower="${TEST_TMP}/testdir-fix056"
  local s1 s2
  s1=$(_project_slug "$test_dir")
  s2=$(_project_slug "$lower")
  [ "$s1" = "$s2" ]
}

@test "_project_slug: distinct real paths still produce distinct slugs after fix" {
  local s1 s2
  s1=$(_project_slug "/tmp/roll-fix056-aaa")
  s2=$(_project_slug "/tmp/roll-fix056-bbb")
  [ "$s1" != "$s2" ]
}
