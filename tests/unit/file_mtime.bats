#!/usr/bin/env bats

# REFACTOR-031: single helper for macOS/Linux mtime compatibility.
# Replaces four copies of `stat -c %Y ... || stat -f %m ... || echo 0`.

setup() {
  source "${BATS_TEST_DIRNAME}/../../bin/roll"
  TMPDIR_TEST=$(mktemp -d)
}

teardown() {
  rm -rf "$TMPDIR_TEST"
}

@test "_file_mtime: returns epoch seconds for existing file" {
  local f="$TMPDIR_TEST/sample"
  touch "$f"
  run _file_mtime "$f"
  [ "$status" -eq 0 ]
  [[ "$output" =~ ^[0-9]+$ ]]
  [ "$output" -gt 0 ]
}

@test "_file_mtime: returns 0 for missing file" {
  run _file_mtime "$TMPDIR_TEST/does-not-exist"
  [ "$status" -eq 0 ]
  [ "$output" = "0" ]
}

@test "_file_mtime: matches native stat output for existing file" {
  local f="$TMPDIR_TEST/sample"
  touch "$f"
  local expected
  expected=$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f" 2>/dev/null)
  run _file_mtime "$f"
  [ "$status" -eq 0 ]
  [ "$output" = "$expected" ]
}
