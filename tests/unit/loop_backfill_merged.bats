#!/usr/bin/env bats
# FIX-060: independent PR-merge backfill for runs.jsonl.
#
# When a loop cycle's PR is merged after the cycle ends, the runs.jsonl row
# stays at status:"built" until something rescans GitHub. Pre-FIX-060 the
# rescan only happened at the next cycle's startup, which never fires while
# the loop is paused. `_loop_backfill_merged` is the standalone scanner the
# outer runner calls every scheduled tick, even when paused.

load helpers

setup() {
  unit_setup
  _runs="${TEST_TMP}/runs.jsonl"
}
teardown() { unit_teardown; }

@test "_loop_backfill_merged: no-op when gh missing" {
  echo '{"ts":"2026-05-18T10:00:00Z","project":"x","run_id":"loop-1","status":"built","cycle_id":"20260518-100000-1234"}' > "$_runs"
  _gh_resolve() { return 1; }
  command() {
    if [ "$1" = "-v" ] && [ "$2" = "gh" ]; then return 1; fi
    builtin command "$@"
  }

  run _loop_backfill_merged "$_runs"
  [ "$status" -eq 0 ]
  # File unchanged
  grep -q '"status":"built"' "$_runs"
  ! grep -q '"status":"merged"' "$_runs"
}

@test "_loop_backfill_merged: rewrites built entry to merged when PR merged" {
  cat > "$_runs" <<'EOF'
{"ts":"2026-05-18T10:00:00Z","project":"x","run_id":"loop-1","status":"built","built":["FIX-060"],"cycle_id":"20260518-100000-1234"}
EOF
  _gh_resolve() { eval "$1=test/repo"; return 0; }
  gh() {
    # gh -R test/repo pr view loop/cycle-... --json state,mergedAt,mergeCommit -q ...
    if [ "$1" = "-R" ]; then shift 2; fi
    if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
      # Return MERGED with timestamp and commit
      echo '{"state":"MERGED","mergedAt":"2026-05-18T11:00:00Z","mergeCommit":{"oid":"abc123def456"}}'
      return 0
    fi
    return 0
  }

  run _loop_backfill_merged "$_runs"
  [ "$status" -eq 0 ]
  grep -q '"status":"merged"' "$_runs"
  grep -q '"merged_at":"2026-05-18T11:00:00Z"' "$_runs"
  grep -q '"merge_commit":"abc123def456"' "$_runs"
  ! grep -q '"status":"built"' "$_runs"
}

@test "_loop_backfill_merged: leaves built entry unchanged when PR still open" {
  echo '{"ts":"2026-05-18T10:00:00Z","project":"x","run_id":"loop-1","status":"built","built":["FIX-060"],"cycle_id":"20260518-100000-1234"}' > "$_runs"
  _gh_resolve() { eval "$1=test/repo"; return 0; }
  gh() {
    if [ "$1" = "-R" ]; then shift 2; fi
    if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
      echo '{"state":"OPEN","mergedAt":null,"mergeCommit":null}'
      return 0
    fi
    return 0
  }

  run _loop_backfill_merged "$_runs"
  [ "$status" -eq 0 ]
  grep -q '"status":"built"' "$_runs"
  ! grep -q '"status":"merged"' "$_runs"
}

@test "_loop_backfill_merged: skips built entry without cycle_id" {
  echo '{"ts":"2026-05-18T10:00:00Z","project":"x","run_id":"loop-1","status":"built","built":["FIX-060"]}' > "$_runs"
  _gh_resolve() { eval "$1=test/repo"; return 0; }
  _gh_called=0
  gh() {
    _gh_called=1
    return 0
  }

  run _loop_backfill_merged "$_runs"
  [ "$status" -eq 0 ]
  # Original line preserved verbatim
  grep -q '"status":"built"' "$_runs"
  ! grep -q '"status":"merged"' "$_runs"
}

@test "_loop_backfill_merged: leaves idle/merged/failed entries untouched" {
  cat > "$_runs" <<'EOF'
{"ts":"2026-05-18T10:00:00Z","project":"x","run_id":"loop-1","status":"idle","cycle_id":"20260518-100000-1111"}
{"ts":"2026-05-18T10:30:00Z","project":"x","run_id":"loop-2","status":"merged","cycle_id":"20260518-103000-2222","merged_at":"2026-05-18T11:00:00Z","merge_commit":"oldsha"}
{"ts":"2026-05-18T11:00:00Z","project":"x","run_id":"loop-3","status":"failed","cycle_id":"20260518-110000-3333"}
EOF
  _gh_resolve() { eval "$1=test/repo"; return 0; }
  gh() {
    # Should never be called for non-built entries; if called, fail loudly.
    echo '{"state":"MERGED","mergedAt":"2026-05-18T99:00:00Z","mergeCommit":{"oid":"WRONG"}}'
    return 0
  }

  run _loop_backfill_merged "$_runs"
  [ "$status" -eq 0 ]
  grep -q '"status":"idle"' "$_runs"
  grep -q '"merge_commit":"oldsha"' "$_runs"
  grep -q '"status":"failed"' "$_runs"
  ! grep -q '"merge_commit":"WRONG"' "$_runs"
}

@test "_loop_backfill_merged: returns 0 when runs.jsonl missing" {
  run _loop_backfill_merged "${TEST_TMP}/does-not-exist.jsonl"
  [ "$status" -eq 0 ]
}

@test "_loop_backfill_merged: only one built entry rewritten among multiple lines" {
  cat > "$_runs" <<'EOF'
{"ts":"2026-05-18T09:00:00Z","project":"x","run_id":"loop-0","status":"idle","cycle_id":"20260518-090000-0000"}
{"ts":"2026-05-18T10:00:00Z","project":"x","run_id":"loop-1","status":"built","built":["FIX-060"],"cycle_id":"20260518-100000-1234"}
{"ts":"2026-05-18T11:00:00Z","project":"x","run_id":"loop-2","status":"built","built":["US-VIEW-001"],"cycle_id":"20260518-110000-5678"}
EOF
  _gh_resolve() { eval "$1=test/repo"; return 0; }
  gh() {
    if [ "$1" = "-R" ]; then shift 2; fi
    if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
      # First branch (1234) merged; second (5678) still open
      case "$3" in
        loop/cycle-20260518-100000-1234)
          echo '{"state":"MERGED","mergedAt":"2026-05-18T10:30:00Z","mergeCommit":{"oid":"sha1234"}}'
          ;;
        loop/cycle-20260518-110000-5678)
          echo '{"state":"OPEN","mergedAt":null,"mergeCommit":null}'
          ;;
      esac
      return 0
    fi
    return 0
  }

  run _loop_backfill_merged "$_runs"
  [ "$status" -eq 0 ]
  # First built rewritten to merged
  grep -q '"merge_commit":"sha1234"' "$_runs"
  # Second still built
  grep -q '"run_id":"loop-2","status":"built"' "$_runs"
  # Idle unchanged
  grep -q '"run_id":"loop-0","status":"idle"' "$_runs"
}
