#!/usr/bin/env bats
# Unit tests for lib/github_sync.py config persistence (US-SYNC-006):
# `roll backlog sync` writes/reads a `backlog_sync:` block in .roll/local.yaml
# so subsequent syncs can omit --repo. Covers: write / read / flag-overrides /
# surgical replace that preserves unrelated keys / first-sync-needs-repo error.
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

# --- write_sync_config -------------------------------------------------------

@test "US-SYNC-006: write_sync_config creates local.yaml with backlog_sync block" {
  run run_py "
p = '${TMP}/local.yaml'
gs.write_sync_config(p, 'seanyao/roll-meta', labels=[], last_sync_at='2026-05-28T10:00:00Z')
print(open(p).read())
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"backlog_sync:"* ]]
  [[ "$output" == *"repo: seanyao/roll-meta"* ]]
  [[ "$output" == *"direction: issues-to-backlog"* ]]
  [[ "$output" == *"labels: []"* ]]
  [[ "$output" == *"last_sync_at: 2026-05-28T10:00:00Z"* ]]
}

@test "US-SYNC-006: write_sync_config renders labels as inline list" {
  run run_py "
p = '${TMP}/local.yaml'
gs.write_sync_config(p, 'o/r', labels=['p1', 'bug'], last_sync_at='2026-05-28T10:00:00Z')
print(open(p).read())
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"labels: [p1, bug]"* ]]
}

# --- read_sync_config --------------------------------------------------------

@test "US-SYNC-006: read_sync_config round-trips what write wrote" {
  run run_py "
p = '${TMP}/local.yaml'
gs.write_sync_config(p, 'seanyao/roll-meta', labels=['p1'], last_sync_at='2026-05-28T10:00:00Z')
cfg = gs.read_sync_config(p)
print('REPO:', cfg['repo'])
print('LABELS:', cfg['labels'])
print('DIR:', cfg['direction'])
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"REPO: seanyao/roll-meta"* ]]
  [[ "$output" == *"LABELS: ['p1']"* ]]
  [[ "$output" == *"DIR: issues-to-backlog"* ]]
}

@test "US-SYNC-006: read_sync_config returns {} when file is missing" {
  run run_py "
print('CFG:', gs.read_sync_config('${TMP}/does-not-exist.yaml'))
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"CFG: {}"* ]]
}

@test "US-SYNC-006: read_sync_config returns {} when no backlog_sync block" {
  run run_py "
p = '${TMP}/local.yaml'
open(p, 'w').write('agent: pi\nloop_schedule:\n  period_minutes: 30\n')
print('CFG:', gs.read_sync_config(p))
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"CFG: {}"* ]]
}

# --- surgical replace preserves unrelated keys -------------------------------

@test "US-SYNC-006: write_sync_config preserves unrelated top-level keys" {
  run run_py "
p = '${TMP}/local.yaml'
open(p, 'w').write('agent: pi\n\nloop_schedule:\n  period_minutes: 30\n  offset_minute: 7\n')
gs.write_sync_config(p, 'o/r', labels=[], last_sync_at='2026-05-28T10:00:00Z')
txt = open(p).read()
print('HAS_AGENT:', 'agent: pi' in txt)
print('HAS_SCHED:', 'period_minutes: 30' in txt)
print('HAS_SYNC:', 'backlog_sync:' in txt)
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"HAS_AGENT: True"* ]]
  [[ "$output" == *"HAS_SCHED: True"* ]]
  [[ "$output" == *"HAS_SYNC: True"* ]]
}

@test "US-SYNC-006: re-writing replaces in place (no duplicate block)" {
  run run_py "
p = '${TMP}/local.yaml'
gs.write_sync_config(p, 'first/repo', labels=['a'], last_sync_at='2026-05-28T10:00:00Z')
gs.write_sync_config(p, 'second/repo', labels=[], last_sync_at='2026-05-29T00:00:00Z')
txt = open(p).read()
print('COUNT:', txt.count('backlog_sync:'))
cfg = gs.read_sync_config(p)
print('REPO:', cfg['repo'])
print('LABELS:', cfg['labels'])
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"COUNT: 1"* ]]
  [[ "$output" == *"REPO: second/repo"* ]]
  [[ "$output" == *"LABELS: []"* ]]
}

# --- _cmd_sync integration: flag overrides config, first sync needs --repo ----

@test "US-SYNC-006: sync without --repo and no config errors (exit 1)" {
  printf '[]' > "${TMP}/issues.json"
  printf '| ID | Desc | Status |\n|---|---|---|\n' > "${TMP}/backlog.md"
  run env ROLL_SYNC_FIXTURE="${TMP}/issues.json" python3 "${LIB}/github_sync.py" \
    sync --backlog "${TMP}/backlog.md" --features "${TMP}/features" \
    --local-yaml "${TMP}/local.yaml"
  [ "$status" -eq 1 ]
  [[ "$output" == *"first sync must pass --repo"* ]]
}

@test "US-SYNC-006: sync with --repo persists config; next sync omits --repo" {
  printf '[{"number":42,"title":"hi","state":"open","labels":[{"name":"enhancement"}],"body":""}]' > "${TMP}/issues.json"
  printf '| ID | Desc | Status |\n|---|---|---|\n' > "${TMP}/backlog.md"
  # First sync writes config.
  run env ROLL_SYNC_FIXTURE="${TMP}/issues.json" python3 "${LIB}/github_sync.py" \
    sync --repo seanyao/roll-meta --backlog "${TMP}/backlog.md" \
    --features "${TMP}/features" --local-yaml "${TMP}/local.yaml"
  [ "$status" -eq 0 ]
  grep -q "repo: seanyao/roll-meta" "${TMP}/local.yaml"
  # Second sync, no --repo: must succeed using persisted repo (idempotent skip).
  run env ROLL_SYNC_FIXTURE="${TMP}/issues.json" python3 "${LIB}/github_sync.py" \
    sync --backlog "${TMP}/backlog.md" --features "${TMP}/features" \
    --local-yaml "${TMP}/local.yaml"
  [ "$status" -eq 0 ]
  [[ "$output" == *"skipped (already exists): GH-42"* ]]
}

@test "US-SYNC-006: explicit --repo flag overrides persisted config repo" {
  printf '[]' > "${TMP}/issues.json"
  printf '| ID | Desc | Status |\n|---|---|---|\n' > "${TMP}/backlog.md"
  # Seed config with one repo.
  run run_py "
gs.write_sync_config('${TMP}/local.yaml', 'old/repo', labels=[], last_sync_at='2026-05-28T10:00:00Z')
"
  [ "$status" -eq 0 ]
  # Sync with a different --repo should win and rewrite the config.
  run env ROLL_SYNC_FIXTURE="${TMP}/issues.json" python3 "${LIB}/github_sync.py" \
    sync --repo new/repo --backlog "${TMP}/backlog.md" \
    --features "${TMP}/features" --local-yaml "${TMP}/local.yaml"
  [ "$status" -eq 0 ]
  grep -q "repo: new/repo" "${TMP}/local.yaml"
  ! grep -q "repo: old/repo" "${TMP}/local.yaml"
}
