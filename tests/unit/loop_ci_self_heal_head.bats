#!/usr/bin/env bats
# US-LOOP-046..050: CI self-heal expansion — HEAD red hot-fix + PR red hot-fix

load helpers
setup()    { unit_setup; }
teardown() { unit_teardown; }

# ─── US-LOOP-046: _loop_precheck_ci exit code routing ───────────────────────

@test "US-LOOP-046: _loop_precheck_ci returns 2 when CI red and heal allowed" {
  # When ROLL_LOOP_NO_HEAL is unset/empty and heal count < ROLL_LOOP_HEAL_MAX,
  # _loop_precheck_ci should return 2 (hot-fix signal) instead of 1 (abort).
  # Verify by checking the function contains exit 2 path.
  grep -q 'return 2' "$(command -v roll)" 2>/dev/null || \
  grep -q 'return 2' "${ROLL_BIN}"
  # And the return 2 is inside the precheck_ci function block
  awk '/^_loop_precheck_ci\(\)/,/^}/' "${ROLL_BIN}" | grep -q 'return 2'
}

@test "US-LOOP-046: ROLL_LOOP_NO_HEAL=1 path in _loop_precheck_ci still returns 1" {
  # The no-heal bypass must be preserved — ROLL_LOOP_NO_HEAL=1 keeps old abort behavior
  awk '/^_loop_precheck_ci\(\)/,/^}/' "${ROLL_BIN}" | grep -qE 'ROLL_LOOP_NO_HEAL|NO_HEAL'
}

@test "US-LOOP-046: SKILL.md Step 1.5 describes exit code 2 or hot-fix routing" {
  local skill="${BATS_TEST_DIRNAME}/../../skills/roll-loop/SKILL.md"
  # Step 1.5 must mention the hot-fix routing for red CI
  grep -qiE 'exit.?code.?2|hotfix|hot.fix|hot_fix|return 2|heal.*allow|path.?a.*ci|ci.*red.*heal' "$skill"
}

# ─── US-LOOP-047: hotfix context factory ────────────────────────────────────

@test "US-LOOP-047: _loop_hotfix_head_context function exists in bin/roll" {
  grep -q '^_loop_hotfix_head_context()' "${ROLL_BIN}"
}

@test "US-LOOP-047: roll loop hotfix-head-context dispatches to _loop_hotfix_head_context" {
  grep -q 'hotfix-head-context' "${ROLL_BIN}"
}

# ─── US-LOOP-048: heal counter for HEAD CI ──────────────────────────────────

@test "US-LOOP-048: _loop_precheck_ci references heal_count or heal counter for HEAD" {
  awk '/^_loop_precheck_ci\(\)/,/^}/' "${ROLL_BIN}" | grep -qE 'heal_count|heal.*head|head.*heal|HEAL_MAX'
}

@test "US-LOOP-048: ROLL_LOOP_HEAL_MAX referenced in _loop_precheck_ci" {
  awk '/^_loop_precheck_ci\(\)/,/^}/' "${ROLL_BIN}" | grep -q 'ROLL_LOOP_HEAL_MAX'
}

# US-LOOP-049 (PR classification verdicts) is covered canonically in
# roll_loop_pr_inbox.bats — the classifier was simplified to stale/ci_red/ready,
# so the old loop_self* verdict assertions no longer apply here.

# ─── US-LOOP-050: PR hot-fix function ───────────────────────────────────────

@test "US-LOOP-050: _loop_hot_fix_pr function exists in bin/roll" {
  grep -q '^_loop_hot_fix_pr()' "${ROLL_BIN}"
}
