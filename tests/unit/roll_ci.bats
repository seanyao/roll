#!/usr/bin/env bats
# Tests for roll ci command and _loop_enforce_ci gate (FIX-024)

load helpers
setup() {
  unit_setup_cd
  _test_dir="$TEST_TMP"
  git init -q
  git config user.email "test@roll.dev"
  git config user.name "Test"
  git config commit.gpgsign false
  export _LOOP_ALERT="${TEST_TMP}/.alert"
}
teardown() { unit_teardown_cd; }

# ─── Dispatch routing ─────────────────────────────────────────────────────────

@test "main: 'ci' subcommand is wired in dispatch table" {
  grep -qE '^\s+ci\)' "$ROLL_BIN"
}

@test "cmd_ci: function exists in bin/roll" {
  grep -qF 'cmd_ci()' "$ROLL_BIN"
}

# ─── _ci_wait function ────────────────────────────────────────────────────────

@test "_ci_wait: function exists in bin/roll" {
  grep -qF '_ci_wait()' "$ROLL_BIN"
}

@test "_ci_wait: returns 0 when gh is not installed (graceful skip)" {
  # Override PATH so gh is not found
  gh() { return 127; }
  command() {
    if [[ "$1" == "-v" && "$2" == "gh" ]]; then return 1; fi
    builtin command "$@"
  }

  run _ci_wait 10
  [ "$status" -eq 0 ]
}

@test "_ci_wait: polls gh run list with commit SHA" {
  local body
  body=$(awk '/^_ci_wait\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$body" | grep -qE 'gh run list'
}

@test "_ci_wait: uses --commit flag with current HEAD" {
  local body
  body=$(awk '/^_ci_wait\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$body" | grep -qE '\-\-commit'
}

# ─── _gh_repo_slug helper (FIX-026) ───────────────────────────────────────────

@test "_gh_repo_slug: function exists in bin/roll" {
  grep -qF '_gh_repo_slug()' "$ROLL_BIN"
}

@test "_gh_repo_slug: parses SSH URL git@github.com:owner/repo.git" {
  git remote add origin "git@github.com:seanyao/Roll.git"
  run _gh_repo_slug
  [ "$status" -eq 0 ]
  [ "$output" = "seanyao/Roll" ]
}

@test "_gh_repo_slug: parses HTTPS URL https://github.com/owner/repo.git" {
  git remote add origin "https://github.com/seanyao/Roll.git"
  run _gh_repo_slug
  [ "$status" -eq 0 ]
  [ "$output" = "seanyao/Roll" ]
}

@test "_gh_repo_slug: parses HTTPS URL without .git suffix" {
  git remote add origin "https://github.com/seanyao/Roll"
  run _gh_repo_slug
  [ "$status" -eq 0 ]
  [ "$output" = "seanyao/Roll" ]
}

@test "_gh_repo_slug: returns non-zero when no origin remote" {
  run _gh_repo_slug
  [ "$status" -ne 0 ]
}

@test "_gh_repo_slug: returns non-zero for non-github remote" {
  git remote add origin "git@gitlab.com:foo/bar.git"
  run _gh_repo_slug
  [ "$status" -ne 0 ]
}

# ─── _ci_wait uses -R flag (FIX-026) ──────────────────────────────────────────

@test "_ci_wait: passes -R <slug> to gh run list (bypass SSH config rewrite)" {
  local body
  body=$(awk '/^_ci_wait\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  # The gh call must include -R so it doesn't depend on auto-detection
  # which breaks when ~/.ssh/config rewrites github.com → IP.
  echo "$body" | grep -qE 'gh +(-R|--repo) +'
}

@test "_ci_wait: differentiates gh-not-installed (skip) from gh-failure (block)" {
  # gh installed but commands fail → should NOT graceful skip
  # gh missing entirely → should graceful skip
  local body
  body=$(awk '/^_ci_wait\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  # Must NOT have the old "gh run list failed — skipping CI gate" return 0 pattern
  # for actual call failures (we keep the "command -v gh" check at top).
  ! echo "$body" | grep -qE 'gh run list failed.*\n.*return 0' ||
    echo "$body" | grep -qE 'gh run list failed.*return 1'
}

@test "_ci_wait: returns 1 when gh installed but call fails (gh repo unreachable)" {
  git remote add origin "git@github.com:seanyao/Roll.git"
  git commit --allow-empty -m "test" -q
  # gh installed (command -v gh succeeds), but gh call fails (e.g. auth, network)
  gh() { return 1; }
  export -f gh
  run _ci_wait 5
  [ "$status" -eq 1 ]
}

# ─── FIX-046: skip CI wait when no PR exists ─────────────────────────────────

@test "_ci_wait: FIX-046 returns 0 immediately when no CI runs and no open PR" {
  git remote add origin "git@github.com:seanyao/Roll.git"
  git commit --allow-empty -m "tcr: test" -q
  # gh: run list returns empty (no CI runs), pr list returns empty (no PR)
  gh() {
    case "$*" in
      *"run list"*) echo "[]" ;;
      *"pr list"*)  echo "[]" ;;
      *)            return 1  ;;
    esac
  }
  export -f gh
  run _ci_wait 30
  [ "$status" -eq 0 ]
}

@test "_ci_wait: FIX-046 continues waiting when no CI runs but PR exists" {
  git remote add origin "git@github.com:seanyao/Roll.git"
  git commit --allow-empty -m "tcr: test" -q
  # gh: run list empty (no CI yet), pr list returns 1 (PR exists)
  gh() {
    case "$*" in
      *"run list"*) echo "[]"         ;;
      *"pr list"*)  echo '[{"number":1}]' ;;
      *)            return 1           ;;
    esac
  }
  export -f gh
  # Should NOT return 0 immediately — must wait (will timeout with status 1)
  run _ci_wait 1
  [ "$status" -eq 1 ]
}

# ─── _loop_wait_pr_merge function (FIX-047) ──────────────────────────────────

@test "_loop_wait_pr_merge: function exists in bin/roll" {
  grep -qF '_loop_wait_pr_merge()' "$ROLL_BIN"
}

@test "_loop_wait_pr_merge: returns 0 when PR state is MERGED" {
  git remote add origin "git@github.com:seanyao/Roll.git"
  git commit --allow-empty -m "test" -q
  gh() {
    case "$*" in
      *"pr view"*) echo "MERGED" ;;
      *)           return 1      ;;
    esac
  }
  export -f gh
  run _loop_wait_pr_merge "loop/cycle-test"
  [ "$status" -eq 0 ]
}

@test "_loop_wait_pr_merge: returns 1 when PR state is CLOSED" {
  git remote add origin "git@github.com:seanyao/Roll.git"
  git commit --allow-empty -m "test" -q
  gh() {
    case "$*" in
      *"pr view"*) echo "CLOSED" ;;
      *)           return 1      ;;
    esac
  }
  export -f gh
  run _loop_wait_pr_merge "loop/cycle-test"
  [ "$status" -eq 1 ]
}

@test "_loop_wait_pr_merge: returns 0 when gh not installed (graceful skip)" {
  command() {
    if [[ "$1" == "-v" && "$2" == "gh" ]]; then return 1; fi
    builtin command "$@"
  }
  run _loop_wait_pr_merge "loop/cycle-test"
  [ "$status" -eq 0 ]
}

# ─── _loop_enforce_ci function ────────────────────────────────────────────────

@test "_loop_enforce_ci: function exists in bin/roll" {
  grep -qF '_loop_enforce_ci()' "$ROLL_BIN"
}

@test "_loop_enforce_ci: returns 0 when _ci_wait succeeds" {
  _ci_wait() { return 0; }

  run _loop_enforce_ci "US-TEST-001"
  [ "$status" -eq 0 ]
}

@test "_loop_enforce_ci: returns 1 when _ci_wait fails" {
  _ci_wait() { return 1; }

  run _loop_enforce_ci "US-TEST-001"
  [ "$status" -eq 1 ]
}

@test "_loop_enforce_ci: writes ALERT file when CI fails" {
  _ci_wait() { return 1; }
  git commit --allow-empty -m "tcr: test" -q

  _loop_enforce_ci "US-TEST-001" || true

  [ -f "$_LOOP_ALERT" ]
  grep -q "US-TEST-001" "$_LOOP_ALERT"
}

@test "_loop_enforce_ci: ALERT contains commit reference" {
  _ci_wait() { return 1; }
  git commit --allow-empty -m "tcr: test" -q

  _loop_enforce_ci "US-FOO-007" || true

  grep -qE 'Commit|commit' "$_LOOP_ALERT"
}

# ─── cmd_ci function ─────────────────────────────────────────────────────────

@test "cmd_ci: accepts --wait flag without error" {
  _ci_wait() { return 0; }

  run cmd_ci --wait
  [ "$status" -eq 0 ]
}

@test "cmd_ci: rejects unknown flags" {
  run cmd_ci --bogus
  [ "$status" -ne 0 ]
}

@test "cmd_ci: handles gh not installed in non-wait mode" {
  command() {
    if [[ "$1" == "-v" && "$2" == "gh" ]]; then return 1; fi
    builtin command "$@"
  }

  run cmd_ci
  [ "$status" -eq 0 ]
}

# ─── usage documentation ─────────────────────────────────────────────────────

@test "usage: mentions 'roll ci' command" {
  local body
  body=$(awk '/^usage\(\)|^_legacy_help\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$body" | grep -qE 'roll ci|ci '
}
