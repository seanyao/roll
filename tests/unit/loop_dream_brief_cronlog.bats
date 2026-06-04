#!/usr/bin/env bats
# IDEA-051 (→ US-DREAM-001): the dream cron log must be project-local
# (<project>/.roll/dream/cron.log), mirroring loop's FIX-139 cron.log.
# Project-intrinsic run history belongs inside the project — visible to git
# status / IDE — not buried in ~/.shared/roll/dream/cron-<slug>.log.
#
# FIX-195: the brief loop was fully retired (launchd + Linux crontab + config).
# Only loop/dream/pr remain as scheduled services; the brief assertions here
# became guards that brief is gone.

load helpers

setup() {
  unit_setup
  # FIX-093/FIX-097: never touch the host launchctl registry from a unit test.
  export _LAUNCHD_SKIP_REGISTRY=1
  export _LAUNCHD_DIR="${TEST_TMP}/LaunchAgents"
  mkdir -p "$_LAUNCHD_DIR"
  # Minimal project fixture so _install_launchd_plists can write runner scripts.
  PROJ="${TEST_TMP}/proj-idea051"
  mkdir -p "$PROJ"
}
teardown() { unit_teardown; }

# ── _install_launchd_plists wires the dream runner at a project-local cron.log ──

@test "_install_launchd_plists: dream runner writes to <project>/.roll/dream/cron.log" {
  run _install_launchd_plists "$PROJ"
  [ "$status" -eq 0 ]
  local slug; slug=$(_project_slug "$PROJ")
  local runner="${_SHARED_ROOT}/dream/run-${slug}.sh"
  [ -f "$runner" ]
  grep -qF ">> \"${PROJ}/.roll/dream/cron.log\"" "$runner"
  # Legacy shared per-slug cron log must NOT be the redirect target.
  ! grep -qF "dream/cron-${slug}.log" "$runner"
}

@test "_install_launchd_plists: creates project-local dream log dir" {
  run _install_launchd_plists "$PROJ"
  [ "$status" -eq 0 ]
  [ -d "${PROJ}/.roll/dream" ]
}

# ── static guards: no shared cross-project dream cron-<slug>.log remains ────────

@test "bin/roll: no shared dream/cron-<slug>.log redirect remains" {
  # A shared ~/.shared/roll/dream/cron-<slug>.log would re-bury project history.
  ! grep -nE 'dream/cron-\$\{?slug' "$ROLL_BIN"
}

# ── Linux crontab generation also uses project-local paths ─────────────────────

@test "bin/roll: Linux dream_cmd writes to project-local .roll/dream/cron.log" {
  grep -q '>> \${project_path}/.roll/dream/cron.log 2>&1' "$ROLL_BIN"
}

@test "bin/roll: no _SHARED_ROOT dream cron-<slug>.log references remain" {
  run grep -nE '_SHARED_ROOT}/dream/cron-' "$ROLL_BIN"
  [ "$status" -ne 0 ] || [ -z "$output" ]
}

# ── FIX-195: brief loop fully removed from the scheduler ────────────────────────

@test "FIX-195: bin/roll installs no brief cron/launchd loop" {
  # No brief command wired into the Linux crontab generator…
  ! grep -q 'brief_cmd=' "$ROLL_BIN"
  # …and no brief schedule keys read for the loop.
  ! grep -qE 'loop_brief_(hour|minute)' "$ROLL_BIN"
}
