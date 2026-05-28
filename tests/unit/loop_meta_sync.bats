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
