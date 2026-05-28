#!/usr/bin/env bats
# US-INFRA-008: _ensure_hooks_path helper — enforces core.hooksPath=hooks

load helpers
setup()    { unit_setup_cd; }
teardown() { unit_teardown_cd; }

_make_git_repo() {
  local dir="$1"
  mkdir -p "$dir"
  git init "$dir" -q
  git -C "$dir" -c "user.email=t@t" -c "user.name=T" commit --allow-empty -m "init" -q
}

@test "_ensure_hooks_path: function exists in bin/roll" {
  grep -q '^_ensure_hooks_path()' "${ROLL_BIN}"
}

@test "_ensure_hooks_path: sets core.hooksPath=hooks on fresh repo" {
  local repo="${TEST_TMP}/fresh-repo"
  _make_git_repo "$repo"
  _ensure_hooks_path "$repo"
  local val; val=$(git -C "$repo" config core.hooksPath 2>/dev/null || echo "")
  [ "$val" = "hooks" ]
}

@test "_ensure_hooks_path: does not override a user-set non-default value" {
  local repo="${TEST_TMP}/custom-hooks-repo"
  _make_git_repo "$repo"
  git -C "$repo" config core.hooksPath "my-custom-hooks"
  _ensure_hooks_path "$repo"
  local val; val=$(git -C "$repo" config core.hooksPath 2>/dev/null || echo "")
  [ "$val" = "my-custom-hooks" ]
}

@test "_ensure_hooks_path: overwrites .git/hooks (default) with hooks" {
  local repo="${TEST_TMP}/default-hooks-repo"
  _make_git_repo "$repo"
  git -C "$repo" config core.hooksPath ".git/hooks"
  _ensure_hooks_path "$repo"
  local val; val=$(git -C "$repo" config core.hooksPath 2>/dev/null || echo "")
  [ "$val" = "hooks" ]
}

@test "_ensure_hooks_path: silent skip on non-git directory" {
  local dir="${TEST_TMP}/not-a-repo"
  mkdir -p "$dir"
  run _ensure_hooks_path "$dir"
  [ "$status" -eq 0 ]
}

@test "_ensure_hooks_path: called in cycle preflight inner script template" {
  local runner="${TEST_TMP}/run-hooks.sh"
  _write_loop_runner_script "$runner" "${TEST_TMP}/proj" "echo hi" "${TEST_TMP}/log"
  local inner="${runner%.sh}-inner.sh"
  grep -q '_ensure_hooks_path' "$inner"
}

@test "_ensure_hooks_path: called in cmd_setup" {
  grep -A5 'cmd_setup' "${ROLL_BIN}" | grep -q '_ensure_hooks_path' || \
  grep '_ensure_hooks_path' "${ROLL_BIN}" | grep -q 'setup\|_run_setup_step'
}

# ─── US-INFRA-009: Claude Code SessionStart hook ────────────────────────────

@test "US-INFRA-009: .claude/settings.json has SessionStart hook" {
  local settings="${BATS_TEST_DIRNAME}/../../.claude/settings.json"
  [ -f "$settings" ]
  grep -q '"SessionStart"' "$settings"
}

@test "US-INFRA-009: SessionStart hook runs git config core.hooksPath" {
  local settings="${BATS_TEST_DIRNAME}/../../.claude/settings.json"
  grep -q 'core.hooksPath' "$settings"
}
