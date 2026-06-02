#!/usr/bin/env bats
# US-REL-005: _release_compute_version_prefix validates MAJOR_VERSION file
# and produces VERSION_PREFIX matching the vMAJOR.MMDD.N scheme.

load helpers
setup() { unit_setup_cd; }
teardown() { unit_teardown_cd; }

RELEASE_SH="${BATS_TEST_DIRNAME}/../../.roll/ops/release.sh"

@test "valid MAJOR_VERSION produces VERSION_PREFIX matching ^[0-9]+\.[0-9]+$" {
  mkdir -p "${TEST_TMP}/.roll/ops"
  printf '2\n' > "${TEST_TMP}/.roll/ops/MAJOR_VERSION"

  run bash -c "
    source '${RELEASE_SH}'
    _release_compute_version_prefix '${TEST_TMP}'
    echo \"\${VERSION_PREFIX}\"
  "
  [ "$status" -eq 0 ]
  [ -n "$output" ]
  [[ "$output" =~ ^2\.[0-9]+$ ]]
}

@test "missing MAJOR_VERSION file returns 1 with clear error" {
  run bash -c "
    source '${RELEASE_SH}'
    _release_compute_version_prefix '${TEST_TMP}' 2>&1
  "
  [ "$status" -eq 1 ]
  [[ "$output" == *"not found"* ]]
}

@test "non-integer MAJOR_VERSION returns 1 with clear error" {
  mkdir -p "${TEST_TMP}/.roll/ops"
  printf 'not-a-number\n' > "${TEST_TMP}/.roll/ops/MAJOR_VERSION"

  run bash -c "
    source '${RELEASE_SH}'
    _release_compute_version_prefix '${TEST_TMP}' 2>&1
  "
  [ "$status" -eq 1 ]
  [[ "$output" == *"must contain a single integer"* ]]
}

@test "VERSION+TAG assembled from prefix matches ^v[0-9]+\.[0-9]+\.[0-9]+$" {
  mkdir -p "${TEST_TMP}/.roll/ops"
  printf '2\n' > "${TEST_TMP}/.roll/ops/MAJOR_VERSION"

  run bash -c "
    source '${RELEASE_SH}'
    _release_compute_version_prefix '${TEST_TMP}'
    N=7
    VERSION=\"\${VERSION_PREFIX}.\${N}\"
    TAG=\"v\${VERSION}\"
    echo \"\${TAG}\"
  "
  [ "$status" -eq 0 ]
  [[ "$output" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

@test "FIX-163: _release_should_move_latest true when new sorts below current latest" {
  # year-scheme transition: 2.602.1 < 2026.601.4
  run bash -c "source '${RELEASE_SH}'; _release_should_move_latest '2.602.1' '2026.601.4'"
  [ "$status" -eq 0 ]
  # Jan-1 MMDD wrap: 2.101.1 < 2.1231.5
  run bash -c "source '${RELEASE_SH}'; _release_should_move_latest '2.101.1' '2.1231.5'"
  [ "$status" -eq 0 ]
}

@test "FIX-163: _release_should_move_latest false for normal-higher / equal / empty latest" {
  run bash -c "source '${RELEASE_SH}'; _release_should_move_latest '2.603.1' '2.602.1'"
  [ "$status" -ne 0 ]
  run bash -c "source '${RELEASE_SH}'; _release_should_move_latest '2.602.1' '2.602.1'"
  [ "$status" -ne 0 ]
  run bash -c "source '${RELEASE_SH}'; _release_should_move_latest '2.602.1' ''"
  [ "$status" -ne 0 ]
}

@test "FIX-165: _release_max_published picks semver-max from npm versions JSON" {
  # year-scheme version stays semver-highest even after newer 2.x publishes
  run bash -c "source '${RELEASE_SH}'; _release_max_published '[\"2026.601.4\",\"2.602.1\",\"2.602.2\"]'"
  [ "$status" -eq 0 ]
  [ "$output" = "2026.601.4" ]
  # pure 2.x set → highest 2.x
  run bash -c "source '${RELEASE_SH}'; _release_max_published '[\"2.101.1\",\"2.602.2\",\"2.603.1\"]'"
  [ "$output" = "2.603.1" ]
  # empty / no version tokens → empty
  run bash -c "source '${RELEASE_SH}'; _release_max_published '[]'"
  [ -z "$output" ]
}

@test "FIX-165: regression — 2.602.2 vs published [2026.601.4,2.602.1] moves latest explicitly" {
  # the exact bug: baseline must be max-published (2026.601.4), not dist-tags.latest (2.602.1).
  # 2.602.2 > 2.602.1 (latest) but < 2026.601.4 (max) → must move explicitly.
  run bash -c "source '${RELEASE_SH}'; _max=\$(_release_max_published '[\"2026.601.4\",\"2.602.1\"]'); _release_should_move_latest '2.602.2' \"\$_max\""
  [ "$status" -eq 0 ]
}
