#!/usr/bin/env bats
# Tests for integration test infrastructure (FIX-016)
# The teardown helper must bootout any roll services it loaded into the
# user's launchd domain before deleting TEST_TMP, otherwise the registrations
# become ghosts with broken paths.

HELPERS="${BATS_TEST_DIRNAME}/../integration/helpers.bash"

@test "integration_teardown: invokes launchctl bootout before removing TEST_TMP" {
  grep -qF 'launchctl bootout' "$HELPERS"
  # The bootout call must appear BEFORE the rm -rf, otherwise TEST_TMP is gone
  local bootout_line rm_line
  bootout_line=$(grep -n 'launchctl bootout' "$HELPERS" | head -1 | cut -d: -f1)
  rm_line=$(grep -n 'rm -rf "$TEST_TMP"' "$HELPERS" | head -1 | cut -d: -f1)
  [[ -n "$bootout_line" && -n "$rm_line" ]]
  [[ "$bootout_line" -lt "$rm_line" ]]
}

@test "integration_teardown: targets com.roll.* labels under TEST_TMP only" {
  # Must scope to plists inside TEST_TMP, not the developer's real services
  grep -qE 'TEST_TMP.*LaunchAgents.*com\.roll' "$HELPERS"
}
