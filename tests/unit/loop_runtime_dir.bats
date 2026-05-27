#!/usr/bin/env bats
# US-LOOP-018 / US-LOOP-019: test _loop_runtime_dir and _loop_resolve_project_path
# Uses ROLL_PROJECT_RUNTIME_DIR env override (loop-state-isolation contract).

setup() {
  local _saved_trap; _saved_trap="$(trap -p DEBUG 2>/dev/null || true)"
  trap - DEBUG
  source "${BATS_TEST_DIRNAME}/../../bin/roll"
  [[ -n "$_saved_trap" ]] && eval "$_saved_trap"
  TEST_PROJ="${BATS_TMPDIR}/test-loop-proj-${RANDOM}"
  mkdir -p "${TEST_PROJ}/.roll/loop"
}

teardown() {
  rm -rf "${TEST_PROJ}" 2>/dev/null || true
}

@test "_loop_runtime_dir returns path when ROLL_PROJECT_RUNTIME_DIR is set" {
  export ROLL_PROJECT_RUNTIME_DIR="${TEST_PROJ}/.roll/loop"
  local result
  result=$(_loop_runtime_dir "fake-slug")
  [ "$result" = "${TEST_PROJ}/.roll/loop" ]
}

@test "_loop_runtime_dir returns non-zero when slug cannot be resolved" {
  # Without env override and with a slug that has no plist/crontab/inner-script,
  # the function should return 1
  unset ROLL_PROJECT_RUNTIME_DIR
  run _loop_runtime_dir "nonexistent-slug-99999"
  [ "$status" -ne 0 ]
}

@test "_loop_resolve_project_path from plist WorkingDirectory" {
  [[ "$(uname)" == "Darwin" ]] || skip "launchd plist tests require macOS"
  local slug="test-plist-${RANDOM}"
  local plist="${HOME}/Library/LaunchAgents/com.roll.loop.${slug}.plist"
  cat > "$plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>WorkingDirectory</key>
  <string>${TEST_PROJ}</string>
</dict>
</plist>
PLIST
  local result
  result=$(_loop_resolve_project_path "$slug")
  [ "$result" = "${TEST_PROJ}" ]
  rm -f "$plist"
}

@test "_loop_runtime_dir from plist yields correct path" {
  [[ "$(uname)" == "Darwin" ]] || skip "launchd plist tests require macOS"
  local slug="test-runtime-${RANDOM}"
  local plist="${HOME}/Library/LaunchAgents/com.roll.loop.${slug}.plist"
  cat > "$plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>WorkingDirectory</key>
  <string>${TEST_PROJ}</string>
</dict>
</plist>
PLIST
  local result
  result=$(_loop_runtime_dir "$slug")
  [ "$result" = "${TEST_PROJ}/.roll/loop" ]
  rm -f "$plist"
}
