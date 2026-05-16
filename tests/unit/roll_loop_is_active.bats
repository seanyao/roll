#!/usr/bin/env bats
# REFACTOR-020: shared three-level liveness probe — heartbeat → LOCK PID → tmux.

load helpers

setup() {
  unit_setup
  _SHARED_ROOT="$TEST_TMP"
  mkdir -p "$_SHARED_ROOT/loop"
  source "${BATS_TEST_DIRNAME}/../../bin/roll"
}
teardown() { unit_teardown; }

@test "_loop_is_active: no signals → dead" {
  ! _loop_is_active "proj"
}

@test "_loop_is_active: fresh heartbeat → alive" {
  date -u +%s > "$_SHARED_ROOT/loop/.heartbeat-proj"
  _loop_is_active "proj"
}

@test "_loop_is_active: stale heartbeat (>30min), no other signals → dead" {
  printf '%s\n' "$(( $(date -u +%s) - 2000 ))" > "$_SHARED_ROOT/loop/.heartbeat-proj"
  ! _loop_is_active "proj"
}

@test "_loop_is_active: non-numeric heartbeat → dead (guards against \$(()) coercion)" {
  printf 'garbage\n' > "$_SHARED_ROOT/loop/.heartbeat-proj"
  ! _loop_is_active "proj"
}

@test "_loop_is_active: live LOCK PID → alive" {
  echo "$$" > "$_SHARED_ROOT/loop/.LOCK-proj"
  _loop_is_active "proj"
}

@test "_loop_is_active: dead LOCK PID → dead" {
  echo "9999999" > "$_SHARED_ROOT/loop/.LOCK-proj"
  ! _loop_is_active "proj"
}

@test "_loop_is_active: stale heartbeat but live LOCK PID → alive (fallback works)" {
  printf '%s\n' "$(( $(date -u +%s) - 2000 ))" > "$_SHARED_ROOT/loop/.heartbeat-proj"
  echo "$$" > "$_SHARED_ROOT/loop/.LOCK-proj"
  _loop_is_active "proj"
}
