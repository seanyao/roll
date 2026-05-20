#!/usr/bin/env bats
# US-ONBOARD-019: roll init writes a .roll/.version stamp so legacy-Roll
# detection can rely on a positive Roll-onboarded signal rather than guessing
# from directory names (which misfires on non-Roll projects that happen to
# have BACKLOG.md / docs/features/ from another tool).

load helpers
setup()    { unit_setup_cd; }
teardown() { unit_teardown_cd; }

# ─── _write_version_stamp ─────────────────────────────────────────────────────

@test "_write_version_stamp: creates .roll/.version with roll_version + installed_at" {
  run _write_version_stamp "$PWD"
  [ "$status" -eq 0 ]
  [ -f "$PWD/.roll/.version" ]
  grep -q "^roll_version:" "$PWD/.roll/.version"
  grep -q "^installed_at:" "$PWD/.roll/.version"
}

@test "_write_version_stamp: roll_version matches current VERSION" {
  run _write_version_stamp "$PWD"
  [ "$status" -eq 0 ]
  grep -q "^roll_version: \"${VERSION}\"" "$PWD/.roll/.version"
}

@test "_write_version_stamp: installed_at is an ISO-8601 UTC timestamp" {
  run _write_version_stamp "$PWD"
  [ "$status" -eq 0 ]
  local ts
  ts=$(grep "^installed_at:" "$PWD/.roll/.version" | sed -E 's/^installed_at: "([^"]+)"/\1/')
  [[ "$ts" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]
}

@test "_write_version_stamp: idempotent — preserves original timestamp on re-run" {
  run _write_version_stamp "$PWD"
  [ "$status" -eq 0 ]
  local first_content
  first_content=$(cat "$PWD/.roll/.version")
  # Sleep enough to guarantee a different second-resolution timestamp if
  # re-written; idempotence means the file must NOT change.
  sleep 1
  run _write_version_stamp "$PWD"
  [ "$status" -eq 0 ]
  local second_content
  second_content=$(cat "$PWD/.roll/.version")
  [ "$first_content" = "$second_content" ]
}

@test "_write_version_stamp: creates .roll/ if missing" {
  [ ! -d "$PWD/.roll" ]
  run _write_version_stamp "$PWD"
  [ "$status" -eq 0 ]
  [ -d "$PWD/.roll" ]
  [ -f "$PWD/.roll/.version" ]
}

# ─── _has_roll_signature ─────────────────────────────────────────────────────
# Decides whether legacy-path markers (BACKLOG.md / docs/features/ etc.) in
# the absence of .roll/ actually came from a previous Roll install (legitimate
# migration candidate) vs. a coincidence from another tool (must not block).

@test "_has_roll_signature: empty directory returns false" {
  run _has_roll_signature "$PWD"
  [ "$status" -ne 0 ]
}

@test "_has_roll_signature: .roll/.version stamp alone returns true" {
  mkdir -p .roll
  cat > .roll/.version <<EOF
roll_version: "2026.521.2"
installed_at: "2026-05-21T00:00:00Z"
EOF
  run _has_roll_signature "$PWD"
  [ "$status" -eq 0 ]
}

@test "_has_roll_signature: BACKLOG.md with Roll Story table is a positive signal" {
  cat > BACKLOG.md <<'EOF'
# Project Backlog

## Epic: Initial Setup
| Story | Description | Status |
|-------|-------------|--------|
| US-001 | bootstrap | Done |
EOF
  run _has_roll_signature "$PWD"
  [ "$status" -eq 0 ]
}

@test "_has_roll_signature: BACKLOG.md with arbitrary text is NOT a Roll signal" {
  # The whole point of US-ONBOARD-019: a non-Roll BACKLOG.md (e.g. from Jira
  # export, Trello dump, or a different tool) must not be flagged as Roll.
  cat > BACKLOG.md <<'EOF'
# My team backlog
- TASK-1: write spec
- TASK-2: ship feature
EOF
  run _has_roll_signature "$PWD"
  [ "$status" -ne 0 ]
}

@test "_has_roll_signature: PROPOSALS.md with Roll-style heading is positive" {
  cat > PROPOSALS.md <<'EOF'
# Proposals

## Proposal P-001: example
Details here.
EOF
  run _has_roll_signature "$PWD"
  [ "$status" -eq 0 ]
}

@test "_has_roll_signature: PROPOSALS.md with non-Roll content is NOT a signal" {
  echo "random text from another tool" > PROPOSALS.md
  run _has_roll_signature "$PWD"
  [ "$status" -ne 0 ]
}

@test "_has_roll_signature: docs/features/ with Roll-named files is positive" {
  mkdir -p docs/features
  echo "# feature" > docs/features/US-001-bootstrap.md
  run _has_roll_signature "$PWD"
  [ "$status" -eq 0 ]
}

@test "_has_roll_signature: docs/features/ without Roll-named files is NOT a signal" {
  # A generic docs/features/ folder (e.g., product docs site) with arbitrary
  # filenames must not be flagged.
  mkdir -p docs/features
  echo "# auth" > docs/features/authentication.md
  echo "# billing" > docs/features/billing.md
  run _has_roll_signature "$PWD"
  [ "$status" -ne 0 ]
}

@test "_has_roll_signature: docs/dream/ directory existence is a Roll signal" {
  # docs/dream/ is Roll-1.x-specific (used by $roll-.dream output)
  mkdir -p docs/dream
  echo "x" > docs/dream/2025-01-01.md
  run _has_roll_signature "$PWD"
  [ "$status" -eq 0 ]
}

@test "_has_roll_signature: docs/briefs/ directory existence is a Roll signal" {
  mkdir -p docs/briefs
  echo "x" > docs/briefs/2025-01-01.md
  run _has_roll_signature "$PWD"
  [ "$status" -eq 0 ]
}
