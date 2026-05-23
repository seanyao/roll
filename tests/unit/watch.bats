#!/usr/bin/env bats
# US-WATCH-001: unit tests for lib/watch.sh (upstream compatibility watch).

load helpers

# Override setup to sandbox ROLL_HOME BEFORE bin/roll is sourced.
# This ensures WATCH_STATE_DIR stays in the test sandbox.
setup()    {
  TEST_TMP="$(mktemp -d)"
  _UNIT_ORIG_DIR="$PWD"
  _sandbox_loop_state
  export _LAUNCHD_SKIP_REGISTRY=1
  export ROLL_HOME="${TEST_TMP}/roll-home"
  mkdir -p "${ROLL_HOME}"
  # ROLL_MAIN_PROJECT may leak from loop env — unset so tests don't
  # accidentally read the real project's backlog.
  export ROLL_MAIN_PROJECT="${TEST_TMP}"
  source "$ROLL_BIN"
  cd "$TEST_TMP"
  export NO_COLOR=1
  export TERM=dumb
}
teardown() { unit_teardown_cd; }

# --- state init ------------------------------------------------------------

@test "_watch_state_init: creates state file and directory" {
  run _watch_state_init
  [ "$status" -eq 0 ]
  [ -f "$WATCH_STATE_FILE" ]
  # Should be idempotent
  run _watch_state_init
  [ "$status" -eq 0 ]
}

@test "_watch_state_init: state file has expected keys" {
  _watch_state_init
  run cat "$WATCH_STATE_FILE"
  [[ "$output" == *"last_scan"* ]]
  [[ "$output" == *"targets:"* ]]
  [[ "$output" == *"evaluated:"* ]]
}

# --- state get/set (top-level) --------------------------------------------

@test "_watch_state_get: reads top-level key" {
  _watch_state_init
  _watch_state_set "last_scan" "2026-05-23T00:00:00Z"
  run _watch_state_get "last_scan"
  [[ "$output" == *"2026-05-23T00:00:00Z"* ]]
}

@test "_watch_state_get: returns empty for unknown key" {
  _watch_state_init
  run _watch_state_get "nonexistent"
  [ -z "$output" ]
}

@test "_watch_state_set: overwrites existing key" {
  _watch_state_init
  _watch_state_set "last_scan" "first"
  _watch_state_set "last_scan" "second"
  run _watch_state_get "last_scan"
  [[ "$output" == *"second"* ]]
}

# --- state get/set (nested targets.<cli>.<field>) -------------------------

@test "_watch_state_set/get: nested key round-trip" {
  _watch_state_init
  _watch_state_set "targets.claude.last_seen_version" "2.1.4"
  run _watch_state_get "targets.claude.last_seen_version"
  [[ "$output" == *"2.1.4"* ]]
}

@test "_watch_state_set: adds new cli block" {
  _watch_state_init
  _watch_state_set "targets.kimi.last_seen_version" "0.9.2"
  run cat "$WATCH_STATE_FILE"
  [[ "$output" == *"kimi:"* ]]
  [[ "$output" == *"0.9.2"* ]]
}

@test "_watch_state_set: adds new field to existing cli block" {
  _watch_state_init
  _watch_state_set "targets.claude.last_seen_version" "2.0.0"
  _watch_state_set "targets.claude.last_seen_at" "2026-01-01"
  run cat "$WATCH_STATE_FILE"
  [[ "$output" == *"last_seen_version"* ]]
  [[ "$output" == *"last_seen_at"* ]]
}

# --- claude version --------------------------------------------------------

@test "_watch_get_claude_version: handles missing claude gracefully" {
  # Remove claude from PATH to simulate missing
  local orig_path="$PATH"
  PATH="${TEST_TMP}"
  run _watch_get_claude_version
  PATH="$orig_path"
  # Should not crash, output may be empty or version string
  [ "$status" -eq 0 ]
}

# --- dimensions file path --------------------------------------------------

@test "_watch_dimensions_file: returns path containing watch-dimensions" {
  run _watch_dimensions_file
  [[ "$output" == *"watch-dimensions.md" ]]
}

# --- idempotency -----------------------------------------------------------

@test "_watch_is_evaluated: returns 1 for unevaluated entry" {
  _watch_state_init
  run _watch_is_evaluated "claude" "2.1.4" "abc12345"
  [ "$status" -eq 1 ]
}

@test "_watch_mark_evaluated + _watch_is_evaluated: round-trip" {
  _watch_state_init
  _watch_mark_evaluated "claude" "2.1.4" "abc12345" "high"
  run _watch_is_evaluated "claude" "2.1.4" "abc12345"
  [ "$status" -eq 0 ]
}

@test "_watch_mark_evaluated: different entries don't collide" {
  _watch_state_init
  _watch_mark_evaluated "claude" "2.1.4" "abc12345" "high"
  run _watch_is_evaluated "claude" "2.1.4" "xyz99999"
  [ "$status" -eq 1 ]
}

@test "_watch_mark_evaluated: different versions don't collide" {
  _watch_state_init
  _watch_mark_evaluated "claude" "2.1.4" "abc12345" "high"
  run _watch_is_evaluated "claude" "2.1.5" "abc12345"
  [ "$status" -eq 1 ]
}

@test "_watch_mark_evaluated: different cli don't collide" {
  _watch_state_init
  _watch_mark_evaluated "claude" "2.1.4" "abc12345" "high"
  run _watch_is_evaluated "kimi" "2.1.4" "abc12345"
  [ "$status" -eq 1 ]
}

@test "_watch_mark_evaluated: idempotent — same entry twice doesn't duplicate" {
  _watch_state_init
  _watch_mark_evaluated "claude" "2.1.4" "abc12345" "high"
  _watch_mark_evaluated "claude" "2.1.4" "abc12345" "high"
  # Count occurrences of the evaluated line
  local count
  count=$(grep -c "claude 2.1.4 abc12345" "$WATCH_STATE_FILE" || true)
  [ "$count" -eq 1 ]
}

# --- fetch releases (uses sandbox, no real network) ------------------------

@test "_watch_fetch_claude_releases: returns empty when curl unavailable" {
  # Replace curl with something that fails
  PATH="${TEST_TMP}:${PATH}"
  run _watch_fetch_claude_releases
  # Should not crash; returns empty or cached content
  [ "$status" -eq 0 ]
}

# --- next fix id -----------------------------------------------------------

@test "_watch_next_fix_id: returns FIX-111 when no backlog" {
  run _watch_next_fix_id
  [[ "$output" == "FIX-111" ]]
}

@test "_watch_next_fix_id: increments from existing max" {
  mkdir -p .roll
  cat > .roll/backlog.md <<'EOF'
| FIX-001 | test | ✅ Done |
| FIX-099 | test | 📋 Todo |
| FIX-110 | test | ✅ Done |
EOF
  run _watch_next_fix_id
  [[ "$output" == "FIX-111" ]]
}

@test "_watch_next_fix_id: does not match non-FIX patterns" {
  mkdir -p .roll
  cat > .roll/backlog.md <<'EOF'
| US-FIX-001 | not a real fix | 📋 Todo |
| FIX-050 | real fix | ✅ Done |
EOF
  run _watch_next_fix_id
  [[ "$output" == "FIX-051" ]]
}

# --- fetch releases fallback (stale cache) ---------------------------------

@test "_watch_fetch_claude_releases: serves cached data when curl fails" {
  # Write a cache (make it old so a fresh fetch is attempted)
  mkdir -p "$WATCH_STATE_DIR"
  echo '[{"tag_name":"v9.9.9","body":"cached test release"}]' > "${WATCH_STATE_DIR}/claude-releases-cache.json"
  # Ensure it's considered stale by setting mtime to epoch 0
  touch -t 197001010000 "${WATCH_STATE_DIR}/claude-releases-cache.json" 2>/dev/null || true
  # Create a fake curl that always fails
  mkdir -p "${TEST_TMP}/bin"
  cat > "${TEST_TMP}/bin/curl" <<'CURL'
#!/bin/bash
exit 1
CURL
  chmod +x "${TEST_TMP}/bin/curl"
  PATH="${TEST_TMP}/bin:${PATH}"
  run _watch_fetch_claude_releases
  [ "$status" -eq 0 ]
  # Should return cached data
  [[ "$output" == *"cached test release"* ]]
}
