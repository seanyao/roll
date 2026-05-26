#!/usr/bin/env bats
# Tests for _loop_pr_merge_self and loop_self verdict routing.
#
# Covers the fix: loop_self PRs are merged directly when CI is green
# instead of relying on repo-level GitHub auto-merge (unreliable).

load helpers

setup()    { unit_setup_cd; }
teardown() { unit_teardown_cd; }

# ── _loop_pr_classify: loop/* → loop_self ────────────────────────────────────

@test "_loop_pr_classify: loop/* branch returns loop_self" {
  run _loop_pr_classify "loop/cycle-20260527-123456-99999" "" "" ""
  [ "$status" -eq 0 ]
  [ "$output" = "loop_self" ]
}

@test "_loop_pr_classify: non-loop branch does not return loop_self" {
  run _loop_pr_classify "feat/my-feature" "" "" "MERGEABLE"
  [ "$status" -eq 0 ]
  [ "$output" != "loop_self" ]
}

# ── _loop_pr_merge_self: merge only when CI green + MERGEABLE ────────────────

@test "_loop_pr_merge_self: calls gh merge when ci=success and MERGEABLE" {
  local gh_called=""
  gh() { gh_called="$*"; }
  info() { :; }
  _loop_pr_merge_self "42" "success" "MERGEABLE" "owner/repo"
  [[ "$gh_called" == *"pr merge 42"* ]]
  [[ "$gh_called" == *"--squash"* ]]
}

@test "_loop_pr_merge_self: skips merge when ci=pending" {
  local gh_called=""
  gh() { gh_called="$*"; }
  _loop_pr_merge_self "42" "pending" "MERGEABLE" "owner/repo"
  [ -z "$gh_called" ]
}

@test "_loop_pr_merge_self: skips merge when mergeable=CONFLICTING" {
  local gh_called=""
  gh() { gh_called="$*"; }
  _loop_pr_merge_self "42" "success" "CONFLICTING" "owner/repo"
  [ -z "$gh_called" ]
}

@test "_loop_pr_merge_self: skips merge when ci=failure" {
  local gh_called=""
  gh() { gh_called="$*"; }
  _loop_pr_merge_self "42" "failure" "MERGEABLE" "owner/repo"
  [ -z "$gh_called" ]
}
