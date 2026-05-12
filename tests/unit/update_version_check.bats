#!/usr/bin/env bats

load helpers
setup() {
  unit_setup
  mkdir -p "$TEST_TMP/bin" "$TEST_TMP/modules/@seanyao/roll/bin"
}
teardown() { unit_teardown; }

_make_npm_stub() {
  local registry_ver="$1"
  local installed_ver="$2"
  cat > "$TEST_TMP/modules/@seanyao/roll/bin/roll" <<ROLLEOF
VERSION="$installed_ver"
ROLLEOF
  cat > "$TEST_TMP/bin/npm" <<NPMEOF
#!/bin/bash
case "\$1" in
  view)    echo "$registry_ver" ;;
  root)    echo "$TEST_TMP/modules" ;;
  install) : ;;
  cache)   : ;;
esac
NPMEOF
  chmod +x "$TEST_TMP/bin/npm"
}

@test "_check_installed_version_or_retry: no-op when versions match" {
  _make_npm_stub "2026.507.2" "2026.507.2"
  PATH="$TEST_TMP/bin:$PATH" run _check_installed_version_or_retry
  [ "$status" -eq 0 ]
  [[ "$output" != *"mismatch"* ]]
}

@test "_check_installed_version_or_retry: warns and retries on mismatch" {
  _make_npm_stub "2026.507.2" "2026.507.1"
  PATH="$TEST_TMP/bin:$PATH" run _check_installed_version_or_retry
  [ "$status" -eq 0 ]
  [[ "$output" == *"mismatch"* ]] || [[ "$output" == *"Version mismatch"* ]]
}

@test "_check_installed_version_or_retry: silent when npm view unavailable" {
  # npm not in PATH → graceful skip
  PATH="/usr/bin:/bin" run _check_installed_version_or_retry
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "_notify_update: exits 0 when update cache is missing" {
  ROLL_HOME="$TEST_TMP/no-roll-home"
  run _notify_update
  [ "$status" -eq 0 ]
}
