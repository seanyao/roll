#!/usr/bin/env bats
# Tests for roll-loop CI gate in Step 4 (FIX-024)

ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"
LOOP_SKILL="${BATS_TEST_DIRNAME}/../../skills/roll-loop/SKILL.md"

# ─── Skill documentation ──────────────────────────────────────────────────────

@test "roll-loop SKILL.md: Step 4 documents CI Gate step" {
  grep -qE 'CI Gate' "$LOOP_SKILL"
}

@test "roll-loop SKILL.md: CI gate references roll ci --wait" {
  grep -qE 'roll ci --wait|_loop_enforce_ci' "$LOOP_SKILL"
}

@test "roll-loop SKILL.md: CI gate keeps story In Progress on failure" {
  grep -qE 'In Progress' "$LOOP_SKILL"
}

@test "roll-loop SKILL.md: CI gate has graceful skip when gh unavailable" {
  grep -qE 'gh.*not installed|graceful' "$LOOP_SKILL"
}

# ─── FIX-026: SKILL must forbid raw gh calls in CI gate ──────────────────────

@test "roll-loop SKILL.md: CI gate forbids raw gh run list (must use roll ci)" {
  # Loop's CI gate must be invoked via `roll ci --wait` or `_loop_enforce_ci`,
  # never raw `gh run list` (which bypasses _gh_repo_slug + -R flag and breaks
  # under SSH config host rewrites).
  local ci_section
  ci_section=$(awk '/CI Gate/,/^### /' "$LOOP_SKILL")
  # The CI gate description should NOT mention `gh run list` as the invocation
  # method — it should reference the wrapper instead.
  ! echo "$ci_section" | grep -qE 'Polls.*gh run list' ||
    echo "$ci_section" | grep -qE 'roll ci --wait.*invokes|wrapper'
}

@test "roll-loop SKILL.md: CI gate explicitly forbids ad-hoc gh checks" {
  grep -qiE 'do not call .?gh.? directly|never call .?gh.? directly|must use roll ci|MUST NOT.*gh ' "$LOOP_SKILL"
}

# ─── _loop_enforce_ci integration with BACKLOG ────────────────────────────────

setup() {
  source "$ROLL_BIN"
  _orig_dir="$PWD"
  _test_dir=$(mktemp -d)
  cd "$_test_dir"
  git init -q
  git config user.email "test@roll.dev"
  git config user.name "Test"
  export _LOOP_ALERT="${_test_dir}/.alert"
}

teardown() {
  cd "$_orig_dir"
  rm -rf "$_test_dir"
}

@test "_loop_enforce_ci: does not modify BACKLOG on success" {
  printf '| [US-CI-001](x.md) | test | 🔨 In Progress |\n' > BACKLOG.md
  _ci_wait() { return 0; }

  _loop_enforce_ci "US-CI-001"

  grep -q "🔨 In Progress" BACKLOG.md
}

@test "_loop_enforce_ci: does not write ALERT on success" {
  _ci_wait() { return 0; }
  git commit --allow-empty -m "tcr: test" -q

  _loop_enforce_ci "US-CI-001"

  [ ! -f "$_LOOP_ALERT" ]
}

@test "_loop_enforce_ci: ALERT mentions Action required" {
  _ci_wait() { return 1; }
  git commit --allow-empty -m "tcr: test" -q

  _loop_enforce_ci "US-CI-099" || true

  grep -qE 'Action required' "$_LOOP_ALERT"
}
