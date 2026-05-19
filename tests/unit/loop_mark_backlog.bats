#!/usr/bin/env bats
# FIX-070: tests for _loop_mark_in_progress / _loop_mark_todo helpers.
#
# Cycle worktrees are gitignored at .roll/, so editing the worktree's copy of
# backlog.md + committing leaves no trace in git. These helpers flip status
# markers directly in the main repo's backlog so brief/monitor can see the
# 🔨 In Progress state the moment the helper returns.

load helpers
setup()    { unit_setup_cd; }
teardown() { unit_teardown_cd; }

_seed_backlog() {
  local f="$1"
  mkdir -p "$(dirname "$f")"
  cat > "$f" <<'BACKLOG'
# Backlog

| Story | Description | Status |
|-------|-------------|--------|
| US-X-001 | something one | 📋 Todo |
| US-X-002 | something two | 🔨 In Progress |
| US-X-003 | something three | ✅ Done |
| FIX-100  | a fix       | 📋 Todo |
BACKLOG
}

@test "_loop_mark_in_progress: flips Todo to In Progress on the matching row" {
  local backlog="${TEST_TMP}/main/.roll/backlog.md"
  _seed_backlog "$backlog"

  run _loop_mark_in_progress "US-X-001" "$backlog"
  [ "$status" -eq 0 ]
  grep -qF '| US-X-001 | something one | 🔨 In Progress |' "$backlog"
  # Other rows untouched
  grep -qF '| US-X-002 | something two | 🔨 In Progress |' "$backlog"
  grep -qF '| US-X-003 | something three | ✅ Done |' "$backlog"
  grep -qF '| FIX-100  | a fix       | 📋 Todo |' "$backlog"
}

@test "_loop_mark_in_progress: idempotent — re-running on the same id is a no-op" {
  local backlog="${TEST_TMP}/main/.roll/backlog.md"
  _seed_backlog "$backlog"
  _loop_mark_in_progress "US-X-001" "$backlog"
  local mid; mid=$(cat "$backlog")
  _loop_mark_in_progress "US-X-001" "$backlog"
  [ "$mid" = "$(cat "$backlog")" ]
}

@test "_loop_mark_in_progress: silent return 0 when backlog is absent" {
  run _loop_mark_in_progress "US-X-001" "${TEST_TMP}/does-not-exist.md"
  [ "$status" -eq 0 ]
}

@test "_loop_mark_in_progress: refuses empty story id" {
  local backlog="${TEST_TMP}/main/.roll/backlog.md"
  _seed_backlog "$backlog"
  run _loop_mark_in_progress "" "$backlog"
  [ "$status" -ne 0 ]
  # backlog unchanged
  grep -qF '| US-X-001 | something one | 📋 Todo |' "$backlog"
}

@test "_loop_mark_todo: reverts In Progress back to Todo" {
  local backlog="${TEST_TMP}/main/.roll/backlog.md"
  _seed_backlog "$backlog"

  run _loop_mark_todo "US-X-002" "$backlog"
  [ "$status" -eq 0 ]
  grep -qF '| US-X-002 | something two | 📋 Todo |' "$backlog"
  # Done rows untouched
  grep -qF '| US-X-003 | something three | ✅ Done |' "$backlog"
}

@test "_loop_mark_todo: silent no-op when row is already Todo" {
  local backlog="${TEST_TMP}/main/.roll/backlog.md"
  _seed_backlog "$backlog"

  _loop_mark_todo "US-X-001" "$backlog"   # was Todo, stays Todo
  grep -qF '| US-X-001 | something one | 📋 Todo |' "$backlog"
}

@test "ROLL_MAIN_PROJECT default: helper finds backlog via env when path omitted" {
  local main_dir="${TEST_TMP}/repo-main"
  local backlog="${main_dir}/.roll/backlog.md"
  _seed_backlog "$backlog"

  ROLL_MAIN_PROJECT="$main_dir" run _loop_mark_in_progress "FIX-100"
  [ "$status" -eq 0 ]
  grep -qF '| FIX-100  | a fix       | 🔨 In Progress |' "$backlog"
}
