#!/usr/bin/env bats
# Integration guard for US-REL-003: release.sh must wrap all 5 declared slow
# steps with _spin so a future refactor that drops a wrap site is caught.
#
# release.sh lives in the private roll-meta repo (.roll/ops/release.sh, which
# is gitignored from the public Roll repo). These assertions run only when
# the file is present locally — CI without roll-meta cloned will skip.

setup() {
  RELEASE_SH="${BATS_TEST_DIRNAME}/../../.roll/ops/release.sh"
  [ -f "$RELEASE_SH" ] || skip "release.sh not present (roll-meta repo not checked out)"
}

@test "release.sh: spin setup invoked before any wrap call" {
  # _spin_setup must appear before the first _spin invocation, otherwise FD 3
  # is unbound and spinners write into the void.
  local setup_line spin_line
  setup_line=$(grep -nE '^_spin_setup\b' "$RELEASE_SH" | head -1 | cut -d: -f1)
  spin_line=$(grep -nE '_spin "\[' "$RELEASE_SH" | head -1 | cut -d: -f1)
  [ -n "$setup_line" ]
  [ -n "$spin_line" ]
  [ "$setup_line" -lt "$spin_line" ]
}

@test "release.sh: [1/5] Generating CHANGELOG.md wrap present" {
  grep -qF '_spin "[1/5] Generating CHANGELOG.md (AI)" _run_changelog_and_notes' "$RELEASE_SH"
}

@test "release.sh: [2/5] Rewriting .roll/features.md wrap present" {
  grep -qF '_spin "[2/5] Rewriting .roll/features.md (AI)" _run_features_sync_skill' "$RELEASE_SH"
}

@test "release.sh: [3/5] Pushing to origin wrap present" {
  grep -qF '_spin "[3/5] Pushing to origin"' "$RELEASE_SH"
}

@test "release.sh: [4/5] Syncing roll-meta wrap present" {
  grep -qF '_spin "[4/5] Syncing roll-meta"' "$RELEASE_SH"
}

@test "release.sh: [5/5] Checking npm registry wrap present" {
  grep -qF '_spin "[5/5] Checking npm registry"' "$RELEASE_SH"
}

@test "release.sh: npm publish is intentionally NOT spinner-wrapped" {
  # npm publish has its own upload progress bar; wrapping it would hide that.
  ! grep -qE '_spin\s+"[^"]*"\s+.*npm\s+publish' "$RELEASE_SH"
}

@test "release.sh: total-elapsed footer present" {
  grep -qF '✅ Released ${TAG} (total $(( SECONDS - _RELEASE_START_SECONDS ))s)' "$RELEASE_SH"
}

@test "release.sh: redundant manual status echoes removed" {
  # These echo lines duplicated the spinner labels post-US-REL-003.
  ! grep -qE 'echo "Syncing CHANGELOG\.md and generating release notes' "$RELEASE_SH"
  ! grep -qE 'echo "Rewriting \.roll/features\.md via' "$RELEASE_SH"
  ! grep -qE 'echo "release_notes\.txt generated\."' "$RELEASE_SH"
}
