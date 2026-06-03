#!/usr/bin/env bats
# US-CONSIST-002: changelog audit module tests.

setup() {
  REPO_ROOT="$(cd "${BATS_TEST_DIRNAME}/../.." && pwd)"
  cd "$REPO_ROOT"
}

@test "changelog_audit: all covered when every Done story is in CHANGELOG" {
  local tmpdir; tmpdir=$(mktemp -d)

  cat > "$tmpdir/CHANGELOG.md" <<'EOF'
# Changelog

## Unreleased
- some feature（US-T1-001）
- another feature（US-T1-002）
EOF

  run python3 -c "
import sys
sys.path.insert(0, 'lib')
from changelog_audit import check_changelog_coverage
from pathlib import Path
result = check_changelog_coverage(
    {'feat-a': ['US-T1-001', 'US-T1-002']},
    Path('$tmpdir/CHANGELOG.md'),
)
print(result['status'])
print('---')
for g in result['gaps']:
    print(g)
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"pass"* ]]

  rm -rf "$tmpdir"
}

@test "changelog_audit: reports gap when Done story missing from CHANGELOG" {
  local tmpdir; tmpdir=$(mktemp -d)

  cat > "$tmpdir/CHANGELOG.md" <<'EOF'
# Changelog

## Unreleased
- some feature（US-T1-001）
EOF

  run python3 -c "
import sys
sys.path.insert(0, 'lib')
from changelog_audit import check_changelog_coverage
from pathlib import Path
result = check_changelog_coverage(
    {'feat-a': ['US-T1-001', 'US-T1-002']},
    Path('$tmpdir/CHANGELOG.md'),
)
print(result['status'])
print('---')
for g in result['gaps']:
    print(g)
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"fail"* ]]
  [[ "$output" == *"US-T1-002"* ]]
  [[ "$output" == *"not referenced in CHANGELOG"* ]]

  rm -rf "$tmpdir"
}

@test "changelog_audit: passes when CHANGELOG.md is missing" {
  local tmpdir; tmpdir=$(mktemp -d)

  run python3 -c "
import sys
sys.path.insert(0, 'lib')
from changelog_audit import check_changelog_coverage
from pathlib import Path
result = check_changelog_coverage(
    {'feat-a': ['US-T1-001']},
    Path('$tmpdir/CHANGELOG.md'),
)
print(result['status'])
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"pass"* ]]

  rm -rf "$tmpdir"
}

@test "changelog_audit: features_md coverage detects missing feature" {
  local tmpdir; tmpdir=$(mktemp -d)

  cat > "$tmpdir/features.md" <<'EOF'
# Features

## present-feature
desc
EOF

  run python3 -c "
import sys
sys.path.insert(0, 'lib')
from changelog_audit import check_features_md_coverage
from pathlib import Path
result = check_features_md_coverage(
    {'present-feature': ['US-P-001'], 'missing-feature': ['US-M-001']},
    Path('$tmpdir/features.md'),
)
print(result['status'])
print('---')
for g in result['gaps']:
    print(g)
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"fail"* ]]
  [[ "$output" == *"missing-feature"* ]]
  [[ "$output" == *"missing from features.md"* ]]

  rm -rf "$tmpdir"
}

@test "changelog_audit: guide_doc reports gap when feature not in guide" {
  local tmpdir; tmpdir=$(mktemp -d)

  mkdir -p "$tmpdir/guide/en"
  cat > "$tmpdir/guide/en/overview.md" <<'EOF'
# Overview
This is about present-feature.
EOF

  run python3 -c "
import sys
sys.path.insert(0, 'lib')
from changelog_audit import check_guide_doc_coverage
from pathlib import Path
result = check_guide_doc_coverage(
    {'present-feature': ['US-P-001'], 'missing-feature': ['US-M-001']},
    Path('$tmpdir/guide/en'),
)
print(result['status'])
print('---')
for g in result['gaps']:
    print(g)
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"fail"* ]]
  [[ "$output" == *"missing-feature"* ]]
  [[ "$output" == *"no guide documentation"* ]]

  rm -rf "$tmpdir"
}

@test "changelog_audit: guide_doc passes when guide dir missing" {
  local tmpdir; tmpdir=$(mktemp -d)

  run python3 -c "
import sys
sys.path.insert(0, 'lib')
from changelog_audit import check_guide_doc_coverage
from pathlib import Path
result = check_guide_doc_coverage(
    {'feat-a': ['US-T1-001']},
    Path('$tmpdir/guide/en'),
)
print(result['status'])
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"pass"* ]]

  rm -rf "$tmpdir"
}
