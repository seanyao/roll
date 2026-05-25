#!/usr/bin/env bats

setup() {
  source "${BATS_TEST_DIRNAME}/../../bin/roll"
  # Create a temp project structure for tests
  TEST_PROJECT="$(mktemp -d)"
  mkdir -p "${TEST_PROJECT}/.roll"
  # Override _SHARED_ROOT so ALERT writes go to a temp dir
  export _SHARED_ROOT="$(mktemp -d)"
  mkdir -p "${_SHARED_ROOT}/loop"
}

teardown() {
  rm -rf "$TEST_PROJECT" "$_SHARED_ROOT"
}

# ─── Default fallback ─────────────────────────────────────────────────────────

@test "_loop_schedule_spec: default when no config exists" {
  run _loop_schedule_spec "$TEST_PROJECT"
  [ "$status" -eq 0 ]
  # Should output "period offset" with period=60
  [[ "$output" =~ ^60\ [0-9]+$ ]]
}

# ─── Global loop_minute (via config_get override) ─────────────────────────────

@test "_loop_schedule_spec: uses global loop_minute when no project config" {
  # Override ROLL_CONFIG to a temp file with loop_minute
  local tmp_config="$(mktemp)"
  echo "loop_minute: 18" > "$tmp_config"
  export ROLL_CONFIG="$tmp_config"
  run _loop_schedule_spec "$TEST_PROJECT"
  [ "$status" -eq 0 ]
  [ "$output" = "60 18" ]
  rm -f "$tmp_config"
}

# ─── Project-level loop_schedule ──────────────────────────────────────────────

@test "_loop_schedule_spec: uses project-level loop_schedule (period=30, offset=7)" {
  cat > "${TEST_PROJECT}/.roll/local.yaml" << 'YAML'
loop_schedule:
  period_minutes: 30
  offset_minute: 7
YAML
  run _loop_schedule_spec "$TEST_PROJECT"
  [ "$status" -eq 0 ]
  [ "$output" = "30 7" ]
}

@test "_loop_schedule_spec: uses project-level loop_schedule (period=15, offset=0)" {
  cat > "${TEST_PROJECT}/.roll/local.yaml" << 'YAML'
loop_schedule:
  period_minutes: 15
  offset_minute: 0
YAML
  run _loop_schedule_spec "$TEST_PROJECT"
  [ "$status" -eq 0 ]
  [ "$output" = "15 0" ]
}

@test "_loop_schedule_spec: project-level takes priority over global" {
  local tmp_config="$(mktemp)"
  echo "loop_minute: 18" > "$tmp_config"
  export ROLL_CONFIG="$tmp_config"
  cat > "${TEST_PROJECT}/.roll/local.yaml" << 'YAML'
loop_schedule:
  period_minutes: 20
  offset_minute: 3
YAML
  run _loop_schedule_spec "$TEST_PROJECT"
  [ "$status" -eq 0 ]
  [ "$output" = "20 3" ]
  rm -f "$tmp_config"
}

# ─── Validation: invalid period ───────────────────────────────────────────────

@test "_loop_schedule_spec: invalid period falls back to default + ALERT" {
  cat > "${TEST_PROJECT}/.roll/local.yaml" << 'YAML'
loop_schedule:
  period_minutes: 45
  offset_minute: 7
YAML
  run _loop_schedule_spec "$TEST_PROJECT"
  [ "$status" -eq 0 ]
  # Should fall back to default (period=60)
  [[ "$output" =~ ^60\ [0-9]+$ ]]
  # ALERT file should have been created
  local slug; slug=$(_project_slug "$TEST_PROJECT")
  [ -f "${_SHARED_ROOT}/loop/ALERT-${slug}.md" ]
  grep -q "loop_schedule" "${_SHARED_ROOT}/loop/ALERT-${slug}.md"
}

@test "_loop_schedule_spec: invalid period (0) falls back to default" {
  cat > "${TEST_PROJECT}/.roll/local.yaml" << 'YAML'
loop_schedule:
  period_minutes: 0
  offset_minute: 0
YAML
  run _loop_schedule_spec "$TEST_PROJECT"
  [ "$status" -eq 0 ]
  [[ "$output" =~ ^60\ [0-9]+$ ]]
}

@test "_loop_schedule_spec: invalid period (string) falls back to default" {
  cat > "${TEST_PROJECT}/.roll/local.yaml" << 'YAML'
loop_schedule:
  period_minutes: abc
  offset_minute: 5
YAML
  run _loop_schedule_spec "$TEST_PROJECT"
  [ "$status" -eq 0 ]
  [[ "$output" =~ ^60\ [0-9]+$ ]]
}

# ─── Validation: invalid offset ───────────────────────────────────────────────

@test "_loop_schedule_spec: offset >= period falls back to default" {
  cat > "${TEST_PROJECT}/.roll/local.yaml" << 'YAML'
loop_schedule:
  period_minutes: 30
  offset_minute: 30
YAML
  run _loop_schedule_spec "$TEST_PROJECT"
  [ "$status" -eq 0 ]
  [[ "$output" =~ ^60\ [0-9]+$ ]]
}

@test "_loop_schedule_spec: negative offset falls back to default" {
  cat > "${TEST_PROJECT}/.roll/local.yaml" << 'YAML'
loop_schedule:
  period_minutes: 30
  offset_minute: -1
YAML
  run _loop_schedule_spec "$TEST_PROJECT"
  [ "$status" -eq 0 ]
  [[ "$output" =~ ^60\ [0-9]+$ ]]
}

@test "_loop_schedule_spec: non-numeric offset falls back to default" {
  cat > "${TEST_PROJECT}/.roll/local.yaml" << 'YAML'
loop_schedule:
  period_minutes: 30
  offset_minute: xyz
YAML
  run _loop_schedule_spec "$TEST_PROJECT"
  [ "$status" -eq 0 ]
  [[ "$output" =~ ^60\ [0-9]+$ ]]
}

# ─── Edge cases ───────────────────────────────────────────────────────────────

@test "_loop_schedule_spec: all valid periods pass validation" {
  for period in 60 30 20 15 12 10 6 5; do
    cat > "${TEST_PROJECT}/.roll/local.yaml" << YAML
loop_schedule:
  period_minutes: ${period}
  offset_minute: 0
YAML
    run _loop_schedule_spec "$TEST_PROJECT"
    [ "$status" -eq 0 ]
    [ "$output" = "${period} 0" ]
  done
}

@test "_loop_schedule_spec: missing offset_minute falls back to default" {
  cat > "${TEST_PROJECT}/.roll/local.yaml" << 'YAML'
loop_schedule:
  period_minutes: 30
YAML
  run _loop_schedule_spec "$TEST_PROJECT"
  [ "$status" -eq 0 ]
  [[ "$output" =~ ^60\ [0-9]+$ ]]
}

@test "_loop_schedule_spec: missing period_minutes falls back to default" {
  cat > "${TEST_PROJECT}/.roll/local.yaml" << 'YAML'
loop_schedule:
  offset_minute: 7
YAML
  run _loop_schedule_spec "$TEST_PROJECT"
  [ "$status" -eq 0 ]
  [[ "$output" =~ ^60\ [0-9]+$ ]]
}

@test "_loop_schedule_spec: no loop_schedule key at all falls back" {
  cat > "${TEST_PROJECT}/.roll/local.yaml" << 'YAML'
agent: claude
YAML
  run _loop_schedule_spec "$TEST_PROJECT"
  [ "$status" -eq 0 ]
  [[ "$output" =~ ^60\ [0-9]+$ ]]
}

@test "_loop_schedule_spec: empty local.yaml falls back" {
  touch "${TEST_PROJECT}/.roll/local.yaml"
  run _loop_schedule_spec "$TEST_PROJECT"
  [ "$status" -eq 0 ]
  [[ "$output" =~ ^60\ [0-9]+$ ]]
}

@test "_loop_schedule_spec: missing local.yaml falls back" {
  # No .roll/local.yaml at all
  run _loop_schedule_spec "$TEST_PROJECT"
  [ "$status" -eq 0 ]
  [[ "$output" =~ ^60\ [0-9]+$ ]]
}

# ─── _loop_schedule_valid unit ────────────────────────────────────────────────

@test "_loop_schedule_valid: all valid pairs pass" {
  run _loop_schedule_valid 60 59
  [ "$status" -eq 0 ]
  run _loop_schedule_valid 30 29
  [ "$status" -eq 0 ]
  run _loop_schedule_valid 15 0
  [ "$status" -eq 0 ]
  run _loop_schedule_valid 5 4
  [ "$status" -eq 0 ]
}

@test "_loop_schedule_valid: invalid period rejected" {
  run _loop_schedule_valid 45 0
  [ "$status" -ne 0 ]
  run _loop_schedule_valid 0 0
  [ "$status" -ne 0 ]
  run _loop_schedule_valid 100 0
  [ "$status" -ne 0 ]
}

@test "_loop_schedule_valid: invalid offset rejected" {
  run _loop_schedule_valid 30 30
  [ "$status" -ne 0 ]
  run _loop_schedule_valid 30 99
  [ "$status" -ne 0 ]
}
