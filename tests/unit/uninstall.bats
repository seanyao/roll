#!/usr/bin/env bats

setup() {
  TEST_TMP="$(mktemp -d)"
}

teardown() {
  rm -rf "$TEST_TMP"
}

@test "uninstall: removes data dir for curl install" {
  mkdir -p "$TEST_TMP/.local/bin"
  mkdir -p "$TEST_TMP/.local/share/roll/bin"
  mkdir -p "$TEST_TMP/.roll"
  ln -s "$TEST_TMP/.local/share/roll/bin/roll" "$TEST_TMP/.local/bin/roll"
  echo "curl" > "$TEST_TMP/.local/share/roll/.install-method"

  echo "y" | HOME="$TEST_TMP" bash uninstall.sh >/dev/null 2>&1

  [[ ! -d "$TEST_TMP/.local/share/roll" ]]
  [[ ! -L "$TEST_TMP/.local/bin/roll" ]]
  [[ ! -d "$TEST_TMP/.roll" ]]
}

@test "uninstall: does not remove data dir for npm install" {
  mkdir -p "$TEST_TMP/.local/bin"
  mkdir -p "$TEST_TMP/.local/share/roll/bin"
  mkdir -p "$TEST_TMP/.roll"
  ln -s "/some/npm/path/bin/roll" "$TEST_TMP/.local/bin/roll"
  echo "npm" > "$TEST_TMP/.local/share/roll/.install-method"

  echo "y" | HOME="$TEST_TMP" bash uninstall.sh >/dev/null 2>&1

  # Data dir should remain because install method is npm
  [[ -d "$TEST_TMP/.local/share/roll" ]]
  [[ ! -L "$TEST_TMP/.local/bin/roll" ]]
  [[ ! -d "$TEST_TMP/.roll" ]]
}

@test "uninstall: defaults to npm when .install-method is missing" {
  mkdir -p "$TEST_TMP/.local/bin"
  mkdir -p "$TEST_TMP/.local/share/roll/bin"
  mkdir -p "$TEST_TMP/.roll"
  ln -s "/some/npm/path/bin/roll" "$TEST_TMP/.local/bin/roll"
  # No .install-method file

  echo "y" | HOME="$TEST_TMP" bash uninstall.sh >/dev/null 2>&1

  # Data dir should remain because default is npm
  [[ -d "$TEST_TMP/.local/share/roll" ]]
  [[ ! -L "$TEST_TMP/.local/bin/roll" ]]
  [[ ! -d "$TEST_TMP/.roll" ]]
}

@test "uninstall: dry-run does not remove anything" {
  mkdir -p "$TEST_TMP/.local/bin"
  mkdir -p "$TEST_TMP/.local/share/roll/bin"
  mkdir -p "$TEST_TMP/.roll"
  ln -s "$TEST_TMP/.local/share/roll/bin/roll" "$TEST_TMP/.local/bin/roll"
  echo "curl" > "$TEST_TMP/.local/share/roll/.install-method"

  HOME="$TEST_TMP" bash uninstall.sh --dry-run >/dev/null 2>&1

  # Everything should still exist
  [[ -d "$TEST_TMP/.local/share/roll" ]]
  [[ -L "$TEST_TMP/.local/bin/roll" ]]
  [[ -d "$TEST_TMP/.roll" ]]
}
