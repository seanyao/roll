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

@test "FIX-093 tripwire: disabled-overrides db com.roll.* count unchanged after _install_launchd_plists in a sandbox" {
  # End-to-end smoke for the FIX-093 fix:
  #
  # The historical leak was: tests called `_install_launchd_plists "$proj"`
  # directly with `_LAUNCHD_DIR` and `_SHARED_ROOT` as sibling tmp dirs (so
  # FIX-090's auto-detect didn't fire) and without exporting
  # `_LAUNCHD_SKIP_REGISTRY=1` (so the explicit gate also didn't fire). The
  # `launchctl disable gui/<UID>/<label>` writes inside _install_launchd_plists
  # then hit the host's disabled-overrides db. Across ~years of test runs this
  # accumulated 6000+ ghost `"com.roll.*" => enabled` entries — the originally-
  # disable'd labels later flipped to `enabled` by FIX-081's symmetric cleanup,
  # but never *removed*.
  #
  # FIX-093 added `export _LAUNCHD_SKIP_REGISTRY=1` to `unit_setup` and
  # `unit_setup_cd` so every unit test gates `_install_launchd_plists`'s
  # launchctl calls regardless of `_LAUNCHD_DIR` placement. This tripwire
  # reproduces the exact leak path inside a subshell and asserts the host's
  # disabled-overrides db is byte-identical before/after.
  local disabled_db="/private/var/db/com.apple.xpc.launchd/disabled.$(id -u).plist"
  [[ -r "$disabled_db" ]] || skip "disabled-overrides db not readable on this host"

  local before
  before=$(/usr/bin/plutil -convert xml1 -o - "$disabled_db" 2>/dev/null \
           | grep -cE '<key>com\.roll\.' || true)

  # Reproduce the historical leak scenario exactly: _LAUNCHD_DIR and
  # _SHARED_ROOT are siblings (not parent/child), so FIX-090's auto-detect
  # would NOT fire. With FIX-093's env gate exported by unit_setup_cd, the
  # explicit `_LAUNCHD_SKIP_REGISTRY=1` MUST stop the launchctl calls.
  local leak_tmp="${TEST_TMP}/leak-repro"
  mkdir -p "${leak_tmp}/proj" "${leak_tmp}/LaunchAgents" "${leak_tmp}/shared/loop"
  cd "$_UNIT_ORIG_DIR"
  env -u _SHARED_ROOT -u _LAUNCHD_DIR bash -c "
    export BATS_TEST_FILENAME='${BATS_TEST_FILENAME}'
    export _LAUNCHD_DIR='${leak_tmp}/LaunchAgents'
    export _SHARED_ROOT='${leak_tmp}/shared'
    export _LAUNCHD_SKIP_REGISTRY=1
    source '$ROLL_BIN' >/dev/null 2>&1 || true
    _install_launchd_plists '${leak_tmp}/proj' >/dev/null 2>&1 || true
  "

  local after
  after=$(/usr/bin/plutil -convert xml1 -o - "$disabled_db" 2>/dev/null \
          | grep -cE '<key>com\.roll\.' || true)

  if [ "$before" != "$after" ]; then
    printf 'FIX-093 leak detected: com.roll.* keys in disabled.<UID>.plist went %s → %s\n' \
      "$before" "$after" >&2
    return 1
  fi
}

@test "FIX-097: _launchd_should_skip_registry returns 0 with _LAUNCHD_SKIP_REGISTRY=1" {
  export _LAUNCHD_SKIP_REGISTRY=1
  _launchd_should_skip_registry
}

@test "FIX-097: _launchd_should_skip_registry returns 0 when _LAUNCHD_DIR is under _SHARED_ROOT" {
  unset _LAUNCHD_SKIP_REGISTRY
  _SHARED_ROOT="${TEST_TMP}/shared"
  _LAUNCHD_DIR="${_SHARED_ROOT}/LaunchAgents"
  _launchd_should_skip_registry
}

@test "FIX-097: _launchd_should_skip_registry returns 1 when both env and path are production" {
  unset _LAUNCHD_SKIP_REGISTRY
  _SHARED_ROOT="${HOME}/.shared/roll"
  _LAUNCHD_DIR="${HOME}/Library/LaunchAgents"
  ! _launchd_should_skip_registry
}

@test "FIX-097: auto-sandbox block also exports _LAUNCHD_SKIP_REGISTRY=1 in a tmp-pathed subshell" {
  # Simulate a user manually reproducing a bug from /private/tmp/<dir>: the
  # auto-sandbox kicks in, but until FIX-097 the env gate was not flipped so
  # _loop_on / _loop_off / _loop_pause / _loop_resume happily called real
  # launchctl against the sandboxed plist path, leaking ghost agents.
  local resolved
  resolved=$(env -u _LAUNCHD_SKIP_REGISTRY -u _LAUNCHD_DIR -u _SHARED_ROOT bash -c "
    export BATS_TEST_FILENAME='${BATS_TEST_FILENAME}'
    source '$ROLL_BIN' >/dev/null 2>&1
    printf %s \"\${_LAUNCHD_SKIP_REGISTRY:-}\"
  ")
  [ "$resolved" = "1" ]
}

@test "FIX-097: _loop_on in sandbox does NOT invoke real launchctl load" {
  # Repro: user runs `roll loop on` from /private/tmp/<dir>. Without FIX-097,
  # _install_launchd_plists's bootstrap was gated but the second pass inside
  # _loop_on (the `launchctl load -w` block) was not — so plists got
  # registered into gui/<uid>, becoming ghost agents when the tmp dir vanished.
  cd "$_UNIT_ORIG_DIR"
  local tmp_dir; tmp_dir=$(mktemp -d)
  local proj="${tmp_dir}/proj"; mkdir -p "$proj"
  _SHARED_ROOT="${tmp_dir}/shared"; mkdir -p "${_SHARED_ROOT}/loop"
  _LAUNCHD_DIR="${_SHARED_ROOT}/LaunchAgents"
  local call_log="${tmp_dir}/launchctl_calls.log"
  export _LAUNCHD_SKIP_REGISTRY=1

  _launchd_is_loaded() { return 1; }   # force the load branch
  launchctl() { echo "$*" >> "$call_log"; }
  export -f _launchd_is_loaded launchctl 2>/dev/null || true

  cd "$proj"
  _loop_on >/dev/null 2>&1 || true

  if [[ -s "$call_log" ]]; then
    printf 'FIX-097 leak: _loop_on invoked launchctl despite skip gate:\n%s\n' \
      "$(cat "$call_log")" >&2
    return 1
  fi

  rm -rf "$tmp_dir"
  unset _LAUNCHD_SKIP_REGISTRY
}

@test "FIX-097: _loop_off in sandbox does NOT invoke real launchctl unload/enable" {
  cd "$_UNIT_ORIG_DIR"
  local tmp_dir; tmp_dir=$(mktemp -d)
  local proj="${tmp_dir}/proj"; mkdir -p "$proj"
  _SHARED_ROOT="${tmp_dir}/shared"; mkdir -p "${_SHARED_ROOT}/loop"
  _LAUNCHD_DIR="${_SHARED_ROOT}/LaunchAgents"
  local call_log="${tmp_dir}/launchctl_calls.log"
  export _LAUNCHD_SKIP_REGISTRY=1

  _launchd_is_loaded() { return 0; }   # force the unload branch
  launchctl() { echo "$*" >> "$call_log"; }
  export -f _launchd_is_loaded launchctl 2>/dev/null || true

  cd "$proj"
  _loop_off >/dev/null 2>&1 || true

  if [[ -s "$call_log" ]]; then
    printf 'FIX-097 leak: _loop_off invoked launchctl despite skip gate:\n%s\n' \
      "$(cat "$call_log")" >&2
    return 1
  fi

  rm -rf "$tmp_dir"
  unset _LAUNCHD_SKIP_REGISTRY
}

@test "FIX-097: _doctor_launchd_stale_section reports plists pointing to vanished paths" {
  [[ "$(uname)" != "Darwin" ]] && skip "macOS only — _doctor_launchd_stale_section is gated by uname=Darwin (bin/roll:905)"
  cd "$_UNIT_ORIG_DIR"
  local tmp_dir; tmp_dir=$(mktemp -d)
  _LAUNCHD_DIR="${tmp_dir}/LaunchAgents"; mkdir -p "$_LAUNCHD_DIR"

  # Plant a stale plist whose WorkingDirectory points to a removed sandbox.
  local vanished="${tmp_dir}/proj-that-was-deleted"
  cat > "${_LAUNCHD_DIR}/com.roll.loop.stale-fix097.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>Label</key><string>com.roll.loop.stale-fix097</string>
  <key>WorkingDirectory</key><string>${vanished}</string>
</dict>
</plist>
EOF
  # And a live plist whose path still exists — must NOT be reported.
  local live_proj="${tmp_dir}/proj-live"; mkdir -p "$live_proj"
  cat > "${_LAUNCHD_DIR}/com.roll.loop.live-fix097.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>Label</key><string>com.roll.loop.live-fix097</string>
  <key>WorkingDirectory</key><string>${live_proj}</string>
</dict>
</plist>
EOF

  run _doctor_launchd_stale_section
  [ "$status" -eq 0 ]
  [[ "$output" == *"stale-fix097"* ]]
  [[ "$output" != *"live-fix097"* ]]

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

# ─── FIX-098: _launchd_is_loaded probes actual registry, not disabled DB ──────

@test "FIX-098: _launchd_is_loaded returns false when plist present but launchctl print fails" {
  # Regression for the silent-cycle bug at 2026-05-23 01:18 CST.
  # Scenario: plist exists on disk, agent was bootout'd (not loaded), but the
  # disabled-overrides DB has no entry (label was never explicitly disabled).
  # Old implementation: grep print-disabled for '=> enabled' → true (false positive).
  # New implementation: launchctl print gui/<uid>/<label> → non-zero → false.
  local tmp_dir; tmp_dir=$(mktemp -d)
  local label="com.roll.loop.fix098-test-abcdef"
  local plist="${tmp_dir}/${label}.plist"
  # Write a real-looking plist (contents don't matter for this test).
  cat > "$plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.roll.loop.fix098-test-abcdef</string>
</dict></plist>
EOF

  # Stub launchctl so 'print gui/<uid>/<label>' always exits non-zero (agent not loaded)
  # while 'print-disabled' would have returned output containing '=> enabled'.
  launchctl() {
    local cmd="${1:-}"
    if [[ "$cmd" == "print" ]]; then
      # Simulate: agent is not registered in launchd
      return 1
    elif [[ "$cmd" == "print-disabled" ]]; then
      # Simulate: old behavior would have shown '=> enabled' (no explicit disable entry)
      echo "  \"${label}\" => enabled"
      return 0
    fi
    command launchctl "$@"
  }
  export -f launchctl 2>/dev/null || true

  # _launchd_is_loaded must return false — label is NOT loaded in launchd.
  run _launchd_is_loaded "$label"
  [ "$status" -ne 0 ]

  rm -rf "$tmp_dir"
}

@test "FIX-098: _launchd_is_loaded returns true when launchctl print succeeds" {
  # When launchctl print exits 0 the agent IS registered — should return true.
  local label="com.roll.loop.fix098-loaded-abcdef"

  launchctl() {
    local cmd="${1:-}"
    if [[ "$cmd" == "print" ]]; then
      # Simulate: agent is registered in launchd
      return 0
    fi
    command launchctl "$@"
  }
  export -f launchctl 2>/dev/null || true

  run _launchd_is_loaded "$label"
  [ "$status" -eq 0 ]
}

@test "FIX-098: _launchd_svc_state returns 'stale' when plist present but agent not loaded" {
  # Ensures the three-state classifier surfaces the STALE state rather than
  # falsely reporting 'enabled' when a plist exists but launchd has no record.
  local tmp_dir; tmp_dir=$(mktemp -d)
  local proj="${tmp_dir}/proj"; mkdir -p "$proj"
  _LAUNCHD_DIR="${tmp_dir}/LaunchAgents"
  _SHARED_ROOT="${tmp_dir}/shared"

  # Install the plist file so it exists on disk.
  _install_launchd_plists "$proj"

  # Now stub _launchd_is_loaded to return false (agent not in launchd).
  _launchd_is_loaded() { return 1; }

  local state; state=$(_launchd_svc_state "loop" "$proj")
  [ "$state" = "stale" ]

# ─── FIX-101: _launchctl_safe refuses to mutate launchd when sandboxed ──────

@test "FIX-101: _launchctl_safe refuses mutating ops when _LAUNCHD_DIR is sandboxed (real binary path)" {
  # FIX-101 follow-up semantic: the tripwire only blocks the REAL launchctl
  # binary. Function stubs (typical in bats) always pass through so existing
  # tests that assert against captured calls keep working. To exercise the
  # real-binary path here, unset any inherited function and use a PATH shim.
  unset -f launchctl 2>/dev/null || true
  local tmp_dir; tmp_dir=$(mktemp -d)
  _LAUNCHD_DIR="${tmp_dir}/sandbox-launchagents"
  mkdir -p "$_LAUNCHD_DIR"
  local shim_dir="${tmp_dir}/shim"; mkdir -p "$shim_dir"
  local log="${tmp_dir}/launchctl.log"
  cat > "${shim_dir}/launchctl" <<SHIM
#!/bin/bash
echo "\$*" >> "${log}"
SHIM
  chmod +x "${shim_dir}/launchctl"
  PATH="${shim_dir}:$PATH"

  _launchctl_safe bootstrap "gui/$(id -u)" "${_LAUNCHD_DIR}/com.roll.loop.fake.plist"
  _launchctl_safe bootout   "gui/$(id -u)/com.roll.loop.fake"
  _launchctl_safe enable    "gui/$(id -u)/com.roll.loop.fake"
  _launchctl_safe disable   "gui/$(id -u)/com.roll.loop.fake"
  _launchctl_safe load -w   "${_LAUNCHD_DIR}/com.roll.loop.fake.plist"
  _launchctl_safe unload -w "${_LAUNCHD_DIR}/com.roll.loop.fake.plist"

  # The PATH shim must never have been called — tripwire blocks real-binary
  # mutating ops when _LAUNCHD_DIR is sandboxed.
  [ ! -f "$log" ]

  rm -rf "$tmp_dir"
}

@test "FIX-101: _launchctl_safe passes through to function stub even when sandboxed" {
  # Bats tests routinely stub launchctl as a function while _LAUNCHD_DIR is
  # sandboxed, and assert against captured calls. The wrapper must let those
  # reach the stub — stubs don't touch host launchd, so it's safe.
  local tmp_dir; tmp_dir=$(mktemp -d)
  _LAUNCHD_DIR="${tmp_dir}/sandbox-launchagents"
  mkdir -p "$_LAUNCHD_DIR"
  local log="${tmp_dir}/launchctl.log"
  launchctl() { echo "$*" >> "$log"; }
  export -f launchctl 2>/dev/null || true

  _launchctl_safe bootstrap "gui/$(id -u)" "${_LAUNCHD_DIR}/com.roll.loop.fake.plist"
  _launchctl_safe bootout "gui/$(id -u)/com.roll.loop.fake"

  [ -f "$log" ]
  grep -q "bootstrap" "$log"
  grep -q "bootout" "$log"

  unset -f launchctl 2>/dev/null || true
  rm -rf "$tmp_dir"
}

@test "FIX-101: _launchctl_safe proxies launchctl when _LAUNCHD_DIR is canonical" {
  # Conversely, when _LAUNCHD_DIR points at the real ~/Library/LaunchAgents,
  # production callers must still get the real launchctl call. Stub launchctl
  # so we don't actually touch host launchd, but verify it was invoked.
  _LAUNCHD_DIR="${HOME}/Library/LaunchAgents"
  local tmp_dir; tmp_dir=$(mktemp -d)
  local log="${tmp_dir}/launchctl.log"
  launchctl() { echo "$*" >> "$log"; }
  export -f launchctl 2>/dev/null || true

  _launchctl_safe bootstrap "gui/$(id -u)" "${HOME}/Library/LaunchAgents/com.roll.loop.fake.plist"

  [ -f "$log" ]
  grep -q "bootstrap" "$log"

  rm -rf "$tmp_dir"
}

@test "FIX-098: roll loop on bootstraps stale agents instead of short-circuiting with 'already enabled'" {
  # The dead-code path: before FIX-098, _launchd_is_loaded returned true for a
  # stale agent, so all_loaded=true and 'roll loop on' returned early with
  # 'already enabled'. Now it must call enable+bootstrap for any unloaded label.
  [[ "$(uname)" != "Darwin" ]] && skip "macOS only — _loop_on's launchd branch is gated by uname=Darwin"
  local tmp_dir; tmp_dir=$(mktemp -d)
  local proj="${tmp_dir}/proj"; mkdir -p "$proj"
  _LAUNCHD_DIR="${tmp_dir}/LaunchAgents"
  _SHARED_ROOT="${tmp_dir}/shared"
  export _LAUNCHD_SKIP_REGISTRY=1

  # Stub _launchd_is_loaded to simulate stale (plist on disk, not in launchd).
  _launchd_is_loaded() { return 1; }

  local launchctl_log="${tmp_dir}/launchctl.log"
  launchctl() { echo "$*" >> "$launchctl_log"; }
  export -f _launchd_is_loaded launchctl 2>/dev/null || true

  # _install_launchd_plists will call launchctl; we want to capture _loop_on's calls only.
  # Pre-install the plists so _install_launchd_plists is a no-op in _loop_on.
  cd "$proj"
  _install_launchd_plists "$proj" >/dev/null 2>&1 || true
  # Reset the log — only capture _loop_on's launchctl calls.
  rm -f "$launchctl_log"

  run _loop_on
  # Must NOT print 'already enabled' (that was the false-positive path).
  [[ "$output" != *"already enabled"* ]]

  # Must have called enable and bootstrap (the real load path).
  [ -f "$launchctl_log" ]
  grep -q "enable" "$launchctl_log"
  grep -q "bootstrap" "$launchctl_log"

  cd "$_UNIT_ORIG_DIR" 2>/dev/null || true

@test "FIX-101: _launchctl_safe allows read-only ops regardless of sandbox state" {
  # Read-only subcommands (print, print-disabled, list, version) have no side
  # effects on host launchd state, so the tripwire must NOT block them even
  # when _LAUNCHD_DIR is sandboxed. _launchd_is_loaded and friends rely on
  # `launchctl print-disabled` and would break otherwise.
  local tmp_dir; tmp_dir=$(mktemp -d)
  _LAUNCHD_DIR="${tmp_dir}/sandbox-launchagents"
  mkdir -p "$_LAUNCHD_DIR"
  local log="${tmp_dir}/launchctl.log"
  launchctl() { echo "$*" >> "$log"; }
  export -f launchctl 2>/dev/null || true

  _launchctl_safe print "gui/$(id -u)/com.roll.loop.fake"
  _launchctl_safe print-disabled "gui/$(id -u)"
  _launchctl_safe list

  [ -f "$log" ]
  [ "$(wc -l < "$log" | tr -d ' ')" = "3" ]

  rm -rf "$tmp_dir"
}
