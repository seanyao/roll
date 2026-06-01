#!/usr/bin/env bats
# Tests for _loop_pr_review_external, _loop_pr_rebase_stale, and
# bot review detection in _loop_pr_inbox (US-PR-002).

load helpers
setup() {
  unit_setup_cd
  _test_repo="$TEST_TMP"
  git init -q
  git config user.email "test@roll.dev"
  git config user.name "Test"
  _LOOP_ALERT="${TEST_TMP}/.alert"
  _LOOP_STATE="${TEST_TMP}/state.yaml"
}
teardown() { unit_teardown_cd; }

# ─── _loop_pr_review_external ────────────────────────────────────────────────

@test "_loop_pr_review_external: calls cmd_review_pr with PR number" {
  cmd_review_pr() { echo "reviewed:$1" > "${TEST_TMP}/review-called"; }
  _loop_pr_review_external 42
  [ -f "${TEST_TMP}/review-called" ]
  [ "$(cat "${TEST_TMP}/review-called")" = "reviewed:42" ]
}

@test "_loop_pr_review_external: returns 0 even when cmd_review_pr fails" {
  cmd_review_pr() { return 1; }
  warn() { :; }
  run _loop_pr_review_external 99
  [ "$status" -eq 0 ]
}

@test "_loop_pr_review_external: returns 0 on empty input" {
  run _loop_pr_review_external ""
  [ "$status" -eq 0 ]
}

# ─── _loop_pr_rebase_stale ───────────────────────────────────────────────────

@test "_loop_pr_rebase_stale: fork PR writes ALERT and skips" {
  _gh_repo_slug() { echo "test/repo"; }
  gh() {
    if [ "$1" = "-R" ]; then shift 2; fi
    if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
      echo '{"isCrossRepository":true}'
      return 0
    fi
    return 0
  }
  _loop_pr_rebase_stale 10 "feat/fork-pr"
  [ -f "$_LOOP_ALERT" ]
  grep -q "fork PR" "$_LOOP_ALERT"
  grep -q "PR #10" "$_LOOP_ALERT"
}

@test "_loop_pr_rebase_stale: conflict writes ALERT" {
  _gh_repo_slug() { echo "test/repo"; }
  gh() {
    if [ "$1" = "-R" ]; then shift 2; fi
    if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
      echo '{"isCrossRepository":false}'
      return 0
    fi
    return 0
  }
  # Mock git to simulate rebase conflict
  git() {
    case "$1" in
      fetch)    return 0 ;;
      checkout) return 0 ;;
      rebase)
        if [ "${2:-}" = "--abort" ]; then return 0; fi
        return 1 ;;
      push)     return 0 ;;
    esac
    command git "$@"
  }
  _loop_pr_rebase_stale 15 "feat/conflict"
  [ -f "$_LOOP_ALERT" ]
  grep -q "rebase conflict" "$_LOOP_ALERT"
  grep -q "PR #15" "$_LOOP_ALERT"
}

@test "_loop_pr_rebase_stale: returns 0 on empty args" {
  run _loop_pr_rebase_stale "" ""
  [ "$status" -eq 0 ]
}

@test "_loop_pr_rebase_stale: rebases BEHIND branch and force-pushes, restoring original branch" {
  _gh_repo_slug() { echo "test/repo"; }
  gh() {
    if [ "$1" = "-R" ]; then shift 2; fi
    if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
      echo '{"isCrossRepository":false}'
      return 0
    fi
    return 0
  }

  local _bare="${TEST_TMP}/origin.git"
  git init --bare -q "$_bare"
  git remote add origin "$_bare"

  # initial commit on main
  echo "init" > main.txt
  git add main.txt
  git commit -q -m "init"
  # FIX-159: normalize the default branch to main — CI runners whose git
  # defaults to `master` would otherwise fail `push -u origin main` with
  # "src refspec main does not match any".
  git branch -M main
  git push -u origin main

  # create feature branch (touch different file to avoid content conflict)
  git checkout -q -b feat/behind
  echo "feat" > feat.txt
  git add feat.txt
  git commit -q -m "feat"

  # advance main
  git checkout -q main
  echo "advance" >> main.txt
  git add main.txt
  git commit -q -m "main advance"
  git push origin main

  # push feature (now behind)
  git checkout -q feat/behind
  git push -u origin feat/behind

  local _orig_branch; _orig_branch=$(git rev-parse --abbrev-ref HEAD)
  local _before; _before=$(git rev-parse origin/feat/behind)

  _loop_pr_rebase_stale 20 "feat/behind"

  # remote should have been force-pushed to a new commit
  local _after; _after=$(git rev-parse origin/feat/behind)
  [ "$_before" != "$_after" ]

  # current branch should be restored
  local _final; _final=$(git rev-parse --abbrev-ref HEAD)
  [ "$_final" = "$_orig_branch" ]
}

@test "_loop_pr_rebase_stale: push failure after rebase writes push-failed ALERT" {
  _gh_repo_slug() { echo "test/repo"; }
  gh() {
    if [ "$1" = "-R" ]; then shift 2; fi
    if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
      echo '{"isCrossRepository":false}'
      return 0
    fi
    return 0
  }
  git() {
    case "$1" in
      fetch)     return 0 ;;
      checkout)  return 0 ;;
      rebase)    [ "${2:-}" = "--abort" ] && return 0 || return 0 ;;
      push)      return 1 ;;
      rev-parse) echo "main" ;;
    esac
    command git "$@"
  }
  _loop_pr_rebase_stale 16 "feat/push-fail"
  [ -f "$_LOOP_ALERT" ]
  grep -q "push failed" "$_LOOP_ALERT"
  grep -q "PR #16" "$_LOOP_ALERT"
}

# ─── bot review detection in _loop_pr_inbox ──────────────────────────────────

@test "_loop_pr_inbox: bot APPROVED skips PR (defers to auto-merge)" {
  git remote add origin git@github.com:test/repo.git
  _gh_repo_slug() { echo "test/repo"; }
  gh() {
    if [ "$1" = "-R" ]; then shift 2; fi
    if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
      echo '[{"number":20,"headRefName":"feat/bot-approved","author":{"login":"contrib"}}]'
      return 0
    fi
    if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
      echo '{"reviews":[{"authorAssociation":"BOT","state":"APPROVED"}],"mergeStateStatus":"CLEAN","statusCheckRollup":[{"conclusion":"SUCCESS"}]}'
      return 0
    fi
    return 0
  }
  _loop_pr_review_external() { touch "${TEST_TMP}/review-fired"; }

  run _loop_pr_inbox
  [ "$status" -eq 0 ]
  [ ! -f "${TEST_TMP}/review-fired" ]
}

@test "_loop_pr_inbox: bot CHANGES_REQUESTED writes ALERT and skips" {
  git remote add origin git@github.com:test/repo.git
  _gh_repo_slug() { echo "test/repo"; }
  gh() {
    if [ "$1" = "-R" ]; then shift 2; fi
    if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
      echo '[{"number":21,"headRefName":"loop/cycle-x","author":{"login":"seanyao"}}]'
      return 0
    fi
    if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
      echo '{"reviews":[{"authorAssociation":"APP","state":"CHANGES_REQUESTED"}],"mergeStateStatus":"CLEAN","statusCheckRollup":[{"conclusion":"SUCCESS"}]}'
      return 0
    fi
    return 0
  }
  _loop_pr_review_external() { touch "${TEST_TMP}/review-fired"; }

  run _loop_pr_inbox
  [ "$status" -eq 0 ]
  [ ! -f "${TEST_TMP}/review-fired" ]
  [ -f "$_LOOP_ALERT" ]
  grep -q "bot review CHANGES_REQUESTED" "$_LOOP_ALERT"
}

@test "_loop_pr_inbox: no bot review falls through to classify normally" {
  git remote add origin git@github.com:test/repo.git
  _gh_repo_slug() { echo "test/repo"; }
  gh() {
    if [ "$1" = "-R" ]; then shift 2; fi
    if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
      echo '[{"number":22,"headRefName":"feat/normal","author":{"login":"contrib"}}]'
      return 0
    fi
    if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
      echo '{"reviews":[],"mergeStateStatus":"CLEAN","statusCheckRollup":[{"conclusion":"SUCCESS"}]}'
      return 0
    fi
    return 0
  }
  _loop_pr_review_external() { echo "$1" > "${TEST_TMP}/review-fired"; }

  run _loop_pr_inbox
  [ "$status" -eq 0 ]
  [ -f "${TEST_TMP}/review-fired" ]
  [ "$(cat "${TEST_TMP}/review-fired")" = "22" ]
}
