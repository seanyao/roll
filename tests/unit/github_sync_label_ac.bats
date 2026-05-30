#!/usr/bin/env bats
# Unit tests for lib/github_sync.py --label filter + AC checkbox mapping
# (US-SYNC-005): OR-semantics label filtering, top-level `- [ ]` extraction
# (nested items ignored), and feature-file stub create/append.
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

# --- --label parsing ---------------------------------------------------------

@test "US-SYNC-005: parse_labels_filter splits comma + lowercases + dedupes" {
  run run_py "
print(gs.parse_labels_filter('P1, bug ,P1'))
print(gs.parse_labels_filter(''))
print(gs.parse_labels_filter(None))
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"['p1', 'bug']"* ]]
  # Empty / None → no filter.
  [[ "$output" == *"[]"* ]]
}

# --- label filter: OR semantics ----------------------------------------------

@test "US-SYNC-005: filter matches issue with ANY wanted label (OR)" {
  run run_py "
issues = [
  {'number': 1, 'title': 'a', 'labels': [{'name': 'P1'}, {'name': 'bug'}]},
  {'number': 2, 'title': 'b', 'labels': [{'name': 'P2'}]},
  {'number': 3, 'title': 'c', 'labels': [{'name': 'enhancement'}]},
]
got = gs.filter_issues_by_label(issues, gs.parse_labels_filter('p1,enhancement'))
print('NUMS:', [i['number'] for i in got])
"
  [ "$status" -eq 0 ]
  # P1 (case-insensitive) hits #1, enhancement hits #3; #2 excluded.
  [[ "$output" == *"NUMS: [1, 3]"* ]]
}

@test "US-SYNC-005: empty filter matches every issue" {
  run run_py "
issues = [{'number': 1, 'labels': []}, {'number': 2, 'labels': [{'name':'x'}]}]
got = gs.filter_issues_by_label(issues, gs.parse_labels_filter(''))
print('NUMS:', [i['number'] for i in got])
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"NUMS: [1, 2]"* ]]
}

# --- AC checkbox extraction: ignore nested ------------------------------------

@test "US-SYNC-005: extract top-level checkboxes, ignore nested list items" {
  run run_py "
body = '''Intro line.

- [ ] First AC
- [x] Second AC done
  - [ ] nested ignored
- not a checkbox bullet
- [ ] Third AC

Trailing prose.'''
items = gs.extract_ac_items(body)
for it in items:
    print('AC:', it)
print('COUNT:', len(items))
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"AC: First AC"* ]]
  [[ "$output" == *"AC: Second AC done"* ]]
  [[ "$output" == *"AC: Third AC"* ]]
  [[ "$output" != *"nested ignored"* ]]
  [[ "$output" == *"COUNT: 3"* ]]
}

@test "US-SYNC-005: empty / None body yields no AC items" {
  run run_py "
print('A:', gs.extract_ac_items(''))
print('B:', gs.extract_ac_items(None))
print('C:', gs.extract_ac_items('just prose, no boxes'))
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"A: []"* ]]
  [[ "$output" == *"B: []"* ]]
  [[ "$output" == *"C: []"* ]]
}

# --- feature stub: create -----------------------------------------------------

@test "US-SYNC-005: write_feature_stub creates GH-NNN.md with AC section" {
  run run_py "
issue = {'number': 13, 'title': 'Sync from GitHub', 'state': 'open',
         'labels': [{'name': 'enhancement'}],
         'body': '- [ ] Pull issues\n- [x] Map labels'}
path = gs.write_feature_stub(issue, '${TMP}/features')
print('PATH:', path)
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"GH-13.md"* ]]
  [ -f "${TMP}/features/backlog-lifecycle/GH-13.md" ]
  grep -qE '^# GH-13 Sync from GitHub$' "${TMP}/features/backlog-lifecycle/GH-13.md"
  grep -qE '^## AC$' "${TMP}/features/backlog-lifecycle/GH-13.md"
  grep -qF -- '- [ ] Pull issues' "${TMP}/features/backlog-lifecycle/GH-13.md"
  # Upstream-checked items still render as unchecked backlog AC.
  grep -qF -- '- [ ] Map labels' "${TMP}/features/backlog-lifecycle/GH-13.md"
}

# --- feature stub: append on existing -----------------------------------------

@test "US-SYNC-005: write_feature_stub appends when file already exists" {
  mkdir -p "${TMP}/features/backlog-lifecycle"
  printf '# GH-13 manual\n\nhand-written prose\n' \
    > "${TMP}/features/backlog-lifecycle/GH-13.md"
  run run_py "
issue = {'number': 13, 'title': 'x', 'state': 'open',
         'labels': [{'name': 'enhancement'}],
         'body': '- [ ] Appended AC'}
gs.write_feature_stub(issue, '${TMP}/features')
"
  [ "$status" -eq 0 ]
  # Original prose preserved; new AC appended.
  grep -qF 'hand-written prose' "${TMP}/features/backlog-lifecycle/GH-13.md"
  grep -qF -- '- [ ] Appended AC' "${TMP}/features/backlog-lifecycle/GH-13.md"
}
