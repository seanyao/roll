#!/usr/bin/env bats
# FIX-112: roll backlog unstick — revert 🔨 In Progress whose latest cycle
# failed / aborted / blocked more than N hours ago.
# bats tier: fast

load helpers

LIB="${BATS_TEST_DIRNAME}/../../lib"
UNSTICK="${LIB}/loop_unstick.py"

setup() {
  unit_setup
  cd "$TEST_TMP"
  mkdir -p .roll "${_SHARED_ROOT}/loop"
  # synthetic backlog: 1 In Progress, 1 Todo, 1 Done
  cat > .roll/backlog.md <<'BL'
| Story | Description | Status |
|-------|-------------|--------|
| [US-STUCK-001](.roll/features/foo.md#us-stuck-001) | story claimed long ago | 🔨 In Progress |
| [US-LIVE-002](.roll/features/foo.md#us-live-002) | story actively being worked | 🔨 In Progress |
| [US-TODO-003](.roll/features/foo.md#us-todo-003) | not yet picked | 📋 Todo |
BL
  # synthetic events ndjson with two cycle stories
  local slug; slug=$(python3 -c "import sys; sys.path.insert(0, '${LIB}'); import importlib.util; spec=importlib.util.spec_from_file_location('u','${UNSTICK}'); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m); print(m._project_slug())")
  EV="${_SHARED_ROOT}/loop/events-${slug}.ndjson"
  # STUCK story: picked yesterday, cycle aborted 10 hours ago
  local ten_h_ago; ten_h_ago=$(python3 -c "from datetime import datetime, timezone, timedelta; print((datetime.now(timezone.utc)-timedelta(hours=10)).strftime('%Y-%m-%dT%H:%M:%SZ'))")
  local pick_ts; pick_ts=$(python3 -c "from datetime import datetime, timezone, timedelta; print((datetime.now(timezone.utc)-timedelta(hours=10, minutes=20)).strftime('%Y-%m-%dT%H:%M:%SZ'))")
  cat > "$EV" <<EOF
{"ts":"$pick_ts","stage":"pick_todo","label":"20260522-100000-1","detail":"US-STUCK-001","outcome":""}
{"ts":"$ten_h_ago","stage":"cycle_end","label":"20260522-100000-1","detail":"loop/cycle-20260522-100000-1","outcome":"aborted"}
EOF
  # LIVE story: picked 30 min ago, no cycle_end yet
  local thirty_min_ago; thirty_min_ago=$(python3 -c "from datetime import datetime, timezone, timedelta; print((datetime.now(timezone.utc)-timedelta(minutes=30)).strftime('%Y-%m-%dT%H:%M:%SZ'))")
  cat >> "$EV" <<EOF
{"ts":"$thirty_min_ago","stage":"pick_todo","label":"20260523-160000-2","detail":"US-LIVE-002","outcome":""}
{"ts":"$thirty_min_ago","stage":"cycle_start","label":"20260523-160000-2","detail":"","outcome":""}
EOF
}
teardown() { unit_teardown; }

@test "FIX-112: dry-run reports stuck story but does not modify backlog" {
  run python3 "$UNSTICK" --dry-run --ttl-hours 4 --backlog .roll/backlog.md
  [ "$status" -eq 0 ]
  [[ "$output" == *"would-revert US-STUCK-001"* ]]
  # No changes
  grep -q "US-STUCK-001.*🔨 In Progress" .roll/backlog.md
}

@test "FIX-112: apply mode reverts the stuck story to 📋 Todo" {
  run python3 "$UNSTICK" --ttl-hours 4 --backlog .roll/backlog.md
  [ "$status" -eq 0 ]
  [[ "$output" == *"reverted US-STUCK-001"* ]]
  grep -q "US-STUCK-001.*📋 Todo" .roll/backlog.md
}

@test "FIX-112: actively-running story (cycle_start, no cycle_end yet) is NOT reverted" {
  run python3 "$UNSTICK" --ttl-hours 4 --backlog .roll/backlog.md
  grep -q "US-LIVE-002.*🔨 In Progress" .roll/backlog.md
}

@test "FIX-112: longer --ttl-hours threshold skips stuck story too" {
  run python3 "$UNSTICK" --ttl-hours 24 --backlog .roll/backlog.md
  grep -q "US-STUCK-001.*🔨 In Progress" .roll/backlog.md
}

@test "FIX-112: revert writes ALERT entry" {
  python3 "$UNSTICK" --ttl-hours 4 --backlog .roll/backlog.md
  local slug; slug=$(python3 -c "import sys; sys.path.insert(0, '${LIB}'); import importlib.util; spec=importlib.util.spec_from_file_location('u','${UNSTICK}'); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m); print(m._project_slug())")
  local alert="${_SHARED_ROOT}/loop/ALERT-${slug}.md"
  [ -f "$alert" ]
  grep -q "unstick: reverted US-STUCK-001" "$alert"
}
