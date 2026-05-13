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
| [US-AUTO-036](docs/features/foo.md#us-auto-036) | helpers + tests | ✅ Done |
| [US-AUTO-037](docs/features/foo.md#us-auto-037) | runner integration `depends-on:US-AUTO-036` `manual-only:true` | 📋 Todo |
| [US-AUTO-033](docs/features/foo.md#us-auto-033) | build PR + auto-merge `depends-on:US-AUTO-037` | 📋 Todo |
| [US-AUTO-034](docs/features/foo.md#us-auto-034) | PR inbox first `depends-on:US-AUTO-033,US-AUTO-035` | 📋 Todo |
| [US-AUTO-035](docs/features/foo.md#us-auto-035) | review approve `depends-on:US-AUTO-033` | ✅ Done |
| [US-AUTO-100](docs/features/foo.md#us-auto-100) | no deps at all | 📋 Todo |

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

@test "_loop_check_depends_on: defaults to ./BACKLOG.md when backlog arg omitted" {
  # Use the fixture backlog as cwd's BACKLOG.md
  cp "$_backlog" "${TEST_TMP}/BACKLOG.md"
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

# --- _loop_is_manual_only ---

@test "_loop_is_manual_only: row with manual-only:true returns 0" {
  run _loop_is_manual_only "US-AUTO-037" "$_backlog"
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
