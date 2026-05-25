#!/usr/bin/env bats

# Integration tests for US-LOOP-013: _loop_on and status display with schedule spec
# These tests verify that the human-readable schedule description flows through
# the display pipeline correctly.

setup() {
  source "${BATS_TEST_DIRNAME}/../../bin/roll"
  TEST_PROJECT="$(mktemp -d)"
  mkdir -p "${TEST_PROJECT}/.roll"
  export _SHARED_ROOT="$(mktemp -d)"
  mkdir -p "${_SHARED_ROOT}/loop"
}

teardown() {
  rm -rf "$TEST_PROJECT" "$_SHARED_ROOT"
}

# ─── _loop_schedule_desc + _loop_schedule_spec integration ───────────────────

@test "US-LOOP-013: display pipeline period=30 offset=0" {
  cat > "${TEST_PROJECT}/.roll/local.yaml" << 'YAML'
loop_schedule:
  period_minutes: 30
  offset_minute: 0
YAML
  local spec; spec=$(_loop_schedule_spec "$TEST_PROJECT")
  local period="${spec%% *}" offset="${spec##* }"
  [ "$period" = "30" ]
  [ "$offset" = "0" ]

  local desc_en; desc_en=$(_loop_schedule_desc "$period" "$offset" en)
  [ "$desc_en" = "every 30min (:00 :30)" ]

  local desc_zh; desc_zh=$(_loop_schedule_desc "$period" "$offset" zh)
  [ "$desc_zh" = "每30分鐘 (:00 :30)" ]
}

@test "US-LOOP-013: display pipeline period=15 offset=7" {
  cat > "${TEST_PROJECT}/.roll/local.yaml" << 'YAML'
loop_schedule:
  period_minutes: 15
  offset_minute: 7
YAML
  local spec; spec=$(_loop_schedule_spec "$TEST_PROJECT")
  local period="${spec%% *}" offset="${spec##* }"
  [ "$period" = "15" ]
  [ "$offset" = "7" ]

  local desc_en; desc_en=$(_loop_schedule_desc "$period" "$offset" en)
  [ "$desc_en" = "every 15min (:07 :22 :37 :52)" ]
}

@test "US-LOOP-013: display pipeline period=60 from global config" {
  local tmp_config="$(mktemp)"
  echo "loop_minute: 18" > "$tmp_config"
  export ROLL_CONFIG="$tmp_config"

  local spec; spec=$(_loop_schedule_spec "$TEST_PROJECT")
  local period="${spec%% *}" offset="${spec##* }"
  [ "$period" = "60" ]
  [ "$offset" = "18" ]

  local desc_en; desc_en=$(_loop_schedule_desc "$period" "$offset" en)
  [ "$desc_en" = "every hour :18" ]

  rm -f "$tmp_config"
}

@test "US-LOOP-013: display pipeline default (period=60)" {
  local spec; spec=$(_loop_schedule_spec "$TEST_PROJECT")
  local period="${spec%% *}" offset="${spec##* }"
  [ "$period" = "60" ]
  # offset is hash-derived, just verify valid
  [[ "$offset" =~ ^[0-9]+$ ]]
  [ "$offset" -ge 0 ]
  [ "$offset" -lt 60 ]

  local desc_en; desc_en=$(_loop_schedule_desc "$period" "$offset" en)
  [[ "$desc_en" =~ ^every\ hour\ :[0-9]+$ ]]
}

@test "US-LOOP-013: display pipeline period=5 offset=2" {
  cat > "${TEST_PROJECT}/.roll/local.yaml" << 'YAML'
loop_schedule:
  period_minutes: 5
  offset_minute: 2
YAML
  local spec; spec=$(_loop_schedule_spec "$TEST_PROJECT")
  local period="${spec%% *}" offset="${spec##* }"
  [ "$period" = "5" ]
  [ "$offset" = "2" ]

  local desc_en; desc_en=$(_loop_schedule_desc "$period" "$offset" en)
  [ "$desc_en" = "every 5min (:02 :07 :12 :17 :22 :27 :32 :37 :42 :47 :52 :57)" ]
}

# ─── _next_cron_hint Python v2 smoke test ─────────────────────────────────────

@test "US-LOOP-013: Python _read_schedule_spec returns valid defaults" {
  local result
  result=$(python3 -c "
import importlib.util
spec = importlib.util.spec_from_file_location('mod', '${BATS_TEST_DIRNAME}/../../lib/roll-loop-status.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
period, offset = mod._read_schedule_spec()
assert period == 60
assert 0 <= offset < 60
print(f'{period} {offset}')
")
  [ "$?" -eq 0 ]
  [[ "$result" =~ ^60\ [0-9]+$ ]]
}
