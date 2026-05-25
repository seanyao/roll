#!/usr/bin/env bats
# US-LOOP-015: cycle log archive — ANSI strip, rotate, gitignore

load helpers

setup()    { unit_setup; }
teardown() { unit_teardown; }

# ─── ANSI strip ────────────────────────────────────────────────────────────

@test "cycle log: strip ANSI CSI escape sequences" {
  local raw="${TEST_TMP}/test.raw"
  printf '\x1b[2KHello\x1b[0m\n' > "$raw"
  printf '\x1b[1;32mWorld\x1b[0m\n' >> "$raw"

  local clean="${TEST_TMP}/test.log"
  sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g; s/\r$//' "$raw" > "$clean"

  run cat "$clean"
  [ "$status" -eq 0 ]
  [[ "$output" == "Hello" ]]
  # Second line should be "World" — verify by counting lines
  [ "$(wc -l < "$clean" | tr -d ' ')" -eq 2 ]
}

@test "cycle log: strip ANSI + carriage return removal" {
  local raw="${TEST_TMP}/test2.raw"
  printf '\x1b[33mLine1\x1b[0m\r\n' > "$raw"
  printf '\x1b[2KLine2\x1b[0m\r\n' >> "$raw"

  local clean="${TEST_TMP}/test2.log"
  sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g; s/\r$//' "$raw" > "$clean"

  # No carriage returns in output
  ! grep -q $'\r' "$clean"
  # Content preserved without ANSI codes
  grep -q "Line1" "$clean"
  grep -q "Line2" "$clean"
  # No raw escape sequences
  ! grep -q $'\x1b' "$clean"
}

@test "cycle log: sed does not corrupt non-ANSI content" {
  local raw="${TEST_TMP}/test3.raw"
  printf 'plain text line\n' > "$raw"
  printf 'numbers 123 and symbols @#$%%\n' >> "$raw"
  printf '  indented with spaces\n' >> "$raw"

  local clean="${TEST_TMP}/test3.log"
  sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g; s/\r$//' "$raw" > "$clean"

  diff "$raw" "$clean"
}

# ─── Rotate ─────────────────────────────────────────────────────────────────

@test "cycle log: rotate keeps newest 50 files, removes older" {
  local dir="${TEST_TMP}/cycle-logs"
  mkdir -p "$dir"

  # Create 51 log files with staggered mtimes (newest last = highest i)
  local i
  for i in $(seq 1 51); do
    local f="${dir}/cycle-${i}.log"
    echo "log $i" > "$f"
    # macOS touch -t expects [[CC]YY]MMDDhhmm[.SS] — pad to even groups
    local _ts
    _ts=$(printf '2025010100%02d' "$i")
    touch -t "$_ts" "$f" 2>/dev/null || true
  done

  # Rotate: keep newest 50
  ( cd "$dir" && ls -t *.log 2>/dev/null | tail -n +51 | xargs -r rm -f )

  local count
  count=$(ls "$dir"/*.log 2>/dev/null | wc -l | tr -d ' ')
  [ "$count" -eq 50 ]

  # The oldest file (cycle-1) should be removed
  [ ! -f "${dir}/cycle-1.log" ]
  # The newest file (cycle-51) should remain
  [ -f "${dir}/cycle-51.log" ]
}

@test "cycle log: rotate when fewer than 51 files does nothing" {
  local dir="${TEST_TMP}/cycle-logs-few"
  mkdir -p "$dir"

  local i
  for i in $(seq 1 10); do
    echo "log $i" > "${dir}/cycle-${i}.log"
  done

  ( cd "$dir" && ls -t *.log 2>/dev/null | tail -n +51 | xargs -r rm -f )

  local count
  count=$(ls "$dir"/*.log 2>/dev/null | wc -l | tr -d ' ')
  [ "$count" -eq 10 ]
}

@test "cycle log: rotate on empty dir is safe" {
  local dir="${TEST_TMP}/cycle-logs-empty"
  mkdir -p "$dir"

  run bash -c "( cd '$dir' && ls -t *.log 2>/dev/null | tail -n +51 | xargs -r rm -f )"
  [ "$status" -eq 0 ]
}

@test "cycle log: rotate only matches .log files" {
  local dir="${TEST_TMP}/cycle-logs-mixed"
  mkdir -p "$dir"

  echo "raw1" > "${dir}/cycle-1.raw"
  echo "log1" > "${dir}/cycle-1.log"
  echo "raw2" > "${dir}/cycle-2.raw"
  echo "log2" > "${dir}/cycle-2.log"

  # Rotate won't touch .raw files
  ( cd "$dir" && ls -t *.log 2>/dev/null | tail -n +51 | xargs -r rm -f )

  [ -f "${dir}/cycle-1.raw" ]
  [ -f "${dir}/cycle-2.raw" ]
  [ -f "${dir}/cycle-1.log" ]
  [ -f "${dir}/cycle-2.log" ]
}

# ─── Gitignore ──────────────────────────────────────────────────────────────

@test "cycle log: .roll/.gitignore contains cycle-logs/" {
  # Verify the repo's .gitignore has the entry
  local gitignore="${BATS_TEST_DIRNAME}/../../.roll/.gitignore"
  [ -f "$gitignore" ]
  grep -q '^cycle-logs/' "$gitignore"
}

# ─── Generated script verification ──────────────────────────────────────────

@test "cycle log: inner script contains ANSI strip + rotate in _inner_cleanup" {
  local runner="${TEST_TMP}/run-test.sh"
  local log="${TEST_TMP}/test.log"
  _write_loop_runner_script "$runner" "${TEST_TMP}/fake-project" "echo ok" "$log"

  local inner="${runner%.sh}-inner.sh"
  [ -f "$inner" ]

  # Verify ANSI strip: sed processes ROLL_CYCLE_LOG_RAW
  grep -q 'ROLL_CYCLE_LOG_RAW' "$inner"
  # Verify rotate: ls -t *.log
  grep -q 'ls -t \*\.log.*xargs.*rm' "$inner"
  # Verify ROLL_CYCLE_LOG_KEEP default
  grep -q 'ROLL_CYCLE_LOG_KEEP:-50' "$inner"
}

@test "cycle log: outer script exports ROLL_CYCLE_LOG_RAW and uses tee pipe-pane" {
  local runner="${TEST_TMP}/run-test2.sh"
  local log="${TEST_TMP}/test2.log"
  _write_loop_runner_script "$runner" "${TEST_TMP}/fake-project" "echo ok" "$log"

  [ -f "$runner" ]

  # Verify pipe-pane uses tee (dual-write) not cat
  grep -q 'tee -a' "$runner"
  # Verify ROLL_CYCLE_LOG_RAW is exported
  grep -q 'export ROLL_CYCLE_LOG_RAW' "$runner"
  # Verify cycle-logs directory is created
  grep -q 'cycle-logs' "$runner"
  # No old cat >> pipe-pane
  ! grep -q 'pipe-pane.*cat >>' "$runner"
}
