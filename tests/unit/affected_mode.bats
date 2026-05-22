#!/usr/bin/env bats
# US-QA-005: tests/helpers/affected.bash mapping rules.
#
# Each test feeds a list of "changed files" on stdin to roll_affected_files
# and asserts the resulting .bats selection. The repo root is used as cwd so
# the layer-3 lib/<stem> mapping can glob real test files.

setup() {
  REPO_ROOT="$(cd "${BATS_TEST_DIRNAME}/../.." && pwd)"
  cd "$REPO_ROOT"
  # shellcheck source=../helpers/affected.bash
  source "${REPO_ROOT}/tests/helpers/affected.bash"
}

@test "affected: empty input → empty output" {
  run bash -c 'source tests/helpers/affected.bash; printf "" | roll_affected_files'
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "affected: changed .bats file is included as self-test" {
  run bash -c 'source tests/helpers/affected.bash; printf "tests/unit/test_runner.bats\n" | roll_affected_files'
  [ "$status" -eq 0 ]
  [ "$output" = "tests/unit/test_runner.bats" ]
}

@test "affected: tests/run.sh change triggers __ALL__" {
  run bash -c 'source tests/helpers/affected.bash; printf "tests/run.sh\n" | roll_affected_files'
  [ "$status" -eq 0 ]
  [ "$output" = "__ALL__" ]
}

@test "affected: tests/helpers/* change triggers __ALL__" {
  run bash -c 'source tests/helpers/affected.bash; printf "tests/helpers/affected.bash\n" | roll_affected_files'
  [ "$status" -eq 0 ]
  [ "$output" = "__ALL__" ]
}

@test "affected: tests/preconditions.bash change triggers __ALL__" {
  run bash -c 'source tests/helpers/affected.bash; printf "tests/preconditions.bash\n" | roll_affected_files'
  [ "$status" -eq 0 ]
  [ "$output" = "__ALL__" ]
}

@test "affected: unmapped doc change → empty output" {
  run bash -c 'source tests/helpers/affected.bash; printf "README.md\nCONTRIBUTING.md\n" | roll_affected_files'
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "affected: __ALL__ short-circuits even when other entries are present" {
  run bash -c 'source tests/helpers/affected.bash; printf "README.md\ntests/run.sh\ntests/unit/test_runner.bats\n" | roll_affected_files'
  [ "$status" -eq 0 ]
  [ "$output" = "__ALL__" ]
}

@test "affected: duplicate inputs collapse to unique sorted output" {
  run bash -c 'source tests/helpers/affected.bash; printf "tests/unit/test_runner.bats\ntests/unit/test_runner.bats\n" | roll_affected_files'
  [ "$status" -eq 0 ]
  [ "$output" = "tests/unit/test_runner.bats" ]
}

@test "affected: changed .bats file that no longer exists → empty output" {
  run bash -c 'source tests/helpers/affected.bash; printf "tests/unit/__does_not_exist__.bats\n" | roll_affected_files'
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "affected: lib/<stem> change selects tests/unit/<stem>*.bats" {
  # Use a real lib file with a corresponding tests/unit/<stem>*.bats — pick a
  # file we know exists in this repo to keep the test stable.
  if [ ! -f "lib/roll-status.py" ] && [ ! -f "lib/roll_status.py" ]; then
    skip "no lib/<stem>.{py,sh} with a matching tests/unit/<stem>*.bats fixture in this repo"
  fi

  # Look for any lib/<stem>.{py,sh} that has at least one matching unit test.
  local picked_lib picked_stem matches
  picked_lib=""
  for cand in lib/*.py lib/*.sh; do
    [ -f "$cand" ] || continue
    local stem
    stem=$(basename "$cand"); stem="${stem%.*}"
    matches=$(ls tests/unit/"$stem"*.bats 2>/dev/null | head -1)
    if [ -n "$matches" ]; then
      picked_lib="$cand"
      picked_stem="$stem"
      break
    fi
  done

  if [ -z "$picked_lib" ]; then
    skip "no lib/<stem> file with a matching tests/unit/<stem>*.bats in this repo"
  fi

  run bash -c "source tests/helpers/affected.bash; printf '%s\n' '$picked_lib' | roll_affected_files"
  [ "$status" -eq 0 ]
  # At least one matching unit test was selected.
  echo "$output" | grep -q "tests/unit/${picked_stem}"
}
