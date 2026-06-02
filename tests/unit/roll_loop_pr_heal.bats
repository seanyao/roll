#!/usr/bin/env bats
# US-LOOP-062a: _loop_pr_heal_self — bounded, non-blocking background heal for
# red loop/* PRs (loop_self_ci_red). Covers heal budget, NO_HEAL/exhausted
# ALERT fallback, dynamic agent selection, and the per-PR lock.

load helpers
setup() {
  unit_setup_cd
  _LOOP_ALERT="${TEST_TMP}/alert.md"
  _LOOP_STATE="${TEST_TMP}/state.yaml"
  ROLL_LOOP_DIR="${TEST_TMP}/loop"
  mkdir -p "$ROLL_LOOP_DIR"
  # Stubs: the actual heal work just records its args; agent is overridable.
  _loop_pr_do_heal() { echo "healed pr=$1 head=$2 slug=$3 agent=$4" >> "${TEST_TMP}/heal.log"; }
  _project_agent() { echo "${STUB_AGENT:-claude}"; }
}
teardown() { unit_teardown_cd; }

_wait_heal_log() {
  local i
  for i in $(seq 1 15); do [ -f "${TEST_TMP}/heal.log" ] && return 0; sleep 0.2; done
  return 1
}

@test "US-LOOP-062a: ROLL_LOOP_NO_HEAL=1 → deduped ALERT, no heal, no budget spend" {
  ROLL_LOOP_NO_HEAL=1 run _loop_pr_heal_self 42 loop/cycle-x test/repo
  [ "$status" -eq 0 ]
  grep -q "TYPE:loop-pr-ci-red" "$_LOOP_ALERT"
  grep -q "PR #42" "$_LOOP_ALERT"
  [ ! -f "${TEST_TMP}/heal.log" ]
  [ ! -f "$_LOOP_STATE" ] || ! grep -q "heal_count.pr:42" "$_LOOP_STATE"
}

@test "US-LOOP-062a: ROLL_LOOP_HEAL_MAX=0 → ALERT, no heal" {
  ROLL_LOOP_HEAL_MAX=0 run _loop_pr_heal_self 42 loop/cycle-x test/repo
  [ "$status" -eq 0 ]
  grep -q "TYPE:loop-pr-ci-red" "$_LOOP_ALERT"
  [ ! -f "${TEST_TMP}/heal.log" ]
}

@test "US-LOOP-062a: heal budget exhausted → ALERT, no further heal" {
  printf 'heal_count.pr:42: 2\n' > "$_LOOP_STATE"
  ROLL_LOOP_HEAL_MAX=2 run _loop_pr_heal_self 42 loop/cycle-x test/repo
  [ "$status" -eq 0 ]
  grep -q "budget exhausted" "$_LOOP_ALERT"
  [ ! -f "${TEST_TMP}/heal.log" ]
}

@test "US-LOOP-062a: available budget → increments heal_count and dispatches heal" {
  ROLL_LOOP_HEAL_MAX=2 _loop_pr_heal_self 42 loop/cycle-x test/repo
  grep -q "^heal_count.pr:42: 1$" "$_LOOP_STATE"
  _wait_heal_log
  grep -q "healed pr=42" "${TEST_TMP}/heal.log"
}

@test "US-LOOP-062a: second heal increments budget to 2 (bounded retry)" {
  printf 'heal_count.pr:42: 1\n' > "$_LOOP_STATE"
  ROLL_LOOP_HEAL_MAX=2 _loop_pr_heal_self 42 loop/cycle-x test/repo
  grep -q "^heal_count.pr:42: 2$" "$_LOOP_STATE"
}

@test "US-LOOP-062a: heal uses the dynamic agent from _project_agent (no bare claude)" {
  STUB_AGENT=kimi
  ROLL_LOOP_HEAL_MAX=2 _loop_pr_heal_self 42 loop/cycle-x test/repo
  _wait_heal_log
  grep -q "agent=kimi" "${TEST_TMP}/heal.log"
}

@test "US-LOOP-062a: live per-PR lock → skip (no duplicate heal, no budget spend)" {
  mkdir -p "${ROLL_LOOP_DIR}/heal"
  echo "$$" > "${ROLL_LOOP_DIR}/heal/pr-42.lock"   # this shell's pid is alive
  ROLL_LOOP_HEAL_MAX=2 run _loop_pr_heal_self 42 loop/cycle-x test/repo
  [ "$status" -eq 0 ]
  [ ! -f "${TEST_TMP}/heal.log" ]
  [ ! -f "$_LOOP_STATE" ] || ! grep -q "heal_count.pr:42" "$_LOOP_STATE"
}

@test "US-LOOP-062a: stale lock (dead pid) is reclaimed → heal proceeds" {
  mkdir -p "${ROLL_LOOP_DIR}/heal"
  echo "999999" > "${ROLL_LOOP_DIR}/heal/pr-42.lock"   # almost certainly dead
  ROLL_LOOP_HEAL_MAX=2 _loop_pr_heal_self 42 loop/cycle-x test/repo
  grep -q "^heal_count.pr:42: 1$" "$_LOOP_STATE"
}
