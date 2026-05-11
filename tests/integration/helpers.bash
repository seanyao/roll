#!/usr/bin/env bash
# Shared helpers for integration tests.
# Load with: load helpers  (from a .bats file in tests/integration/)

# Creates an isolated temp environment and sets all ROLL_ vars.
# Call in setup() of each integration test file.
integration_setup() {
  TEST_TMP="$(mktemp -d)"
  export ROLL_HOME="${TEST_TMP}/.roll"
  export ROLL_CONFIG="${ROLL_HOME}/config.yaml"
  export ROLL_GLOBAL="${ROLL_HOME}/conventions/global"
  export ROLL_TEMPLATES="${ROLL_HOME}/conventions/templates"

  # Fake AI client dirs so sync/link operations have targets
  mkdir -p "${TEST_TMP}/.claude"
  mkdir -p "${TEST_TMP}/.gemini"

  # Convenience: absolute path to the binary under test
  ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"
}

# Cleans up the temp tree after each test.
# IMPORTANT: bootout any roll services the test loaded into the user's launchd
# domain (via `roll loop on`) BEFORE deleting TEST_TMP. Otherwise the launchd
# registration outlives the plist file, leaving a ghost service whose path no
# longer exists. See FIX-016.
integration_teardown() {
  if [[ -n "${TEST_TMP:-}" ]]; then
    if [[ "$(uname)" == "Darwin" ]] && [[ -d "${TEST_TMP}/Library/LaunchAgents" ]]; then
      for plist in "${TEST_TMP}/Library/LaunchAgents"/com.roll.*.plist; do
        [[ -f "$plist" ]] || continue
        local label
        label=$(grep -A1 '<key>Label</key>' "$plist" | grep '<string>' \
                | sed 's/.*<string>\(.*\)<\/string>.*/\1/')
        [[ -n "$label" ]] && launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
      done
    fi
    rm -rf "$TEST_TMP"
  fi
}

# Run roll with TEST_TMP as HOME and cwd so ~ expansions resolve inside the
# sandbox AND project-slug-derived labels are unique (don't collide with the
# developer's real loaded services).
# Usage: run_roll <cmd> [args...]
run_roll() {
  ROLL_HOME="${ROLL_HOME}" HOME="${TEST_TMP}" run bash -c "cd \"${TEST_TMP}\" && bash \"$ROLL_BIN\" \"\$@\"" -- "$@"
}
