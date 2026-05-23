#!/usr/bin/env bats
# FIX-113: roll changelog audit — pre-release coverage check.
# bats tier: fast

load helpers

LIB="${BATS_TEST_DIRNAME}/../../lib"
AUDIT="${LIB}/changelog_audit.py"

setup() {
  unit_setup
  cd "$TEST_TMP"
  git init -q
  git config user.email t@example.com
  git config user.name t
  # Seed a tag
  echo "init" > README.md && git add README.md && git commit -q -m "init"
  git tag v2026.500.1
  # Two merge commits: FIX-A (user-visible), and chore (internal)
  git commit --allow-empty -q -m "FIX-901: dashboard fix something (#101)"
  git commit --allow-empty -q -m "chore: rebase main (#102)"
  git commit --allow-empty -q -m "US-FOO-005: new feature (#103)"
  cat > CHANGELOG.md <<'CL'
# Changelog

## Unreleased

### Added
- new shiny stuff (US-FOO-005)

## v2026.500.1
- initial release
CL
}
teardown() { unit_teardown; }

@test "FIX-113: audit reports user-visible PR not in CHANGELOG (FIX-901)" {
  run python3 "$AUDIT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"FIX-901"* ]]
  [[ "$output" == *"#101"* ]]
}

@test "FIX-113: audit does NOT flag PRs already in CHANGELOG (US-FOO-005)" {
  run python3 "$AUDIT"
  ! [[ "$output" == *"US-FOO-005"* ]]
}

@test "FIX-113: audit skips internal/chore PRs from user-visible flag" {
  run python3 "$AUDIT"
  # chore: rebase has no US/FIX/REFACTOR id → skipped, NOT in missing list
  ! [[ "$output" == *"#102"* ]]
}

@test "FIX-113: --json output is machine-readable" {
  run python3 "$AUDIT" --json
  [ "$status" -eq 0 ]
  echo "$output" | python3 -c "import sys, json; d=json.load(sys.stdin); assert d['total_prs']>=2; assert any(m['pr']==101 for m in d['missing_user_visible']); assert not any(m['pr']==103 for m in d['missing_user_visible'])"
}

@test "FIX-113: --since accepts explicit tag override" {
  run python3 "$AUDIT" --since v2026.500.1
  [ "$status" -eq 0 ]
  [[ "$output" == *"v2026.500.1"* ]]
}

@test "FIX-113: clean state (all PRs covered) prints 'audit ok'" {
  # Add FIX-901 entry to CHANGELOG so coverage = 100%
  sed -i.bak '/^- new shiny stuff/a\
- FIX-901 dashboard fix
' CHANGELOG.md
  rm -f CHANGELOG.md.bak
  run python3 "$AUDIT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"audit ok"* ]]
}
