#!/usr/bin/env bats
# US-CONSIST-001: consistency check orchestrator.

setup() {
  REPO_ROOT="$(cd "${BATS_TEST_DIRNAME}/../.." && pwd)"
  cd "$REPO_ROOT"
}

@test "consistency: all pass when features.md catalog is complete" {
  local tmpdir; tmpdir=$(mktemp -d)

  mkdir -p "$tmpdir/.roll"
  cat > "$tmpdir/.roll/backlog.md" <<'EOF'
### Feature: cli-simplification
| Story | Description | Status |
|-------|-------------|--------|
| [US-CLI-001](...) | desc | ✅ Done |

### Feature: feedback-command
| Story | Description | Status |
|-------|-------------|--------|
| [US-FB-001](...) | desc | 📋 Todo |
EOF

  cat > "$tmpdir/.roll/features.md" <<'EOF'
# Features

## cli-simplification
Some description.
EOF

  run python3 lib/consistency_check.py --project-dir "$tmpdir"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Overall: pass"* ]]
  [[ "$output" == *"code: pass"* ]]

  rm -rf "$tmpdir"
}

@test "consistency: reports gap when a Done feature is missing from features.md" {
  local tmpdir; tmpdir=$(mktemp -d)

  mkdir -p "$tmpdir/.roll"
  cat > "$tmpdir/.roll/backlog.md" <<'EOF'
### Feature: present-feature
| Story | Description | Status |
|-------|-------------|--------|
| [US-PRES-001](...) | desc | ✅ Done |

### Feature: missing-feature
| Story | Description | Status |
|-------|-------------|--------|
| [US-MISS-001](...) | desc | ✅ Done |
EOF

  cat > "$tmpdir/.roll/features.md" <<'EOF'
# Features

## present-feature
Some description.
EOF

  run python3 lib/consistency_check.py --project-dir "$tmpdir"
  [ "$status" -eq 1 ]
  [[ "$output" == *"Overall: fail"* ]]
  [[ "$output" == *"missing-feature"* ]]
  [[ "$output" == *"missing from features.md"* ]]

  rm -rf "$tmpdir"
}

@test "consistency: JSON output mode works" {
  local tmpdir; tmpdir=$(mktemp -d)

  mkdir -p "$tmpdir/.roll"
  cat > "$tmpdir/.roll/backlog.md" <<'EOF'
### Feature: test-feature
| Story | Description | Status |
|-------|-------------|--------|
| [US-TEST-001](...) | desc | ✅ Done |
EOF

  cat > "$tmpdir/.roll/features.md" <<'EOF'
# Features

## test-feature
Some description.
EOF

  run python3 lib/consistency_check.py --json --project-dir "$tmpdir"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"overall": "pass"'* ]]
  [[ "$output" == *'"dimensions"'* ]]

  rm -rf "$tmpdir"
}

@test "consistency: reports changelog gap when Done story not in CHANGELOG" {
  local tmpdir; tmpdir=$(mktemp -d)

  mkdir -p "$tmpdir/.roll"
  cat > "$tmpdir/.roll/backlog.md" <<'EOF'
### Feature: test-feature
| Story | Description | Status |
|-------|-------------|--------|
| [US-TEST-001](...) | desc | ✅ Done |
EOF

  cat > "$tmpdir/.roll/features.md" <<'EOF'
# Features

## test-feature
Some description.
EOF

  cat > "$tmpdir/CHANGELOG.md" <<'EOF'
# Changelog

## Unreleased
- some other feature
EOF

  run python3 lib/consistency_check.py --project-dir "$tmpdir"
  [ "$status" -eq 1 ]
  [[ "$output" == *"Overall: fail"* ]]
  [[ "$output" == *"docs: fail"* ]]
  [[ "$output" == *"US-TEST-001"* ]]
  [[ "$output" == *"not referenced in CHANGELOG"* ]]

  rm -rf "$tmpdir"
}

@test "consistency: passes gracefully when backlog or features.md is missing" {
  local tmpdir; tmpdir=$(mktemp -d)

  run python3 lib/consistency_check.py --project-dir "$tmpdir"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Overall: pass"* ]]

  rm -rf "$tmpdir"
}
