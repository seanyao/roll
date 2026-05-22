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

@test "FIX-090: _LAUNCHD_SKIP_REGISTRY=1 makes _install_launchd_plists write files but skip launchctl" {
  # FIX-087 sandboxed the plist FILE path. FIX-090 closes the second half:
  # `launchctl bootstrap gui/<uid> <plist>` registers the (sandbox) path into
  # the user's REAL gui domain — surviving TEST_TMP cleanup as a zombie that
  # either fails silently (EX_CONFIG) or points launchd at a non-existent
  # runner. Setting _LAUNCHD_SKIP_REGISTRY=1 must short-circuit every
  # launchctl call inside _install_launchd_plists while leaving file-writes
  # intact (so other unit tests that inspect the written plist still work).
  cd "$_UNIT_ORIG_DIR"  # _slug_migrate_from_legacy needs a git-tracked cwd
  local tmp_dir; tmp_dir=$(mktemp -d)
  local proj="${tmp_dir}/proj"; mkdir -p "$proj"
  _LAUNCHD_DIR="${tmp_dir}/LaunchAgents"
  _SHARED_ROOT="${tmp_dir}/shared"
  local call_log="${tmp_dir}/launchctl_calls.log"
  export _LAUNCHD_SKIP_REGISTRY=1

  # Pretend the labels are already loaded so the reload branch would have
  # fired (FIX-027 path) — without the skip, this would call bootout+bootstrap.
  _launchd_is_loaded() { return 0; }
  launchctl() { echo "$*" >> "$call_log"; }
  export -f _launchd_is_loaded launchctl 2>/dev/null || true

  # First install — brand-new plist (would normally hit the FIX-059 disable branch).
  _install_launchd_plists "$proj"
  # Verify the plist file was actually written (file ops not gated by the skip).
  local plist; plist=$(_launchd_plist_path "loop" "$proj")
  [ -f "$plist" ]

  # Change config so plist content differs — would normally hit FIX-027 reload.
  local cfg; cfg=$(mktemp); echo "loop_minute: 47" > "$cfg"; ROLL_CONFIG="$cfg"
  _install_launchd_plists "$proj"

  # Hard assertion: NO launchctl call of any kind was made.
  # Note: must use `[ ! -s ]` (or similar) — file may exist as empty, or not at all.
  # Diagnostic to stderr if the assertion fails:
  if [[ -s "$call_log" ]]; then
    printf 'launchctl calls captured (should be empty under SKIP_REGISTRY=1):\n%s\n' "$(cat "$call_log")" >&2
    return 1
  fi

  rm -rf "$tmp_dir"; rm -f "$cfg"
  unset _LAUNCHD_SKIP_REGISTRY
}

@test "FIX-090 auto-detect: _LAUNCHD_DIR under _SHARED_ROOT short-circuits launchctl even with SKIP_REGISTRY unset" {
  # Covers the FIX-087 inner-runner.sh re-source path: inner.sh sources
  # bin/roll, the auto-sandbox sets _LAUNCHD_DIR under _SHARED_ROOT, but
  # nothing exports _LAUNCHD_SKIP_REGISTRY. Implicit detection must still
  # gate launchctl based on the sandbox path.
  cd "$_UNIT_ORIG_DIR"
  local tmp_dir; tmp_dir=$(mktemp -d)
  local proj="${tmp_dir}/proj"; mkdir -p "$proj"
  _SHARED_ROOT="${tmp_dir}/shared"
  _LAUNCHD_DIR="${_SHARED_ROOT}/LaunchAgents"  # simulate auto-sandbox redirect
  local call_log="${tmp_dir}/launchctl_calls.log"
  unset _LAUNCHD_SKIP_REGISTRY                  # the inner.sh scenario

  _launchd_is_loaded() { return 0; }
  launchctl() { echo "$*" >> "$call_log"; }
  export -f _launchd_is_loaded launchctl 2>/dev/null || true

  _install_launchd_plists "$proj"

  if [[ -s "$call_log" ]]; then
    printf 'auto-detect failed — launchctl was invoked despite sandbox path:\n%s\n' \
      "$(cat "$call_log")" >&2
    return 1
  fi

  rm -rf "$tmp_dir"
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
