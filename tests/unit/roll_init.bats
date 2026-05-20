#!/usr/bin/env bats
# Unit tests for: roll init v2 real-data UI (FIX-073)

ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"
ROLL_DIR="${ROLL_BIN%/bin/roll}"

setup() {
  TEST_DIR="$(mktemp -d)"
  export NO_COLOR=1
  export TERM=dumb
}

teardown() {
  rm -rf "$TEST_DIR"
}

# ─── roll-init.py renderer: stdin JSON only ──────────────────────────────────

@test "init v2: renderer renders headers, steps, and Project ready from stdin JSON" {
  cd "$TEST_DIR"
  payload='{"header_label":"INIT","subtitle":"项目初始化","project_path":"~/p","steps":[{"num":1,"label":"Detect project type","status":"ok"},{"num":2,"label":"Create AGENTS.md","status":"ok","files":[["+","AGENTS.md"]]}],"footer":{"status":"ok","label":"Project ready"},"next":[["Edit .roll/backlog.md","add your first US"]]}'
  run bash -c "echo '$payload' | python3 \"$ROLL_DIR/lib/roll-init.py\""
  [ "$status" -eq 0 ]
  [[ "$output" == *"INIT"* ]]
  [[ "$output" == *"Detect project type"* ]]
  [[ "$output" == *"AGENTS.md"* ]]
  [[ "$output" == *"Project ready"* ]]
  [[ "$output" == *"NEXT"* ]]
}

@test "init v2: renderer marks failed steps with ✗ and surfaces the error" {
  cd "$TEST_DIR"
  payload='{"header_label":"INIT","steps":[{"num":1,"label":"x","status":"fail","error":"permission denied"}],"footer":{"status":"fail","label":"Init incomplete"}}'
  run bash -c "echo '$payload' | python3 \"$ROLL_DIR/lib/roll-init.py\""
  [ "$status" -eq 0 ]
  [[ "$output" == *"✗"* ]]
  [[ "$output" == *"permission denied"* ]]
  [[ "$output" == *"Init incomplete"* ]]
}

@test "init v2: renderer marks skipped steps with ↷ and shows the note" {
  cd "$TEST_DIR"
  payload='{"header_label":"INIT","steps":[{"num":1,"label":"x","status":"skip","note":"already exists"}],"footer":{"status":"ok","label":"Project ready"}}'
  run bash -c "echo '$payload' | python3 \"$ROLL_DIR/lib/roll-init.py\""
  [ "$status" -eq 0 ]
  [[ "$output" == *"↷"* ]]
  [[ "$output" == *"already exists"* ]]
}

@test "init v2: renderer exits non-zero on empty stdin (no demo fallback)" {
  cd "$TEST_DIR"
  run bash -c ": | python3 \"$ROLL_DIR/lib/roll-init.py\""
  [ "$status" -ne 0 ]
}

# ─── roll init (bash entry) ──────────────────────────────────────────────────

@test "init: --demo flag is rejected (FIX-073 removes the demo path)" {
  cd "$TEST_DIR"
  ROLL_PKG_DIR="$ROLL_DIR" \
  ROLL_TEMPLATES="$ROLL_DIR/conventions/templates" \
    run bash "$ROLL_BIN" init --demo
  [ "$status" -ne 0 ]
  [[ "$output" == *"--demo"* ]]
}

@test "init: bare 'roll init' on a fresh dir creates files AND renders v2 UI with real data" {
  cd "$TEST_DIR"
  ROLL_PKG_DIR="$ROLL_DIR" \
  ROLL_TEMPLATES="$ROLL_DIR/conventions/templates" \
    bash "$ROLL_BIN" init > /tmp/roll-init.$$.out 2>&1 || true
  # AGENTS.md must actually exist
  [ -f "$TEST_DIR/AGENTS.md" ]
  # v2 UI banner present
  grep -qF "INIT" /tmp/roll-init.$$.out
  # The renderer shows the real created file
  grep -qF "AGENTS.md" /tmp/roll-init.$$.out
  # Initialized footer (not "Project ready" — that was the demo footer)
  grep -qF "Initialized" /tmp/roll-init.$$.out
  rm -f /tmp/roll-init.$$.out
}

@test "init: legacy project goes to onboard guide; no fixture 'Create AGENTS.md ✓' step" {
  cd "$TEST_DIR"
  # Mark as legacy via root manifest
  echo '{}' > app.json
  ROLL_PKG_DIR="$ROLL_DIR" \
  ROLL_TEMPLATES="$ROLL_DIR/conventions/templates" \
    bash "$ROLL_BIN" init > /tmp/roll-init.$$.out 2>&1 || true
  grep -qF "legacy project" /tmp/roll-init.$$.out
  # Legacy path must not promise files that weren't created.
  ! grep -qF "Project ready" /tmp/roll-init.$$.out
  ! grep -qF "Create AGENTS.md" /tmp/roll-init.$$.out
  [ ! -f "$TEST_DIR/AGENTS.md" ]
  rm -f /tmp/roll-init.$$.out
}

@test "init: reinit on a project that already has AGENTS.md renders REINIT banner" {
  cd "$TEST_DIR"
  # Pre-seed AGENTS.md to hit the reinit branch
  echo "# AGENTS" > AGENTS.md
  ROLL_PKG_DIR="$ROLL_DIR" \
  ROLL_TEMPLATES="$ROLL_DIR/conventions/templates" \
    bash "$ROLL_BIN" init > /tmp/roll-init.$$.out 2>&1 || true
  # The banner switches to REINIT (was INIT for fresh)
  grep -qF "REINIT" /tmp/roll-init.$$.out
  rm -f /tmp/roll-init.$$.out
}

@test "init v2: --no-color suppresses ANSI escapes in the renderer" {
  cd "$TEST_DIR"
  payload='{"header_label":"INIT","steps":[{"num":1,"label":"x","status":"ok"}],"footer":{"status":"ok","label":"ok"}}'
  run bash -c "echo '$payload' | python3 \"$ROLL_DIR/lib/roll-init.py\" --no-color"
  [ "$status" -eq 0 ]
  [[ "$output" != *$'\033'* ]]
}
