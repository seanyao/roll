#!/usr/bin/env bats
# US-LOOP-019: test _loop_migrate_legacy_paths and _loop_control_state_path
# Uses ROLL_PROJECT_RUNTIME_DIR env override (loop-state-isolation contract).

setup() {
  local _saved_trap; _saved_trap="$(trap -p DEBUG 2>/dev/null || true)"
  trap - DEBUG
  source "${BATS_TEST_DIRNAME}/../../bin/roll"
  [[ -n "$_saved_trap" ]] && eval "$_saved_trap"
  TEST_PROJ="${BATS_TMPDIR}/test-cp-migrate-${RANDOM}"
  mkdir -p "${TEST_PROJ}/.roll/loop"
  LEGACY_DIR="${BATS_TMPDIR}/legacy-loop-${RANDOM}"
  mkdir -p "$LEGACY_DIR"
  export ROLL_PROJECT_RUNTIME_DIR="${TEST_PROJ}/.roll/loop"
}

teardown() {
  rm -rf "${TEST_PROJ}" "${LEGACY_DIR}" 2>/dev/null || true
}

@test "_loop_migrate_legacy_paths copies state yaml" {
  local slug="test-abc123"
  echo "status: idle" > "${LEGACY_DIR}/state-${slug}.yaml"

  _loop_migrate_legacy_paths "$slug" "$LEGACY_DIR"

  [ -f "${TEST_PROJ}/.roll/loop/state-${slug}.yaml" ]
  [ "$(cat "${TEST_PROJ}/.roll/loop/state-${slug}.yaml")" = "status: idle" ]
}

@test "_loop_migrate_legacy_paths marks legacy as migrated" {
  local slug="test-abc123"
  echo "status: idle" > "${LEGACY_DIR}/state-${slug}.yaml"

  _loop_migrate_legacy_paths "$slug" "$LEGACY_DIR"

  # Old file should be renamed to .migrated-<timestamp>
  [ ! -f "${LEGACY_DIR}/state-${slug}.yaml" ]
  local migrated; migrated=$(ls "${LEGACY_DIR}/state-${slug}.yaml.migrated-"* 2>/dev/null | head -1)
  [ -n "$migrated" ]
}

@test "_loop_migrate_legacy_paths is idempotent" {
  local slug="test-abc123"
  echo "status: idle" > "${LEGACY_DIR}/state-${slug}.yaml"

  _loop_migrate_legacy_paths "$slug" "$LEGACY_DIR"
  # Second run should not fail
  run _loop_migrate_legacy_paths "$slug" "$LEGACY_DIR"
  [ "$status" -eq 0 ]
  # Target file should still have original content
  [ "$(cat "${TEST_PROJ}/.roll/loop/state-${slug}.yaml")" = "status: idle" ]
}

@test "_loop_migrate_legacy_paths skips already migrated files" {
  local slug="test-abc123"
  echo "status: idle" > "${LEGACY_DIR}/state-${slug}.yaml"
  # Pre-mark as migrated
  touch "${LEGACY_DIR}/state-${slug}.yaml.migrated-12345"

  _loop_migrate_legacy_paths "$slug" "$LEGACY_DIR"

  # Should not have copied (already migrated)
  [ ! -f "${TEST_PROJ}/.roll/loop/state-${slug}.yaml" ]
}

@test "_loop_migrate_legacy_paths skips when target already exists" {
  local slug="test-abc123"
  echo "status: idle" > "${LEGACY_DIR}/state-${slug}.yaml"
  echo "status: running" > "${TEST_PROJ}/.roll/loop/state-${slug}.yaml"

  _loop_migrate_legacy_paths "$slug" "$LEGACY_DIR"

  # Target should not be overwritten
  [ "$(cat "${TEST_PROJ}/.roll/loop/state-${slug}.yaml")" = "status: running" ]
  # Legacy should still be marked as migrated
  [ ! -f "${LEGACY_DIR}/state-${slug}.yaml" ]
}

@test "_loop_migrate_legacy_paths migrates ALERT PAUSE mute" {
  local slug="test-abc123"
  echo "## Alert" > "${LEGACY_DIR}/ALERT-${slug}.md"
  touch "${LEGACY_DIR}/PAUSE-${slug}"
  touch "${LEGACY_DIR}/mute-${slug}"

  _loop_migrate_legacy_paths "$slug" "$LEGACY_DIR"

  [ -f "${TEST_PROJ}/.roll/loop/ALERT-${slug}.md" ]
  [ -f "${TEST_PROJ}/.roll/loop/PAUSE-${slug}" ]
  [ -f "${TEST_PROJ}/.roll/loop/mute-${slug}" ]
}

@test "_loop_migrate_legacy_paths returns 0 when no legacy files" {
  local slug="test-abc123"
  run _loop_migrate_legacy_paths "$slug" "$LEGACY_DIR"
  [ "$status" -eq 0 ]
}

@test "_loop_control_state_path prefers new path" {
  local slug="test-abc123"
  echo "status: idle" > "${TEST_PROJ}/.roll/loop/state-${slug}.yaml"
  echo "status: old" > "${LEGACY_DIR}/state-${slug}.yaml"

  local result
  result=$(_loop_control_state_path "$slug" "state-${slug}.yaml" "$LEGACY_DIR")
  [ "$result" = "${TEST_PROJ}/.roll/loop/state-${slug}.yaml" ]
}

@test "_loop_control_state_path falls back to legacy" {
  local slug="test-abc123"
  echo "status: old" > "${LEGACY_DIR}/state-${slug}.yaml"

  local result
  result=$(_loop_control_state_path "$slug" "state-${slug}.yaml" "$LEGACY_DIR")
  [ "$result" = "${LEGACY_DIR}/state-${slug}.yaml" ]
}

@test "_loop_control_state_path returns 1 when neither exists" {
  local slug="test-abc123"
  run _loop_control_state_path "$slug" "state-${slug}.yaml" "$LEGACY_DIR"
  [ "$status" -eq 1 ]
}
