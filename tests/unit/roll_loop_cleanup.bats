#!/usr/bin/env bats
# US-AUTO-038: cleanup of orphan claude/* session branches.
#
# Each loop cycle runs `claude` which may push claude/<name>-<id> branches to
# origin. These never become PRs (US-AUTO-033 only handles loop/cycle-* branches)
# and GitHub surfaces a stale "Compare & pull request" banner for them. The fix:
#
#   pre-claude  → snapshot remote claude/* branches
#   post-claude → diff snapshot vs current; delete the additions (silent on failure)

load helpers

_install_fake_git() {
  _fake_bin="${TEST_TMP}/bin"
  mkdir -p "$_fake_bin"
  export PUSH_CALLS="${TEST_TMP}/push_calls"
  export LSREMOTE_OUT="${TEST_TMP}/lsremote_out"
  export REMOTE_URL="${REMOTE_URL:-https://github.com/owner/repo.git}"
  : > "$PUSH_CALLS"
  : > "$LSREMOTE_OUT"

  cat > "$_fake_bin/git" << 'SH'
#!/bin/bash
# Mock git that records push --delete calls and reads ls-remote/remote
# fixtures from env-pointed files. Ignores -C <repo> args.
while [ "$1" = "-C" ]; do shift 2; done
case "$1" in
  ls-remote)
    cat "$LSREMOTE_OUT" 2>/dev/null
    ;;
  remote)
    if [ "$2" = "get-url" ]; then echo "$REMOTE_URL"; fi
    ;;
  merge-base)
    # merge-base --is-ancestor <branch> origin/main
    local branch="$3"
    if [ -n "$MERGED_BRANCHES" ] && echo "$MERGED_BRANCHES" | grep -qF "$branch"; then
      exit 0
    fi
    exit 1
    ;;
  push)
    # push origin --delete <branch>
    branch="$4"
    echo "$branch" >> "$PUSH_CALLS"
    [ -n "$PUSH_SHOULD_FAIL" ] && exit 1
    ;;
esac
SH
  chmod +x "$_fake_bin/git"
  export PATH="$_fake_bin:$PATH"
}

setup() {
  unit_setup_cd
  _install_fake_git
}

teardown() {
  unset PUSH_SHOULD_FAIL REMOTE_URL LSREMOTE_OUT PUSH_CALLS MERGED_BRANCHES
  unit_teardown_cd
}

# --- _claude_remote_snapshot ---

@test "_claude_remote_snapshot: lists branch names sans refs/heads/, sorted" {
  printf 'sha1\trefs/heads/claude/foo-abc\nsha2\trefs/heads/claude/bar-xyz\n' > "$LSREMOTE_OUT"
  run _claude_remote_snapshot .
  [ "$status" -eq 0 ]
  # Sorted: bar-xyz before foo-abc
  [ "${lines[0]}" = "claude/bar-xyz" ]
  [ "${lines[1]}" = "claude/foo-abc" ]
}

@test "_claude_remote_snapshot: empty when no claude branches" {
  : > "$LSREMOTE_OUT"
  run _claude_remote_snapshot .
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# --- _claude_cleanup_new_branches ---

@test "case 1: new claude branch is deleted" {
  # Prior snapshot: just claude/old
  local prior="claude/old"
  # Current state: claude/old + claude/new
  printf 'sha1\trefs/heads/claude/old\nsha2\trefs/heads/claude/new\n' > "$LSREMOTE_OUT"

  run _claude_cleanup_new_branches "$prior" .
  [ "$status" -eq 0 ]
  # Exactly one delete call for the new branch
  run cat "$PUSH_CALLS"
  [ "$status" -eq 0 ]
  [ "$output" = "claude/new" ]
}

@test "case 2: pre-existing claude branch is NOT deleted" {
  local prior="claude/keepme"
  printf 'sha1\trefs/heads/claude/keepme\n' > "$LSREMOTE_OUT"

  run _claude_cleanup_new_branches "$prior" .
  [ "$status" -eq 0 ]
  # No push calls — branch was in prior snapshot
  [ ! -s "$PUSH_CALLS" ]
}

@test "case 3: non-GitHub remote → silent skip, no delete calls" {
  export REMOTE_URL="https://gitlab.example.com/owner/repo.git"
  local prior=""
  printf 'sha1\trefs/heads/claude/anything\n' > "$LSREMOTE_OUT"

  run _claude_cleanup_new_branches "$prior" .
  [ "$status" -eq 0 ]
  [ ! -s "$PUSH_CALLS" ]
}

@test "case 4: cleanup is wired AFTER the for-attempt loop (runs on claude failure)" {
  local script_path="${TEST_TMP}/run-test.sh"
  _write_loop_runner_script "$script_path" "/tmp/proj" "claude -p go" "/tmp/log" 0 24
  local inner_path="${script_path%.sh}-inner.sh"
  # Snapshot capture exists before the for loop
  grep -qF 'CLAUDE_BRANCH_SNAPSHOT' "$inner_path"
  # Cleanup call exists OUTSIDE any "if [ \"\$_exit\" -eq 0 ]" — must be at top level
  # so it runs whether claude succeeded or failed.
  grep -qF '_claude_cleanup_new_branches' "$inner_path"
  # And it appears AFTER the retry loop's `done` keyword
  local loop_end_line cleanup_line
  loop_end_line=$(grep -n '^done$' "$inner_path" | head -1 | cut -d: -f1)
  cleanup_line=$(grep -n '_claude_cleanup_new_branches' "$inner_path" | head -1 | cut -d: -f1)
  [ -n "$loop_end_line" ]
  [ -n "$cleanup_line" ]
  [ "$cleanup_line" -gt "$loop_end_line" ]
}

@test "case 5: delete failure is silently ignored (return 0)" {
  export PUSH_SHOULD_FAIL=1
  local prior=""
  printf 'sha1\trefs/heads/claude/doomed\n' > "$LSREMOTE_OUT"

  run _claude_cleanup_new_branches "$prior" .
  [ "$status" -eq 0 ]
  # push was attempted (recorded before exit 1)
  run cat "$PUSH_CALLS"
  [ "$output" = "claude/doomed" ]
}

# --- _claude_cleanup_stale_worktrees (wiring only — behaviour tested in roll_worktree.bats) ---

@test "_claude_cleanup_stale_worktrees: wired in runner script alongside branch cleanup" {
  local script_path="${TEST_TMP}/run-test.sh"
  _write_loop_runner_script "$script_path" "/tmp/proj" "claude -p go" "/tmp/log" 0 24
  local inner_path="${script_path%.sh}-inner.sh"
  grep -qF '_claude_cleanup_stale_worktrees' "$inner_path"
  # Must appear after the retry loop
  local loop_end_line stale_wt_line
  loop_end_line=$(grep -n '^done$' "$inner_path" | head -1 | cut -d: -f1)
  stale_wt_line=$(grep -n '_claude_cleanup_stale_worktrees' "$inner_path" | head -1 | cut -d: -f1)
  [ -n "$stale_wt_line" ]
  [ "$stale_wt_line" -gt "$loop_end_line" ]
}

# --- _loop_cleanup_stale_cycle_branches (US-AUTO-040) ---

@test "_loop_cleanup_stale_cycle_branches: deletes merged loop/cycle-* branch" {
  printf 'sha1\trefs/heads/loop/cycle-20260514-0800\n' > "$LSREMOTE_OUT"
  export MERGED_BRANCHES="loop/cycle-20260514-0800"
  : > "$PUSH_CALLS"
  run _loop_cleanup_stale_cycle_branches .
  [ "$status" -eq 0 ]
  run cat "$PUSH_CALLS"
  [ "$output" = "loop/cycle-20260514-0800" ]
}

@test "_loop_cleanup_stale_cycle_branches: skips branch ahead of main" {
  printf 'sha1\trefs/heads/loop/cycle-20260514-0900\n' > "$LSREMOTE_OUT"
  export MERGED_BRANCHES=""
  : > "$PUSH_CALLS"
  run _loop_cleanup_stale_cycle_branches .
  [ "$status" -eq 0 ]
  [ ! -s "$PUSH_CALLS" ]
}

@test "_loop_cleanup_stale_cycle_branches: skips non-GitHub remote" {
  export REMOTE_URL="https://gitlab.example.com/owner/repo.git"
  printf 'sha1\trefs/heads/loop/cycle-20260514-1000\n' > "$LSREMOTE_OUT"
  export MERGED_BRANCHES="loop/cycle-20260514-1000"
  : > "$PUSH_CALLS"
  run _loop_cleanup_stale_cycle_branches .
  [ "$status" -eq 0 ]
  [ ! -s "$PUSH_CALLS" ]
}

@test "_loop_cleanup_stale_cycle_branches: idempotent — delete failure silent" {
  export PUSH_SHOULD_FAIL=1
  printf 'sha1\trefs/heads/loop/cycle-20260514-1100\n' > "$LSREMOTE_OUT"
  export MERGED_BRANCHES="loop/cycle-20260514-1100"
  : > "$PUSH_CALLS"
  run _loop_cleanup_stale_cycle_branches .
  [ "$status" -eq 0 ]
}

@test "_loop_cleanup_stale_cycle_branches: wired into inner.sh after PR publish" {
  local script_path="${TEST_TMP}/run-test.sh"
  _write_loop_runner_script "$script_path" "/tmp/proj" "claude -p go" "/tmp/log" 0 24
  local inner_path="${script_path%.sh}-inner.sh"
  grep -qF '_loop_cleanup_stale_cycle_branches' "$inner_path"
}
