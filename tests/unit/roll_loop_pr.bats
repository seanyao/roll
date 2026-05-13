#!/usr/bin/env bats
# Unit tests for: _loop_publish_pr (US-AUTO-033)

load helpers

setup() {
  unit_setup_cd
  _UNIT_ORIG_HOME="$HOME"
  export HOME="$TEST_TMP/home"
  mkdir -p "$HOME/.shared/roll/loop"
  _LOOP_ALERT="${HOME}/.shared/roll/loop/ALERT.md"

  # Minimal git repo with origin pointing somewhere consistent.
  git init -q .
  git -c user.email=t@t -c user.name=t commit -q --allow-empty -m "init"
  git remote add origin git@github.com:test/repo.git
  git checkout -q -b loop/cycle-test
  git -c user.email=t@t -c user.name=t commit -q --allow-empty -m "tcr: work"

  # Mock bin dir takes precedence on PATH for `gh` and `git push`.
  MOCKBIN="$TEST_TMP/mockbin"
  mkdir -p "$MOCKBIN"
  export PATH="$MOCKBIN:$PATH"

  # Logging fixture
  GH_LOG="$TEST_TMP/gh.log"
  GIT_PUSH_LOG="$TEST_TMP/git-push.log"
  : > "$GH_LOG"
  : > "$GIT_PUSH_LOG"
}

teardown() {
  export HOME="$_UNIT_ORIG_HOME"
  unit_teardown_cd
}

# Helper: stub a `git` wrapper that logs pushes but forwards everything else
# to the real git binary, controllable via env flags.
_install_git_wrapper() {
  local real_git; real_git=$(command -v git)
  # find the real git, not the wrapper we're about to install
  if [ "$real_git" = "$MOCKBIN/git" ]; then real_git=$(PATH="${PATH#$MOCKBIN:}" command -v git); fi
  cat > "$MOCKBIN/git" <<EOF
#!/bin/bash
if [ "\$1" = "push" ]; then
  echo "git \$*" >> "$GIT_PUSH_LOG"
  [ -n "\$GIT_PUSH_FAIL" ] && exit 1
  exit 0
fi
exec "$real_git" "\$@"
EOF
  chmod +x "$MOCKBIN/git"
}

_install_gh() {
  local view_url="$1"   # PR url to return from `gh pr view`; empty = none
  local create_url="$2" # PR url to return from `gh pr create`
  local merge_status="${3:-0}"
  cat > "$MOCKBIN/gh" <<EOF
#!/bin/bash
echo "gh \$*" >> "$GH_LOG"
# parse subcommands (skip -R <slug>)
args=("\$@")
i=0
while [ "\$i" -lt "\${#args[@]}" ]; do
  case "\${args[\$i]}" in
    -R) i=\$((i+2)); continue ;;
    *) break ;;
  esac
done
sub="\${args[\$i]:-}"
sub2="\${args[\$((i+1))]:-}"
if [ "\$sub" = "pr" ] && [ "\$sub2" = "view" ]; then
  [ -n "$view_url" ] && { echo "$view_url"; exit 0; }
  exit 1
fi
if [ "\$sub" = "pr" ] && [ "\$sub2" = "create" ]; then
  [ -n "$create_url" ] && echo "$create_url"
  exit 0
fi
if [ "\$sub" = "pr" ] && [ "\$sub2" = "merge" ]; then
  exit $merge_status
fi
exit 0
EOF
  chmod +x "$MOCKBIN/gh"
}

_remove_gh() {
  rm -f "$MOCKBIN/gh"
  cat > "$MOCKBIN/no_gh_check" <<'EOF'
#!/bin/bash
exit 127
EOF
}

@test "_loop_publish_pr: returns 2 + ALERT when gh not installed" {
  _install_git_wrapper
  # Plant a shim `gh` in MOCKBIN that signals "not installed" via exit 127.
  # _loop_publish_pr uses `command -v gh` — which still finds the shim — so
  # we additionally redefine `command` as a shell function inside the test
  # subshell. Bats `run` cannot intercept builtins via PATH, so we use the
  # GH_AVAILABLE env knob the helper honors (added below).
  # Simpler path: strip every PATH dir that contains a gh executable, then
  # ensure MOCKBIN has no gh either.
  local stripped="$PATH"
  while command -v gh >/dev/null 2>&1; do
    local gh_path; gh_path=$(command -v gh)
    local gh_dir; gh_dir=$(dirname "$gh_path")
    stripped=$(echo "$stripped" | tr ':' '\n' | grep -v -F -x "$gh_dir" | tr '\n' ':' | sed 's/:$//')
    PATH="$stripped"
  done
  PATH="$MOCKBIN:$stripped"
  # Final sanity check inside the test (no `gh` reachable):
  ! command -v gh >/dev/null 2>&1 || skip "could not strip gh from PATH"
  run _loop_publish_pr "loop/cycle-test"
  [ "$status" -eq 2 ]
  grep -q "gh not installed" "$_LOOP_ALERT"
}

@test "_loop_publish_pr: pushes branch, creates PR, enables auto-merge" {
  _install_git_wrapper
  _install_gh "" "https://github.com/test/repo/pull/42" 0
  run _loop_publish_pr "loop/cycle-test" "US-DEMO-001: demo"
  [ "$status" -eq 0 ]
  echo "$output" | grep -q "pull/42"
  grep -q "push origin loop/cycle-test" "$GIT_PUSH_LOG"
  grep -q "pr create" "$GH_LOG"
  grep -q "pr merge .* --auto" "$GH_LOG"
}

@test "_loop_publish_pr: reuses existing PR (idempotent — no pr create)" {
  _install_git_wrapper
  _install_gh "https://github.com/test/repo/pull/9" "should-not-be-used" 0
  run _loop_publish_pr "loop/cycle-test"
  [ "$status" -eq 0 ]
  echo "$output" | grep -q "pull/9"
  ! grep -q "pr create" "$GH_LOG"
  grep -q "pr merge" "$GH_LOG"
}

@test "_loop_publish_pr: returns 1 + ALERT on push failure" {
  _install_git_wrapper
  _install_gh "" "https://github.com/test/repo/pull/1" 0
  export GIT_PUSH_FAIL=1
  run _loop_publish_pr "loop/cycle-test"
  [ "$status" -eq 1 ]
  grep -q "push origin" "$_LOOP_ALERT"
  ! grep -q "pr create" "$GH_LOG"
}

@test "_loop_publish_pr: returns 1 + ALERT on pr create failure" {
  _install_git_wrapper
  # gh pr view returns nothing, gh pr create returns empty (failure)
  _install_gh "" "" 0
  run _loop_publish_pr "loop/cycle-test"
  [ "$status" -eq 1 ]
  grep -q "pr create failed" "$_LOOP_ALERT"
}

@test "_loop_publish_pr: returns 0 + ALERT when auto-merge fails (PR left open)" {
  _install_git_wrapper
  _install_gh "" "https://github.com/test/repo/pull/7" 1
  run _loop_publish_pr "loop/cycle-test"
  [ "$status" -eq 0 ]
  echo "$output" | grep -q "pull/7"
  grep -q "auto failed" "$_LOOP_ALERT"
}

@test "_loop_publish_pr: returns 2 + ALERT when origin is not a github remote" {
  _install_git_wrapper
  _install_gh "" "https://github.com/test/repo/pull/1" 0
  # Point origin at a non-github URL
  git remote set-url origin file:///tmp/nonexistent.git
  run _loop_publish_pr "loop/cycle-test"
  [ "$status" -eq 2 ]
  grep -q "not a github repo" "$_LOOP_ALERT"
  ! grep -q "pr create" "$GH_LOG"
}

@test "_loop_publish_pr: passes -R slug to gh when origin parseable" {
  _install_git_wrapper
  _install_gh "" "https://github.com/test/repo/pull/3" 0
  run _loop_publish_pr "loop/cycle-test"
  [ "$status" -eq 0 ]
  grep -qE 'gh -R test/repo' "$GH_LOG"
}
