#!/usr/bin/env bats
# US-REL-004: release-notes generation — gather the CHANGELOG `## Unreleased`
# section so it can be reviewed/edited ahead of release, decoupling notes
# generation from the release script's critical path.

setup() {
  source "${BATS_TEST_DIRNAME}/../../bin/roll"
  TEST_TMP="$(mktemp -d)"
}
teardown() { rm -rf "${TEST_TMP:-}"; }

@test "_release_notes_gather: extracts only the Unreleased section body" {
  local cl="${TEST_TMP}/CHANGELOG.md"
  cat > "$cl" <<'EOF'
# Changelog

## Unreleased

### Added
- thing one
- thing two

## v2026.529.5

### Added
- old thing
EOF
  run _release_notes_gather "$cl"
  [ "$status" -eq 0 ]
  [[ "$output" == *"thing one"* ]]
  [[ "$output" == *"thing two"* ]]
  [[ "$output" != *"old thing"* ]]
}

@test "_release_notes_gather: missing file returns non-zero" {
  run _release_notes_gather "${TEST_TMP}/nope.md"
  [ "$status" -ne 0 ]
}

@test "_release_notes_gather: empty Unreleased yields empty body" {
  local cl="${TEST_TMP}/CHANGELOG.md"
  printf '# Changelog\n\n## Unreleased\n\n## v1\n\n- x\n' > "$cl"
  run _release_notes_gather "$cl"
  [ "$status" -eq 0 ]
  [ -z "$(printf '%s' "$output" | tr -d '[:space:]')" ]
}
