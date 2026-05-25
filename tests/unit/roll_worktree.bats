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

  # Bare upstream + local clone so fetch/push are exercisable without a real
  # remote. `init.defaultBranch=main` pins both bare and local to `main` on
  # every OS — ubuntu's older git still defaults to `master`, which left the
  # bare repo's HEAD dangling and broke submodule add (see CI run 25789742946).
  git -c init.defaultBranch=main init -q --bare upstream.git
  git -c init.defaultBranch=main clone -q upstream.git repo
  cd repo
  git config user.email "test@example.com"
  git config user.name "Test"
  git config commit.gpgsign false
  git commit --allow-empty -m "init" -q
  git push -q -u origin main

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
  # Build a tiny submodule upstream (pin to main — see setup() comment)
  cd "$TEST_TMP"
  git -c init.defaultBranch=main init -q --bare submod.git
  git -c init.defaultBranch=main clone -q submod.git submod_seed
  ( cd submod_seed \
      && git config user.email t@t && git config user.name t && git config commit.gpgsign false \
      && git commit --allow-empty -m "submod-init" -q \
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

# --- _worktree_sync_meta (FIX-069) ---

@test "_worktree_sync_meta: copies backlog/skills into worktree, excludes runtime state" {
  local wt; wt=$(_worktree_path "test" "US-META")
  _worktree_create "$wt" "loop/US-META" "main"

  # Seed main's .roll/ with a mix of meta files and runtime artefacts
  mkdir -p .roll/skills/roll-build .roll/conventions .roll/state .roll/scratch
  echo "# Backlog" > .roll/backlog.md
  echo "skill: roll-build" > .roll/skills/roll-build/SKILL.md
  echo "convention" > .roll/conventions/global.md
  echo "live-state" > .roll/state/state.yaml
  echo "scratch" > .roll/scratch/draft.md
  : > .roll/events.lock
  echo "pass" > .roll/last-test-pass
  echo '{"event":"x"}' > .roll/events.ndjson
  echo '{"run":"y"}' > .roll/runs.jsonl

  run _worktree_sync_meta "$wt"
  [ "$status" -eq 0 ]

  # Meta copied
  [ -f "$wt/.roll/backlog.md" ]
  [ -f "$wt/.roll/skills/roll-build/SKILL.md" ]
  [ -f "$wt/.roll/conventions/global.md" ]

  # Runtime artefacts excluded
  [ ! -d "$wt/.roll/state" ]
  [ ! -d "$wt/.roll/scratch" ]
  [ ! -f "$wt/.roll/events.lock" ]
  [ ! -f "$wt/.roll/last-test-pass" ]
  [ ! -f "$wt/.roll/events.ndjson" ]
  [ ! -f "$wt/.roll/runs.jsonl" ]
}

@test "_worktree_sync_meta: silent no-op when .roll/ absent in main repo" {
  local wt; wt=$(_worktree_path "test" "US-NOMETA")
  _worktree_create "$wt" "loop/US-NOMETA" "main"

  # No .roll/ in main — helper must succeed without creating one in worktree
  [ ! -d .roll ]
  run _worktree_sync_meta "$wt"
  [ "$status" -eq 0 ]
  [ ! -d "$wt/.roll" ]
}

@test "_worktree_sync_meta: single-shot — later edits in main don't leak into worktree" {
  local wt; wt=$(_worktree_path "test" "US-SNAPSHOT")
  _worktree_create "$wt" "loop/US-SNAPSHOT" "main"

  mkdir -p .roll
  echo "v1" > .roll/backlog.md
  _worktree_sync_meta "$wt"
  [ "$(cat "$wt/.roll/backlog.md")" = "v1" ]

  # Main edits backlog after the sync — worktree copy must NOT change
  # (no background watcher, no symlink, no re-sync)
  echo "v2" > .roll/backlog.md
  [ "$(cat "$wt/.roll/backlog.md")" = "v1" ]
}

# --- _worktree_merge_back ---

@test "_worktree_merge_back: ff-only success for doc-only branch — commit reaches main and origin" {
  local wt; wt=$(_worktree_path "test" "US-FF")
  _worktree_create "$wt" "loop/US-FF" "main"

  # Doc-only commit (FIX-E: ff-merge fast path is now restricted to doc paths).
  ( cd "$wt" \
      && mkdir -p docs \
      && echo "hello" > docs/new.md \
      && git add docs/new.md \
      && git commit -q -m "doc: add note" )

  local main_head_before; main_head_before=$(git rev-parse HEAD)

  # Caller is on main; merge_back ff-merges loop branch + pushes
  run _worktree_merge_back "loop/US-FF"
  [ "$status" -eq 0 ]

  # Main has advanced (got the worktree's commit)
  local main_head_after; main_head_after=$(git rev-parse HEAD)
  [ "$main_head_before" != "$main_head_after" ]
  [ -f docs/new.md ]

  # Origin has the new commit too
  git fetch origin --quiet
  local origin_main; origin_main=$(git rev-parse origin/main)
  [ "$main_head_after" = "$origin_main" ]
}

# Regression for FIX-E 2026-05-25: code changes must not bypass PR+CI gate
# via _worktree_merge_back's ff-push fallback. The 12:15 pi cycle landed
# 3 commits on origin/main this way and turned CI red unnoticed.
@test "_worktree_merge_back: code change branch is refused — main untouched, ALERT for next-cycle retry" {
  local wt; wt=$(_worktree_path "test" "US-CODE")
  _worktree_create "$wt" "loop/US-CODE" "main"

  # Code commit: anything outside the doc allowlist counts (bin/, lib/, tests/, ...).
  ( cd "$wt" \
      && mkdir -p bin \
      && echo "echo hi" > bin/new-tool.sh \
      && git add bin/new-tool.sh \
      && git commit -q -m "feat: new tool" )

  local main_head_before; main_head_before=$(git rev-parse HEAD)
  local origin_before; origin_before=$(git ls-remote origin main | awk '{print $1}')

  run _worktree_merge_back "loop/US-CODE"
  [ "$status" -eq 1 ]

  # Main untouched locally and on origin.
  local main_head_after; main_head_after=$(git rev-parse HEAD)
  [ "$main_head_before" = "$main_head_after" ]
  local origin_after; origin_after=$(git ls-remote origin main | awk '{print $1}')
  [ "$origin_before" = "$origin_after" ]

  # ALERT contains the human-on-the-loop retry script for the next cycle.
  [ -f "$_LOOP_ALERT" ]
  grep -qF 'FIX-E' "$_LOOP_ALERT"
  grep -qF 'gh pr create --base main --head loop/US-CODE' "$_LOOP_ALERT"
  grep -qF 'gh pr merge loop/US-CODE --auto --squash --delete-branch' "$_LOOP_ALERT"
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

# --- _claude_cleanup_stale_worktrees (REFACTOR-011) ---

@test "_claude_cleanup_stale_worktrees: merged branch worktree is removed" {
  local wt_dir="${TEST_TMP}/repo/.claude/worktrees"
  mkdir -p "$wt_dir"
  git worktree add "$wt_dir/merged-wt" -b "claude/merged-test" -q
  # Branch at same HEAD as main → merge-base --is-ancestor returns 0
  run _claude_cleanup_stale_worktrees "${TEST_TMP}/repo"
  [ "$status" -eq 0 ]
  [ ! -d "$wt_dir/merged-wt" ]
  run git branch
  [[ "$output" != *"claude/merged-test"* ]]
}

@test "_claude_cleanup_stale_worktrees: active (ahead-of-main) worktree is preserved" {
  local wt_dir="${TEST_TMP}/repo/.claude/worktrees"
  mkdir -p "$wt_dir"
  git worktree add "$wt_dir/active-wt" -b "claude/active-test" -q
  git -C "$wt_dir/active-wt" commit --allow-empty -m "wip" -q
  run _claude_cleanup_stale_worktrees "${TEST_TMP}/repo"
  [ "$status" -eq 0 ]
  [ -d "$wt_dir/active-wt" ]
}

@test "_claude_cleanup_stale_worktrees: missing .claude/worktrees dir is silent return 0" {
  run _claude_cleanup_stale_worktrees "${TEST_TMP}/repo"
  [ "$status" -eq 0 ]
}
