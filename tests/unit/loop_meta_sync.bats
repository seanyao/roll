#!/usr/bin/env bats
# US-LOOP-056: _loop_sync_meta helper — cycle preflight auto-syncs .roll/ from roll-meta

load helpers
setup()    { unit_setup; }
teardown() { unit_teardown; }

# ─── helper: create a local bare repo to act as roll-meta remote ────────────

_make_remote_repo() {
  local remote_dir="$1"
  git init --bare "$remote_dir" -q
  local tmp_clone="${TEST_TMP}/seed-clone"
  git clone "$remote_dir" "$tmp_clone" -q 2>/dev/null
  echo "backlog" > "${tmp_clone}/backlog.md"
  git -C "$tmp_clone" add backlog.md
  git -C "$tmp_clone" -c "user.email=t@t" -c "user.name=T" commit -m "init" -q
  git -C "$tmp_clone" push origin main -q 2>/dev/null || \
    git -C "$tmp_clone" push origin HEAD:main -q 2>/dev/null || true
}

_make_roll_meta_repo() {
  local project_path="$1"
  local remote_dir="${TEST_TMP}/roll-meta-remote"
  _make_remote_repo "$remote_dir"
  mkdir -p "${project_path}/.roll"
  git clone "$remote_dir" "${project_path}/.roll" -q 2>/dev/null
}

# ─── tests ──────────────────────────────────────────────────────────────────

@test "_loop_sync_meta: function exists in bin/roll" {
  declare -f _loop_sync_meta | grep -q "_loop_sync_meta"
}

@test "_loop_sync_meta: silent skip when .roll/ has no git remote" {
  local proj="${TEST_TMP}/proj-no-remote"
  mkdir -p "${proj}/.roll"
  git init "${proj}/.roll" -q
  export CYCLE_ID="test-cycle"
  export ROLL_PROJECT_RUNTIME_DIR="${TEST_TMP}/rt-skip"
  mkdir -p "$ROLL_PROJECT_RUNTIME_DIR"
  run _loop_sync_meta "$proj"
  [ "$status" -eq 0 ]
  # No meta_sync event should be written when remote is absent
  if [ -f "${ROLL_PROJECT_RUNTIME_DIR}/events.ndjson" ]; then
    ! grep -q '"meta_sync"' "${ROLL_PROJECT_RUNTIME_DIR}/events.ndjson"
  fi
  unset ROLL_PROJECT_RUNTIME_DIR
}

@test "_loop_sync_meta: emits ok event on successful fetch+reset" {
  local proj="${TEST_TMP}/proj-ok"
  _make_roll_meta_repo "$proj"
  export CYCLE_ID="test-cycle-ok"
  export ROLL_PROJECT_RUNTIME_DIR="${TEST_TMP}/rt-ok"
  mkdir -p "$ROLL_PROJECT_RUNTIME_DIR"
  run _loop_sync_meta "$proj"
  [ "$status" -eq 0 ]
  local evfile="${ROLL_PROJECT_RUNTIME_DIR}/events.ndjson"
  [ -f "$evfile" ]
  grep -q '"meta_sync"' "$evfile"
  grep -q '"ok"' "$evfile"
  unset ROLL_PROJECT_RUNTIME_DIR
}

@test "FIX-145: _loop_sync_meta skips reset + emits dirty when .roll has uncommitted edits" {
  local proj="${TEST_TMP}/proj-dirty"
  _make_roll_meta_repo "$proj"
  # Simulate a human editing a tracked .roll file mid-session (uncommitted)
  echo "LOCAL EDIT must survive the loop" >> "${proj}/.roll/backlog.md"
  export CYCLE_ID="test-cycle-dirty"
  export ROLL_PROJECT_RUNTIME_DIR="${TEST_TMP}/rt-dirty"
  mkdir -p "$ROLL_PROJECT_RUNTIME_DIR"
  run _loop_sync_meta "$proj"
  [ "$status" -eq 0 ]
  # The uncommitted edit must NOT be wiped by reset --hard
  grep -q "LOCAL EDIT must survive the loop" "${proj}/.roll/backlog.md"
  # A dirty event must be emitted so the skip is visible
  local evfile="${ROLL_PROJECT_RUNTIME_DIR}/events.ndjson"
  [ -f "$evfile" ]
  grep -q '"meta_sync"' "$evfile"
  grep -q '"dirty"' "$evfile"
  unset ROLL_PROJECT_RUNTIME_DIR
}

@test "_loop_sync_meta: emits stale event when fetch fails" {
  local proj="${TEST_TMP}/proj-stale"
  mkdir -p "${proj}/.roll"
  git init "${proj}/.roll" -q
  git -C "${proj}/.roll" remote add origin "git@nonexistent.invalid:test/repo.git" 2>/dev/null || true
  export CYCLE_ID="test-cycle-stale"
  export ROLL_PROJECT_RUNTIME_DIR="${TEST_TMP}/rt-stale"
  export ROLL_LOOP_META_SYNC_TIMEOUT=1
  mkdir -p "$ROLL_PROJECT_RUNTIME_DIR"
  run _loop_sync_meta "$proj"
  [ "$status" -eq 0 ]
  local evfile="${ROLL_PROJECT_RUNTIME_DIR}/events.ndjson"
  [ -f "$evfile" ]
  grep -q '"meta_sync"' "$evfile"
  grep -q '"stale"' "$evfile"
  unset ROLL_PROJECT_RUNTIME_DIR
  unset ROLL_LOOP_META_SYNC_TIMEOUT
}

@test "_loop_sync_meta: returns 0 when .roll/ dir does not exist" {
  local proj="${TEST_TMP}/proj-missing"
  mkdir -p "$proj"
  export CYCLE_ID="test-cycle-miss"
  export ROLL_PROJECT_RUNTIME_DIR="${TEST_TMP}/rt-miss"
  mkdir -p "$ROLL_PROJECT_RUNTIME_DIR"
  run _loop_sync_meta "$proj"
  [ "$status" -eq 0 ]
  unset ROLL_PROJECT_RUNTIME_DIR
}

@test "_loop_sync_meta: inner script template calls _loop_sync_meta in preflight" {
  local runner="${TEST_TMP}/run-test-meta.sh"
  _write_loop_runner_script "$runner" "${TEST_TMP}/fake-proj" "echo hi" "${TEST_TMP}/log"
  local inner="${runner%.sh}-inner.sh"
  [ -f "$inner" ]
  grep -q '_loop_sync_meta' "$inner"
}

# ─── US-LOOP-057: consecutive failure counter + ALERT ───────────────────────

@test "US-LOOP-057: first failure increments counter in state file" {
  local proj="${TEST_TMP}/proj-fail1"
  mkdir -p "${proj}/.roll"
  git init "${proj}/.roll" -q
  git -C "${proj}/.roll" remote add origin "git@nonexistent.invalid:t/r.git" 2>/dev/null || true
  export CYCLE_ID="c1"
  export ROLL_LOOP_META_SYNC_TIMEOUT=1
  export ROLL_PROJECT_RUNTIME_DIR="${TEST_TMP}/rt-fail1"
  export _SHARED_ROOT="${TEST_TMP}/shared-fail1"
  export _LOOP_PROJ_SLUG="test-fail1"
  mkdir -p "$ROLL_PROJECT_RUNTIME_DIR" "$_SHARED_ROOT/loop"
  run _loop_sync_meta "$proj"
  [ "$status" -eq 0 ]
  # Counter file should exist with value 1
  local counter_file="${_SHARED_ROOT}/loop/meta-sync-fail-test-fail1"
  [ -f "$counter_file" ]
  local count; count=$(cat "$counter_file")
  [ "$count" -eq 1 ]
  unset ROLL_PROJECT_RUNTIME_DIR _SHARED_ROOT _LOOP_PROJ_SLUG ROLL_LOOP_META_SYNC_TIMEOUT
}

@test "US-LOOP-057: three consecutive failures trigger ALERT" {
  local proj="${TEST_TMP}/proj-fail3"
  mkdir -p "${proj}/.roll"
  git init "${proj}/.roll" -q
  git -C "${proj}/.roll" remote add origin "git@nonexistent.invalid:t/r.git" 2>/dev/null || true
  export ROLL_LOOP_META_SYNC_TIMEOUT=1
  export ROLL_PROJECT_RUNTIME_DIR="${TEST_TMP}/rt-fail3"
  export _SHARED_ROOT="${TEST_TMP}/shared-fail3"
  export _LOOP_PROJ_SLUG="test-fail3"
  mkdir -p "$ROLL_PROJECT_RUNTIME_DIR" "$_SHARED_ROOT/loop"
  # Run 3 times to reach threshold
  CYCLE_ID="c1" _loop_sync_meta "$proj" || true
  CYCLE_ID="c2" _loop_sync_meta "$proj" || true
  CYCLE_ID="c3" _loop_sync_meta "$proj" || true
  # ALERT file should exist
  local alert_file="${_SHARED_ROOT}/loop/ALERT-test-fail3.md"
  [ -f "$alert_file" ]
  grep -qi "meta.sync\|roll-meta\|sync" "$alert_file"
  unset ROLL_PROJECT_RUNTIME_DIR _SHARED_ROOT _LOOP_PROJ_SLUG ROLL_LOOP_META_SYNC_TIMEOUT
}

@test "US-LOOP-057: success resets failure counter" {
  local proj="${TEST_TMP}/proj-reset"
  _make_roll_meta_repo "$proj"
  export ROLL_PROJECT_RUNTIME_DIR="${TEST_TMP}/rt-reset"
  export _SHARED_ROOT="${TEST_TMP}/shared-reset"
  export _LOOP_PROJ_SLUG="test-reset"
  mkdir -p "$ROLL_PROJECT_RUNTIME_DIR" "$_SHARED_ROOT/loop"
  # Pre-populate counter with value 2
  echo "2" > "${_SHARED_ROOT}/loop/meta-sync-fail-test-reset"
  CYCLE_ID="c-ok" _loop_sync_meta "$proj" || true
  # Counter should be reset (file removed or 0)
  local counter_file="${_SHARED_ROOT}/loop/meta-sync-fail-test-reset"
  if [ -f "$counter_file" ]; then
    local count; count=$(cat "$counter_file")
    [ "$count" -eq 0 ]
  fi
  unset ROLL_PROJECT_RUNTIME_DIR _SHARED_ROOT _LOOP_PROJ_SLUG
}
