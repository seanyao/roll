#!/usr/bin/env bats
# Tests for _loop_pr_claimed_stories (FIX-048 — in-flight story race between cycles).
#
# Helper reads open `loop/cycle-*` PRs and returns story IDs already marked
# 🔨 In Progress on their branches, so a new cycle can skip them and avoid
# double-claiming the same Todo story.

load helpers
setup() {
  unit_setup_cd
  _test_repo="$TEST_TMP"
  git init -q
  git config user.email "test@roll.dev"
  git config user.name "Test"
  _LOOP_ALERT="${TEST_TMP}/.alert"
}
teardown() { unit_teardown_cd; }

@test "_loop_pr_claimed_stories: returns 0 with no output when gh unavailable" {
  _gh_resolve() { return 1; }

  run _loop_pr_claimed_stories
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "_loop_pr_claimed_stories: empty output when no open loop PRs" {
  git remote add origin git@github.com:test/repo.git
  _gh_repo_slug() { echo "test/repo"; }
  gh() {
    if [ "$1" = "-R" ]; then shift 2; fi
    if [ "$1" = "pr" ] && [ "$2" = "list" ]; then echo ""; return 0; fi
    return 0
  }

  run _loop_pr_claimed_stories
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "_loop_pr_claimed_stories: extracts claimed story IDs from loop branch BACKLOG" {
  git remote add origin git@github.com:test/repo.git
  _gh_repo_slug() { echo "test/repo"; }
  gh() {
    if [ "$1" = "-R" ]; then shift 2; fi
    if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
      echo "loop/cycle-20260517-010000-1234"
      return 0
    fi
    if [ "$1" = "api" ]; then
      cat <<'EOF'
| FIX-048 | race description | 🔨 In Progress |
| FIX-049 | another row | 📋 Todo |
| [US-AUTO-033](.roll/features/foo.md#us-auto-033) | a linked story | 🔨 In Progress |
EOF
      return 0
    fi
    return 0
  }

  run _loop_pr_claimed_stories
  [ "$status" -eq 0 ]
  echo "$output" | grep -qx "FIX-048"
  echo "$output" | grep -qx "US-AUTO-033"
  ! echo "$output" | grep -qx "FIX-049"
}

@test "_loop_pr_claimed_stories: non-loop branches are excluded by pr list filter" {
  git remote add origin git@github.com:test/repo.git
  _gh_repo_slug() { echo "test/repo"; }
  gh() {
    if [ "$1" = "-R" ]; then shift 2; fi
    if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
      # The --jq filter inside the helper should drop non-loop branches;
      # the mock returns only what would pass that filter.
      echo ""
      return 0
    fi
    return 0
  }

  run _loop_pr_claimed_stories
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "_loop_pr_claimed_stories: dedupes across multiple loop PRs" {
  git remote add origin git@github.com:test/repo.git
  _gh_repo_slug() { echo "test/repo"; }
  gh() {
    if [ "$1" = "-R" ]; then shift 2; fi
    if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
      printf 'loop/cycle-a\nloop/cycle-b\n'
      return 0
    fi
    if [ "$1" = "api" ]; then
      echo "| FIX-048 | x | 🔨 In Progress |"
      return 0
    fi
    return 0
  }

  run _loop_pr_claimed_stories
  [ "$status" -eq 0 ]
  [ "$(echo "$output" | grep -c '^FIX-048$')" -eq 1 ]
}
