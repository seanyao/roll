#!/usr/bin/env bats
# REFACTOR-041: backlog description linter. Detects file paths / function
# names / filenames / inline code that the global convention bans in
# .roll/backlog.md descriptions. Phase 1: warn-only (always exit 0).

load helpers
setup()    { unit_setup_cd; }
teardown() { unit_teardown_cd; }

_seed_backlog_clean() {
  mkdir -p .roll
  cat > .roll/backlog.md <<'BACKLOG'
| Story | Description | Status |
|-------|-------------|--------|
| US-X-001 | give users a daily summary mail at 09:00 local time | 📋 Todo |
| FIX-100  | session token cleanup forgets a stale entry after logout | 📋 Todo |
BACKLOG
}

_seed_backlog_dirty() {
  mkdir -p .roll
  cat > .roll/backlog.md <<'BACKLOG'
| Story | Description | Status |
|-------|-------------|--------|
| US-PATH-001 | refactor src/api/handlers/user.ts to use new auth | 📋 Todo |
| US-FUNC-002 | call _check_auth_token() before opening session | 📋 Todo |
| US-FILE-003 | rename release.sh to publish.sh | 📋 Todo |
| US-OK-004   | give users a daily summary mail at 09:00 local time | 📋 Todo |
BACKLOG
}

@test "_backlog_lint: clean backlog reports no violations" {
  _seed_backlog_clean
  run _backlog_lint .roll/backlog.md
  [ "$status" -eq 0 ]
  [[ "$output" == *"No violations"* ]]
}

@test "_backlog_lint: detects file paths in descriptions" {
  _seed_backlog_dirty
  run _backlog_lint .roll/backlog.md
  [ "$status" -eq 0 ]
  [[ "$output" == *"US-PATH-001"* ]]
  [[ "$output" == *"path"* ]]
}

@test "_backlog_lint: detects function names in descriptions" {
  _seed_backlog_dirty
  run _backlog_lint .roll/backlog.md
  [[ "$output" == *"US-FUNC-002"* ]]
  [[ "$output" == *"function"* ]]
}

@test "_backlog_lint: detects filenames in descriptions" {
  _seed_backlog_dirty
  run _backlog_lint .roll/backlog.md
  [[ "$output" == *"US-FILE-003"* ]]
  [[ "$output" == *"filename"* ]]
}

@test "_backlog_lint: leaves clean rows alone in a mixed backlog" {
  _seed_backlog_dirty
  run _backlog_lint .roll/backlog.md
  # The clean US-OK-004 row should never appear as a violation
  ! grep -q 'US-OK-004' <<< "$output" || [ "${BASH_REMATCH[0]:-}" != "$output" ]
  [[ "$output" != *"US-OK-004: backlog description"* ]]
}

@test "_backlog_lint: counts violations correctly" {
  _seed_backlog_dirty
  run _backlog_lint .roll/backlog.md
  [[ "$output" == *"3 violation(s)"* ]]
}

@test "_backlog_lint: phase 1 always returns 0 even when violations exist" {
  _seed_backlog_dirty
  run _backlog_lint .roll/backlog.md
  [ "$status" -eq 0 ]
}

@test "_backlog_lint: errors when backlog file is missing" {
  err() { echo "ERR: $*" >&2; }
  run _backlog_lint /does/not/exist.md
  [ "$status" -ne 0 ]
}

@test "cmd_backlog lint: routes to the linter" {
  _seed_backlog_dirty
  err() { echo "ERR: $*" >&2; }
  run cmd_backlog lint
  [ "$status" -eq 0 ]
  [[ "$output" == *"violation"* ]]
}

# ─── FIX-102: length + code-fence rules + --gate flag ──────────────────────

@test "FIX-102: _backlog_lint detects rows longer than 120 chars" {
  mkdir -p .roll
  cat > .roll/backlog.md <<'MD'
# Backlog

## Epic: Test
### Feature: t
| Story | Description | Status |
|-------|-------------|--------|
| FIX-LONG | this is a deliberately verbose human sentence that drones on far beyond a reasonable backlog index row length and crosses the 120 char threshold without using jargon | 📋 Todo |
MD
  run _backlog_lint .roll/backlog.md
  [[ "$output" == *"FIX-LONG"* ]]
  [[ "$output" == *"length"* ]]
}

@test "FIX-102: _backlog_lint detects backtick code fence in descriptions" {
  mkdir -p .roll
  cat > .roll/backlog.md <<'MD'
# Backlog

## Epic: Test
### Feature: t
| Story | Description | Status |
|-------|-------------|--------|
| FIX-TICK | description mentions a command in backticks | 📋 Todo |
MD
  # Add a backtick row separately (heredoc with literal backticks needs care).
  printf '| FIX-TICK2 | %s | %s |\n' '`some command` is mentioned here' '📋 Todo' >> .roll/backlog.md
  run _backlog_lint .roll/backlog.md
  [[ "$output" == *"FIX-TICK2"* ]]
  [[ "$output" == *"code-fence"* ]]
}

@test "FIX-102: --gate flag flips warn-only to hard-fail" {
  _seed_backlog_dirty
  err() { echo "ERR: $*" >&2; }
  # Without --gate: returns 0 (phase 1 default)
  run _backlog_lint .roll/backlog.md
  [ "$status" -eq 0 ]
  # With --gate: returns 1
  run _backlog_lint --gate .roll/backlog.md
  [ "$status" -eq 1 ]
}

@test "FIX-102: --gate returns 0 when no violations" {
  mkdir -p .roll
  cat > .roll/backlog.md <<'MD'
# Backlog

## Epic: Test
### Feature: t
| Story | Description | Status |
|-------|-------------|--------|
| FIX-OK | 用户能看懂的一句人话 | 📋 Todo |
MD
  err() { echo "ERR: $*" >&2; }
  run _backlog_lint --gate .roll/backlog.md
  [ "$status" -eq 0 ]
}

@test "FIX-102: cmd_backlog lint forwards --gate flag" {
  _seed_backlog_dirty
  err() { echo "ERR: $*" >&2; }
  run cmd_backlog lint --gate
  [ "$status" -eq 1 ]
  [[ "$output" == *"--gate enabled"* ]]
}
