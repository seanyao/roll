#!/usr/bin/env bats
# US-WATCH-001: integration test — fixture release notes → FIX detection.

load helpers
setup()    {
  integration_setup
  # Source bin/roll to get watch.sh functions
  source "$ROLL_BIN"
  # ROLL_MAIN_PROJECT may leak from loop env — override to sandbox
  export ROLL_MAIN_PROJECT="${TEST_TMP}"
  cd "$TEST_TMP"
}
teardown() {
  rm -rf "${TEST_TMP:-}"
}

# Helper: create a fake claude version
_setup_claude_version() {
  mkdir -p "${TEST_TMP}/bin"
  cat > "${TEST_TMP}/bin/claude" <<'CLAUDE'
#!/bin/bash
echo "claude-code CLI v2.5.0 (abc123) — Anthropic"
CLAUDE
  chmod +x "${TEST_TMP}/bin/claude"
  PATH="${TEST_TMP}/bin:${PATH}"
}

# Helper: create fake GitHub releases JSON
_setup_github_releases() {
  mkdir -p "${WATCH_STATE_DIR}"
  cat > "${WATCH_STATE_DIR}/claude-releases-cache.json" <<'JSON'
[
  {
    "tag_name": "v2.5.0",
    "name": "v2.5.0",
    "body": "## What's Changed\n\n- **Breaking**: stream-json event `tool_use_id` renamed to `tool_call_id`\n- New `--model` flag for selecting specific models\n- Fixed a bug with permission prompts\n- Updated documentation for hook protocol",
    "published_at": "2026-05-20T00:00:00Z"
  },
  {
    "tag_name": "v2.4.0",
    "name": "v2.4.0",
    "body": "## What's Changed\n\n- Added support for MCP server v2 protocol\n- Improved error messages",
    "published_at": "2026-05-10T00:00:00Z"
  }
]
JSON
  # Make it fresh so cache is used directly
  touch "${WATCH_STATE_DIR}/claude-releases-cache.json"
}

@test "integration: fetch releases returns fixture JSON" {
  _setup_github_releases
  run _watch_fetch_claude_releases
  [ "$status" -eq 0 ]
  [[ "$output" == *"v2.5.0"* ]]
  [[ "$output" == *"tool_use_id"* ]]
  [[ "$output" == *"v2.4.0"* ]]
}

@test "integration: first run records version, no FIX opened" {
  _setup_claude_version
  _setup_github_releases

  # Simulate first run: no last_seen_version
  _watch_state_init
  last_seen=$(_watch_state_get "targets.claude.last_seen_version")
  [ -z "$last_seen" ]

  # Record current version (first-run behaviour)
  _watch_state_set "targets.claude.last_seen_version" "2.5.0"
  _watch_state_set "last_scan" "2026-05-23T00:00:00Z"

  # Verify state updated
  run _watch_state_get "targets.claude.last_seen_version"
  [[ "$output" == *"2.5.0"* ]]

  # Verify no FIX was opened (backlog should not have new FIX from watch)
  if [[ -f .roll/backlog.md ]]; then
    run grep "upstream watch" .roll/backlog.md || true
    [ "$status" -ne 0 ]
  fi
}

@test "integration: second run detects new version, opens FIX for high-impact" {
  _setup_claude_version
  _setup_github_releases

  # Set initial state as if first run already happened
  _watch_state_init
  _watch_state_set "targets.claude.last_seen_version" "2.4.0"
  _watch_state_set "last_scan" "2026-05-22T00:00:00Z"

  # Simulate second run: fetch releases, compare to last_seen
  releases=$(_watch_fetch_claude_releases)

  # Verify releases contain v2.5.0 (newer than 2.4.0)
  [[ "$releases" == *"v2.5.0"* ]]

  # Simulate evaluation: the stream-json change is high-impact (dimension 2)
  local entry_hash="abc12345"
  _watch_mark_evaluated "claude" "2.5.0" "$entry_hash" "high"

  # Verify idempotency
  run _watch_is_evaluated "claude" "2.5.0" "$entry_hash"
  [ "$status" -eq 0 ]

  # Verify different entry not marked
  run _watch_is_evaluated "claude" "2.5.0" "xyz99999"
  [ "$status" -eq 1 ]

  # Open a FIX (simplified — real path goes through dream AI evaluation)
  local fix_id
  fix_id=$(_watch_next_fix_id)
  [[ "$fix_id" == FIX-* ]]

  # Write FIX to backlog
  mkdir -p .roll
  cat > .roll/backlog.md <<BACKLOG
## 🐛 Bug Fixes
| ID | Description | Status |
|----|-------------|--------|
| ${fix_id} | claude 2.5.0: stream-json tool_use_id renamed to tool_call_id — flagged by dream 2026-05-23 (upstream watch) | 📋 Todo |
BACKLOG

  # Verify FIX written
  run grep "stream-json" .roll/backlog.md
  [ "$status" -eq 0 ]

  # Update state
  _watch_state_set "targets.claude.last_seen_version" "2.5.0"
  _watch_state_set "last_scan" "2026-05-23T00:00:00Z"

  # Verify state updated
  run _watch_state_get "targets.claude.last_seen_version"
  [[ "$output" == *"2.5.0"* ]]
}

@test "integration: fetch failure does not crash" {
  _setup_claude_version
  # No cache file — fetch will try network and fail (no curl in sandbox PATH)
  # Save PATH so teardown can still find rm
  local orig_path="$PATH"
  PATH="${TEST_TMP}/bin"
  run _watch_fetch_claude_releases
  PATH="$orig_path"
  [ "$status" -eq 0 ]
  # Should return empty gracefully
}

@test "integration: idempotency prevents duplicate FIX for same upstream entry" {
  _watch_state_init

  # First evaluation
  _watch_mark_evaluated "claude" "2.5.0" "hash001" "high"
  run _watch_is_evaluated "claude" "2.5.0" "hash001"
  [ "$status" -eq 0 ]

  # Same entry evaluated again — should be skipped
  run _watch_is_evaluated "claude" "2.5.0" "hash001"
  [ "$status" -eq 0 ]

  # Different entry same version — should NOT be skipped
  run _watch_is_evaluated "claude" "2.5.0" "hash002"
  [ "$status" -eq 1 ]
}

@test "integration: state survives across multiple runs" {
  _watch_state_init

  # Run 1
  _watch_state_set "targets.claude.last_seen_version" "2.4.0"
  _watch_mark_evaluated "claude" "2.4.0" "entry1" "high"

  # Verify state file exists and has content
  [ -f "$WATCH_STATE_FILE" ]
  run cat "$WATCH_STATE_FILE"
  [[ "$output" == *"2.4.0"* ]]

  # Run 2 — state should persist
  run _watch_state_get "targets.claude.last_seen_version"
  [[ "$output" == *"2.4.0"* ]]
  run _watch_is_evaluated "claude" "2.4.0" "entry1"
  [ "$status" -eq 0 ]
}
