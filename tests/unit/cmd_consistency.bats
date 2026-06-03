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

@test "consistency: passes gracefully when backlog or features.md is missing" {
  local tmpdir; tmpdir=$(mktemp -d)

  run python3 lib/consistency_check.py --project-dir "$tmpdir"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Overall: pass"* ]]

  rm -rf "$tmpdir"
}

# ── US-CONSIST-003: i18n dimension ──

@test "consistency: i18n reports gap when guide/zh file is missing" {
  local tmpdir; tmpdir=$(mktemp -d)

  mkdir -p "$tmpdir/guide/en"
  mkdir -p "$tmpdir/guide/zh"
  echo "# Test" > "$tmpdir/guide/en/loop.md"
  echo "# Test" > "$tmpdir/guide/zh/loop.md"
  echo "# Test" > "$tmpdir/guide/en/consistency.md"
  # consistency.md missing from guide/zh

  run python3 lib/consistency_check.py --json --project-dir "$tmpdir"
  [ "$status" -eq 1 ]
  [[ "$output" == *'"overall": "fail"'* ]]
  [[ "$output" == *'"i18n"'* ]]
  [[ "$output" == *'"status": "fail"'* ]]
  [[ "$output" == *'consistency.md'* ]]

  rm -rf "$tmpdir"
}

@test "consistency: i18n reports gap when i18n key is missing ZH" {
  local tmpdir; tmpdir=$(mktemp -d)

  mkdir -p "$tmpdir/lib/i18n"
  cat > "$tmpdir/lib/i18n/loop.sh" <<'IEOF'
_i18n_set en loop.hello "Hello"
_i18n_set zh loop.hello "你好"
_i18n_set en loop.goodbye "Goodbye"
# missing ZH for loop.goodbye
IEOF
  cat > "$tmpdir/lib/i18n/setup.sh" <<'IEOF'
_i18n_set en setup.start "Starting"
_i18n_set zh setup.start "开始"
IEOF

  run python3 lib/consistency_check.py --json --project-dir "$tmpdir"
  [ "$status" -eq 1 ]
  [[ "$output" == *'"overall": "fail"'* ]]
  [[ "$output" == *'"i18n"'* ]]
  [[ "$output" == *'"status": "fail"'* ]]
  [[ "$output" == *'loop.goodbye'* ]]

  rm -rf "$tmpdir"
}

@test "consistency: i18n passes when guide files and i18n keys are all paired" {
  local tmpdir; tmpdir=$(mktemp -d)

  mkdir -p "$tmpdir/guide/en"
  mkdir -p "$tmpdir/guide/zh"
  echo "# Test" > "$tmpdir/guide/en/loop.md"
  echo "# Test" > "$tmpdir/guide/zh/loop.md"
  echo "# Test" > "$tmpdir/guide/en/skills.md"
  echo "# Test" > "$tmpdir/guide/zh/skills.md"

  mkdir -p "$tmpdir/lib/i18n"
  cat > "$tmpdir/lib/i18n/loop.sh" <<'IEOF'
_i18n_set en loop.hello "Hello"
_i18n_set zh loop.hello "你好"
IEOF

  run python3 lib/consistency_check.py --json --project-dir "$tmpdir"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"overall": "pass"'* ]]
  [[ "$output" == *'"i18n"'* ]]
  [[ "$output" == *'"status": "pass"'* ]]

  rm -rf "$tmpdir"
}
