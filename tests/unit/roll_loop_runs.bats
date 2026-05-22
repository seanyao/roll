#!/usr/bin/env bats
# Tests for roll loop runs — per-iteration visibility (US-AUTO-024)

SKILL_FILE="${BATS_TEST_DIRNAME}/../../skills/roll-loop/SKILL.md"

load helpers
setup() {
  unit_setup_cd
  _tmp="$TEST_TMP"
  _LOOP_RUNS="${TEST_TMP}/runs.jsonl"
  # Pin timezone so UTC-Z fixtures convert deterministically across runners (CI=UTC, mac=CST).
  export TZ=UTC
}
teardown() { unit_teardown_cd; }

# ─── Dispatch ─────────────────────────────────────────────────────────────────

@test "cmd_loop routes 'runs' to _loop_runs" {
  grep -qE 'runs\)[[:space:]]+_loop_runs' "$ROLL_BIN"
}

@test "cmd_loop usage line lists 'runs'" {
  grep -qE 'Usage: roll loop .*runs' "$ROLL_BIN"
}

# ─── Empty / missing state ────────────────────────────────────────────────────

@test "_loop_runs: shows 'no runs' when runs.jsonl missing" {
  run _loop_runs
  [ "$status" -eq 0 ]
  [[ "$output" == *"No loop runs"* ]]
}

@test "_loop_runs: shows 'no runs for current project' when file has only other projects" {
  cat > "$_LOOP_RUNS" <<'EOF'
{"ts":"2026-05-11T19:11:00Z","project":"/some/other/path","run_id":"loop-1","status":"idle","built":[],"skipped":[],"alerts":0,"tcr_count":0,"duration_sec":5}
EOF
  run _loop_runs
  [ "$status" -eq 0 ]
  [[ "$output" == *"No loop runs"* ]]
}

# ─── Project filtering ────────────────────────────────────────────────────────

@test "_loop_runs: shows entries matching current project" {
  local proj; proj=$(_project_slug "$(pwd -P)")
  cat > "$_LOOP_RUNS" <<EOF
{"ts":"2026-05-11T19:11:00Z","project":"${proj}","run_id":"loop-A","status":"built","built":["US-AUTO-024"],"skipped":[],"alerts":0,"tcr_count":3,"duration_sec":1680}
EOF
  run _loop_runs
  [ "$status" -eq 0 ]
  [[ "$output" == *"19:11"* ]]
  [[ "$output" == *"US-AUTO-024"* ]]
  [[ "$output" == *"built"* ]]
}

@test "_loop_runs: filters out entries from other projects (default)" {
  local proj; proj=$(_project_slug "$(pwd -P)")
  cat > "$_LOOP_RUNS" <<EOF
{"ts":"2026-05-11T19:11:00Z","project":"other-aaaaaa","run_id":"loop-X","status":"built","built":["US-OTHER-001"],"skipped":[],"alerts":0,"tcr_count":1,"duration_sec":120}
{"ts":"2026-05-11T19:12:00Z","project":"${proj}","run_id":"loop-Y","status":"idle","built":[],"skipped":[],"alerts":0,"tcr_count":0,"duration_sec":10}
EOF
  run _loop_runs
  [ "$status" -eq 0 ]
  [[ "$output" != *"US-OTHER-001"* ]]
  [[ "$output" == *"idle"* ]]
}

@test "_loop_runs --all: shows entries from all projects" {
  cat > "$_LOOP_RUNS" <<'EOF'
{"ts":"2026-05-11T19:11:00Z","project":"/a/projA","run_id":"loop-A","status":"built","built":["US-A-001"],"skipped":[],"alerts":0,"tcr_count":1,"duration_sec":60}
{"ts":"2026-05-11T19:12:00Z","project":"/b/projB","run_id":"loop-B","status":"idle","built":[],"skipped":[],"alerts":0,"tcr_count":0,"duration_sec":5}
EOF
  run _loop_runs --all
  [ "$status" -eq 0 ]
  [[ "$output" == *"projA"* ]]
  [[ "$output" == *"projB"* ]]
}

# ─── Ordering & limit ─────────────────────────────────────────────────────────

@test "_loop_runs: lists entries in reverse chronological order (newest first)" {
  local proj; proj=$(_project_slug "$(pwd -P)")
  cat > "$_LOOP_RUNS" <<EOF
{"ts":"2026-05-11T10:00:00Z","project":"${proj}","run_id":"loop-OLD","status":"built","built":["US-X-001"],"skipped":[],"alerts":0,"tcr_count":1,"duration_sec":60}
{"ts":"2026-05-11T19:00:00Z","project":"${proj}","run_id":"loop-NEW","status":"built","built":["US-X-002"],"skipped":[],"alerts":0,"tcr_count":2,"duration_sec":120}
EOF
  run _loop_runs
  [ "$status" -eq 0 ]
  local new_line old_line
  new_line=$(echo "$output" | grep -n "US-X-002" | head -1 | cut -d: -f1)
  old_line=$(echo "$output" | grep -n "US-X-001" | head -1 | cut -d: -f1)
  [ -n "$new_line" ] && [ -n "$old_line" ]
  [ "$new_line" -lt "$old_line" ]
}

@test "_loop_runs N: respects N argument (default 10)" {
  local proj; proj=$(_project_slug "$(pwd -P)")
  : > "$_LOOP_RUNS"
  for i in $(seq 1 5); do
    printf '{"ts":"2026-05-11T19:%02d:00Z","project":"%s","run_id":"loop-%d","status":"idle","built":[],"skipped":[],"alerts":0,"tcr_count":0,"duration_sec":5}\n' \
      "$i" "$proj" "$i" >> "$_LOOP_RUNS"
  done
  run _loop_runs 2
  [ "$status" -eq 0 ]
  local count; count=$(echo "$output" | grep -c "idle")
  [ "$count" -eq 2 ]
}

# ─── Timezone conversion ──────────────────────────────────────────────────────

@test "_loop_runs: UTC Z-suffix timestamps convert to local time" {
  local proj; proj=$(_project_slug "$(pwd -P)")
  cat > "$_LOOP_RUNS" <<EOF
{"ts":"2026-05-11T03:00:00Z","project":"${proj}","run_id":"loop-utc","status":"idle","built":[],"skipped":[],"alerts":0,"tcr_count":0,"duration_sec":5}
EOF
  TZ=Asia/Shanghai run _loop_runs
  [ "$status" -eq 0 ]
  [[ "$output" == *"11:00"* ]]
}

# ─── Status formatting ────────────────────────────────────────────────────────

@test "_loop_runs: built status shows ✅, story ids, count, tcr, duration" {
  local proj; proj=$(_project_slug "$(pwd -P)")
  cat > "$_LOOP_RUNS" <<EOF
{"ts":"2026-05-11T19:11:00Z","project":"${proj}","run_id":"loop-A","status":"built","built":["US-AUTO-024","US-AUTO-025"],"skipped":[],"alerts":0,"tcr_count":14,"duration_sec":1680}
EOF
  run _loop_runs
  [ "$status" -eq 0 ]
  [[ "$output" == *"✅"* ]]
  [[ "$output" == *"US-AUTO-024"* ]]
  [[ "$output" == *"US-AUTO-025"* ]]
  [[ "$output" == *"2 items"* ]]
  [[ "$output" == *"14 tcr"* ]]
  [[ "$output" == *"28m"* ]]
}

@test "_loop_runs: idle status shows ○ and 'no Todo items'" {
  local proj; proj=$(_project_slug "$(pwd -P)")
  cat > "$_LOOP_RUNS" <<EOF
{"ts":"2026-05-11T18:11:00Z","project":"${proj}","run_id":"loop-A","status":"idle","built":[],"skipped":[],"alerts":0,"tcr_count":0,"duration_sec":5}
EOF
  run _loop_runs
  [ "$status" -eq 0 ]
  [[ "$output" == *"○"* ]]
  [[ "$output" == *"idle"* ]]
}

@test "_loop_runs: failed status shows ✗ and reason" {
  local proj; proj=$(_project_slug "$(pwd -P)")
  cat > "$_LOOP_RUNS" <<EOF
{"ts":"2026-05-11T17:11:00Z","project":"${proj}","run_id":"loop-A","status":"failed","built":[],"skipped":[],"alerts":1,"tcr_count":0,"duration_sec":30,"reason":"claude API error"}
EOF
  run _loop_runs
  [ "$status" -eq 0 ]
  [[ "$output" == *"✗"* ]]
  [[ "$output" == *"FAILED"* || "$output" == *"failed"* ]]
  [[ "$output" == *"claude API error"* ]]
}

# ─── SKILL.md contract ───────────────────────────────────────────────────────

@test "roll-loop SKILL.md: Step 5 references runs.jsonl" {
  grep -qF 'runs.jsonl' "$SKILL_FILE"
}

@test "roll-loop SKILL.md: Step 5 documents JSONL fields" {
  grep -qE 'ts.*project.*run_id|run_id.*status.*built|built.*tcr_count' "$SKILL_FILE"
  grep -qF 'tcr_count' "$SKILL_FILE"
  grep -qF 'duration_sec' "$SKILL_FILE"
}

@test "SKILL.md write recipe uses _project_slug (matches _loop_runs filter)" {
  grep -qE '_project_slug' "$SKILL_FILE"
}

@test "write-read contract: slug written by skill recipe is readable by _loop_runs" {
  local proj; proj=$(_project_slug "$(pwd -P)")
  cat > "$_LOOP_RUNS" <<EOF
{"ts":"2026-05-11T19:00:00Z","project":"${proj}","run_id":"loop-contract","status":"built","built":["US-CONTRACT-001"],"skipped":[],"alerts":[],"tcr_count":1,"duration_sec":60}
EOF
  run _loop_runs
  [ "$status" -eq 0 ]
  [[ "$output" == *"US-CONTRACT-001"* ]]
}

# ─── FIX-099: tcr_count + built[] truthfulness ────────────────────────────────

@test "FIX-099: runs.jsonl with tcr_count=1 and built=[FIX-097] renders correctly" {
  # Regression: before FIX-099 the orphan recovery path hard-coded tcr_count=0
  # and built=[]. Verify the runs display correctly reflects non-zero values.
  local proj; proj=$(_project_slug "$(pwd -P)")
  cat > "$_LOOP_RUNS" <<EOF
{"ts":"2026-05-23T01:28:00Z","project":"${proj}","run_id":"loop-fix097","status":"built","built":["FIX-097"],"skipped":[],"alerts":[],"tcr_count":1,"duration_sec":540}
EOF
  run _loop_runs
  [ "$status" -eq 0 ]
  [[ "$output" == *"FIX-097"* ]]
  [[ "$output" == *"1 tcr"* ]]
}

@test "FIX-099: runs.jsonl tcr_count=0 and built=[] does not show story ids" {
  # When a cycle is genuinely idle (no tcr commits), the runs display should
  # reflect that accurately — not spuriously invent story ids.
  local proj; proj=$(_project_slug "$(pwd -P)")
  cat > "$_LOOP_RUNS" <<EOF
{"ts":"2026-05-23T01:18:00Z","project":"${proj}","run_id":"loop-idle","status":"idle","built":[],"skipped":[],"alerts":[],"tcr_count":0,"duration_sec":10}
EOF
  run _loop_runs
  [ "$status" -eq 0 ]
  [[ "$output" != *"FIX-"* ]]
  [[ "$output" != *"US-"* ]]
}

@test "FIX-099: ALERT three-field format contains recovered_from_orphan and tcr_commits fields" {
  # Verify the new ALERT format used by _worktree_alert in the orphan recovery
  # path carries the three structured fields the spec requires.
  # The old pattern: _worktree_alert "... FIX-091 published as PR"
  # The new pattern: recovered_from_orphan=yes; tcr_commits=...; stories=...
  # Assert new fields present:
  grep -q 'recovered_from_orphan=yes' "$ROLL_BIN"
  grep -q 'tcr_commits=' "$ROLL_BIN"
  # Assert old misleading text is NOT in any active _worktree_alert call
  # (it may appear in a comment, that's fine).
  # Use python to parse lines and check — avoids grep pipeline exit-code issues.
  python3 - "$ROLL_BIN" <<'PYEOF'
import sys
path = sys.argv[1]
with open(path) as f:
    for i, line in enumerate(f, 1):
        stripped = line.lstrip()
        # Skip comment lines
        if stripped.startswith('#'):
            continue
        if '_worktree_alert' in line and 'FIX-091 published as PR' in line:
            print(f"Line {i}: {line.rstrip()}", file=sys.stderr)
            sys.exit(1)
PYEOF
}
