#!/usr/bin/env bats

setup() {
  local _saved_trap; _saved_trap="$(trap -p DEBUG 2>/dev/null || true)"
  trap - DEBUG
  source "${BATS_TEST_DIRNAME}/../../bin/roll"
  [[ -n "$_saved_trap" ]] && eval "$_saved_trap"
  TEST_PROJECT="$(mktemp -d)"
  mkdir -p "${TEST_PROJECT}/.roll"
  export _SHARED_ROOT="$(mktemp -d)"
  mkdir -p "${_SHARED_ROOT}/loop"
}

teardown() {
  rm -rf "$TEST_PROJECT" "$_SHARED_ROOT"
}

# ─── Default ──────────────────────────────────────────────────────────────────

@test "_loop_read_active_window: default 0 24 when no local.yaml" {
  run _loop_read_active_window "$TEST_PROJECT"
  [ "$status" -eq 0 ]
  [ "$output" = "0 24" ]
}

@test "_loop_read_active_window: default 0 24 when local.yaml has no loop_schedule" {
  cat > "${TEST_PROJECT}/.roll/local.yaml" << 'YAML'
agent: pi
YAML
  run _loop_read_active_window "$TEST_PROJECT"
  [ "$status" -eq 0 ]
  [ "$output" = "0 24" ]
}

@test "_loop_read_active_window: default 0 24 when loop_schedule has no active fields" {
  cat > "${TEST_PROJECT}/.roll/local.yaml" << 'YAML'
loop_schedule:
  period_minutes: 30
  offset_minute: 7
YAML
  run _loop_read_active_window "$TEST_PROJECT"
  [ "$status" -eq 0 ]
  [ "$output" = "0 24" ]
}

# ─── Reads from local.yaml ────────────────────────────────────────────────────

@test "_loop_read_active_window: reads active_start and active_end from loop_schedule" {
  cat > "${TEST_PROJECT}/.roll/local.yaml" << 'YAML'
loop_schedule:
  period_minutes: 30
  offset_minute: 7
  active_start: 10
  active_end: 18
YAML
  run _loop_read_active_window "$TEST_PROJECT"
  [ "$status" -eq 0 ]
  [ "$output" = "10 18" ]
}

@test "_loop_read_active_window: reads 24h window (0 24)" {
  cat > "${TEST_PROJECT}/.roll/local.yaml" << 'YAML'
loop_schedule:
  active_start: 0
  active_end: 24
YAML
  run _loop_read_active_window "$TEST_PROJECT"
  [ "$status" -eq 0 ]
  [ "$output" = "0 24" ]
}

@test "_loop_read_active_window: reads night window (22 6 is invalid, falls back)" {
  cat > "${TEST_PROJECT}/.roll/local.yaml" << 'YAML'
loop_schedule:
  active_start: 22
  active_end: 30
YAML
  run _loop_read_active_window "$TEST_PROJECT"
  [ "$status" -eq 0 ]
  [ "$output" = "0 24" ]
}

@test "_loop_read_active_window: active_start=0 active_end=12 (half day)" {
  cat > "${TEST_PROJECT}/.roll/local.yaml" << 'YAML'
loop_schedule:
  active_start: 0
  active_end: 12
YAML
  run _loop_read_active_window "$TEST_PROJECT"
  [ "$status" -eq 0 ]
  [ "$output" = "0 12" ]
}

# ─── Validation: invalid values fall back to default ─────────────────────────

@test "_loop_read_active_window: non-numeric active_start falls back" {
  cat > "${TEST_PROJECT}/.roll/local.yaml" << 'YAML'
loop_schedule:
  active_start: abc
  active_end: 18
YAML
  run _loop_read_active_window "$TEST_PROJECT"
  [ "$status" -eq 0 ]
  [ "$output" = "0 24" ]
}

@test "_loop_read_active_window: active_end > 24 falls back" {
  cat > "${TEST_PROJECT}/.roll/local.yaml" << 'YAML'
loop_schedule:
  active_start: 10
  active_end: 25
YAML
  run _loop_read_active_window "$TEST_PROJECT"
  [ "$status" -eq 0 ]
  [ "$output" = "0 24" ]
}

@test "_loop_read_active_window: active_start >= active_end falls back" {
  cat > "${TEST_PROJECT}/.roll/local.yaml" << 'YAML'
loop_schedule:
  active_start: 18
  active_end: 10
YAML
  run _loop_read_active_window "$TEST_PROJECT"
  [ "$status" -eq 0 ]
  [ "$output" = "0 24" ]
}

@test "_loop_read_active_window: missing active_end falls back" {
  cat > "${TEST_PROJECT}/.roll/local.yaml" << 'YAML'
loop_schedule:
  active_start: 10
YAML
  run _loop_read_active_window "$TEST_PROJECT"
  [ "$status" -eq 0 ]
  [ "$output" = "0 24" ]
}

# ─── Does NOT read from ~/.roll/config.yaml ───────────────────────────────────

@test "_loop_read_active_window: ignores global config loop_active_start/end" {
  local tmp_config; tmp_config="$(mktemp)"
  echo "loop_active_start: 8" > "$tmp_config"
  echo "loop_active_end: 20" >> "$tmp_config"
  export ROLL_CONFIG="$tmp_config"
  # No local.yaml — should default to 0 24, not pick up global
  run _loop_read_active_window "$TEST_PROJECT"
  [ "$status" -eq 0 ]
  [ "$output" = "0 24" ]
  rm -f "$tmp_config"
}
