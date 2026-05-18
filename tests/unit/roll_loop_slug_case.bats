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

# FIX-058: slug migration tests

@test "_slug_migrate_from_legacy: function exists" {
  declare -f _slug_migrate_from_legacy >/dev/null
}

@test "_slug_migrate_from_legacy: migrates state file from old slug to new slug" {
  local fake_loop="${TEST_TMP}/loop"
  mkdir -p "$fake_loop"
  echo "status: paused" > "${fake_loop}/state-old-aaaaaa.yaml"

  _slug_migrate_from_legacy "new-bbbbbb" "$fake_loop" "old-aaaaaa"

  [ ! -f "${fake_loop}/state-old-aaaaaa.yaml" ]
  [ -f "${fake_loop}/state-new-bbbbbb.yaml" ]
}

@test "_slug_migrate_from_legacy: migrates log and events files alongside state" {
  local fake_loop="${TEST_TMP}/loop"
  mkdir -p "$fake_loop"
  echo "status: running" > "${fake_loop}/state-old-cccccc.yaml"
  echo "cycle log"        > "${fake_loop}/cron-old-cccccc.log"
  echo '{"ts":"2026"}' > "${fake_loop}/events-old-cccccc.ndjson"

  _slug_migrate_from_legacy "new-dddddd" "$fake_loop" "old-cccccc"

  [ ! -f "${fake_loop}/state-old-cccccc.yaml" ]
  [ ! -f "${fake_loop}/cron-old-cccccc.log" ]
  [ ! -f "${fake_loop}/events-old-cccccc.ndjson" ]
  [ -f "${fake_loop}/state-new-dddddd.yaml" ]
  [ -f "${fake_loop}/cron-new-dddddd.log" ]
  [ -f "${fake_loop}/events-new-dddddd.ndjson" ]
}

@test "_slug_migrate_from_legacy: no-ops when old slug equals new slug" {
  local fake_loop="${TEST_TMP}/loop"
  mkdir -p "$fake_loop"
  echo "status: idle" > "${fake_loop}/state-same-aaaaaa.yaml"

  _slug_migrate_from_legacy "same-aaaaaa" "$fake_loop" "same-aaaaaa"

  [ -f "${fake_loop}/state-same-aaaaaa.yaml" ]
}

@test "_slug_migrate_from_legacy: no-ops when old state file does not exist" {
  local fake_loop="${TEST_TMP}/loop"
  mkdir -p "$fake_loop"

  _slug_migrate_from_legacy "new-ffffff" "$fake_loop" "old-eeeeee"

  [ ! -f "${fake_loop}/state-new-ffffff.yaml" ]
}
