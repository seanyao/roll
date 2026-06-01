#!/usr/bin/env bats
# Tests for the PR Loop self-heal + active-merge enhancements
# (US-LOOP-050 revived / FIX-158 / US-AUTO-044 expectations ① ② ③):
#   - loop_self_ci_red  → _loop_pr_heal_self (bounded, background agent)
#   - blocked_human_approved (green + mergeable) → _loop_pr_merge_approved
#   - heal budget exhausted / disabled → deduped FIX-158 ALERT

load helpers

setup() {
  unit_setup_cd
  git init -q
  git config user.email "test@roll.dev"
  git config user.name "Test"
  _LOOP_ALERT="${TEST_TMP}/.alert"
  # Isolate the per-slug state file used by the heal counter.
  _SHARED_ROOT="${TEST_TMP}/shared"
  _LOOP_PROJ_SLUG="heal-test"
}
teardown() { unit_teardown_cd; }

# ─── _loop_pr_merge_approved ──────────────────────────────────────────────────

@test "_loop_pr_merge_approved: green + mergeable merges via gh" {
  gh() { echo "$@" >> "${TEST_TMP}/gh.log"; }
  run _loop_pr_merge_approved 42 success MERGEABLE test/repo
  [ "$status" -eq 0 ]
  grep -qF "pr merge 42 --squash --delete-branch" "${TEST_TMP}/gh.log"
}

@test "_loop_pr_merge_approved: not green → no-op (no merge)" {
  gh() { echo "$@" >> "${TEST_TMP}/gh.log"; }
  run _loop_pr_merge_approved 42 failure MERGEABLE test/repo
  [ "$status" -eq 0 ]
  [ ! -f "${TEST_TMP}/gh.log" ]
}

@test "_loop_pr_merge_approved: conflicting → no-op (no merge)" {
  gh() { echo "$@" >> "${TEST_TMP}/gh.log"; }
  run _loop_pr_merge_approved 42 success CONFLICTING test/repo
  [ "$status" -eq 0 ]
  [ ! -f "${TEST_TMP}/gh.log" ]
}

# ─── _loop_pr_ci_red_alert (FIX-158 surfacing, deduped) ───────────────────────

@test "_loop_pr_ci_red_alert: writes a typed alert and dedupes across calls" {
  _loop_pr_ci_red_alert 7
  _loop_pr_ci_red_alert 7
  run grep -cF "[TYPE:loop-pr-ci-red] PR #7" "$_LOOP_ALERT"
  [ "$output" -eq 1 ]
}

# ─── _loop_pr_heal_self (bounded heal) ────────────────────────────────────────

@test "_loop_pr_heal_self: budget available → increments counter and spawns agent" {
  export ROLL_LOOP_HEAL_MAX=2
  _loop_pr_spawn_heal_agent() { echo "$1" > "${TEST_TMP}/spawned"; }
  _loop_hot_fix_pr() { echo "/tmp/log-$1"; }

  run _loop_pr_heal_self 9 loop/cycle-x test/repo
  [ "$status" -eq 0 ]
  [ "$(cat "${TEST_TMP}/spawned")" = "9" ]
  # Counter persisted at 1, no exhaustion alert.
  grep -qF "heal_count_pr_9: 1" "${TEST_TMP}/shared/loop/state-heal-test.yaml"
  [ ! -f "$_LOOP_ALERT" ] || ! grep -qF "PR #9" "$_LOOP_ALERT"
}

@test "_loop_pr_heal_self: budget exhausted → alert, no spawn" {
  export ROLL_LOOP_HEAL_MAX=2
  mkdir -p "${TEST_TMP}/shared/loop"
  echo "heal_count_pr_9: 2" > "${TEST_TMP}/shared/loop/state-heal-test.yaml"
  _loop_pr_spawn_heal_agent() { echo "$1" > "${TEST_TMP}/spawned"; }
  _loop_hot_fix_pr() { echo "/tmp/log-$1"; }

  run _loop_pr_heal_self 9 loop/cycle-x test/repo
  [ "$status" -eq 0 ]
  [ ! -f "${TEST_TMP}/spawned" ]
  grep -qF "[TYPE:loop-pr-ci-red] PR #9" "$_LOOP_ALERT"
}

@test "_loop_pr_heal_self: ROLL_LOOP_NO_HEAL=1 → alert, no spawn" {
  export ROLL_LOOP_NO_HEAL=1
  _loop_pr_spawn_heal_agent() { echo "$1" > "${TEST_TMP}/spawned"; }
  _loop_hot_fix_pr() { echo "/tmp/log-$1"; }

  run _loop_pr_heal_self 9 loop/cycle-x test/repo
  [ "$status" -eq 0 ]
  [ ! -f "${TEST_TMP}/spawned" ]
  grep -qF "[TYPE:loop-pr-ci-red] PR #9" "$_LOOP_ALERT"
}

# ─── _loop_pr_inbox routing ───────────────────────────────────────────────────

@test "_loop_pr_inbox: red loop/* PR routes to heal (not silently dropped)" {
  git remote add origin git@github.com:test/repo.git
  _gh_repo_slug() { echo "test/repo"; }
  gh() {
    if [ "$1" = "-R" ]; then shift 2; fi
    if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
      echo '[{"number":99,"headRefName":"loop/cycle-z","author":{"login":"seanyao"}}]'
      return 0
    fi
    if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
      echo '{"reviews":[],"mergeStateStatus":"DIRTY","statusCheckRollup":[{"conclusion":"FAILURE"}]}'
      return 0
    fi
    return 0
  }
  _loop_pr_heal_self() { echo "$1" > "${TEST_TMP}/healed"; }

  run _loop_pr_inbox
  [ "$status" -eq 0 ]
  [ "$(cat "${TEST_TMP}/healed")" = "99" ]
}

@test "_loop_pr_inbox: approved + green external PR is actively merged" {
  git remote add origin git@github.com:test/repo.git
  _gh_repo_slug() { echo "test/repo"; }
  gh() {
    if [ "$1" = "-R" ]; then shift 2; fi
    if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
      echo '[{"number":50,"headRefName":"feat/foo","author":{"login":"contrib"}}]'
      return 0
    fi
    if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
      echo '{"reviews":[{"authorAssociation":"COLLABORATOR","state":"APPROVED"}],"mergeStateStatus":"MERGEABLE","statusCheckRollup":[{"conclusion":"SUCCESS"}]}'
      return 0
    fi
    return 0
  }
  _loop_pr_merge_approved() { echo "$1" > "${TEST_TMP}/merged"; }

  run _loop_pr_inbox
  [ "$status" -eq 0 ]
  [ "$(cat "${TEST_TMP}/merged")" = "50" ]
}
