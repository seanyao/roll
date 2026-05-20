#!/usr/bin/env bats
# Integration tests for: roll setup
# Tests ROLL_HOME directory creation, convention/skill installation, symlink linking,
# config.yaml generation, and convention sync to AI tool configs.

load helpers

setup() {
  # FIX-074: `run_roll setup` writes plists and calls `launchctl disable`
  # (FIX-059 path). Inside a real cycle ROLL_MAIN_SLUG poisons the label, so the
  # disable would hit the host's live service. Skip when CYCLE_ID is set.
  require_not_in_real_loop
  integration_setup
}

teardown() {
  integration_teardown
}

# ─── Scenario 1: setup creates ROLL_HOME directory structure ──────────────────

@test "setup: creates ~/.roll/ when it does not exist" {
  [ ! -d "$ROLL_HOME" ]
  run_roll setup
  [ "$status" -eq 0 ]
  [ -d "$ROLL_HOME" ]
}

@test "setup: creates ~/.roll/conventions/global/ with files" {
  run_roll setup
  [ "$status" -eq 0 ]
  [ -d "${ROLL_HOME}/conventions/global" ]
  # At least one file should be present (AGENTS.md, CLAUDE.md, or GEMINI.md)
  local count
  count=$(find "${ROLL_HOME}/conventions/global" -maxdepth 1 -type f | wc -l | tr -d ' ')
  [ "$count" -gt 0 ]
}

@test "setup: creates ~/.roll/skills/ directory" {
  run_roll setup
  [ "$status" -eq 0 ]
  [ -d "${ROLL_HOME}/skills" ]
}

@test "setup: creates ~/.roll/config.yaml" {
  run_roll setup
  [ "$status" -eq 0 ]
  [ -f "${ROLL_HOME}/config.yaml" ]
}

@test "setup: installs skills into ~/.roll/skills/" {
  run_roll setup
  [ "$status" -eq 0 ]
  # At least one skill sub-directory should be present
  local count
  count=$(find "${ROLL_HOME}/skills" -maxdepth 1 -mindepth 1 -type d | wc -l | tr -d ' ')
  [ "$count" -gt 0 ]
}

# ─── Scenario 2: setup is idempotent ─────────────────────────────────────────

@test "setup: running twice does not error" {
  run_roll setup
  [ "$status" -eq 0 ]
  run_roll setup
  [ "$status" -eq 0 ]
}

@test "setup: ROLL_HOME structure is intact after running twice" {
  run_roll setup
  run_roll setup
  [ -d "${ROLL_HOME}/conventions/global" ]
  [ -d "${ROLL_HOME}/skills" ]
  [ -f "${ROLL_HOME}/config.yaml" ]
}

# ─── Scenario 3: setup creates skill symlinks when AI tool dirs exist ─────────

@test "setup: creates ~/.claude/skills/ directory after setup" {
  run_roll setup
  [ "$status" -eq 0 ]
  [ -d "${TEST_TMP}/.claude/skills" ]
}

@test "setup: ~/.claude/skills/ contains roll-* symlinks" {
  run_roll setup
  [ "$status" -eq 0 ]
  local count
  count=$(find "${TEST_TMP}/.claude/skills" -maxdepth 1 -mindepth 1 -type l -name "roll-*" | wc -l | tr -d ' ')
  [ "$count" -gt 0 ]
}

@test "setup: roll-* symlinks in ~/.claude/skills/ point to ~/.roll/skills/" {
  run_roll setup
  [ "$status" -eq 0 ]
  local broken=0
  for link in "${TEST_TMP}/.claude/skills"/roll-*; do
    [ -L "$link" ] || continue
    local target
    target="$(readlink "$link")"
    # Each symlink must point into ROLL_HOME/skills/
    [[ "$target" == "${ROLL_HOME}/skills/"* ]] || broken=$((broken + 1))
  done
  [ "$broken" -eq 0 ]
}

@test "setup: creates ~/.gemini/skills/ symlinks when ~/.gemini/ exists" {
  run_roll setup
  [ "$status" -eq 0 ]
  [ -d "${TEST_TMP}/.gemini/skills" ]
  local count
  count=$(find "${TEST_TMP}/.gemini/skills" -maxdepth 1 -mindepth 1 -type l -name "roll-*" | wc -l | tr -d ' ')
  [ "$count" -gt 0 ]
}

# ─── Scenario 4: config.yaml handling ────────────────────────────────────────

@test "setup: does not overwrite config.yaml that already has ai_* entries" {
  mkdir -p "$ROLL_HOME"
  # Realistic user config: has ai_* entries plus custom values
  printf 'ai_claude: ~/.claude|CLAUDE.md|CLAUDE.md\ncustom: value\n' > "${ROLL_HOME}/config.yaml"

  run_roll setup
  [ "$status" -eq 0 ]

  # Custom content must still be present
  grep -q "custom: value" "${ROLL_HOME}/config.yaml"
}

@test "setup: recreates config.yaml when it has no ai_* entries (broken/migrated)" {
  mkdir -p "$ROLL_HOME"
  # Simulate a broken migrated config with no ai_* entries
  echo "sync_claude: ~/.claude" > "${ROLL_HOME}/config.yaml"

  run_roll setup
  [ "$status" -eq 0 ]

  # Fresh config with ai_* entries must now exist
  grep -qE "^ai_claude:" "${ROLL_HOME}/config.yaml"
  # Backup must have been saved
  [ -f "${ROLL_HOME}/config.yaml.bak" ]
}

# ─── Scenario 5: setup syncs conventions to AI tool configs ──────────────────

@test "setup: syncs conventions — roll.md written to ~/.claude/" {
  run_roll setup
  [ "$status" -eq 0 ]
  [ -f "${TEST_TMP}/.claude/roll.md" ]
}

@test "setup: syncs conventions — @roll.md appended to ~/.claude/CLAUDE.md" {
  run_roll setup
  [ "$status" -eq 0 ]
  [ -f "${TEST_TMP}/.claude/CLAUDE.md" ]
  grep -qF "@roll.md" "${TEST_TMP}/.claude/CLAUDE.md"
}

@test "setup: preserves custom content when config.yaml already has ai_* entries" {
  mkdir -p "$ROLL_HOME"
  local original_content="ai_claude: ~/.claude|CLAUDE.md|CLAUDE.md
custom_key: custom_value
another_key: 42"
  echo "$original_content" > "${ROLL_HOME}/config.yaml"

  run_roll setup
  [ "$status" -eq 0 ]

  # Custom content must still be present (new ai_* entries may be added by migration)
  grep -q "custom_key: custom_value" "${ROLL_HOME}/config.yaml"
  grep -q "another_key: 42" "${ROLL_HOME}/config.yaml"
  grep -qE "^ai_claude:" "${ROLL_HOME}/config.yaml"
}

# ─── Scenario 6: config migration — adds missing ai_* entries ─────────────────

@test "setup: adds missing ai_trae to config that already has some ai_* entries" {
  mkdir -p "$ROLL_HOME"
  # Simulate upgrading from old version — has ai_claude but no ai_trae
  printf 'ai_claude: ~/.claude|CLAUDE.md|CLAUDE.md\n# User preferences\ndefault_language: zh\n' \
    > "${ROLL_HOME}/config.yaml"

  run_roll setup
  [ "$status" -eq 0 ]

  grep -qE "^ai_trae:" "${ROLL_HOME}/config.yaml"
  grep -qE "^ai_claude:" "${ROLL_HOME}/config.yaml"
  # No backup: config was patched in place, not rebuilt from scratch
  [ ! -f "${ROLL_HOME}/config.yaml.bak" ]
}

# ─── Scenario 7: Trae installation detection via Library path ─────────────────

@test "setup: creates ~/.trae/ and syncs conventions when Library/Application Support/Trae exists" {
  mkdir -p "${TEST_TMP}/Library/Application Support/Trae"

  run_roll setup
  [ "$status" -eq 0 ]

  [ -d "${TEST_TMP}/.trae" ]
  [ -f "${TEST_TMP}/.trae/roll.md" ]
}

@test "setup: creates ~/.trae/skills/ symlinks when Library/Application Support/Trae exists" {
  mkdir -p "${TEST_TMP}/Library/Application Support/Trae"

  run_roll setup
  [ "$status" -eq 0 ]

  local count
  count=$(find "${TEST_TMP}/.trae/skills" -maxdepth 1 -mindepth 1 -type l -name "roll-*" \
    | wc -l | tr -d ' ')
  [ "$count" -gt 0 ]
}

@test "setup: does not create ~/.trae/ when neither ~/.trae nor Library/Application Support/Trae exist" {
  # No Trae installed — neither path present
  run_roll setup
  [ "$status" -eq 0 ]
  [ ! -d "${TEST_TMP}/.trae" ]
}

# ─── setup: sync correctness (merged from removed cmd_sync.bats) ──────────────

@test "setup: synced roll.md content matches ROLL_HOME/conventions/global/CLAUDE.md" {
  run_roll setup
  [ "$status" -eq 0 ]
  diff "${ROLL_HOME}/conventions/global/CLAUDE.md" "${TEST_TMP}/.claude/roll.md"
}

@test "setup: @roll.md is not duplicated when setup runs twice" {
  run_roll setup
  [ "$status" -eq 0 ]
  run_roll setup
  [ "$status" -eq 0 ]
  local count
  count=$(grep -cF "@roll.md" "${TEST_TMP}/.claude/CLAUDE.md")
  [ "$count" -eq 1 ]
}

@test "setup: absent ~/.gemini/ is not recreated by setup" {
  run_roll setup
  [ "$status" -eq 0 ]
  rm -rf "${TEST_TMP}/.gemini"
  run_roll setup
  [ "$status" -eq 0 ]
  [ ! -d "${TEST_TMP}/.gemini" ]
}

# ─── setup: stale-file prune (FIX-001) ────────────────────────────────────────
# Simulate the case where a prior version had a file that the current package
# no longer ships. The file lives in ROLL_HOME but has no source counterpart;
# the next setup must remove it instead of leaving it as a ghost.

@test "setup: prunes a ghost file inside a skill directory" {
  run_roll setup
  [ "$status" -eq 0 ]

  # Inject a ghost file with no counterpart in the package source
  local ghost="${ROLL_HOME}/skills/roll-design/ghost-file.md"
  echo "stale" > "$ghost"
  [ -f "$ghost" ]

  run_roll setup
  [ "$status" -eq 0 ]
  [ ! -f "$ghost" ]
}

@test "setup: prunes a ghost file in conventions/global/" {
  run_roll setup
  [ "$status" -eq 0 ]

  local ghost="${ROLL_HOME}/conventions/global/ghost-rule.md"
  echo "stale" > "$ghost"
  [ -f "$ghost" ]

  run_roll setup
  [ "$status" -eq 0 ]
  [ ! -f "$ghost" ]
}

@test "setup: prunes a ghost file inside a project-type template" {
  run_roll setup
  [ "$status" -eq 0 ]

  local ghost="${ROLL_HOME}/conventions/templates/fullstack/ghost-template.md"
  echo "stale" > "$ghost"
  [ -f "$ghost" ]

  run_roll setup
  [ "$status" -eq 0 ]
  [ ! -f "$ghost" ]
}

# ─── Scenario 8: launchd plist installation (macOS only) ─────────────────────

@test "setup (macOS): installs three launchd plist files" {
  [[ "$(uname)" != "Darwin" ]] && skip "macOS only"

  run_roll setup
  [ "$status" -eq 0 ]

  local launchd_dir="${TEST_TMP}/Library/LaunchAgents"
  [ -d "$launchd_dir" ]
  local count
  count=$(find "$launchd_dir" -maxdepth 1 -name "com.roll.*.plist" | wc -l | tr -d ' ')
  [ "$count" -eq 3 ]
}

@test "setup (macOS): plist files are not loaded after setup (disabled by default)" {
  [[ "$(uname)" != "Darwin" ]] && skip "macOS only"

  run_roll setup
  [ "$status" -eq 0 ]

  local launchd_dir="${TEST_TMP}/Library/LaunchAgents"
  for plist in "${launchd_dir}"/com.roll.*.plist; do
    [ -f "$plist" ]
    local label; label=$(grep -A1 '<key>Label</key>' "$plist" | grep '<string>' | sed 's/.*<string>\(.*\)<\/string>.*/\1/')
    ! launchctl list "$label" &>/dev/null
  done
}

@test "setup (macOS): running setup twice does not duplicate plists (idempotent)" {
  [[ "$(uname)" != "Darwin" ]] && skip "macOS only"

  run_roll setup
  [ "$status" -eq 0 ]
  run_roll setup
  [ "$status" -eq 0 ]

  local launchd_dir="${TEST_TMP}/Library/LaunchAgents"
  local count
  count=$(find "$launchd_dir" -maxdepth 1 -name "com.roll.*.plist" | wc -l | tr -d ' ')
  [ "$count" -eq 3 ]
}

# ─── FIX-073: v2 SETUP view backed by real data ──────────────────────────────

@test "setup v2 e2e: bare 'roll setup' renders SETUP header from real outcomes" {
  run_roll setup
  [ "$status" -eq 0 ]
  [[ "$output" == *"SETUP"* ]]
}

@test "setup v2 e2e: bare 'roll setup' renders numbered steps from real outcomes" {
  run_roll setup
  [ "$status" -eq 0 ]
  [[ "$output" == *"1."* ]]
  [[ "$output" == *"3."* ]]
}

@test "setup v2 e2e: bare 'roll setup' shows ✓ checkmarks for real successful steps" {
  run_roll setup
  [ "$status" -eq 0 ]
  [[ "$output" == *"✓"* ]]
}

@test "setup v2 e2e: bare 'roll setup' renders 'Setup complete' footer when real flow succeeds" {
  run_roll setup
  [ "$status" -eq 0 ]
  [[ "$output" == *"Setup complete"* ]]
}

@test "setup v2 e2e: unknown flag is rejected" {
  run_roll setup --bogus
  [ "$status" -ne 0 ]
  [[ "$output" == *"Unknown"* ]] || [[ "$output" == *"未知参数"* ]]
}
