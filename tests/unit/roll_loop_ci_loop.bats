#!/usr/bin/env bats
# US-AUTO-045 Phase 1: dedicated CI Loop helpers.
#
# Covers _ci_record_timing (idempotent NDJSON), _ci_classify_failure
# (transient vs real), _ci_rerun_transient (attempt cap + alert),
# _ci_detect_flaky, _ci_detect_degradation, and _ci_open_story (idempotent
# backlog append). gh is mocked; state lives in a sandboxed .roll/state/.

load helpers

setup() {
  unit_setup_cd
  _LOOP_ALERT="${TEST_TMP}/ALERT.md"
  GH_LOG="${TEST_TMP}/gh.log"
  : > "$GH_LOG"
  info() { :; }
  warn() { :; }
  _gh_resolve() { printf -v "$1" '%s' "owner/repo"; }
  mkdir -p .roll/state
}
teardown() { unit_teardown_cd; }

_state="$BATS_TEST_DIRNAME"  # placeholder; real paths resolved at runtime

# ── _ci_record_timing ───────────────────────────────────────────────────────

@test "_ci_record_timing: first record writes a JSONL line" {
  _ci_record_timing '{"databaseId":101,"workflowName":"unit","conclusion":"success","status":"completed","createdAt":"2026-05-30T10:00:00Z","updatedAt":"2026-05-30T10:02:00Z"}'
  [ -f .roll/state/ci-timing.jsonl ]
  run cat .roll/state/ci-timing.jsonl
  [[ "$output" == *'"run_id":101'* ]]
  [[ "$output" == *'"workflow":"unit"'* ]]
  [[ "$output" == *'"conclusion":"success"'* ]]
}

@test "_ci_record_timing: computes duration from createdAt/updatedAt" {
  _ci_record_timing '{"databaseId":102,"workflowName":"unit","conclusion":"success","createdAt":"2026-05-30T10:00:00Z","updatedAt":"2026-05-30T10:02:00Z"}'
  run cat .roll/state/ci-timing.jsonl
  # 2 minutes = 120s
  [[ "$output" == *'"duration_sec":120'* ]]
}

@test "_ci_record_timing: duplicate run_id is skipped (idempotent)" {
  _ci_record_timing '{"databaseId":103,"workflowName":"unit","conclusion":"success"}'
  _ci_record_timing '{"databaseId":103,"workflowName":"unit","conclusion":"failure"}'
  run wc -l < .roll/state/ci-timing.jsonl
  [ "$output" -eq 1 ]
}

@test "_ci_record_timing: empty json is a no-op" {
  _ci_record_timing ""
  [ ! -f .roll/state/ci-timing.jsonl ]
}

# ── _ci_classify_failure ─────────────────────────────────────────────────────

@test "_ci_classify_failure: transient signature → transient" {
  gh() { echo "Error: connect ETIMEDOUT 10.0.0.1:443"; }
  run _ci_classify_failure 200
  [ "$output" = "transient" ]
}

@test "_ci_classify_failure: runner shutdown → transient" {
  gh() { echo "The runner has received a shutdown signal"; }
  run _ci_classify_failure 201
  [ "$output" = "transient" ]
}

@test "_ci_classify_failure: real test failure → real" {
  gh() { echo "not ok 5 _ci_record_timing: assertion failed: expected 1 got 0"; }
  run _ci_classify_failure 202
  [ "$output" = "real" ]
}

@test "_ci_classify_failure: empty log defaults to real (fail safe)" {
  gh() { return 0; }
  run _ci_classify_failure 203
  [ "$output" = "real" ]
}

# ── _ci_rerun_transient ──────────────────────────────────────────────────────

@test "_ci_rerun_transient: attempt 0 → rerun, state incremented to 1" {
  gh() { echo "gh $*" >> "$GH_LOG"; }
  run _ci_rerun_transient 300
  [ "$output" = "rerun" ]
  run _ci_rerun_attempts 300
  [ "$output" -eq 1 ]
  grep -q 'run rerun 300' "$GH_LOG"
}

@test "_ci_rerun_transient: attempt 1 → rerun, state incremented to 2" {
  gh() { :; }
  _ci_rerun_state_write 301 1
  run _ci_rerun_transient 301
  [ "$output" = "rerun" ]
  run _ci_rerun_attempts 301
  [ "$output" -eq 2 ]
}

@test "_ci_rerun_transient: attempt >=2 → limit + error ALERT" {
  gh() { :; }
  _ci_rerun_state_write 302 2
  run _ci_rerun_transient 302
  [ "$output" = "limit" ]
  [ -f "$_LOOP_ALERT" ]
  grep -q 'ci-rerun-limit' "$_LOOP_ALERT"
  grep -q '\[error\]' "$_LOOP_ALERT"
}

# ── _ci_open_story ───────────────────────────────────────────────────────────

@test "_ci_open_story: appends a FIX row with auto-incremented id" {
  printf '| ID | Description | Status |\n|----|----|----|\n| FIX-007 | x | ✅ Done |\n' > .roll/backlog.md
  run _ci_open_story FIX "flaky: unit"
  [ "$output" = "FIX-008" ]
  grep -q '| FIX-008 | flaky: unit | 📋 Todo |' .roll/backlog.md
}

@test "_ci_open_story: duplicate Todo title is skipped (idempotent)" {
  printf '| ID | Description | Status |\n| FIX-009 | flaky: unit | 📋 Todo |\n' > .roll/backlog.md
  run _ci_open_story FIX "flaky: unit"
  [ "$output" = "skip" ]
  run grep -c 'flaky: unit' .roll/backlog.md
  [ "$output" -eq 1 ]
}

@test "_ci_open_story: same title already Done is NOT skipped (reopens)" {
  printf '| ID | Description | Status |\n| FIX-010 | flaky: unit | ✅ Done |\n' > .roll/backlog.md
  run _ci_open_story FIX "flaky: unit"
  [ "$output" = "FIX-011" ]
}

# ── _ci_detect_flaky ─────────────────────────────────────────────────────────

@test "_ci_detect_flaky: 20-80% failure rate opens a FIX story" {
  printf '| ID | Description | Status |\n' > .roll/backlog.md
  local f=.roll/state/ci-timing.jsonl
  : > "$f"
  # 6 success, 4 failure for workflow "unit" = 40% fail → flaky
  for i in 1 2 3 4 5 6; do
    printf '{"run_id":%s,"workflow":"unit","conclusion":"success","duration_sec":10}\n' "$i" >> "$f"
  done
  for i in 7 8 9 10; do
    printf '{"run_id":%s,"workflow":"unit","conclusion":"failure","duration_sec":10}\n' "$i" >> "$f"
  done
  _ci_detect_flaky
  grep -q 'flaky: unit' .roll/backlog.md
}

@test "_ci_detect_flaky: all-pass workflow does NOT open a story" {
  printf '| ID | Description | Status |\n' > .roll/backlog.md
  local f=.roll/state/ci-timing.jsonl
  : > "$f"
  for i in 1 2 3 4 5; do
    printf '{"run_id":%s,"workflow":"unit","conclusion":"success","duration_sec":10}\n' "$i" >> "$f"
  done
  _ci_detect_flaky
  run grep -c 'flaky' .roll/backlog.md
  [ "$output" -eq 0 ]
}

# ── _ci_detect_degradation ───────────────────────────────────────────────────

@test "_ci_detect_degradation: unit avg > 300s opens a US story" {
  printf '| ID | Description | Status |\n' > .roll/backlog.md
  local f=.roll/state/ci-timing.jsonl
  : > "$f"
  printf '{"run_id":1,"workflow":"unit","conclusion":"success","duration_sec":400}\n' >> "$f"
  printf '{"run_id":2,"workflow":"unit","conclusion":"success","duration_sec":500}\n' >> "$f"
  _ci_detect_degradation
  grep -q 'CI degradation: unit' .roll/backlog.md
}

@test "_ci_detect_degradation: integration avg > 900s opens a US story" {
  printf '| ID | Description | Status |\n' > .roll/backlog.md
  local f=.roll/state/ci-timing.jsonl
  : > "$f"
  printf '{"run_id":1,"workflow":"integration","conclusion":"success","duration_sec":1000}\n' >> "$f"
  _ci_detect_degradation
  grep -q 'CI degradation: integration' .roll/backlog.md
}

@test "_ci_detect_degradation: fast workflow does NOT open a story" {
  printf '| ID | Description | Status |\n' > .roll/backlog.md
  local f=.roll/state/ci-timing.jsonl
  : > "$f"
  printf '{"run_id":1,"workflow":"unit","conclusion":"success","duration_sec":50}\n' >> "$f"
  _ci_detect_degradation
  run grep -c 'degradation' .roll/backlog.md
  [ "$output" -eq 0 ]
}

# ── _ci_scan (orchestrator) ──────────────────────────────────────────────────

@test "_ci_scan: gh missing → returns 0 (lenient, no state written)" {
  # Simulate gh absent: _gh_resolve fails.
  _gh_resolve() { return 1; }
  run _ci_scan
  [ "$status" -eq 0 ]
  [ ! -f .roll/state/ci-timing.jsonl ]
}

@test "_ci_scan: gh run list failure → returns 0 (lenient)" {
  gh() { return 1; }
  run _ci_scan
  [ "$status" -eq 0 ]
}

@test "_ci_scan: empty run list → returns 0, no records" {
  gh() { echo "[]"; }
  run _ci_scan
  [ "$status" -eq 0 ]
  [ ! -f .roll/state/ci-timing.jsonl ]
}

@test "_ci_scan: records timing for each run via _ci_record_timing" {
  gh() {
    case "$*" in
      *"run list"*) echo '[{"databaseId":501,"workflowName":"unit","conclusion":"success","status":"completed","createdAt":"2026-05-30T10:00:00Z","updatedAt":"2026-05-30T10:01:00Z"},{"databaseId":502,"workflowName":"integration","conclusion":"success","status":"completed","createdAt":"2026-05-30T10:00:00Z","updatedAt":"2026-05-30T10:05:00Z"}]' ;;
      *) : ;;
    esac
  }
  run _ci_scan
  [ "$status" -eq 0 ]
  grep -q '"run_id":501' .roll/state/ci-timing.jsonl
  grep -q '"run_id":502' .roll/state/ci-timing.jsonl
}

@test "_ci_scan: a transient failure is auto-rerun" {
  gh() {
    case "$*" in
      *"run list"*) echo '[{"databaseId":600,"workflowName":"unit","conclusion":"failure","status":"completed","createdAt":"2026-05-30T10:00:00Z","updatedAt":"2026-05-30T10:01:00Z"}]' ;;
      *"--log-failed"*) echo "Error: connect ETIMEDOUT 10.0.0.1:443" ;;
      *) echo "gh $*" >> "$GH_LOG" ;;
    esac
  }
  run _ci_scan
  [ "$status" -eq 0 ]
  # transient → rerun recorded
  run _ci_rerun_attempts 600
  [ "$output" -eq 1 ]
}

@test "_ci_scan: a real failure is NOT rerun" {
  gh() {
    case "$*" in
      *"run list"*) echo '[{"databaseId":601,"workflowName":"unit","conclusion":"failure","status":"completed","createdAt":"2026-05-30T10:00:00Z","updatedAt":"2026-05-30T10:01:00Z"}]' ;;
      *"--log-failed"*) echo "not ok 5 assertion failed" ;;
      *) : ;;
    esac
  }
  run _ci_scan
  [ "$status" -eq 0 ]
  run _ci_rerun_attempts 601
  [ "$output" -eq 0 ]
}

@test "_ci_scan: runs flaky + degradation detection after the loop" {
  # Pre-seed timing history so detectors fire on data the scan appends to.
  printf '| ID | Description | Status |\n' > .roll/backlog.md
  local f=.roll/state/ci-timing.jsonl
  : > "$f"
  for i in 1 2 3 4 5 6; do
    printf '{"run_id":%s,"workflow":"unit","conclusion":"success","duration_sec":10}\n' "$i" >> "$f"
  done
  for i in 7 8 9 10; do
    printf '{"run_id":%s,"workflow":"unit","conclusion":"failure","duration_sec":10}\n' "$i" >> "$f"
  done
  gh() { case "$*" in *"run list"*) echo "[]" ;; *) : ;; esac; }
  run _ci_scan
  [ "$status" -eq 0 ]
  grep -q 'flaky: unit' .roll/backlog.md
}

# ── function existence contracts ─────────────────────────────────────────────

@test "all CI loop helpers are defined in bin/roll" {
  for fn in _ci_record_timing _ci_classify_failure _ci_rerun_transient \
            _ci_detect_flaky _ci_detect_degradation _ci_open_story _ci_scan; do
    grep -qF "${fn}()" "$ROLL_BIN"
  done
}
