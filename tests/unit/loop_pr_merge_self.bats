#!/usr/bin/env bats
# Tests for _loop_pr_merge_self_eager — the inbox's direct-merge step.
#
# Covers the fix: a green + mergeable PR is squash-merged directly instead of
# relying on repo-level GitHub auto-merge (unreliable). Verdict routing itself
# is covered canonically in roll_loop_pr_inbox.bats.

load helpers

setup()    { unit_setup_cd; }
teardown() { unit_teardown_cd; }

# ── _loop_pr_merge_self_eager: merge only when CI green + MERGEABLE ────────────────

@test "_loop_pr_merge_self_eager: calls gh merge when ci=success and MERGEABLE" {
  local gh_called=""
  gh() { gh_called="$*"; }
  info() { :; }
  _loop_pr_merge_self_eager "42" "success" "MERGEABLE" "owner/repo"
  [[ "$gh_called" == *"pr merge 42"* ]]
  [[ "$gh_called" == *"--squash"* ]]
}

@test "_loop_pr_merge_self_eager: calls gh merge when ci=success and CLEAN (prod mergeStateStatus)" {
  local gh_called=""
  gh() { gh_called="$*"; }
  info() { :; }
  _loop_pr_merge_self_eager "42" "success" "CLEAN" "owner/repo"
  [[ "$gh_called" == *"pr merge 42"* ]]
  [[ "$gh_called" == *"--squash"* ]]
}

@test "_loop_pr_merge_self_eager: skips merge when ci=pending" {
  local gh_called=""
  gh() { gh_called="$*"; }
  _loop_pr_merge_self_eager "42" "pending" "MERGEABLE" "owner/repo"
  [ -z "$gh_called" ]
}

@test "_loop_pr_merge_self_eager: skips merge when mergeable=CONFLICTING" {
  local gh_called=""
  gh() { gh_called="$*"; }
  _loop_pr_merge_self_eager "42" "success" "CONFLICTING" "owner/repo"
  [ -z "$gh_called" ]
}

@test "_loop_pr_merge_self_eager: skips merge when ci=failure" {
  local gh_called=""
  gh() { gh_called="$*"; }
  _loop_pr_merge_self_eager "42" "failure" "MERGEABLE" "owner/repo"
  [ -z "$gh_called" ]
}
