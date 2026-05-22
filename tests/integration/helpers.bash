#!/usr/bin/env bash
# Shared helpers for integration tests.
# Load with: load helpers  (from a .bats file in tests/integration/)

# US-QA-004: standardised precondition helpers (require_not_in_real_loop, ...)
# shellcheck source=../preconditions.bash
source "${BATS_TEST_DIRNAME}/../preconditions.bash"

# Creates an isolated temp environment and sets all ROLL_ vars.
# Call in setup() of each integration test file.
integration_setup() {
  TEST_TMP="$(mktemp -d)"
  # FIX-065: pin _SHARED_ROOT to TEST_TMP so every subshell that sources
  # bin/roll inherits the same loop state path. The auto-sandbox in bin/roll
  # falls back to a per-PID dir which fragments state across subshells; pinning
  # it here keeps alert/mute/state files visible to follow-up `roll` calls.
  export _SHARED_ROOT="${TEST_TMP}/.shared/roll"
  mkdir -p "${_SHARED_ROOT}/loop"
  export ROLL_HOME="${TEST_TMP}/.roll"
  export ROLL_CONFIG="${ROLL_HOME}/config.yaml"
  export ROLL_GLOBAL="${ROLL_HOME}/conventions/global"
  export ROLL_TEMPLATES="${ROLL_HOME}/conventions/templates"
  # FIX-090: by default integration tests must NOT mutate the host launchctl
  # registry. _install_launchd_plists still writes plist files (so tests that
  # inspect plist content keep working) but launchctl bootstrap/bootout/disable
  # are short-circuited. The one test file that genuinely exercises launchctl
  # (cmd_loop.bats) opts back in by `unset _LAUNCHD_SKIP_REGISTRY` in its setup.
  export _LAUNCHD_SKIP_REGISTRY=1

  # US-ONBOARD-004: existing tests use legacy structure fixtures (.roll/backlog.md etc.)
  # Bypass structure check until Story 5 migrates fixtures. New tests explicitly
  # testing structure enforcement should unset this.
  export ROLL_SKIP_STRUCTURE_CHECK=1

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
#
# FIX-093: must use `/bin/launchctl` absolute path so the PATH shim that
# cmd_loop.bats installs is bypassed — this teardown is defensive cleanup of
# any *real* registration that escaped both `_LAUNCHD_SKIP_REGISTRY=1` and
# the shim. Going through the shim here would be a no-op (its state is
# already torn down with TEST_TMP) and would miss any actual leak.
#
# FIX-093: ALSO removed the symmetric `launchctl enable` call that FIX-081
# added. `enable` on a never-disabled label can itself ADD a `"LABEL" =>
# enabled` entry to the host's disabled-overrides db — which is exactly the
# ghost pollution this whole patch series is trying to stop. With FIX-090 +
# the unit_setup gate + the cmd_loop.bats shim, no test path should reach a
# real `launchctl disable` anymore, so the symmetric enable is unnecessary.
integration_teardown() {
  if [[ -n "${TEST_TMP:-}" ]]; then
    if [[ "$(uname)" == "Darwin" ]] && [[ -d "${TEST_TMP}/Library/LaunchAgents" ]]; then
      for plist in "${TEST_TMP}/Library/LaunchAgents"/com.roll.*.plist; do
        [[ -f "$plist" ]] || continue
        local label
        label=$(grep -A1 '<key>Label</key>' "$plist" | grep '<string>' \
                | sed 's/.*<string>\(.*\)<\/string>.*/\1/')
        if [[ -n "$label" ]]; then
          /bin/launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
        fi
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

# FIX-052: returns the per-project loop state path bin/roll would use given
# the test's TEST_TMP cwd (or an explicit project path argument).
# Usage: roll_loop_path <alert|state|mute|cron> [project_path]
# Mirrors bin/roll's _project_slug + per-project file naming so integration
# tests don't need to duplicate the slug algorithm.
roll_loop_path() {
  local kind="$1" proj="${2:-$TEST_TMP}"
  bash -c "cd \"$proj\" 2>/dev/null && HOME=\"$TEST_TMP\" source \"$ROLL_BIN\" && \
    case \"$kind\" in \
      alert) printf '%s\\n' \"\$_LOOP_ALERT\" ;; \
      state) printf '%s\\n' \"\$_LOOP_STATE\" ;; \
      mute)  printf '%s\\n' \"\$_LOOP_MUTE_FILE\" ;; \
      cron)  printf '%s/loop/cron-%s.log\\n' \"\$_SHARED_ROOT\" \"\$_LOOP_PROJ_SLUG\" ;; \
    esac" 2>/dev/null
}
