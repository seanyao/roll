#!/usr/bin/env bats
# US-LOOP-005: every cycle termination path must emit a cycle_end event
# so dashboard never shows phantom "running" cycles.
#
# Audit table is in .roll/features/loop-write-integrity-plan.md. Each
# `@test` below targets one row of that table.

load helpers

setup() {
  unit_setup_cd
  _test_dir="$TEST_TMP"
  _script="${_test_dir}/run.sh"
  _write_loop_runner_script "$_script" "/tmp/proj" "claude -p x" "/tmp/log" 0 24
  _inner="${_script%.sh}-inner.sh"
}
teardown() { unit_teardown_cd; }

# Each test asserts the inner script emits the right cycle_end outcome in
# the window around a known marker line (echo / alert text the path prints).

# --- T3: gh unavailable + ff merge_back OK ---

@test "T3: gh-unavailable + merge_back OK emits cycle_end done" {
  grep -B 6 -A 1 'gh unavailable; merged via ff and cleaned up' "$_inner" \
    | grep -qE 'cycle_end.*"done"'
}

# --- T4: gh unavailable + merge_back fail + orphan push OK ---

@test "T4: gh-unavailable + orphan push OK emits cycle_end orphan" {
  grep -F -B 6 -A 1 'gh+merge_back failed; FIX-039 pushed orphan' "$_inner" \
    | grep -qE 'cycle_end.*"orphan"'
}

# --- T5: gh unavailable + all publish failed ---

@test "T5: gh-unavailable all-failed emits cycle_end failed" {
  grep -F -B 6 -A 1 'gh+merge_back+push all failed' "$_inner" \
    | grep -qE 'cycle_end.*"failed"'
}

# --- T6: PR publish failed + orphan push OK ---

@test "T6: PR-publish-failed + orphan push OK emits cycle_end orphan" {
  grep -B 6 -A 1 'PR publish failed; FIX-039 pushed orphan' "$_inner" \
    | grep -qE 'cycle_end.*"orphan"'
}

# --- T7: PR publish failed + orphan push failed ---

@test "T7: PR-publish-failed all-fail emits cycle_end failed" {
  grep -B 6 -A 1 'PR publish failed; worktree preserved at' "$_inner" \
    | grep -qE 'cycle_end.*"failed"'
}

# --- T8: claude session failed ---

@test "T8: claude non-zero exit emits cycle_end failed" {
  grep -B 6 -A 1 'claude exited.*worktree preserved' "$_inner" \
    | grep -qE 'cycle_end.*"failed"'
}

# --- T9: timeout — already emits cycle_end blocked in trap (regression guard) ---

@test "T9: timeout still emits cycle_end blocked (regression guard)" {
  grep -qE 'cycle_end.*"blocked"' "$_inner"
}

# --- T10: worktree setup failed — must write runs.jsonl row before exit ---

@test "T10: worktree-setup-failed writes runs.jsonl row before exit" {
  awk '/worktree setup failed/{f=1} f{print} /^[[:space:]]*exit 0/&&f{exit}' "$_inner" \
    | grep -qE 'runs\.jsonl'
}

# --- T9 supplementary: timeout path also writes runs.jsonl row ---

@test "T9: timeout path also writes runs.jsonl row" {
  # _inner_cleanup must write a runs.jsonl row when _CYCLE_TIMED_OUT==1
  # (otherwise dashboard sees no terminal row even though cycle_end fired).
  awk '/_CYCLE_TIMED_OUT.*-eq 1/{f=1} f{print} /^[[:space:]]*}[[:space:]]*$/&&f{c++; if(c==1)exit}' "$_inner" \
    | grep -qE 'runs\.jsonl'
}
