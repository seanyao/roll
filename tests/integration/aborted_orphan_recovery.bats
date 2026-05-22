#!/usr/bin/env bats
# FIX-086: Integration tests for the orphan-push safety net in _inner_cleanup.
#
# Scenario: a loop cycle completes one or more TCR commits in its worktree, but
# the inner script is terminated (e.g. SIGHUP, parent process death) BEFORE the
# publish step runs. Without the FIX-086 safety net, _inner_cleanup writes
# `cycle_end aborted` and the commits remain dangling in the worktree only — if
# the worktree is later force-removed, the work is lost.
#
# FIX-086 inserts an "unpushed-commit detection + orphan push" before the
# existing aborted/timeout fallback in _inner_cleanup. On success it writes
# `cycle_end orphan` and tags origin with `loop-orphan-<CYCLE_ID>` so the commits
# survive even if the worktree is cleaned up.
#
# Strategy: build a small git fixture, generate a real inner.sh, then drive it
# with a stub command that creates commits and immediately kills the parent
# inner.sh with SIGUSR1 (default action: terminate; EXIT trap fires; the SIGTERM
# trap `_on_sigterm` does NOT fire, so _CYCLE_TIMED_OUT stays 0 — exactly the
# "aborted" path FIX-086 targets). SIGUSR1 is preferred over SIGHUP because
# SIGHUP propagates through the controlling terminal and would kill bats itself.

load helpers

setup() {
  integration_setup
  export HOME="$TEST_TMP"
  _SHARED_ROOT="${TEST_TMP}/.shared/roll"
  mkdir -p "${_SHARED_ROOT}/loop" "${_SHARED_ROOT}/worktrees"

  ROLL_PKG_DIR="${BATS_TEST_DIRNAME}/../.."
  export ROLL_PKG_DIR
  source "$ROLL_BIN"
  _SHARED_ROOT="${TEST_TMP}/.shared/roll"

  # Tiny git fixture: bare upstream + local clone.
  cd "$TEST_TMP"
  git -c init.defaultBranch=main init -q --bare upstream.git
  git -c init.defaultBranch=main clone -q upstream.git project
  cd project
  git config user.email "test@example.com"
  git config user.name "Test"
  git config commit.gpgsign false
  git config protocol.file.allow always
  echo "init" > README.md
  git add README.md
  git commit -q -m "initial commit"
  git push -q -u origin main

  _project="${TEST_TMP}/project"
  _LOOP_ALERT="${_SHARED_ROOT}/loop/ALERT-$(_project_slug "$_project").md"
}

teardown() {
  if [ -d "${_project}/.git" ]; then
    cd "$_project" 2>/dev/null \
      && git worktree list --porcelain 2>/dev/null \
      | awk '/^worktree /{print $2}' \
      | while read -r wt; do
          [ "$wt" != "$_project" ] && git worktree remove --force "$wt" 2>/dev/null || true
        done
  fi
  cd /
  integration_teardown
}

# Generate the inner script for a given cmd; returns its path on stdout.
_make_inner() {
  local cmd="$1"
  local script="${TEST_TMP}/run-test.sh"
  _write_loop_runner_script "$script" "$_project" "$cmd" "${TEST_TMP}/log" 0 24
  echo "${script%.sh}-inner.sh"
}

@test "FIX-086: aborted cycle with unpushed commits → orphan tag pushed to origin" {
  # Stub command: create a commit in the worktree, then SIGUSR1 the parent inner.sh
  # so it dies before reaching the publish path. EXIT trap fires; _CYCLE_TIMED_OUT
  # stays 0 (SIGUSR1, not SIGTERM) → enters the aborted branch of _inner_cleanup.
  local cmd='git commit --allow-empty -m "tcr: aborted cycle work" && kill -USR1 $$ && sleep 30'
  local inner; inner=$(_make_inner "$cmd")

  HOME="$TEST_TMP" bash "$inner" || true

  # Verify origin has the orphan tag (FIX-086 safety net pushed it).
  cd "$_project"
  git fetch origin --tags --quiet
  local orphan_tags; orphan_tags=$(git tag -l 'loop-orphan-*' --list)
  [[ -n "$orphan_tags" ]] || {
    echo "expected origin to have a loop-orphan-* tag, got none" >&2
    echo "all tags: $(git tag -l)" >&2
    echo "branches: $(git branch -a)" >&2
    return 1
  }

  # Verify origin has the cycle branch (push must have succeeded).
  git branch -r | grep -qE 'origin/loop/cycle-' || {
    echo "expected origin to have loop/cycle-* branch" >&2
    git branch -r >&2
    return 1
  }

  # Verify ALERT records the orphan push with the tag name.
  [ -f "$_LOOP_ALERT" ]
  grep -qE 'FIX-086' "$_LOOP_ALERT" || {
    echo "expected ALERT to mention FIX-086, got:" >&2
    cat "$_LOOP_ALERT" >&2
    return 1
  }
}

@test "FIX-086 regression: aborted with no commits → no orphan tag, no regression" {
  # Stub command: do nothing (no commits), just SIGUSR1 the parent inner.sh.
  # _CYCLE_TIMED_OUT=0, _CYCLE_END_WRITTEN=0, but no unpushed commits → orphan
  # push must be skipped, original aborted path runs unchanged.
  local cmd='kill -USR1 $$ && sleep 30'
  local inner; inner=$(_make_inner "$cmd")

  HOME="$TEST_TMP" bash "$inner" || true

  cd "$_project"
  git fetch origin --tags --quiet
  local orphan_tags; orphan_tags=$(git tag -l 'loop-orphan-*' --list)
  [[ -z "$orphan_tags" ]] || {
    echo "did not expect orphan tag for no-commit abort, got: $orphan_tags" >&2
    return 1
  }
}

@test "FIX-091: aborted with commits + gh available → PR published, ALERT mentions FIX-091" {
  # FIX-091: when commits exist on abort AND gh is reachable, _inner_cleanup
  # should call _loop_publish_pr first so the cycle's work lands as a normal
  # PR (ready to auto-merge) instead of requiring manual rescue from a tag.
  # Set up: rewire origin URL to look like github so _gh_repo_slug accepts it,
  # but keep the actual push target via insteadOf so git push still reaches
  # the local bare upstream.
  cd "$_project"
  git config --add url."${TEST_TMP}/upstream.git/".insteadOf "git@github.com:test/test.git"
  git remote set-url origin "git@github.com:test/test.git"

  # Stub gh in PATH: pr view returns 1 (no existing PR), pr create echoes URL
  # and exits 0, pr merge exits 0. Every call is logged for assertion.
  local mock_bin="${TEST_TMP}/mock-bin"
  mkdir -p "$mock_bin"
  local gh_log="${TEST_TMP}/gh.log"
  : > "$gh_log"
  cat > "$mock_bin/gh" <<EOF
#!/bin/bash
echo "gh \$*" >> "$gh_log"
case "\$*" in
  *"pr view"*)   exit 1 ;;
  *"pr create"*) echo "https://github.com/test/test/pull/1"; exit 0 ;;
  *"pr merge"*)  exit 0 ;;
  *)             exit 0 ;;
esac
EOF
  chmod +x "$mock_bin/gh"
  export PATH="$mock_bin:$PATH"

  local cmd='git commit --allow-empty -m "tcr: aborted cycle work" && kill -USR1 $$ && sleep 30'
  local inner; inner=$(_make_inner "$cmd")

  HOME="$TEST_TMP" PATH="$mock_bin:$PATH" bash "$inner" || true

  # Assert: gh pr create was invoked (FIX-091 took the publish path).
  grep -qE 'gh.*pr create' "$gh_log" || {
    echo "expected 'gh pr create' to be called, got gh log:" >&2
    cat "$gh_log" >&2
    return 1
  }

  # Assert: ALERT mentions FIX-091 (PR published, not tag-only fallback).
  [ -f "$_LOOP_ALERT" ]
  grep -qE 'FIX-091' "$_LOOP_ALERT" || {
    echo "expected ALERT to mention FIX-091, got:" >&2
    cat "$_LOOP_ALERT" >&2
    return 1
  }
}
