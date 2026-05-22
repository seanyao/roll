#!/usr/bin/env bash
# US-QA-005: map a list of changed source files (one per line on stdin) to
# the set of .bats files that need to run.
#
# Output contract:
#   - stdout: newline-separated .bats paths relative to repo root, sorted/unique.
#   - sentinel "__ALL__" on stdout (sole line) means "run the full suite";
#     callers must short-circuit to default scan when they see it.
#   - empty stdout means "no affected tests".
#
# Layer rules (most specific first):
#   1. Direct hit:       a changed .bats file is added to the set (self-test).
#   2. Conservative:     changes to tests/run.sh, tests/helpers/*, or
#                        tests/preconditions.bash trigger __ALL__ (the runner
#                        and shared scaffolding can affect any test).
#   3. Naming convention: lib/<stem>.* (any extension) maps to
#                        tests/unit/<stem>*.bats and tests/integration/*<stem>*.bats.
#   4. Unmapped:         anything else contributes nothing.

# Map a single changed file to one of:
#   - "__ALL__" (full-suite sentinel)
#   - one or more .bats paths (newline-separated)
#   - nothing (no mapping)
_affected_map_file() {
  local f="$1"
  [ -z "$f" ] && return 0

  # Layer 2: conservative full-suite triggers (checked before the .bats
  # direct-hit branch so a change to tests/helpers/foo.bats still escalates).
  case "$f" in
    tests/run.sh|tests/preconditions.bash)
      printf '__ALL__\n'
      return 0
      ;;
    tests/helpers/*)
      printf '__ALL__\n'
      return 0
      ;;
  esac

  # Layer 1: direct .bats hit — include itself if the file still exists.
  if [[ "$f" == *.bats ]]; then
    [ -f "$f" ] && printf '%s\n' "$f"
    return 0
  fi

  # Layer 3: source files under lib/ map by stem.
  if [[ "$f" == lib/* ]]; then
    local stem
    stem=$(basename "$f")
    stem="${stem%.*}"
    [ -z "$stem" ] && return 0

    local match
    for match in tests/unit/"$stem"*.bats; do
      [ -f "$match" ] && printf '%s\n' "$match"
    done
    for match in tests/integration/*"$stem"*.bats; do
      [ -f "$match" ] && printf '%s\n' "$match"
    done
    return 0
  fi

  # Layer 4: anything else (docs, README, top-level config, .roll/*) contributes nothing.
  return 0
}

# Compute affected set from a list of changed files supplied on stdin
# (one path per line). Honors the rules in _affected_map_file.
roll_affected_files() {
  local line
  local -a collected=()
  local saw_all=0

  while IFS= read -r line; do
    [ -z "$line" ] && continue
    local mapped
    mapped=$(_affected_map_file "$line")
    if [ "$mapped" = "__ALL__" ]; then
      saw_all=1
      break
    fi
    if [ -n "$mapped" ]; then
      while IFS= read -r m; do
        [ -z "$m" ] && continue
        collected+=("$m")
      done <<< "$mapped"
    fi
  done

  if [ "$saw_all" = 1 ]; then
    printf '__ALL__\n'
    return 0
  fi

  if [ "${#collected[@]}" -eq 0 ]; then
    return 0
  fi

  printf '%s\n' "${collected[@]}" | sort -u
}
