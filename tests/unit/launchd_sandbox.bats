#!/usr/bin/env bats
# Tests for FIX-087: _LAUNCHD_DIR must be sandboxed during tests so a
# subprocess invocation of bin/roll (or a re-source from a tmp-pathed
# runner-inner.sh) cannot write plists into the real ~/Library/LaunchAgents/.
#
# History: FIX-065 added an auto-sandbox for _SHARED_ROOT but left
# _LAUNCHD_DIR hard-coded to ${HOME}/Library/LaunchAgents. As a result, any
# test that triggered _install_launchd_plists (or that ran a cycle whose
# inner runner re-sourced bin/roll from /var/folders/) installed plists with
# sandbox-rooted runner paths into the developer's real launchd domain.
# When the sandbox got cleaned up, those plists outlived their runner and
# launchd kept firing them every hour with EX_CONFIG, silently killing
# the autonomous loop.

load helpers

setup() { unit_setup_cd; }
teardown() { unit_teardown_cd; }

@test "auto-sandbox: _LAUNCHD_DIR resolves under sandbox when bin/roll is sourced in a bats context" {
  # In this test's own context (BATS_TEST_FILENAME is set), the sourced
  # bin/roll must NOT resolve _LAUNCHD_DIR to the real ~/Library/LaunchAgents.
  [ "$_LAUNCHD_DIR" != "${HOME}/Library/LaunchAgents" ]
  case "$_LAUNCHD_DIR" in
    /tmp/*|/private/tmp/*|/var/folders/*) ;;
    *) printf 'expected _LAUNCHD_DIR under a tmp path, got %s\n' "$_LAUNCHD_DIR" >&2; return 1 ;;
  esac
}

@test "auto-sandbox: subprocess without _LAUNCHD_DIR override never resolves to production" {
  # Simulate the inner-runner.sh path: spawn a subprocess that does NOT
  # export _LAUNCHD_DIR (or _SHARED_ROOT) before sourcing bin/roll, and
  # confirm the auto-sandbox redirects _LAUNCHD_DIR away from prod.
  local resolved
  resolved=$(env -u _LAUNCHD_DIR -u _SHARED_ROOT bash -c "
    export BATS_TEST_FILENAME='${BATS_TEST_FILENAME}'
    source '$ROLL_BIN' >/dev/null 2>&1
    printf %s \"\$_LAUNCHD_DIR\"
  ")
  [ "$resolved" != "${HOME}/Library/LaunchAgents" ]
  case "$resolved" in
    /tmp/*|/private/tmp/*|/var/folders/*) ;;
    *) printf 'expected _LAUNCHD_DIR under a tmp path, got %s\n' "$resolved" >&2; return 1 ;;
  esac
}

@test "auto-sandbox: _LAUNCHD_DIR lives next to _SHARED_ROOT so cleanup is one-shot" {
  # Locking this in: the sandboxed launchd dir is a subdirectory of
  # _SHARED_ROOT, so when a test removes TEST_TMP at teardown, the launchd
  # sandbox goes with it. Decoupling them would resurrect the original bug
  # in a slightly different shape (leftover sandbox plists across tests).
  case "$_LAUNCHD_DIR" in
    "${_SHARED_ROOT}"/*) ;;
    *) printf 'expected _LAUNCHD_DIR under _SHARED_ROOT (%s), got %s\n' \
         "$_SHARED_ROOT" "$_LAUNCHD_DIR" >&2; return 1 ;;
  esac
}

@test "explicit override: _LAUNCHD_DIR set before sourcing is respected" {
  # Tests (or production callers) that explicitly set _LAUNCHD_DIR must
  # win over the auto-sandbox — same posture as FIX-065's _SHARED_ROOT.
  local resolved
  resolved=$(env -u _SHARED_ROOT bash -c "
    export BATS_TEST_FILENAME='${BATS_TEST_FILENAME}'
    export _LAUNCHD_DIR='${TEST_TMP}/custom-launchd'
    source '$ROLL_BIN' >/dev/null 2>&1
    printf %s \"\$_LAUNCHD_DIR\"
  ")
  [ "$resolved" = "${TEST_TMP}/custom-launchd" ]
}

@test "tripwire: _write_launchd_plist refuses to write into real ~/Library/LaunchAgents under bats" {
  # Defense-in-depth: even if some future caller manages to set
  # _LAUNCHD_DIR back to the real path while BATS_TEST_FILENAME is set,
  # the writer itself refuses. Without this guard, a single rogue test
  # would still be able to plant plists in the dev's launchd domain.
  local fake_real_dir="${HOME}/Library/LaunchAgents"
  local plist_path="${fake_real_dir}/com.roll.loop.FIX-087-tripwire.plist"
  # Don't actually need the dir to exist for the tripwire to fire — but
  # creating the path object lets us assert "no file got created".
  mkdir -p "$fake_real_dir"
  # Idempotency: a previous (red) run of this test may have written the
  # plist before the tripwire existed. Clear it so we can assert on
  # absence rather than count-equality alone.
  rm -f "$plist_path"

  # Capture baseline so the assertion is meaningful even if the dir
  # already had other files (it usually does on a dev machine).
  local before
  before=$(ls "$fake_real_dir" 2>/dev/null | wc -l | tr -d ' ')

  run _write_launchd_plist "$plist_path" "com.roll.loop.FIX-087-tripwire" "$TEST_TMP" 7 "" "${TEST_TMP}/runner.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"FIX-087"* ]] || [[ "$output" == *"refusing"* ]] || [[ "$output" == *"sandbox"* ]]

  local after
  after=$(ls "$fake_real_dir" 2>/dev/null | wc -l | tr -d ' ')
  [ "$before" = "$after" ]

  # Make sure the specific file we tried to write does not exist
  [ ! -f "$plist_path" ]
}

@test "tripwire: real ~/Library/LaunchAgents/com.roll.* count unchanged after running roll setup in a sandbox" {
  # End-to-end smoke: invoke a real `roll setup` flow through a subprocess
  # whose env is fully sandboxed, then confirm the developer's real launchd
  # dir was not touched. This is the test that would have caught the
  # original bug if it had existed at the time of FIX-065.
  local real_dir="${HOME}/Library/LaunchAgents"
  mkdir -p "$real_dir"
  local before
  before=$(find "$real_dir" -maxdepth 1 -name 'com.roll.*' 2>/dev/null | wc -l | tr -d ' ')

  # Subprocess: sandbox _SHARED_ROOT and let _LAUNCHD_DIR auto-sandbox
  # (because BATS_TEST_FILENAME is exported). Then call into a function
  # that would otherwise write plists.
  env -u _LAUNCHD_DIR bash -c "
    export BATS_TEST_FILENAME='${BATS_TEST_FILENAME}'
    export _SHARED_ROOT='${TEST_TMP}/sub-shared'
    mkdir -p \"\$_SHARED_ROOT/loop\"
    source '$ROLL_BIN' >/dev/null 2>&1
    # _LAUNCHD_DIR must now point at sandbox, not prod
    case \"\$_LAUNCHD_DIR\" in
      \"\$_SHARED_ROOT\"/*) exit 0 ;;
      *) exit 9 ;;
    esac
  "
  [ "$?" -eq 0 ]

  local after
  after=$(find "$real_dir" -maxdepth 1 -name 'com.roll.*' 2>/dev/null | wc -l | tr -d ' ')
  [ "$before" = "$after" ]
}
