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

@test "run.sh --affected --dry-run prints the affected file list and does not invoke bats" {
  # In this worktree we have just committed two new files (tests/helpers/affected.bash
  # and tests/unit/affected_mode.bats). The helper triggers __ALL__, so the dry-run
  # branch is not exercised by HEAD~1 — instead, set up an isolated temp repo.
  local tmp
  tmp="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" RETURN

  # Mirror just the runner + helper so the script paths resolve. We don't need
  # bats-core: --dry-run must short-circuit before bats is invoked.
  mkdir -p "$tmp/tests/helpers/bats-core/bin"
  mkdir -p "$tmp/tests/unit"
  cp "${REPO_ROOT}/tests/run.sh" "$tmp/tests/run.sh"
  cp "${REPO_ROOT}/tests/helpers/affected.bash" "$tmp/tests/helpers/affected.bash"
  cp "${REPO_ROOT}/tests/helpers/tier.bash" "$tmp/tests/helpers/tier.bash"
  # Stub bats so a fall-through would fail loudly (we expect dry-run to exit before this).
  printf '#!/bin/sh\necho "bats stub should not run in dry-run" >&2; exit 99\n' \
    > "$tmp/tests/helpers/bats-core/bin/bats"
  chmod +x "$tmp/tests/helpers/bats-core/bin/bats"
  # Provide one .bats file the helper can map to.
  touch "$tmp/tests/unit/sample.bats"

  cd "$tmp"
  git init -q
  git config user.email t@example.com
  git config user.name t
  git add . && git commit -q -m init
  # Modify the sample test → it becomes affected via direct-hit rule.
  echo "# touched" >> "$tmp/tests/unit/sample.bats"
  git add tests/unit/sample.bats && git commit -q -m "touch sample"

  run bash tests/run.sh --affected --dry-run
  [ "$status" -eq 0 ]
  echo "$output" | grep -q "tests/unit/sample.bats"
}

@test "run.sh --affected with empty set prints skip message and exits 0" {
  local tmp
  tmp="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" RETURN

  mkdir -p "$tmp/tests/helpers/bats-core/bin"
  mkdir -p "$tmp/tests/unit"
  cp "${REPO_ROOT}/tests/run.sh" "$tmp/tests/run.sh"
  cp "${REPO_ROOT}/tests/helpers/affected.bash" "$tmp/tests/helpers/affected.bash"
  cp "${REPO_ROOT}/tests/helpers/tier.bash" "$tmp/tests/helpers/tier.bash"
  printf '#!/bin/sh\nexit 99\n' > "$tmp/tests/helpers/bats-core/bin/bats"
  chmod +x "$tmp/tests/helpers/bats-core/bin/bats"

  cd "$tmp"
  git init -q
  git config user.email t@example.com
  git config user.name t
  echo "x" > README.md && git add . && git commit -q -m init
  echo "y" >> README.md && git add README.md && git commit -q -m "doc-only change"

  run bash tests/run.sh --affected
  [ "$status" -eq 0 ]
  echo "$output" | grep -q "no affected tests, skipping suite"
}

@test "run.sh --affected falls through to full suite when helpers change" {
  local tmp
  tmp="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" RETURN

  mkdir -p "$tmp/tests/helpers/bats-core/bin"
  mkdir -p "$tmp/tests/unit"
  mkdir -p "$tmp/tests/integration"
  cp "${REPO_ROOT}/tests/run.sh" "$tmp/tests/run.sh"
  cp "${REPO_ROOT}/tests/helpers/affected.bash" "$tmp/tests/helpers/affected.bash"
  cp "${REPO_ROOT}/tests/helpers/tier.bash" "$tmp/tests/helpers/tier.bash"
  # Stub bats to succeed and print marker so we can detect fall-through.
  printf '#!/bin/sh\necho "FULL_SUITE_RAN"\nexit 0\n' \
    > "$tmp/tests/helpers/bats-core/bin/bats"
  chmod +x "$tmp/tests/helpers/bats-core/bin/bats"
  touch "$tmp/tests/unit/sample.bats"
  touch "$tmp/tests/helpers/sidecar.bash"

  cd "$tmp"
  git init -q
  git config user.email t@example.com
  git config user.name t
  git add . && git commit -q -m init
  # Change an arbitrary helper file (not affected.bash itself) → __ALL__ → fall
  # through to the default full-suite scan.
  echo "# change" >> "$tmp/tests/helpers/sidecar.bash"
  git add tests/helpers/sidecar.bash && git commit -q -m "touch helper"

  run bash tests/run.sh --affected
  [ "$status" -eq 0 ]
  echo "$output" | grep -q "FULL_SUITE_RAN"
}

@test "run.sh --affected outside git repo errors with exit 2" {
  local tmp
  tmp="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" RETURN

  mkdir -p "$tmp/tests/helpers/bats-core/bin"
  cp "${REPO_ROOT}/tests/run.sh" "$tmp/tests/run.sh"
  cp "${REPO_ROOT}/tests/helpers/affected.bash" "$tmp/tests/helpers/affected.bash"
  cp "${REPO_ROOT}/tests/helpers/tier.bash" "$tmp/tests/helpers/tier.bash"
  printf '#!/bin/sh\nexit 0\n' > "$tmp/tests/helpers/bats-core/bin/bats"
  chmod +x "$tmp/tests/helpers/bats-core/bin/bats"

  cd "$tmp"
  run bash tests/run.sh --affected
  [ "$status" -eq 2 ]
  echo "$output" | grep -q "requires a git repository"
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

  # Pick an unrelated unit test (stem does NOT match) and assert it was not selected.
  # Excludes empty results and the picked stem itself.
  local unrelated
  unrelated=$(ls tests/unit/*.bats 2>/dev/null \
    | grep -v "tests/unit/${picked_stem}" \
    | head -1)
  if [ -n "$unrelated" ]; then
    ! echo "$output" | grep -Fq "$unrelated"
  fi
}
