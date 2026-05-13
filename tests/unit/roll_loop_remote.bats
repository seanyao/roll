#!/usr/bin/env bats
# Tests for FIX-030: _loop_precheck_remote — Step 1.4 Pre-run Remote Sync.
# Covers the 4 paths required by the BACKLOG row:
#   in-sync / behind-clean / behind-dirty / fetch-failed
# Plus smoke (function exists), no-remote lenient, and SKILL doc check.

ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"
LOOP_SKILL="${BATS_TEST_DIRNAME}/../../skills/roll-loop/SKILL.md"

setup() {
  source "$ROLL_BIN"
  _orig_dir="$PWD"
  _test_dir=$(mktemp -d)
  cd "$_test_dir"

  # Bare origin
  git init -q --bare origin.git

  # Local clone + initial tracked commit so working-tree dirtiness is meaningful
  git clone -q ./origin.git local
  cd local
  git config user.email "test@roll.dev"
  git config user.name "Test"
  echo "v1" > tracked.txt
  git add tracked.txt
  git -c init.defaultBranch=main commit -q -m "initial"
  local branch; branch=$(git rev-parse --abbrev-ref HEAD)
  git push -q origin "HEAD:refs/heads/${branch}"

  export _LOOP_ALERT="${_test_dir}/.alert"
}

teardown() {
  cd "$_orig_dir"
  rm -rf "$_test_dir"
}

# Helper: push a new commit to origin via a sibling clone, simulating "remote
# moved ahead of us". Leaves caller's CWD untouched.
_push_remote_commit() {
  local saved="$PWD"
  cd "$_test_dir"
  git clone -q ./origin.git pusher
  cd pusher
  git config user.email "p@p.test"
  git config user.name "Pusher"
  git commit --allow-empty -q -m "remote moved ahead"
  local branch; branch=$(git rev-parse --abbrev-ref HEAD)
  git push -q origin "HEAD:refs/heads/${branch}"
  cd "$saved"
}

# ─── Smoke ────────────────────────────────────────────────────────────────────

@test "_loop_precheck_remote: function exists in bin/roll" {
  grep -qF '_loop_precheck_remote()' "$ROLL_BIN"
}

# ─── Path 1: in-sync ──────────────────────────────────────────────────────────

@test "_loop_precheck_remote: in-sync with origin → return 0" {
  run _loop_precheck_remote
  [ "$status" -eq 0 ]
  [ ! -f "$_LOOP_ALERT" ]
}

# ─── Path 2: behind + clean ──────────────────────────────────────────────────

@test "_loop_precheck_remote: behind + clean → ff-pull and return 0" {
  _push_remote_commit
  local before; before=$(git rev-parse HEAD)

  run _loop_precheck_remote
  [ "$status" -eq 0 ]
  [ ! -f "$_LOOP_ALERT" ]

  # HEAD should have advanced via fast-forward
  local after; after=$(git rev-parse HEAD)
  [ "$before" != "$after" ]
}

# ─── Path 3: behind + dirty → ALERT + 1 ───────────────────────────────────────

@test "_loop_precheck_remote: behind + dirty working tree → ALERT + return 1" {
  _push_remote_commit
  echo "wip" >> tracked.txt   # dirty tracked file

  run _loop_precheck_remote
  [ "$status" -eq 1 ]
  [ -f "$_LOOP_ALERT" ]
  grep -qE 'Pre-run remote sync|远端|behind' "$_LOOP_ALERT"
}

@test "_loop_precheck_remote: behind + dirty does NOT discard local changes" {
  _push_remote_commit
  echo "wip" >> tracked.txt

  _loop_precheck_remote || true

  grep -q "wip" tracked.txt
}

# ─── Path 4: fetch failed → lenient return 0 ─────────────────────────────────

@test "_loop_precheck_remote: fetch failed (broken remote url) → return 0" {
  git remote set-url origin "/nonexistent/path/that/does/not/exist.git"
  run _loop_precheck_remote
  [ "$status" -eq 0 ]
  [ ! -f "$_LOOP_ALERT" ]
}

# ─── Edge: no remote / not-a-repo / detached HEAD ────────────────────────────

@test "_loop_precheck_remote: no origin remote → return 0 (lenient)" {
  git remote remove origin
  run _loop_precheck_remote
  [ "$status" -eq 0 ]
}

@test "_loop_precheck_remote: not inside a git repo → return 0 (lenient)" {
  cd "$_test_dir"
  rm -rf local
  mkdir bare
  cd bare
  run _loop_precheck_remote
  [ "$status" -eq 0 ]
}

@test "_loop_precheck_remote: detached HEAD → return 0 (lenient)" {
  git checkout --detach -q
  run _loop_precheck_remote
  [ "$status" -eq 0 ]
}

# ─── SKILL.md documentation ──────────────────────────────────────────────────

@test "roll-loop SKILL.md: Step 1.4 documents Pre-run Remote Sync" {
  grep -qiE 'step 1\.4|pre-run remote sync|_loop_precheck_remote' "$LOOP_SKILL"
}
