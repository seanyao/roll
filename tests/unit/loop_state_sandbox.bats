#!/usr/bin/env bats
# Tests for FIX-065: shared loop state must be sandboxed during tests
# so a subprocess invocation of bin/roll cannot write ALERT / state /
# heartbeat into the real ~/.shared/roll/ path (which the running loop
# cycle is watching).

load helpers

setup() { unit_setup_cd; }
teardown() { unit_teardown_cd; }

@test "harness: _SHARED_ROOT is exported and rooted at TEST_TMP" {
  # Must be exported (subprocesses inherit) and must point inside TEST_TMP
  # so any path derived from $_SHARED_ROOT lands in the sandbox.
  local exported_value
  exported_value=$(bash -c 'printf %s "${_SHARED_ROOT:-UNSET}"')
  [ "$exported_value" != "UNSET" ]
  case "$exported_value" in
    "$TEST_TMP"*) ;;
    *) printf 'expected _SHARED_ROOT to start with %s, got %s\n' \
         "$TEST_TMP" "$exported_value" >&2; return 1 ;;
  esac
}

@test "subprocess: roll loop enforce-tcr writes ALERT into sandbox, not production" {
  # Capture production ALERT directory mtime before the subprocess runs.
  # The real bug is that this directory got new files / new mtimes when
  # tests ran. After the fix, it must stay untouched.
  local prod_alert_dir="${HOME}/.shared/roll/loop"
  mkdir -p "$prod_alert_dir"
  local prod_mtime_before
  prod_mtime_before=$(stat -c %Y "$prod_alert_dir" 2>/dev/null || stat -f %m "$prod_alert_dir" 2>/dev/null || echo 0)

  # Set up a git repo + backlog row, then subprocess-invoke roll with
  # a started_at that has no tcr commits → expected to write ALERT.
  git init -q
  git config user.email "test@roll.dev"
  git config user.name "Test"
  mkdir -p .roll
  printf '| [US-SANDBOX-001](x.md) | sandbox test | ✅ Done |\n' > .roll/backlog.md

  local started_at="2026-01-01T00:00:00Z"
  GIT_COMMITTER_DATE="2026-01-02T00:00:00Z" git commit \
    --date="2026-01-02T00:00:00Z" --allow-empty -m "chore: nothing" -q

  run "$ROLL_BIN" loop enforce-tcr "US-SANDBOX-001" "$started_at"
  [ "$status" -eq 1 ]

  # An ALERT must have been written somewhere in $_SHARED_ROOT (the sandbox).
  local sandbox_alerts
  sandbox_alerts=$(find "$_SHARED_ROOT/loop" -name 'ALERT-*' 2>/dev/null | wc -l | tr -d ' ')
  [ "$sandbox_alerts" -ge 1 ]

  # Production ALERT directory mtime must be unchanged.
  local prod_mtime_after
  prod_mtime_after=$(stat -c %Y "$prod_alert_dir" 2>/dev/null || stat -f %m "$prod_alert_dir" 2>/dev/null || echo 0)
  [ "$prod_mtime_before" = "$prod_mtime_after" ]
}

@test "auto-sandbox: sourcing bin/roll under bats with no override never resolves _SHARED_ROOT to production" {
  # Defense-in-depth: some legacy tests have their own setup() that sources
  # bin/roll directly without going through unit_setup. The fallback at
  # bin/roll  : "${_SHARED_ROOT:=${HOME}/.shared/roll}"  used to leak
  # straight to production in that case. The auto-sandbox guard in bin/roll
  # now redirects to /tmp whenever BATS_TEST_FILENAME is set, so even a
  # legacy caller is safe by default.
  #
  # Simulate that path: spawn a subprocess that DOES NOT export _SHARED_ROOT
  # before sourcing bin/roll, then read back what it resolved to.
  local resolved
  resolved=$(env -u _SHARED_ROOT bash -c "
    export BATS_TEST_FILENAME='${BATS_TEST_FILENAME}'
    source '$ROLL_BIN' >/dev/null 2>&1
    printf %s \"\$_SHARED_ROOT\"
  ")
  # Must NOT be the production path
  [ "$resolved" != "${HOME}/.shared/roll" ]
  # Must be a writable /tmp-rooted path (macOS: /var/folders/, Linux: /tmp/)
  case "$resolved" in
    /tmp/*|/private/tmp/*|/var/folders/*) ;;
    *) printf 'expected _SHARED_ROOT under a tmp path, got %s\n' "$resolved" >&2; return 1 ;;
  esac
}

@test "auto-sandbox: _LOOP_RUNS follows _SHARED_ROOT (not hardcoded to HOME)" {
  # FIX-065 also closed a hardcoded path leak: _LOOP_RUNS used to be
  # ${HOME}/.shared/roll/loop/runs.jsonl regardless of _SHARED_ROOT,
  # so the runs log appended into prod even when the rest of state went
  # to the sandbox. Lock that in here.
  [ "$_LOOP_RUNS" = "${_SHARED_ROOT}/loop/runs.jsonl" ]
}
