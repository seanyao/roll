#!/usr/bin/env bats
# IDEA-051 (→ US-DREAM-001): dream/brief cron logs must be project-local
# (<project>/.roll/{dream,brief}/cron.log), mirroring loop's FIX-139 cron.log.
# Project-intrinsic run history belongs inside the project — visible to git
# status / IDE — not buried in ~/.shared/roll/{dream,brief}/cron-<slug>.log.

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

# ── _install_launchd_plists wires dream/brief runners at project-local cron.log ─

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

@test "_install_launchd_plists: brief runner writes to <project>/.roll/brief/cron.log" {
  run _install_launchd_plists "$PROJ"
  [ "$status" -eq 0 ]
  local slug; slug=$(_project_slug "$PROJ")
  local runner="${_SHARED_ROOT}/brief/run-${slug}.sh"
  [ -f "$runner" ]
  grep -qF ">> \"${PROJ}/.roll/brief/cron.log\"" "$runner"
  ! grep -qF "brief/cron-${slug}.log" "$runner"
}

@test "_install_launchd_plists: creates project-local dream/brief log dirs" {
  run _install_launchd_plists "$PROJ"
  [ "$status" -eq 0 ]
  [ -d "${PROJ}/.roll/dream" ]
  [ -d "${PROJ}/.roll/brief" ]
}

# ── static guards: no shared cross-project dream/brief cron-<slug>.log remains ──

@test "bin/roll: no shared dream/cron-<slug>.log redirect remains" {
  # A shared ~/.shared/roll/dream/cron-<slug>.log would re-bury project history.
  ! grep -nE 'dream/cron-\$\{?slug' "$ROLL_BIN"
}

@test "bin/roll: no shared brief/cron-<slug>.log redirect remains" {
  ! grep -nE 'brief/cron-\$\{?slug' "$ROLL_BIN"
}

# ── Linux crontab generation also uses project-local paths ─────────────────────

@test "bin/roll: Linux dream_cmd writes to project-local .roll/dream/cron.log" {
  grep -q '>> \${project_path}/.roll/dream/cron.log 2>&1' "$ROLL_BIN"
}

@test "bin/roll: Linux brief_cmd writes to project-local .roll/brief/cron.log" {
  grep -q '>> \${project_path}/.roll/brief/cron.log 2>&1' "$ROLL_BIN"
}

@test "bin/roll: no _SHARED_ROOT dream/brief cron-<slug>.log references remain" {
  run grep -nE '_SHARED_ROOT}/dream/cron-|_SHARED_ROOT}/brief/cron-' "$ROLL_BIN"
  [ "$status" -ne 0 ] || [ -z "$output" ]
}
