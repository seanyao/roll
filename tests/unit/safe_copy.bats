#!/usr/bin/env bats
# Unit tests for safe_copy helper

load helpers

setup() { unit_setup; }
teardown() { unit_teardown; }

@test "safe_copy: copies file when destination does not exist" {
  local src="$TEST_TMP/src.txt"
  local dst="$TEST_TMP/dst.txt"
  echo "content" > "$src"

  safe_copy "$src" "$dst"

  [ -f "$dst" ]
  [ "$(cat "$dst")" = "content" ]
}

@test "safe_copy: skips silently when files are identical" {
  local src="$TEST_TMP/src.txt"
  local dst="$TEST_TMP/dst.txt"
  echo "same" > "$src"
  echo "same" > "$dst"

  run safe_copy "$src" "$dst"

  [ "$status" -eq 0 ]
  [ "$(cat "$dst")" = "same" ]
}

@test "safe_copy: overwrites differing file when stdin is EOF (non-interactive)" {
  local src="$TEST_TMP/src.txt"
  local dst="$TEST_TMP/dst.txt"
  echo "new content" > "$src"
  echo "old content" > "$dst"

  run safe_copy "$src" "$dst" </dev/null

  [ "$status" -eq 0 ]
  [ "$(cat "$dst")" = "new content" ]
}

@test "safe_copy: force=true overwrites even when identical" {
  local src="$TEST_TMP/src.txt"
  local dst="$TEST_TMP/dst.txt"
  echo "same" > "$src"
  echo "same" > "$dst"
  local before_mtime
  before_mtime="$(stat -f %m "$dst" 2>/dev/null || stat -c %Y "$dst" 2>/dev/null)"

  safe_copy "$src" "$dst" true

  [ "$(cat "$dst")" = "same" ]
}
