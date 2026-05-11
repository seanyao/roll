#!/usr/bin/env bats
# Tests for _promote_unreleased — release.sh promotes ## Unreleased to ## v<VERSION>
# (FIX-019: release.sh is the sole authority on version numbers)

RELEASE_SH="${BATS_TEST_DIRNAME}/../../scripts/release.sh"

setup() {
  _tmp=$(mktemp -d)
  _orig_dir="$PWD"
  cd "$_tmp"
}

teardown() {
  cd "$_orig_dir"
  rm -rf "$_tmp"
}

@test "release.sh is sourceable without executing main" {
  run bash -c "source '$RELEASE_SH' && type _promote_unreleased | head -1"
  [ "$status" -eq 0 ]
  [[ "$output" == *"_promote_unreleased is a function"* ]]
}

@test "_promote_unreleased: replaces '## Unreleased' with '## v<VERSION>'" {
  cat > CHANGELOG.md <<'EOF'
# Changelog

## Unreleased
- **Added**: foo
- **Fixed**: bar

## v2026.511.7
- old stuff
EOF
  bash -c "source '$RELEASE_SH' && _promote_unreleased '2026.999.1' '$_tmp/CHANGELOG.md'"
  grep -q '^## v2026.999.1$' CHANGELOG.md
  ! grep -q '^## Unreleased' CHANGELOG.md
}

@test "_promote_unreleased: preserves bullets under the promoted section" {
  cat > CHANGELOG.md <<'EOF'
# Changelog

## Unreleased
- **Added**: alpha
- **Fixed**: beta
- **Improved**: gamma

## v2026.511.7
- old
EOF
  bash -c "source '$RELEASE_SH' && _promote_unreleased '2026.999.2' '$_tmp/CHANGELOG.md'"
  grep -q 'alpha' CHANGELOG.md
  grep -q 'beta' CHANGELOG.md
  grep -q 'gamma' CHANGELOG.md
}

@test "_promote_unreleased: no-op when Unreleased section missing" {
  cat > CHANGELOG.md <<'EOF'
# Changelog

## v2026.511.7
- old
EOF
  local before; before=$(cat CHANGELOG.md)
  bash -c "source '$RELEASE_SH' && _promote_unreleased '2026.999.3' '$_tmp/CHANGELOG.md'"
  local after; after=$(cat CHANGELOG.md)
  [ "$before" = "$after" ]
}

@test "_promote_unreleased: no-op when file missing (no crash)" {
  bash -c "source '$RELEASE_SH' && _promote_unreleased '2026.999.4' '$_tmp/does-not-exist.md'"
}

@test "_promote_unreleased: handles single Unreleased line (no bullets)" {
  cat > CHANGELOG.md <<'EOF'
# Changelog

## Unreleased

## v2026.511.7
- old
EOF
  bash -c "source '$RELEASE_SH' && _promote_unreleased '2026.999.5' '$_tmp/CHANGELOG.md'"
  grep -q '^## v2026.999.5$' CHANGELOG.md
  ! grep -q '^## Unreleased' CHANGELOG.md
}

@test "_ensure_unreleased: inserts empty ## Unreleased section when missing" {
  cat > CHANGELOG.md <<'EOF'
# Changelog

## v2026.511.7
- old
EOF
  bash -c "source '$RELEASE_SH' && _ensure_unreleased '$_tmp/CHANGELOG.md'"
  grep -q '^## Unreleased$' CHANGELOG.md
  # Unreleased must appear before the latest released section
  local urel_line vrel_line
  urel_line=$(grep -n '^## Unreleased$' CHANGELOG.md | head -1 | cut -d: -f1)
  vrel_line=$(grep -n '^## v2026.511.7$' CHANGELOG.md | head -1 | cut -d: -f1)
  [ "$urel_line" -lt "$vrel_line" ]
}

@test "_ensure_unreleased: leaves file alone if Unreleased already exists" {
  cat > CHANGELOG.md <<'EOF'
# Changelog

## Unreleased
- **Added**: foo

## v2026.511.7
- old
EOF
  local before; before=$(cat CHANGELOG.md)
  bash -c "source '$RELEASE_SH' && _ensure_unreleased '$_tmp/CHANGELOG.md'"
  local after; after=$(cat CHANGELOG.md)
  [ "$before" = "$after" ]
  # foo bullet still there
  grep -q 'foo' CHANGELOG.md
}
