#!/usr/bin/env bats
# US-OBS-010: _project_slug remote-based slug derivation
#
# Verifies that _project_slug uses git remote origin URL (normalized) for
# stable cross-machine project identity, falling back to path-based slug
# when no remotes are available.

load helpers

setup()    { unset ROLL_MAIN_SLUG; unit_setup; }
teardown() {
  unset ROLL_MAIN_SLUG
  unset ROLL_CONFIG
  unit_teardown
}

# ─── Remote-based slug ─────────────────────────────────────────────────────

@test "_project_slug: uses remote origin URL (https) for hash" {
  local repo="${TEST_TMP}/obs010-https"
  mkdir -p "$repo"
  git -C "$repo" init
  git -C "$repo" remote add origin "https://github.com/user/my-project.git"

  local s
  s=$(_project_slug "$repo")

  # should derive from normalized URL base "my-project"
  [[ "$s" =~ ^my-project-[a-f0-9]{6}$ ]]
}

@test "_project_slug: strips .git suffix from origin URL" {
  local repo="${TEST_TMP}/obs010-stripgit"
  mkdir -p "$repo"
  git -C "$repo" init
  git -C "$repo" remote add origin "https://github.com/org/repo.git"

  local s
  s=$(_project_slug "$repo")

  [[ "$s" =~ ^repo-[a-f0-9]{6}$ ]]
}

@test "_project_slug: normalizes git@ format to https:// for hash" {
  local repo="${TEST_TMP}/obs010-ssh"
  mkdir -p "$repo"
  git -C "$repo" init
  git -C "$repo" remote add origin "git@github.com:user/my-lib.git"

  local s
  s=$(_project_slug "$repo")

  # After normalization: https://github.com/user/my-lib → base "my-lib"
  [[ "$s" =~ ^my-lib-[a-f0-9]{6}$ ]]
}

@test "_project_slug: lowercase normalizes origin URL" {
  local repo="${TEST_TMP}/obs010-case"
  mkdir -p "$repo"
  git -C "$repo" init
  git -C "$repo" remote add origin "https://GitHub.COM/User/My-Project"

  local s
  s=$(_project_slug "$repo")

  # Lowercase normalized: base "my-project"
  [[ "$s" =~ ^my-project-[a-f0-9]{6}$ ]]
}

# ─── Fallback: no origin → first available remote ──────────────────────────

@test "_project_slug: uses first available remote when origin is missing" {
  local repo="${TEST_TMP}/obs010-noorigin"
  mkdir -p "$repo"
  git -C "$repo" init
  git -C "$repo" remote add upstream "https://github.com/upstream/fork.git"

  local s
  s=$(_project_slug "$repo")
  [[ "$s" =~ ^fork-[a-f0-9]{6}$ ]]
}

# ─── Fallback: no remotes → path-based slug ────────────────────────────────

@test "_project_slug: falls back to path-based when no git remotes exist" {
  local repo="${TEST_TMP}/obs010-noremote"
  mkdir -p "$repo"
  git -C "$repo" init

  local s
  s=$(_project_slug "$repo")

  # Should use path-based hash (same as pre-OBS-010 behavior)
  [[ "$s" =~ ^obs010-noremote-[a-f0-9]{6}$ ]]
}

@test "_project_slug: falls back to path-based when not a git repo" {
  local dir="${TEST_TMP}/obs010-nogit"
  mkdir -p "$dir"

  local s
  s=$(_project_slug "$dir")
  [[ "$s" =~ ^obs010-nogit-[a-f0-9]{6}$ ]]
}

# ─── WARNING: records_remote configured but no remote URL ──────────────────

@test "_project_slug: emits WARNING when roll_records_remote set but no remote url" {
  local repo="${TEST_TMP}/obs010-warning"
  mkdir -p "$repo"
  git -C "$repo" init

  # Simulate roll_records_remote configured
  local orig_config="${ROLL_CONFIG:-}"
  ROLL_CONFIG="${TEST_TMP}/obs010-config.yaml"
  echo "roll_records_remote: git@github.com:user/records.git" > "$ROLL_CONFIG"

  run _project_slug "$repo"
  [ "$status" -eq 0 ]

  [[ "$output" =~ "WARNING" ]] || [[ "$output" =~ "slug will fall back" ]]

  # Restore
  if [[ -n "$orig_config" ]]; then
    ROLL_CONFIG="$orig_config"
  else
    unset ROLL_CONFIG
  fi
}

# ─── Regression: ROLL_MAIN_SLUG still wins ─────────────────────────────────

@test "_project_slug: ROLL_MAIN_SLUG overrides remote-based slug" {
  local repo="${TEST_TMP}/obs010-main-slug"
  mkdir -p "$repo"
  git -C "$repo" init
  git -C "$repo" remote add origin "https://github.com/user/some-repo.git"

  export ROLL_MAIN_SLUG="override-abc123"
  local s
  s=$(_project_slug "$repo")
  [ "$s" = "override-abc123" ]
  unset ROLL_MAIN_SLUG
}

# ─── Cross-machine: same origin → same slug ────────────────────────────────

@test "_project_slug: same remote URL in different dirs produces same slug" {
  local repo_a="${TEST_TMP}/obs010-cross-a"
  local repo_b="${TEST_TMP}/obs010-cross-b"
  mkdir -p "$repo_a" "$repo_b"
  git -C "$repo_a" init
  git -C "$repo_b" init
  git -C "$repo_a" remote add origin "https://github.com/team/shared-lib.git"
  git -C "$repo_b" remote add origin "https://github.com/team/shared-lib.git"

  local sa sb
  sa=$(_project_slug "$repo_a")
  sb=$(_project_slug "$repo_b")
  [ "$sa" = "$sb" ]
}

@test "_project_slug: different remote URLs produce different slugs" {
  local repo_a="${TEST_TMP}/obs010-diff-a"
  local repo_b="${TEST_TMP}/obs010-diff-b"
  mkdir -p "$repo_a" "$repo_b"
  git -C "$repo_a" init
  git -C "$repo_b" init
  git -C "$repo_a" remote add origin "https://github.com/team/project-one.git"
  git -C "$repo_b" remote add origin "https://github.com/team/project-two.git"

  local sa sb
  sa=$(_project_slug "$repo_a")
  sb=$(_project_slug "$repo_b")
  [ "$sa" != "$sb" ]
}

# ─── Worktree: slug consistent from within git worktree ────────────────────

@test "_project_slug: worktree slave produces same slug as main tree (remote-based)" {
  local main="${TEST_TMP}/obs010-main-tree"
  mkdir -p "$main"
  git -C "$main" init
  git -C "$main" remote add origin "https://github.com/team/worktree-repo.git"
  # Create an initial commit so worktree add works
  git -C "$main" commit --allow-empty -m "init"

  local wt="${TEST_TMP}/obs010-worktree"
  git -C "$main" worktree add "$wt" -b obs010-wt-branch

  local sm sw
  sm=$(_project_slug "$main")
  sw=$(_project_slug "$wt")
  [ "$sm" = "$sw" ]

  # Cleanup worktree
  git -C "$main" worktree remove "$wt" --force 2>/dev/null || true
  git -C "$main" branch -D obs010-wt-branch 2>/dev/null || true
}
