#!/usr/bin/env bats
# Unit tests for lib/github_sync.py idempotency (US-SYNC-003):
# GH-NNN id naming + already-existing rows are skipped (not overwritten) so a
# second sync is a no-op. Covers first sync / second sync / partial-existing.
# bats tier: fast

LIB="${BATS_TEST_DIRNAME}/../../lib"

setup() {
  TMP="$(mktemp -d)"
}

teardown() {
  rm -rf "$TMP"
}

run_py() {
  python3 -c "
import sys
sys.path.insert(0, '${LIB}')
import github_sync as gs

$1
"
}

_seed_backlog() {
  cat > "${TMP}/backlog.md" << 'EOF'
# Backlog
| Story | Description | Status |
|-------|-------------|--------|
| US-EXISTING-001 | Keep me | 📋 Todo |
EOF
}

# --- GH-NNN id naming --------------------------------------------------------

@test "US-SYNC-003: issue id is <TYPE>-GH-<number>" {
  run run_py '
print("US:", gs.issue_to_row({"number": 13, "title": "t", "state": "open",
                              "labels": [{"name": "enhancement"}]}))
print("FIX:", gs.issue_to_row({"number": 13, "title": "t", "state": "open",
                               "labels": [{"name": "bug"}]}))
print("GHID:", gs.gh_id({"number": 13}))
'
  [ "$status" -eq 0 ]
  [[ "$output" == *"US: | US-GH-13 | t | 📋 Todo |"* ]]
  [[ "$output" == *"FIX: | FIX-GH-13 | t | 📋 Todo |"* ]]
  [[ "$output" == *"GHID: GH-13"* ]]
}

# --- First sync: all rows added ----------------------------------------------

@test "US-SYNC-003: first sync adds all issues, skips none" {
  _seed_backlog
  run run_py "
s = gs.sync_to_backlog(
    [{'number': 13, 'title': 'A', 'state': 'open', 'labels': [{'name':'enhancement'}]},
     {'number': 14, 'title': 'B', 'state': 'open', 'labels': [{'name':'bug'}]}],
    '${TMP}/backlog.md')
print('ADDED:', s['added'])
print('SKIPPED:', s['skipped'])
print('TOTAL:', s['total'])
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"ADDED: 2"* ]]
  [[ "$output" == *"SKIPPED: 0"* ]]
  [[ "$output" == *"TOTAL: 2"* ]]
  grep -qE '^\| US-GH-13 \| A \| 📋 Todo \|$' "${TMP}/backlog.md"
  grep -qE '^\| FIX-GH-14 \| B \| 📋 Todo \|$' "${TMP}/backlog.md"
}

# --- Second sync: idempotent (skip all, no mutation) -------------------------

@test "US-SYNC-003: second sync skips all existing ids, backlog unchanged" {
  _seed_backlog
  run run_py "
issues = [{'number': 13, 'title': 'A', 'state': 'open', 'labels': [{'name':'enhancement'}]},
          {'number': 14, 'title': 'B', 'state': 'open', 'labels': [{'name':'bug'}]}]
gs.sync_to_backlog(issues, '${TMP}/backlog.md')
"
  [ "$status" -eq 0 ]
  before="$(cat "${TMP}/backlog.md")"
  run run_py "
issues = [{'number': 13, 'title': 'A', 'state': 'open', 'labels': [{'name':'enhancement'}]},
          {'number': 14, 'title': 'B', 'state': 'open', 'labels': [{'name':'bug'}]}]
s = gs.sync_to_backlog(issues, '${TMP}/backlog.md')
print('ADDED:', s['added'])
print('SKIPPED:', s['skipped'])
print('TOTAL:', s['total'])
print('SKIPPED_IDS:', s['skipped_ids'])
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"ADDED: 0"* ]]
  [[ "$output" == *"SKIPPED: 2"* ]]
  [[ "$output" == *"TOTAL: 2"* ]]
  [[ "$output" == *"SKIPPED_IDS: ['GH-13', 'GH-14']"* ]]
  after="$(cat "${TMP}/backlog.md")"
  [ "$before" = "$after" ]
}

# --- Second sync does NOT overwrite a manually-edited status -----------------

@test "US-SYNC-003: existing row status/description is not overwritten" {
  _seed_backlog
  run run_py "
gs.sync_to_backlog([{'number': 13, 'title': 'A', 'state': 'open',
                     'labels': [{'name':'enhancement'}]}], '${TMP}/backlog.md')
"
  [ "$status" -eq 0 ]
  # Human moves it to Done and edits the description.
  perl -pi -e 's/\| US-GH-13 \| A \| 📋 Todo \|/| US-GH-13 | A (edited) | ✅ Done |/' "${TMP}/backlog.md"
  # Issue is now closed upstream, but second sync must leave the row alone.
  run run_py "
s = gs.sync_to_backlog([{'number': 13, 'title': 'A', 'state': 'closed',
                         'labels': [{'name':'enhancement'}]}], '${TMP}/backlog.md')
print('SKIPPED:', s['skipped'])
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"SKIPPED: 1"* ]]
  grep -qE '^\| US-GH-13 \| A \(edited\) \| ✅ Done \|$' "${TMP}/backlog.md"
}

# --- Partial: some new, some existing ----------------------------------------

@test "US-SYNC-003: partial sync adds new and skips existing" {
  _seed_backlog
  run run_py "
gs.sync_to_backlog([{'number': 13, 'title': 'A', 'state': 'open',
                     'labels': [{'name':'enhancement'}]}], '${TMP}/backlog.md')
"
  [ "$status" -eq 0 ]
  run run_py "
issues = [{'number': 13, 'title': 'A', 'state': 'open', 'labels': [{'name':'enhancement'}]},
          {'number': 20, 'title': 'C', 'state': 'open', 'labels': [{'name':'bug'}]}]
s = gs.sync_to_backlog(issues, '${TMP}/backlog.md')
print('ADDED:', s['added'])
print('SKIPPED:', s['skipped'])
print('TOTAL:', s['total'])
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"ADDED: 1"* ]]
  [[ "$output" == *"SKIPPED: 1"* ]]
  [[ "$output" == *"TOTAL: 2"* ]]
  grep -qE '^\| FIX-GH-20 \| C \| 📋 Todo \|$' "${TMP}/backlog.md"
  # GH-13 appears exactly once (not duplicated).
  [ "$(grep -c 'GH-13' "${TMP}/backlog.md")" -eq 1 ]
}

# --- Boundary: GH-1 must not match GH-13 -------------------------------------

@test "US-SYNC-003: id boundary GH-1 does not match GH-13" {
  _seed_backlog
  run run_py "
gs.sync_to_backlog([{'number': 13, 'title': 'A', 'state': 'open',
                     'labels': [{'name':'enhancement'}]}], '${TMP}/backlog.md')
s = gs.sync_to_backlog([{'number': 1, 'title': 'One', 'state': 'open',
                         'labels': [{'name':'enhancement'}]}], '${TMP}/backlog.md')
print('ADDED:', s['added'])
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"ADDED: 1"* ]]
  grep -qE '^\| US-GH-1 \| One \| 📋 Todo \|$' "${TMP}/backlog.md"
}
