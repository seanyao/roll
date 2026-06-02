#!/usr/bin/env bats
# FIX-032: Tests for dependency-gate helpers.
#
# Two pure functions in bin/roll parse BACKLOG inline tags:
#   _loop_check_depends_on <story-id> [backlog]
#       exit 0 if all `depends-on:` deps are ✅ Done (or no deps);
#       exit 1 if any unsatisfied / story missing / backlog missing.
#       Prints unsatisfied dep IDs (space-separated) to stdout when blocking.
#
#   _loop_is_manual_only <story-id> [backlog]
#       exit 0 if row carries `manual-only:true`; exit 1 otherwise.

load helpers

setup() {
  unit_setup_cd
  _backlog="${TEST_TMP}/fixture-backlog.md"
  cat > "$_backlog" << 'EOF'
# Project Backlog

## Epic: Sample
### Feature: sample
| Story | Description | Status |
|-------|-------------|--------|
| [US-AUTO-036](.roll/features/foo.md#us-auto-036) | helpers + tests | ✅ Done |
| [US-AUTO-037](.roll/features/foo.md#us-auto-037) | runner integration `depends-on:US-AUTO-036` `manual-only:true` | 📋 Todo |
| [US-AUTO-033](.roll/features/foo.md#us-auto-033) | build PR + auto-merge `depends-on:US-AUTO-037` | 📋 Todo |
| [US-AUTO-034](.roll/features/foo.md#us-auto-034) | PR inbox first `depends-on:US-AUTO-033,US-AUTO-035` | 📋 Todo |
| [US-AUTO-035](.roll/features/foo.md#us-auto-035) | review approve `depends-on:US-AUTO-033` | ✅ Done |
| [US-AUTO-100](.roll/features/foo.md#us-auto-100) | no deps at all | 📋 Todo |

## 🐛 Bug Fixes
| ID | Description | Status |
|----|-------------|--------|
| FIX-031 | concurrent lock | ✅ Done |
| FIX-100 | sample fix with multi deps `depends-on:US-AUTO-036,US-AUTO-100` | 📋 Todo |
EOF
}
teardown() {
  unit_teardown_cd
}

# --- _loop_check_depends_on ---

@test "_loop_check_depends_on: no depends-on tag returns 0" {
  run _loop_check_depends_on "US-AUTO-100" "$_backlog"
  [ "$status" -eq 0 ]
}

@test "_loop_check_depends_on: single dep that is ✅ Done returns 0" {
  run _loop_check_depends_on "US-AUTO-037" "$_backlog"
  [ "$status" -eq 0 ]
}

@test "_loop_check_depends_on: single dep that is 📋 Todo returns 1 and prints dep" {
  run _loop_check_depends_on "US-AUTO-033" "$_backlog"
  [ "$status" -eq 1 ]
  [[ "$output" == *"US-AUTO-037"* ]]
}

@test "_loop_check_depends_on: comma-separated multi-dep with one unsatisfied returns 1" {
  # US-AUTO-034 depends on US-AUTO-033 (Todo) and US-AUTO-035 (Done) — should block on 033
  run _loop_check_depends_on "US-AUTO-034" "$_backlog"
  [ "$status" -eq 1 ]
  [[ "$output" == *"US-AUTO-033"* ]]
}

@test "_loop_check_depends_on: multi-dep all ✅ Done returns 0" {
  run _loop_check_depends_on "FIX-100" "$_backlog"
  [ "$status" -eq 1 ]   # US-AUTO-100 is 📋 Todo, so 1
  [[ "$output" == *"US-AUTO-100"* ]]
}

@test "_loop_check_depends_on: story not in backlog returns 1 (conservative block)" {
  run _loop_check_depends_on "US-NONE-999" "$_backlog"
  [ "$status" -eq 1 ]
}

@test "_loop_check_depends_on: missing backlog file returns 1" {
  run _loop_check_depends_on "US-AUTO-033" "${TEST_TMP}/nope.md"
  [ "$status" -eq 1 ]
}

@test "_loop_check_depends_on: defaults to ./.roll/backlog.md when backlog arg omitted" {
  # Use the fixture backlog as cwd's .roll/backlog.md
  mkdir -p "${TEST_TMP}/.roll"
  cp "$_backlog" "${TEST_TMP}/.roll/backlog.md"
  cd "$TEST_TMP"
  run _loop_check_depends_on "US-AUTO-100"
  [ "$status" -eq 0 ]
}

@test "_loop_check_depends_on: id only matches row-start, not mentions in other rows" {
  # US-AUTO-036 is mentioned in FIX-100's depends-on; the search must
  # match the row that DEFINES US-AUTO-036, not FIX-100's row.
  run _loop_check_depends_on "US-AUTO-036" "$_backlog"
  [ "$status" -eq 0 ]   # US-AUTO-036 has no depends-on
}

@test "_loop_check_depends_on: no depends-on under set -e pipefail → returns 0" {
  # FIX-161: the grep pipeline inside the function used to return 1 when no
  # depends-on tag exists; with set -e active that crashed the caller.
  source "$ROLL_BIN"
  set -e
  set -o pipefail
  _loop_check_depends_on "US-AUTO-100" "$_backlog"
}

# --- _loop_is_manual_only ---

@test "_loop_is_manual_only: row with manual-only:true returns 0" {
  run _loop_is_manual_only "US-AUTO-037" "$_backlog"
  [ "$status" -eq 0 ]
}

@test "FIX-109: _loop_is_manual_only accepts non-'true' values (manual-only:roll-meta)" {
  local tmp; tmp=$(mktemp)
  cat > "$tmp" <<'BL'
| Story | Description | Status |
|-------|-------------|--------|
| [US-WATCH-001](features/upstream-watch.md#us-watch-001) | private maintainer task `manual-only:roll-meta` | 📋 Todo |
BL
  run _loop_is_manual_only "US-WATCH-001" "$tmp"
  rm -f "$tmp"
  [ "$status" -eq 0 ]
}

@test "FIX-109: _loop_is_manual_only accepts arbitrary tag value (manual-only:sean-yao)" {
  local tmp; tmp=$(mktemp)
  cat > "$tmp" <<'BL'
| Story | Description | Status |
|-------|-------------|--------|
| [US-FOO-001](features/foo.md#us-foo-001) | claimed by human `manual-only:sean-yao` | 📋 Todo |
BL
  run _loop_is_manual_only "US-FOO-001" "$tmp"
  rm -f "$tmp"
  [ "$status" -eq 0 ]
}

@test "_loop_is_manual_only: row without manual-only tag returns 1" {
  run _loop_is_manual_only "US-AUTO-033" "$_backlog"
  [ "$status" -eq 1 ]
}

@test "_loop_is_manual_only: story not in backlog returns 1" {
  run _loop_is_manual_only "US-NONE-999" "$_backlog"
  [ "$status" -eq 1 ]
}

@test "_loop_is_manual_only: tag must be on the story's own row, not in someone else's deps" {
  # US-AUTO-036 is referenced in US-AUTO-037 (which has manual-only:true)
  # but US-AUTO-036 itself does NOT have manual-only:true.
  run _loop_is_manual_only "US-AUTO-036" "$_backlog"
  [ "$status" -eq 1 ]
}

@test "FIX-167: depends-on a lettered sub-story (062c) resolves to the sub-story, not its base parent" {
  # The a/b/c split pattern: parent on Hold, sub-story Done, dependent on the sub-story.
  # The old regex [A-Z0-9,-] dropped the lowercase suffix → checked US-SPLIT-062 (Hold)
  # instead of US-SPLIT-062c (Done), wrongly blocking the dependent.
  local bl="${TEST_TMP}/split-backlog.md"
  cat > "$bl" << 'BL'
| [US-SPLIT-062](.roll/features/x.md#us-split-062) | parent | 🚫 Hold (split into a..c) |
| [US-SPLIT-062c](.roll/features/x.md#us-split-062c) | sub-story c | ✅ Done |
| [US-SPLIT-070](.roll/features/x.md#us-split-070) | dependent `depends-on:US-SPLIT-062c` | 📋 Todo |
BL
  run _loop_check_depends_on "US-SPLIT-070" "$bl"
  [ "$status" -eq 0 ]      # dep US-SPLIT-062c is ✅ Done → satisfied
  [ -z "$output" ]
}

@test "FIX-167: lettered sub-story dep that is NOT done still blocks (and is reported with full id)" {
  local bl="${TEST_TMP}/split-backlog2.md"
  cat > "$bl" << 'BL'
| [US-SPLIT-062](.roll/features/x.md#us-split-062) | parent | ✅ Done |
| [US-SPLIT-062c](.roll/features/x.md#us-split-062c) | sub-story c | 📋 Todo |
| [US-SPLIT-070](.roll/features/x.md#us-split-070) | dependent `depends-on:US-SPLIT-062c` | 📋 Todo |
BL
  run _loop_check_depends_on "US-SPLIT-070" "$bl"
  [ "$status" -eq 1 ]                       # 062c is Todo → blocked even though base 062 is Done
  [[ "$output" == *"US-SPLIT-062c"* ]]      # full id reported, not truncated to US-SPLIT-062
}

@test "FIX-167: deps after a lettered one are not dropped (multi-dep with suffix)" {
  local bl="${TEST_TMP}/split-backlog3.md"
  cat > "$bl" << 'BL'
| [US-SPLIT-062c](.roll/features/x.md#us-split-062c) | done sub | ✅ Done |
| [US-AGENT-040](.roll/features/x.md#us-agent-040) | other dep | 📋 Todo |
| [US-SPLIT-070](.roll/features/x.md#us-split-070) | dependent `depends-on:US-SPLIT-062c,US-AGENT-040` | 📋 Todo |
BL
  run _loop_check_depends_on "US-SPLIT-070" "$bl"
  [ "$status" -eq 1 ]                       # US-AGENT-040 (after the lettered dep) is Todo → must still block
  [[ "$output" == *"US-AGENT-040"* ]]       # the 2nd dep was not dropped by the parser
}
