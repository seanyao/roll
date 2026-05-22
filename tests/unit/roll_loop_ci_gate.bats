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
  mkdir -p .roll
  export _LOOP_ALERT="${_test_dir}/.alert"
}

teardown() {
  cd "$_orig_dir"
  rm -rf "$_test_dir"
}

@test "_loop_enforce_ci: does not modify BACKLOG on success" {
  printf '| [US-CI-001](x.md) | test | 🔨 In Progress |\n' > .roll/backlog.md
  _ci_wait() { return 0; }

  _loop_enforce_ci "US-CI-001"

  grep -q "🔨 In Progress" .roll/backlog.md
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

# ─── FIX-026: pre-run CI health check ─────────────────────────────────────────

@test "_loop_precheck_ci: function exists in bin/roll" {
  grep -qF '_loop_precheck_ci()' "$ROLL_BIN"
}

@test "_loop_precheck_ci: returns 0 when gh is not installed (graceful)" {
  command() {
    if [[ "$1" == "-v" && "$2" == "gh" ]]; then return 1; fi
    builtin command "$@"
  }
  run _loop_precheck_ci
  [ "$status" -eq 0 ]
}

@test "_loop_precheck_ci: returns 0 when no CI runs exist for HEAD yet" {
  git remote add origin "git@github.com:seanyao/roll.git"
  git commit --allow-empty -m "test" -q
  gh() { echo "[]"; return 0; }
  export -f gh
  run _loop_precheck_ci
  [ "$status" -eq 0 ]
}

@test "_loop_precheck_ci: returns 0 when HEAD CI is success" {
  git remote add origin "git@github.com:seanyao/roll.git"
  git commit --allow-empty -m "test" -q
  gh() { echo '[{"conclusion":"success"}]'; return 0; }
  export -f gh
  run _loop_precheck_ci
  [ "$status" -eq 0 ]
}

@test "_loop_precheck_ci: returns 1 when HEAD CI is failure" {
  git remote add origin "git@github.com:seanyao/roll.git"
  git commit --allow-empty -m "test" -q
  gh() { echo '[{"conclusion":"failure"}]'; return 0; }
  export -f gh
  run _loop_precheck_ci
  [ "$status" -eq 1 ]
}

@test "_loop_precheck_ci: writes ALERT when HEAD CI is red" {
  git remote add origin "git@github.com:seanyao/roll.git"
  git commit --allow-empty -m "test" -q
  gh() { echo '[{"conclusion":"failure"}]'; return 0; }
  export -f gh
  _loop_precheck_ci || true
  [ -f "$_LOOP_ALERT" ]
  grep -qE 'red|失败|broken base' "$_LOOP_ALERT"
}

@test "roll-loop SKILL.md: Step 1 documents pre-run CI health check" {
  grep -qiE 'pre-run CI|precheck.*CI|head ci.*red|broken base' "$LOOP_SKILL"
}

@test "roll loop precheck-ci: CLI subcommand routes to _loop_precheck_ci (no gh → ok)" {
  # gh not installed → _loop_precheck_ci returns 0 gracefully
  run "$ROLL_BIN" loop precheck-ci
  [ "$status" -eq 0 ]
}

@test "roll loop precheck-ci: CLI subcommand returns 1 when HEAD CI is red" {
  git remote add origin "git@github.com:seanyao/roll.git"
  git commit --allow-empty -m "test" -q
  gh() { echo '[{"conclusion":"failure"}]'; return 0; }
  export -f gh
  run "$ROLL_BIN" loop precheck-ci
  [ "$status" -eq 1 ]
}

# ─── FIX-103: precheck must distinguish in_progress from failure ─────────────

@test "_loop_precheck_ci: returns 0 when HEAD CI is in_progress (FIX-103)" {
  git remote add origin "git@github.com:seanyao/roll.git"
  git commit --allow-empty -m "test" -q
  gh() { echo '[{"conclusion":null,"status":"in_progress"}]'; return 0; }
  export -f gh
  run _loop_precheck_ci
  [ "$status" -eq 0 ]
}

@test "_loop_precheck_ci: returns 0 when HEAD CI is queued (FIX-103)" {
  git remote add origin "git@github.com:seanyao/roll.git"
  git commit --allow-empty -m "test" -q
  gh() { echo '[{"conclusion":null,"status":"queued"}]'; return 0; }
  export -f gh
  run _loop_precheck_ci
  [ "$status" -eq 0 ]
}

@test "_loop_precheck_ci: returns 0 when mixing in_progress with success (FIX-103)" {
  git remote add origin "git@github.com:seanyao/roll.git"
  git commit --allow-empty -m "test" -q
  gh() { echo '[{"conclusion":"success","status":"completed"},{"conclusion":null,"status":"in_progress"}]'; return 0; }
  export -f gh
  run _loop_precheck_ci
  [ "$status" -eq 0 ]
}

@test "_loop_precheck_ci: returns 1 when HEAD CI is cancelled (FIX-103)" {
  git remote add origin "git@github.com:seanyao/roll.git"
  git commit --allow-empty -m "test" -q
  gh() { echo '[{"conclusion":"cancelled","status":"completed"}]'; return 0; }
  export -f gh
  run _loop_precheck_ci
  [ "$status" -eq 1 ]
}

@test "_loop_precheck_ci: ALERT records conclusion + status when red (FIX-103)" {
  git remote add origin "git@github.com:seanyao/roll.git"
  git commit --allow-empty -m "test" -q
  gh() { echo '[{"conclusion":"failure","status":"completed"},{"conclusion":null,"status":"in_progress"}]'; return 0; }
  export -f gh
  _loop_precheck_ci || true
  [ -f "$_LOOP_ALERT" ]
  # ALERT must carry dedicated, structured fields so a human can tell
  # "real red" from "misclassified pending" without re-querying gh.
  grep -qE '\*\*Failing conclusions\*\*' "$_LOOP_ALERT"
  grep -qE '\*\*Run states\*\*' "$_LOOP_ALERT"
}
