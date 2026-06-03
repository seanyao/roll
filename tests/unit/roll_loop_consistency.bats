#!/usr/bin/env bats
# US-CONSIST-006: dedicated Consistency Loop helpers.
#
# Covers _consistency_scan (gap detection → backlog entries / ALERT),
# _consistency_state_file, and _consistency_create_idea (idempotent
# backlog append). python3 is mocked; state lives in sandboxed .roll/loop/.

load helpers

setup() {
  unit_setup_cd
  _LOOP_ALERT="${TEST_TMP}/ALERT.md"
  : > "$_LOOP_ALERT"
  export _LOOP_ALERT
  info() { :; }
  warn() { :; }
  mkdir -p .roll/loop
  # Create a minimal backlog so _consistency_create_idea can resolve it
  cat > .roll/backlog.md << 'BACKLOG'
# Project Backlog

## 🐛 Bug Fixes
| ID | Description | Status |
|----|-------------|--------|

## 💡 Ideas
| ID | Description | Status |
|----|-------------|--------|
| IDEA-998 | existing idea for idempotency check | 📋 Todo |
BACKLOG
}
teardown() { unit_teardown_cd; }

# ── _consistency_scan ───────────────────────────────────────────────────────

@test "_consistency_scan: no gaps → tick idle, no backlog changes" {
  # python3 stubbed: return all-pass JSON
  python3() { echo '{"overall":"pass","dimensions":{}}'; }
  export -f python3

  run _consistency_scan
  [ "$status" -eq 0 ]

  # No ALERT written
  [ ! -s "$_LOOP_ALERT" ] || false

  # No new IDEA rows in backlog
  run grep 'IDEA-999' .roll/backlog.md
  [ "$status" -ne 0 ]
}

@test "_consistency_scan: new gap → creates IDEA entry in backlog" {
  python3() {
    echo '{"overall":"fail","dimensions":{"code":{"status":"fail","gaps":["Feature X has Done stories but missing from features.md catalog"]}}}'
  }
  export -f python3

  run _consistency_scan
  [ "$status" -eq 0 ]

  # IDEA-999 should be appended (998 exists)
  run grep 'IDEA-999' .roll/backlog.md
  [ "$status" -eq 0 ]
  [[ "$output" == *"📋 Todo"* ]]
}

@test "_consistency_scan: gap already in state file → no duplicate IDEA" {
  # Pre-populate state with the same gap
  local state_file
  # _consistency_scan creates ~/.roll/consistency-state.txt; in sandbox that's
  # inside TEST_TMP.  We write the expected gap line so it's treated as "seen".
  # Source the function so the config path resolves inside the sandbox.
  source "$(command -v roll)"
  state_file=$(_consistency_state_file)
  echo "code	Feature X has Done stories but missing from features.md catalog" > "$state_file"

  python3() {
    echo '{"overall":"fail","dimensions":{"code":{"status":"fail","gaps":["Feature X has Done stories but missing from features.md catalog"]}}}'
  }
  export -f python3

  # Reset backlog to before the gap
  cat > .roll/backlog.md << 'BACKLOG'
# Project Backlog

## 💡 Ideas
| ID | Description | Status |
|----|-------------|--------|
| IDEA-998 | existing idea for idempotency check | 📋 Todo |
BACKLOG

  run _consistency_scan
  [ "$status" -eq 0 ]

  # No IDEA-999
  run grep 'IDEA-999' .roll/backlog.md
  [ "$status" -ne 0 ]
}

@test "_consistency_scan: multiple gaps → one IDEA per gap" {
  python3() {
    echo '{"overall":"fail","dimensions":{"code":{"status":"fail","gaps":["Gap A in code","Gap B in code"]},"docs":{"status":"fail","gaps":["Gap C in docs"]}}}'
  }
  export -f python3

  run _consistency_scan
  [ "$status" -eq 0 ]

  # Three new IDEA entries (IDEA-999, IDEA-1000, IDEA-1001) + IDEA-998 existing = 4 Idea rows total
  run grep -cE 'IDEA-[0-9]+.*📋 Todo' .roll/backlog.md
  [ "$output" -eq 4 ]
}

@test "_consistency_scan: python3 unavailable → tick idle, no crash" {
  python3() { return 1; }
  export -f python3

  run _consistency_scan
  [ "$status" -eq 0 ]
}

@test "_consistency_scan: empty JSON result → tick idle" {
  python3() { echo ''; }
  export -f python3

  run _consistency_scan
  [ "$status" -eq 0 ]
}

@test "_consistency_scan: writes consistency tick record" {
  # Direct _loop_runtime_dir to the sandbox
  export ROLL_PROJECT_RUNTIME_DIR="${TEST_TMP}/.roll/loop"
  mkdir -p "$ROLL_PROJECT_RUNTIME_DIR"

  python3() { echo '{"overall":"pass","dimensions":{}}'; }
  export -f python3

  run _consistency_scan
  [ "$status" -eq 0 ]

  # Tick file lives at <rt_dir>/consistency-tick.jsonl
  [ -f "${ROLL_PROJECT_RUNTIME_DIR}/consistency-tick.jsonl" ]
  run cat "${ROLL_PROJECT_RUNTIME_DIR}/consistency-tick.jsonl"
  [[ "$output" == *'"loop":"consistency"'* ]]
}

@test "_consistency_scan: new gaps → writes ALERT" {
  python3() {
    echo '{"overall":"fail","dimensions":{"code":{"status":"fail","gaps":["New gap found"]}}}'
  }
  export -f python3

  run _consistency_scan
  [ "$status" -eq 0 ]

  # ALERT should mention the new gap count
  run cat "$_LOOP_ALERT"
  [[ "$output" == *"consistency"* ]]
  [[ "$output" == *"1 new gap"* ]]
}

# ── _consistency_state_file ─────────────────────────────────────────────────

@test "_consistency_state_file: returns path under .roll/loop/" {
  source "$(command -v roll)"
  run _consistency_state_file
  [ "$status" -eq 0 ]
  [[ "$output" == *".roll/loop/consistency-state.txt"* ]]
}

# ── _consistency_create_idea ────────────────────────────────────────────────

@test "_consistency_create_idea: appends IDEA row to backlog" {
  source "$(command -v roll)"

  run _consistency_create_idea "code" "Feature X missing from features.md"
  [ "$status" -eq 0 ]

  run grep 'IDEA-999' .roll/backlog.md
  [ "$status" -eq 0 ]
}

@test "_consistency_create_idea: same title already Todo → skip, no duplicate" {
  source "$(command -v roll)"

  # First call
  _consistency_create_idea "code" "duplicate gap title"
  # Second call with same title
  run _consistency_create_idea "code" "duplicate gap title"
  [ "$status" -eq 0 ]
  [[ "$output" == "skip" ]]
}

@test "_consistency_create_idea: empty dim/title → return 0" {
  source "$(command -v roll)"
  run _consistency_create_idea "" "some gap"
  [ "$status" -eq 0 ]
  run _consistency_create_idea "code" ""
  [ "$status" -eq 0 ]
}
