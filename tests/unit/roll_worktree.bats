#!/usr/bin/env bats
# US-AUTO-036: Tests for worktree helper functions (loop-safe additions).
#
# These helpers will be wired into _write_loop_runner_script in US-AUTO-037
# (manual-only). Phase 1 (this Story) delivers helpers + tests with **zero
# runner.sh changes**.
#
# Helper namespace: _worktree_*
#   _worktree_path <slug> <us-id>             → string
#   _worktree_create <path> <branch> <base>   → idempotent on branch reuse
#   _worktree_cleanup <path> <branch>         → remove worktree + branch
#   _worktree_fetch_origin <branch>           → lenient on failure
#   _worktree_submodule_init <path>           → init submodules in worktree
#   _worktree_merge_back <branch>             → ff-only merge + push, alert on fail
#   _worktree_alert <msg>                     → append to _LOOP_ALERT (internal)

load helpers

setup() {
  unit_setup
  _orig_dir="$PWD"
  cd "$TEST_TMP"

  # Bare upstream + local clone so fetch/push are exercisable without a real remote.
  git init -q --bare upstream.git
  git clone -q upstream.git repo
  cd repo
  git config user.email "test@example.com"
  git config user.name "Test"
  git config commit.gpgsign false
  git commit --allow-empty -m "init" -q
  git push -q origin master 2>/dev/null || git push -q origin main 2>/dev/null || true
  # Pin to main for predictability
  git branch -m main 2>/dev/null || true
  git push -q -u origin main 2>/dev/null || true

  # Override roll's shared dirs to land inside TEST_TMP
  _SHARED_ROOT="${TEST_TMP}/shared"
  _LOOP_ALERT="${_SHARED_ROOT}/loop/ALERT.md"
  mkdir -p "${_SHARED_ROOT}/worktrees" "${_SHARED_ROOT}/loop"
}
teardown() {
  # Clean any lingering worktrees registered against this repo
  if [ -d "${TEST_TMP}/repo" ]; then
    cd "${TEST_TMP}/repo" 2>/dev/null && git worktree list --porcelain 2>/dev/null \
      | awk '/^worktree /{print $2}' \
      | while read -r wt; do
          [ "$wt" != "${TEST_TMP}/repo" ] && git worktree remove --force "$wt" 2>/dev/null || true
        done
  fi
  cd "$_orig_dir"
  unit_teardown
}

# --- _worktree_path ---

@test "_worktree_path: returns <_SHARED_ROOT>/worktrees/<slug>-<us-id>" {
  run _worktree_path "myproj-abc123" "US-AUTO-036"
  [ "$status" -eq 0 ]
  [ "$output" = "${_SHARED_ROOT}/worktrees/myproj-abc123-US-AUTO-036" ]
}

# --- _worktree_create ---

@test "_worktree_create: fresh path + new branch succeeds" {
  local wt; wt=$(_worktree_path "test" "US-X")
  run _worktree_create "$wt" "loop/US-X" "main"
  [ "$status" -eq 0 ]
  [ -d "$wt" ]
  [ -f "$wt/.git" ] || [ -d "$wt/.git" ]
  git show-ref --verify --quiet "refs/heads/loop/US-X"
}

@test "_worktree_create: idempotent when branch already exists from prior failed run" {
  local wt; wt=$(_worktree_path "test" "US-Y")
  # First create
  _worktree_create "$wt" "loop/US-Y" "main"
  # Simulate prior run that registered branch but worktree dir was cleaned externally
  git worktree remove --force "$wt"
  # Branch still exists at this point
  git show-ref --verify --quiet "refs/heads/loop/US-Y"

  # Retry — must succeed even though branch already exists
  run _worktree_create "$wt" "loop/US-Y" "main"
  [ "$status" -eq 0 ]
  [ -d "$wt" ]
}

# --- _worktree_cleanup ---

@test "_worktree_cleanup: removes worktree dir and deletes branch" {
  local wt; wt=$(_worktree_path "test" "US-Z")
  _worktree_create "$wt" "loop/US-Z" "main"
  [ -d "$wt" ]
  git show-ref --verify --quiet "refs/heads/loop/US-Z"

  run _worktree_cleanup "$wt" "loop/US-Z"
  [ "$status" -eq 0 ]
  [ ! -d "$wt" ]
  ! git show-ref --verify --quiet "refs/heads/loop/US-Z"
}

@test "_worktree_cleanup: tolerant when worktree or branch already absent" {
  local wt; wt=$(_worktree_path "test" "US-MISSING")
  # Neither exists; cleanup should still succeed
  run _worktree_cleanup "$wt" "loop/US-MISSING"
  [ "$status" -eq 0 ]
}

# --- _worktree_alert ---

@test "_worktree_alert: appends timestamped message to _LOOP_ALERT" {
  run _worktree_alert "sample failure message"
  [ "$status" -eq 0 ]
  [ -f "$_LOOP_ALERT" ]
  grep -qF "sample failure message" "$_LOOP_ALERT"
}

# --- _worktree_fetch_origin ---

@test "_worktree_fetch_origin: succeeds when origin has the branch" {
  run _worktree_fetch_origin "main"
  [ "$status" -eq 0 ]
}

@test "_worktree_fetch_origin: lenient — returns 0 even when fetch fails" {
  # Break origin so fetch fails (origin URL points nowhere)
  git remote set-url origin "${TEST_TMP}/does-not-exist.git"
  run _worktree_fetch_origin "main"
  [ "$status" -eq 0 ]
}

# --- _worktree_submodule_init ---

@test "_worktree_submodule_init: works inside worktree and leaves main intact (coexistence)" {
  # Build a tiny submodule upstream
  cd "$TEST_TMP"
  git init -q --bare submod.git
  git clone -q submod.git submod_seed
  ( cd submod_seed \
      && git config user.email t@t && git config user.name t && git config commit.gpgsign false \
      && git commit --allow-empty -m "submod-init" -q \
      && git branch -m main 2>/dev/null \
      && git push -q -u origin main )
  rm -rf submod_seed

  # Add the submodule to main repo. file:// transport is restricted by
  # default in modern git, so we opt in via `-c protocol.file.allow=always`
  # for the test fixture commands. The helper under test does NOT receive
  # this flag — it relies on the worktree inheriting from main's persisted
  # config below.
  cd "${TEST_TMP}/repo"
  git config protocol.file.allow always
  git -c protocol.file.allow=always submodule add -q "${TEST_TMP}/submod.git" deps/submod
  git commit -q -m "add submod"
  git push -q

  # Init main's submodule + record its HEAD
  git -c protocol.file.allow=always submodule update --init --recursive --quiet
  [ -d deps/submod/.git ] || [ -f deps/submod/.git ]
  local main_submod_head; main_submod_head=$(cd deps/submod && git rev-parse HEAD)

  # Spin up a worktree, run the helper. file:// transport is only used to
  # avoid spinning up a real remote in tests, so inject the protocol allowlist
  # via env (production submodules use https — no env needed).
  local wt; wt=$(_worktree_path "test" "US-SUB")
  _worktree_create "$wt" "loop/US-SUB" "main"
  GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=protocol.file.allow GIT_CONFIG_VALUE_0=always \
    run _worktree_submodule_init "$wt"
  [ "$status" -eq 0 ]

  # Worktree has submodule materialised
  [ -d "$wt/deps/submod/.git" ] || [ -f "$wt/deps/submod/.git" ]

  # Main's submodule is unaffected (same HEAD, working tree intact)
  local main_submod_after; main_submod_after=$(cd deps/submod && git rev-parse HEAD)
  [ "$main_submod_head" = "$main_submod_after" ]
}

# --- _worktree_merge_back ---

@test "_worktree_merge_back: ff-only success — worktree commit reaches main and origin" {
  local wt; wt=$(_worktree_path "test" "US-FF")
  _worktree_create "$wt" "loop/US-FF" "main"

  # Make a commit on the worktree's branch
  ( cd "$wt" \
      && echo "hello" > new.txt \
      && git add new.txt \
      && git commit -q -m "work commit" )

  local main_head_before; main_head_before=$(git rev-parse HEAD)

  # Caller is on main; merge_back ff-merges loop branch + pushes
  run _worktree_merge_back "loop/US-FF"
  [ "$status" -eq 0 ]

  # Main has advanced (got the worktree's commit)
  local main_head_after; main_head_after=$(git rev-parse HEAD)
  [ "$main_head_before" != "$main_head_after" ]
  [ -f new.txt ]

  # Origin has the new commit too
  git fetch origin --quiet
  local origin_main; origin_main=$(git rev-parse origin/main)
  [ "$main_head_after" = "$origin_main" ]
}

@test "_worktree_merge_back: ff-only failure when main diverged — alert written, returns 1" {
  local wt; wt=$(_worktree_path "test" "US-DIV")
  _worktree_create "$wt" "loop/US-DIV" "main"

  # Worktree commit
  ( cd "$wt" \
      && echo "from worktree" > wt.txt \
      && git add wt.txt \
      && git commit -q -m "worktree work" )

  # Divergent commit on main, pushed to origin so pull --ff-only is a no-op
  echo "from main" > main.txt && git add main.txt && git commit -q -m "main work"
  git push -q origin main

  run _worktree_merge_back "loop/US-DIV"
  [ "$status" -eq 1 ]

  [ -f "$_LOOP_ALERT" ]
  grep -qE 'ff-only|merge' "$_LOOP_ALERT"
}
