#!/usr/bin/env bats
# US-LOOP-006: _project_slug must produce the main-project slug no matter where
# (worktree, tmp dir, anywhere) the cycle is running. ROLL_MAIN_SLUG is the
# explicit shortcut — when the cycle wrapper exports it, helpers like
# _loop_event and runs.jsonl writes use it directly and never fall back to a
# tmp-* / cycle-* basename slug.

load helpers

setup()    { unit_setup; }
teardown() { unit_teardown; }

# ── ROLL_MAIN_SLUG is honored ────────────────────────────────────────────────

@test "_project_slug: honors ROLL_MAIN_SLUG when set (ignores \$1)" {
  ROLL_MAIN_SLUG="my-main-aaaaaa" run _project_slug "/some/totally/unrelated/path"
  [ "$status" -eq 0 ]
  [ "$output" = "my-main-aaaaaa" ]
}

@test "_project_slug: honors ROLL_MAIN_SLUG when invoked with no args" {
  ROLL_MAIN_SLUG="my-main-bbbbbb" run _project_slug
  [ "$status" -eq 0 ]
  [ "$output" = "my-main-bbbbbb" ]
}

@test "_project_slug: empty ROLL_MAIN_SLUG falls back to path-derived slug" {
  ROLL_MAIN_SLUG="" run _project_slug "/tmp/roll-loop-006-fallback"
  [ "$status" -eq 0 ]
  # Falls back: starts with sanitized basename
  [[ "$output" == roll-loop-006-fallback-* ]]
}

@test "_project_slug: unset ROLL_MAIN_SLUG falls back to path-derived slug" {
  unset ROLL_MAIN_SLUG
  run _project_slug "/tmp/roll-loop-006-unset"
  [ "$status" -eq 0 ]
  [[ "$output" == roll-loop-006-unset-* ]]
}

# ── Worktree → main repo resolution (FIX-034 reaffirmation) ──────────────────

@test "_project_slug: inside git worktree resolves to main repo when ROLL_MAIN_SLUG unset" {
  unset ROLL_MAIN_SLUG
  # Build a real main repo + worktree under TEST_TMP
  local main_repo="${TEST_TMP}/main-repo"
  local wt_dir="${TEST_TMP}/wt-cycle"
  git init -q "$main_repo"
  ( cd "$main_repo" && git commit --allow-empty -q -m "init" )
  ( cd "$main_repo" && git worktree add -q "$wt_dir" HEAD )

  local s_main s_wt
  s_main=$(_project_slug "$main_repo")
  s_wt=$(_project_slug "$wt_dir")

  [ -n "$s_main" ]
  [ "$s_main" = "$s_wt" ]
}
