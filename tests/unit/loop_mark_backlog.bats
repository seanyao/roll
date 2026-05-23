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

@test "FIX-106: _loop_mark_in_progress only flips the target row, not rows that mention id in depends-on" {
  # Reproduces the substring-matching bug: pre-FIX-106, awk index($0, sid)
  # would match every line whose description text contains the sid as a
  # substring, including dependent rows like "depends-on:US-X-001". Result:
  # picking US-X-001 also flipped US-X-002 (and any other dependent) to 🔨,
  # leaving dashboard showing assistants working on stories no one had picked.
  local backlog="${TEST_TMP}/main/.roll/backlog.md"
  mkdir -p "$(dirname "$backlog")"
  cat > "$backlog" <<'BACKLOG'
# Backlog

| Story | Description | Status |
|-------|-------------|--------|
| US-X-001 | leaf story does X | 📋 Todo |
| US-X-002 | depends-on:US-X-001 build on top | 📋 Todo |
| US-X-003 | sibling depends-on:US-X-001,US-X-002 doc | 📋 Todo |
BACKLOG

  run _loop_mark_in_progress "US-X-001" "$backlog"
  [ "$status" -eq 0 ]

  # Only US-X-001 flips:
  grep -qF '| US-X-001 | leaf story does X | 🔨 In Progress |' "$backlog"
  # US-X-002 / US-X-003 mention US-X-001 in their depends-on — must stay Todo:
  grep -qF '| US-X-002 | depends-on:US-X-001 build on top | 📋 Todo |' "$backlog"
  grep -qF '| US-X-003 | sibling depends-on:US-X-001,US-X-002 doc | 📋 Todo |' "$backlog"
}

@test "FIX-106: _loop_mark_todo only reverts the target row" {
  local backlog="${TEST_TMP}/main/.roll/backlog.md"
  mkdir -p "$(dirname "$backlog")"
  cat > "$backlog" <<'BACKLOG'
# Backlog

| Story | Description | Status |
|-------|-------------|--------|
| US-X-001 | leaf | 🔨 In Progress |
| US-X-002 | depends-on:US-X-001 | 🔨 In Progress |
BACKLOG

  run _loop_mark_todo "US-X-001" "$backlog"
  [ "$status" -eq 0 ]
  grep -qF '| US-X-001 | leaf | 📋 Todo |' "$backlog"
  # US-X-002 had its own 🔨 (e.g. another cycle picked it); must NOT be touched
  grep -qF '| US-X-002 | depends-on:US-X-001 | 🔨 In Progress |' "$backlog"
}

@test "FIX-106: markdown-linked rows ([ID](path)) also match exactly" {
  # Real backlog rows use [US-X-001](.roll/features/...) markdown links.
  # The fix must extract the bare id from the link, not parse the literal string.
  local backlog="${TEST_TMP}/main/.roll/backlog.md"
  mkdir -p "$(dirname "$backlog")"
  cat > "$backlog" <<'BACKLOG'
# Backlog

| Story | Description | Status |
|-------|-------------|--------|
| [US-X-001](.roll/features/foo.md#us-x-001) | leaf | 📋 Todo |
| [US-X-002](.roll/features/foo.md#us-x-002) | depends-on:US-X-001 | 📋 Todo |
BACKLOG

  run _loop_mark_in_progress "US-X-001" "$backlog"
  [ "$status" -eq 0 ]
  grep -qF '| [US-X-001](.roll/features/foo.md#us-x-001) | leaf | 🔨 In Progress |' "$backlog"
  grep -qF '| [US-X-002](.roll/features/foo.md#us-x-002) | depends-on:US-X-001 | 📋 Todo |' "$backlog"
}

@test "ROLL_MAIN_PROJECT default: helper finds backlog via env when path omitted" {
  local main_dir="${TEST_TMP}/repo-main"
  local backlog="${main_dir}/.roll/backlog.md"
  _seed_backlog "$backlog"

  ROLL_MAIN_PROJECT="$main_dir" run _loop_mark_in_progress "FIX-100"
  [ "$status" -eq 0 ]
  grep -qF '| FIX-100  | a fix       | 🔨 In Progress |' "$backlog"
}
