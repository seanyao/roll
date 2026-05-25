#!/usr/bin/env bats
# FIX-085: loop must NOT pickup a story already marked 🔨 In Progress in main
# backlog. SKILL.md tells the agent to skip 🔨 rows, but agents don't always
# comply — so we filter 🔨 rows out of the worktree's backlog copy in
# _worktree_sync_meta. The agent literally can't see them.

load ../unit/helpers

setup() {
  unit_setup
  _orig_dir="$PWD"
  cd "$TEST_TMP"

  # Bare upstream + local clone — same fixture pattern as roll_worktree.bats.
  git -c init.defaultBranch=main init -q --bare upstream.git
  git -c init.defaultBranch=main clone -q upstream.git repo
  cd repo
  git config user.email "test@example.com"
  git config user.name "Test"
  git config commit.gpgsign false
  git commit --allow-empty -m "init" -q
  git push -q -u origin main

  _SHARED_ROOT="${TEST_TMP}/shared"
  _LOOP_ALERT="${_SHARED_ROOT}/loop/ALERT.md"
  mkdir -p "${_SHARED_ROOT}/worktrees" "${_SHARED_ROOT}/loop"
}

teardown() {
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

# refute_grep <pattern> <file>
#   Assert <pattern> is absent from <file>. Uses [ ... ] form so bats's
#   set -e correctly fails the test (bare `! grep ...` is a `!`-prefixed
#   compound command that set -e ignores — see bats-core gotcha).
refute_grep() {
  local pattern="$1" file="$2"
  if grep -qF "$pattern" "$file"; then
    echo "refute_grep: '$pattern' WAS found in $file (expected absent)" >&2
    echo "--- $file ---" >&2
    cat "$file" >&2
    echo "--- end ---" >&2
    return 1
  fi
  return 0
}

# --- FIX-085 acceptance criteria ---

@test "FIX-085: _worktree_sync_meta filters 🔨 In Progress rows from worktree backlog copy" {
  local wt; wt=$(_worktree_path "test" "FIX-085-A")
  _worktree_create "$wt" "loop/FIX-085-A" "main"

  # Seed main .roll/backlog.md with one 📋 Todo row and one 🔨 In Progress row.
  # _worktree_sync_meta reads .roll/ from CWD (the main repo), so be explicit.
  cd "${TEST_TMP}/repo"
  mkdir -p .roll
  cat > .roll/backlog.md <<'EOF'
# Project Backlog

## Epic: Demo
### Feature: demo
| Story | Description | Status |
|-------|-------------|--------|
| [US-FOO-001](.roll/features/demo/demo.md#us-foo-001) | Pickable story | 📋 Todo |
| [US-BAR-002](.roll/features/demo/demo.md#us-bar-002) | Already in progress | 🔨 In Progress |
| [US-BAZ-003](.roll/features/demo/demo.md#us-baz-003) | Done story | ✅ Done |
EOF

  run _worktree_sync_meta "$wt"
  [ "$status" -eq 0 ]

  # Worktree copy must exist
  [ -f "$wt/.roll/backlog.md" ]

  # 📋 Todo row preserved
  grep -qF 'US-FOO-001' "$wt/.roll/backlog.md"

  # 🔨 In Progress row filtered out — agent can't see it
  refute_grep 'US-BAR-002'        "$wt/.roll/backlog.md"
  refute_grep '🔨 In Progress'    "$wt/.roll/backlog.md"

  # ✅ Done row preserved (we only filter 🔨, not ✅)
  grep -qF 'US-BAZ-003' "$wt/.roll/backlog.md"
}

@test "FIX-085: main repo backlog is NOT modified by the filter" {
  local wt; wt=$(_worktree_path "test" "FIX-085-B")
  _worktree_create "$wt" "loop/FIX-085-B" "main"

  cd "${TEST_TMP}/repo"
  mkdir -p .roll
  cat > .roll/backlog.md <<'EOF'
| [US-FOO-001](.roll/features/demo.md#us-foo-001) | x | 📋 Todo |
| [US-BAR-002](.roll/features/demo.md#us-bar-002) | y | 🔨 In Progress |
EOF
  local main_before; main_before=$(cat .roll/backlog.md)

  run _worktree_sync_meta "$wt"
  [ "$status" -eq 0 ]

  # Main backlog still has the 🔨 row, byte-identical
  local main_after; main_after=$(cat .roll/backlog.md)
  [ "$main_before" = "$main_after" ]
  grep -qF '🔨 In Progress' .roll/backlog.md
  grep -qF 'US-BAR-002' .roll/backlog.md
}

@test "FIX-085: no .bak file left in worktree after filter" {
  local wt; wt=$(_worktree_path "test" "FIX-085-C")
  _worktree_create "$wt" "loop/FIX-085-C" "main"

  cd "${TEST_TMP}/repo"
  mkdir -p .roll
  cat > .roll/backlog.md <<'EOF'
| [US-FOO-001](.roll/features/demo.md#us-foo-001) | x | 🔨 In Progress |
EOF

  run _worktree_sync_meta "$wt"
  [ "$status" -eq 0 ]

  # sed -i.bak's intermediate must be cleaned
  [ ! -f "$wt/.roll/backlog.md.bak" ]
}

@test "FIX-085: no 🔨 rows present → worktree backlog equals main (no-op filter)" {
  local wt; wt=$(_worktree_path "test" "FIX-085-D")
  _worktree_create "$wt" "loop/FIX-085-D" "main"

  cd "${TEST_TMP}/repo"
  mkdir -p .roll
  cat > .roll/backlog.md <<'EOF'
| [US-FOO-001](.roll/features/demo.md#us-foo-001) | x | 📋 Todo |
| [US-BAZ-003](.roll/features/demo.md#us-baz-003) | y | ✅ Done |
EOF

  run _worktree_sync_meta "$wt"
  [ "$status" -eq 0 ]

  # Worktree copy byte-identical to main
  diff -q .roll/backlog.md "$wt/.roll/backlog.md"
}
