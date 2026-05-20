#!/usr/bin/env bats
# Unit tests for: roll init v2 redesign (US-VIEW-008)

ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"

setup() {
  TEST_DIR="$(mktemp -d)"
  export NO_COLOR=1
  export TERM=dumb
}

teardown() {
  rm -rf "$TEST_DIR"
}

@test "init v2: Python renderer runs standalone with --demo" {
  cd "$TEST_DIR"
  run python3 "${ROLL_BIN%/bin/roll}/lib/roll-init.py" --demo
  [ "$status" -eq 0 ]
  [[ "$output" == *"INIT"* ]]
  [[ "$output" == *"✓"* ]]
}

# FIX-071: `cmd_init` previously emitted the demo Python renderer (with a
# fake "Project ready" footer and six pre-canned "✓" steps) on every invocation
# when ROLL_UI defaulted to v2. That output is misleading on the legacy-project
# code path, which short-circuits into the onboard guide and creates nothing —
# but the user has already been told the project is "ready". The demo render
# is now gated behind --demo, and the bash flow produces its own real output.

@test "init: bare 'roll init' on a legacy project does NOT emit demo Project ready (FIX-071)" {
  cd "$TEST_DIR"
  # Make this look like a legacy project: no AGENTS.md, but a manifest at root
  # so US-ONBOARD-012's legacy recogniser fires.
  echo '{}' > app.json
  # Make ROLL_PKG_DIR / ROLL_TEMPLATES resolve so cmd_init can be sourced.
  ROLL_PKG_DIR="${ROLL_BIN%/bin/roll}" \
  ROLL_TEMPLATES="${ROLL_BIN%/bin/roll}/conventions/templates" \
    bash "$ROLL_BIN" init 2>&1 > /tmp/roll-init.$$.out || true
  # The legacy onboard banner is fine
  grep -qF "legacy project" /tmp/roll-init.$$.out
  # The demo footer must NOT appear (we never created any files)
  ! grep -qF "Project ready" /tmp/roll-init.$$.out
  rm -f /tmp/roll-init.$$.out
}

@test "init: 'roll init --demo' still renders the demo UI (FIX-071 preserves --demo)" {
  cd "$TEST_DIR"
  ROLL_PKG_DIR="${ROLL_BIN%/bin/roll}" \
    run bash "$ROLL_BIN" init --demo
  [ "$status" -eq 0 ]
  [[ "$output" == *"INIT"* ]]
  [[ "$output" == *"Project ready"* ]]
}

@test "init v2: demo shows numbered steps" {
  cd "$TEST_DIR"
  run python3 "${ROLL_BIN%/bin/roll}/lib/roll-init.py" --demo
  [ "$status" -eq 0 ]
  [[ "$output" == *"1."* ]]
  [[ "$output" == *"6."* ]]
}

@test "init v2: demo shows file-operation markers + and ~" {
  cd "$TEST_DIR"
  run python3 "${ROLL_BIN%/bin/roll}/lib/roll-init.py" --demo
  [ "$status" -eq 0 ]
  [[ "$output" == *"+"* ]]
  [[ "$output" == *"~"* ]]
}

@test "init v2: demo shows 'Project ready' footer" {
  cd "$TEST_DIR"
  run python3 "${ROLL_BIN%/bin/roll}/lib/roll-init.py" --demo
  [ "$status" -eq 0 ]
  [[ "$output" == *"Project ready"* ]]
}

@test "init v2: demo shows NEXT section with three follow-up steps" {
  cd "$TEST_DIR"
  run python3 "${ROLL_BIN%/bin/roll}/lib/roll-init.py" --demo
  [ "$status" -eq 0 ]
  [[ "$output" == *"NEXT"* ]]
  # Three numbered next-steps OR bullet markers
  echo "$output" | grep -cE "^\s+[1-3]\." | grep -q "^[3-9]" || \
    echo "$output" | grep -qE "(BACKLOG|backlog).*(loop|cycle)"
}

@test "init v2: --no-color suppresses ANSI escapes" {
  cd "$TEST_DIR"
  run python3 "${ROLL_BIN%/bin/roll}/lib/roll-init.py" --demo --no-color
  [ "$status" -eq 0 ]
  # No ESC sequences
  [[ "$output" != *$'\033'* ]]
}

@test "init v2: ROLL_UI=v2 with --demo routes through Python renderer and exits cleanly" {
  cd "$TEST_DIR"
  run env ROLL_UI=v2 bash "$ROLL_BIN" init --demo
  [ "$status" -eq 0 ]
  [[ "$output" == *"INIT"* ]]
}
