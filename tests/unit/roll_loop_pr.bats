#!/usr/bin/env bats
# Unit tests for: _loop_publish_pr (US-AUTO-033)

load helpers

setup() {
  unit_setup_cd
  mkdir -p .roll
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
  # Override `command` as a shell function so `command -v gh` returns 1
  # within the helper's invocation. PATH manipulation isn't portable here
  # (CI runners have gh in multiple dirs and stripping all of them also
  # removes grep/rm).
  command() {
    if [ "$1" = "-v" ] && [ "$2" = "gh" ]; then return 1; fi
    builtin command "$@"
  }
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

# --- US-VIEW-011: PR landing state events ----------------------------------

# Find the events.ndjson file _loop_event wrote in this test sandbox.
# helpers.bash exports _SHARED_ROOT=$TEST_TMP/shared so the sandbox path is
# $_SHARED_ROOT/loop/events-<slug>.ndjson; fall back to scanning $TEST_TMP
# if _SHARED_ROOT is not exported (defensive).
_events_file() {
  local root="${_SHARED_ROOT:-$TEST_TMP/shared}"
  local f
  f=$(find "$root/loop" -name 'events-*.ndjson' 2>/dev/null | head -1)
  [ -n "$f" ] && echo "$f" && return 0
  return 0
}

@test "US-VIEW-011: _loop_publish_pr emits pr event with outcome=open (not ok)" {
  _install_git_wrapper
  _install_gh "" "https://github.com/test/repo/pull/42" 0
  run _loop_publish_pr "loop/cycle-test"
  [ "$status" -eq 0 ]
  local ev; ev=$(_events_file)
  [ -n "$ev" ]
  grep -q '"stage":"pr"' "$ev"
  grep -q '"outcome":"open"' "$ev"
  ! grep -q '"outcome":"ok"' "$ev"
}

# Stub gh that returns a configurable state for `gh pr view --json state`.
# Args: state ("MERGED"|"CLOSED"|"OPEN"|"") and PR url.
_install_gh_state() {
  local state="$1" url="$2"
  cat > "$MOCKBIN/gh" <<EOF
#!/bin/bash
echo "gh \$*" >> "$GH_LOG"
# Skip leading "-R <slug>" flags.
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
# Detect --json field
field=""
for a in "\$@"; do
  if [ "\$prev" = "--json" ]; then field="\$a"; break; fi
  prev="\$a"
done
if [ "\$sub" = "pr" ] && [ "\$sub2" = "view" ]; then
  case "\$field" in
    url)   [ -n "$url" ] && echo "$url"; exit 0 ;;
    state) [ -n "$state" ] && echo "$state"; exit 0 ;;
    *)     exit 0 ;;
  esac
fi
exit 0
EOF
  chmod +x "$MOCKBIN/gh"
}

@test "US-VIEW-011: _loop_emit_pr_final skips silently when gh missing" {
  rm -f "$MOCKBIN/gh"
  command() {
    if [ "$1" = "-v" ] && [ "$2" = "gh" ]; then return 1; fi
    builtin command "$@"
  }
  run _loop_emit_pr_final "loop/cycle-test"
  [ "$status" -eq 0 ]
  local ev; ev=$(_events_file)
  # No pr event written when gh is unavailable.
  if [ -n "$ev" ]; then
    ! grep -q '"stage":"pr"' "$ev"
  fi
}

@test "US-VIEW-011: _loop_emit_pr_final emits merged when gh state=MERGED" {
  _install_gh_state "MERGED" "https://github.com/test/repo/pull/77"
  run _loop_emit_pr_final "loop/cycle-test"
  [ "$status" -eq 0 ]
  local ev; ev=$(_events_file)
  [ -n "$ev" ]
  grep -q '"stage":"pr"' "$ev"
  grep -q '"outcome":"merged"' "$ev"
}

@test "US-VIEW-011: _loop_emit_pr_final emits closed when gh state=CLOSED" {
  _install_gh_state "CLOSED" "https://github.com/test/repo/pull/99"
  run _loop_emit_pr_final "loop/cycle-test"
  [ "$status" -eq 0 ]
  local ev; ev=$(_events_file)
  [ -n "$ev" ]
  grep -q '"outcome":"closed"' "$ev"
}

@test "US-VIEW-011: _loop_emit_pr_final maps OPEN and unknown to open" {
  _install_gh_state "OPEN" "https://github.com/test/repo/pull/55"
  run _loop_emit_pr_final "loop/cycle-test"
  [ "$status" -eq 0 ]
  local ev; ev=$(_events_file)
  [ -n "$ev" ]
  grep -q '"outcome":"open"' "$ev"
}

@test "US-VIEW-011: _loop_emit_pr_final skips when PR url is empty" {
  _install_gh_state "MERGED" ""
  run _loop_emit_pr_final "loop/cycle-test"
  [ "$status" -eq 0 ]
  local ev; ev=$(_events_file)
  if [ -n "$ev" ]; then
    ! grep -q '"stage":"pr"' "$ev"
  fi
}

# --- _loop_is_doc_only_change ---

_setup_origin_main() {
  # Point origin/main at the root commit so git diff origin/main HEAD works
  local root; root=$(git rev-list --max-parents=0 HEAD)
  git update-ref refs/remotes/origin/main "$root"
}

@test "_loop_is_doc_only_change: returns 0 when only .roll/backlog.md changed" {
  _setup_origin_main
  git checkout -q -b loop/cycle-doc
  echo "new" > .roll/backlog.md
  git -c user.email=t@t -c user.name=t add .roll/backlog.md
  git -c user.email=t@t -c user.name=t commit -q -m "doc"
  run _loop_is_doc_only_change
  [ "$status" -eq 0 ]
}

@test "_loop_is_doc_only_change: returns 1 when a code file changed" {
  _setup_origin_main
  git checkout -q -b loop/cycle-code
  mkdir -p bin && echo "#!/bin/bash" > bin/roll
  git -c user.email=t@t -c user.name=t add bin/roll
  git -c user.email=t@t -c user.name=t commit -q -m "code"
  run _loop_is_doc_only_change
  [ "$status" -eq 1 ]
}

@test "_loop_is_doc_only_change: returns 1 when no changes vs origin/main" {
  _setup_origin_main
  git checkout -q -b loop/cycle-empty
  run _loop_is_doc_only_change
  [ "$status" -eq 1 ]
}

# --- _loop_publish_doc_pr ---

@test "_loop_publish_doc_pr: returns 2 when gh not installed" {
  _install_git_wrapper
  command() {
    if [ "$1" = "-v" ] && [ "$2" = "gh" ]; then return 1; fi
    builtin command "$@"
  }
  run _loop_publish_doc_pr "loop/cycle-test"
  [ "$status" -eq 2 ]
}

@test "_loop_publish_doc_pr: uses --admin instead of --auto" {
  _install_git_wrapper
  _install_gh "" "https://github.com/test/repo/pull/9" 0
  run _loop_publish_doc_pr "loop/cycle-test" "doc: test"
  [ "$status" -eq 0 ]
  grep -q -- "--admin" "$GH_LOG"
  ! grep -q -- "--auto" "$GH_LOG"
}

@test "_loop_publish_doc_pr: returns 1 when gh pr merge --admin fails" {
  _install_git_wrapper
  _install_gh "" "https://github.com/test/repo/pull/9" 1
  run _loop_publish_doc_pr "loop/cycle-test" "doc: test"
  [ "$status" -eq 1 ]
}
