#!/usr/bin/env bash
set -euo pipefail

# Default the test suite to en so dev machines with AppleLanguages=zh (or any
# zh-prefixed LANG) render the same catalog strings as the Ubuntu CI runner.
# Tests that exercise zh behaviour set ROLL_LANG=zh explicitly per-test.
: "${ROLL_LANG:=en}"
export ROLL_LANG

BATS="$(dirname "$0")/helpers/bats-core/bin/bats"

# REFACTOR-008 Phase 1: clear error when bats-core submodule not initialized.
if [ ! -x "$BATS" ]; then
  echo "error: bats binary not found at $BATS" >&2
  echo "hint: run 'git submodule update --init --recursive' to fetch bats-core" >&2
  exit 1
fi

# US-QA-005: parse --affected [base-ref] / --affected=<ref> / --dry-run flags.
# US-QA-007: parse --tier=fast|slow|all (default fast — TCR micro-step stays
#            in seconds; CI / pre-push run --tier=all for full coverage).
# Positional args (existing REFACTOR-009 behavior) still override the default
# scan paths when --affected is not set.
AFFECTED_MODE=0
DRY_RUN=0
BASE_REF=""
TIER="${ROLL_TEST_TIER:-fast}"
POSITIONAL=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    --affected)
      AFFECTED_MODE=1
      shift
      # Optional positional base-ref. Only consume the next arg when it is not
      # another flag and not an existing file/dir on disk (so users can still
      # write `--affected tests/unit/foo.bats` and have the path stay positional).
      if [ "$#" -gt 0 ] && [[ "$1" != --* ]] && [ ! -e "$1" ] && [ -z "$BASE_REF" ]; then
        BASE_REF="$1"
        shift
      fi
      ;;
    --affected=*)
      AFFECTED_MODE=1
      BASE_REF="${1#--affected=}"
      shift
      ;;
    --tier)
      TIER="${2:-fast}"
      shift 2
      ;;
    --tier=*)
      TIER="${1#--tier=}"
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --)
      shift
      while [ "$#" -gt 0 ]; do POSITIONAL+=("$1"); shift; done
      ;;
    *)
      POSITIONAL+=("$1")
      shift
      ;;
  esac
done

case "$TIER" in
  fast|slow|all) ;;
  *) echo "error: --tier must be one of fast|slow|all (got: $TIER)" >&2; exit 2 ;;
esac

# shellcheck source=helpers/tier.bash
source "$(dirname "$0")/helpers/tier.bash"

if [ "$AFFECTED_MODE" = 1 ]; then
  # shellcheck source=helpers/affected.bash
  source "$(dirname "$0")/helpers/affected.bash"

  REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null || true)"
  if [ -z "$REPO_ROOT" ]; then
    echo "error: --affected requires a git repository" >&2
    exit 2
  fi

  BASE_REF="${BASE_REF:-HEAD~1}"
  # Combine committed range (base..HEAD) with uncommitted working-tree changes,
  # so TCR micro-step edits are picked up before they are committed.
  _committed=$(git -C "$REPO_ROOT" diff --name-only "$BASE_REF" HEAD 2>/dev/null || true)
  _wip=$(git -C "$REPO_ROOT" diff --name-only HEAD 2>/dev/null || true)
  _all_changed=$(printf '%s\n%s\n' "$_committed" "$_wip" | grep -v '^$' | sort -u)

  AFFECTED=$(printf '%s\n' "$_all_changed" | (cd "$REPO_ROOT" && roll_affected_files))

  # US-QA-007: tier filter inside affected mode too. When all affected files
  # are slow but tier=fast (TCR default), skip with a clear message.
  if [ -n "$AFFECTED" ] && [ "$AFFECTED" != "__ALL__" ] && [ "$TIER" != "all" ]; then
    AFFECTED=$(printf '%s\n' "$AFFECTED" | while IFS= read -r f; do
      [ -z "$f" ] && continue
      got=$(roll_tier_classify "$REPO_ROOT/$f")
      [ "$got" = "$TIER" ] && printf '%s\n' "$f"
    done)
  fi

  if [ "$AFFECTED" = "__ALL__" ]; then
    # Conservative trigger (run.sh / helpers / preconditions changed) — fall
    # through to the default full-suite path below.
    :
  elif [ -z "$AFFECTED" ]; then
    echo "no affected tests, skipping suite"
    exit 0
  else
    if [ "$DRY_RUN" = 1 ]; then
      printf '%s\n' "$AFFECTED"
      exit 0
    fi

    AFFECTED_ABS=()
    while IFS= read -r f; do
      [ -n "$f" ] && AFFECTED_ABS+=("$REPO_ROOT/$f")
    done <<< "$AFFECTED"

    JOBS="${ROLL_TEST_JOBS:-}"
    if [ -z "$JOBS" ]; then
      JOBS=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)
    fi

    if command -v parallel >/dev/null 2>&1; then
      "$BATS" --jobs "$JOBS" --no-parallelize-within-files "${AFFECTED_ABS[@]}"
    else
      "$BATS" "${AFFECTED_ABS[@]}"
    fi

    # Write proof-of-pass (US-INFRA-006) — affected mode still counts as a real run.
    _TREE="$(git -C "$REPO_ROOT" write-tree 2>/dev/null || true)"
    if [ -n "$_TREE" ]; then
      mkdir -p "$REPO_ROOT/.roll"
      printf '{"ts":%s,"tree":"%s","mode":"affected"}\n' "$(date +%s)" "$_TREE" \
        > "$REPO_ROOT/.roll/last-test-pass"
    fi
    exit 0
  fi
fi

# REFACTOR-009 Phase 1B: optional args override the default scan paths,
# so CI can run `bash tests/run.sh tests/unit` and `tests/integration` in parallel jobs.
if [ "${#POSITIONAL[@]}" -gt 0 ]; then
  SCAN_PATHS=("${POSITIONAL[@]}")
else
  SCAN_PATHS=("$(dirname "$0")/unit" "$(dirname "$0")/integration")
fi

FILES=$(find "${SCAN_PATHS[@]}" -name '*.bats' | sort)

# US-QA-007: apply tier filter unless --tier=all OR the user named individual
# .bats files explicitly (their intent overrides classification).
_USER_NAMED_FILES=0
for _p in "${SCAN_PATHS[@]}"; do
  case "$_p" in
    *.bats) _USER_NAMED_FILES=1; break ;;
  esac
done
if [ "$TIER" != "all" ] && [ "$_USER_NAMED_FILES" = "0" ]; then
  FILES=$(printf '%s\n' "$FILES" | roll_tier_filter "$TIER")
  if [ -z "$FILES" ]; then
    echo "no $TIER-tier tests found in: ${SCAN_PATHS[*]}"
    exit 0
  fi
fi

# REFACTOR-008 Phase 1: detect CPU count dynamically instead of hardcoded 4.
JOBS="${ROLL_TEST_JOBS:-}"
if [ -z "$JOBS" ]; then
  JOBS=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)
fi

# US-QA-007: enforce 60s wall-clock cap when ROLL_TEST_TIME_CAP=1 (CI sets this
# for fast tier so a creeping perf regression turns the suite red immediately).
_t_start=$(date +%s)
if command -v parallel >/dev/null 2>&1; then
  # shellcheck disable=SC2086
  echo "$FILES" | xargs "$BATS" --jobs "$JOBS" --no-parallelize-within-files
else
  # shellcheck disable=SC2086
  echo "$FILES" | xargs "$BATS"
fi
_t_end=$(date +%s)
_t_dur=$(( _t_end - _t_start ))

if [ "${ROLL_TEST_TIME_CAP:-0}" = "1" ] && [ "$TIER" = "fast" ]; then
  _cap="${ROLL_TEST_FAST_CAP_SEC:-60}"
  if [ "$_t_dur" -gt "$_cap" ]; then
    echo "error: --tier=fast suite took ${_t_dur}s, exceeds ${_cap}s cap (US-QA-007)" >&2
    echo "       move heavyweight tests to tier=slow or split them" >&2
    exit 3
  fi
fi

# Write proof-of-pass for pre-commit hook (US-INFRA-006).
# Records timestamp + working tree hash so the hook can verify tests ran on
# exactly the code being committed, not a prior or modified version.
_REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null || true)"
if [ -n "$_REPO_ROOT" ]; then
  mkdir -p "$_REPO_ROOT/.roll"
  _TREE="$(git -C "$_REPO_ROOT" write-tree 2>/dev/null || true)"
  if [ -n "$_TREE" ]; then
    printf '{"ts":%s,"tree":"%s"}\n' "$(date +%s)" "$_TREE" \
      > "$_REPO_ROOT/.roll/last-test-pass"
  fi
fi
