#!/usr/bin/env bats

setup() {
  local _saved_trap; _saved_trap="$(trap -p DEBUG 2>/dev/null || true)"
  trap - DEBUG
  source "${BATS_TEST_DIRNAME}/../../bin/roll"
  [[ -n "$_saved_trap" ]] && eval "$_saved_trap"
}

# ─── period=60 ────────────────────────────────────────────────────────────────

@test "_loop_schedule_desc: period=60 offset=18" {
  run _loop_schedule_desc 60 18 en
  [ "$status" -eq 0 ]
  [ "$output" = "every hour :18" ]
}

@test "_loop_schedule_desc: period=60 offset=0" {
  run _loop_schedule_desc 60 0 en
  [ "$status" -eq 0 ]
  [ "$output" = "every hour :00" ]
}

# ─── period=30 ────────────────────────────────────────────────────────────────

@test "_loop_schedule_desc: period=30 offset=0" {
  run _loop_schedule_desc 30 0 en
  [ "$status" -eq 0 ]
  [ "$output" = "every 30min (:00 :30)" ]
}

@test "_loop_schedule_desc: period=30 offset=7" {
  run _loop_schedule_desc 30 7 en
  [ "$status" -eq 0 ]
  [ "$output" = "every 30min (:07 :37)" ]
}

# ─── period=15 ────────────────────────────────────────────────────────────────

@test "_loop_schedule_desc: period=15 offset=7" {
  run _loop_schedule_desc 15 7 en
  [ "$status" -eq 0 ]
  [ "$output" = "every 15min (:07 :22 :37 :52)" ]
}

@test "_loop_schedule_desc: period=15 offset=0" {
  run _loop_schedule_desc 15 0 en
  [ "$status" -eq 0 ]
  [ "$output" = "every 15min (:00 :15 :30 :45)" ]
}

# ─── period=20 ────────────────────────────────────────────────────────────────

@test "_loop_schedule_desc: period=20 offset=5" {
  run _loop_schedule_desc 20 5 en
  [ "$status" -eq 0 ]
  [ "$output" = "every 20min (:05 :25 :45)" ]
}

# ─── period=10 ────────────────────────────────────────────────────────────────

@test "_loop_schedule_desc: period=10 offset=3" {
  run _loop_schedule_desc 10 3 en
  [ "$status" -eq 0 ]
  [ "$output" = "every 10min (:03 :13 :23 :33 :43 :53)" ]
}

# ─── period=5 ─────────────────────────────────────────────────────────────────

@test "_loop_schedule_desc: period=5 offset=2" {
  run _loop_schedule_desc 5 2 en
  [ "$status" -eq 0 ]
  [ "$output" = "every 5min (:02 :07 :12 :17 :22 :27 :32 :37 :42 :47 :52 :57)" ]
}

# ─── US-LOOP-032: non-divisor periods (no clock-aligned slots) ──────────────

@test "_loop_schedule_desc: period=45 offset=0 (non-divisor)" {
  run _loop_schedule_desc 45 0 en
  [ "$status" -eq 0 ]
  [ "$output" = "every 45min" ]
}

@test "_loop_schedule_desc: period=40 offset=0 (non-divisor)" {
  run _loop_schedule_desc 40 0 en
  [ "$status" -eq 0 ]
  [ "$output" = "every 40min" ]
}

@test "_loop_schedule_desc: period=90 offset=0 (non-divisor)" {
  run _loop_schedule_desc 90 0 en
  [ "$status" -eq 0 ]
  [ "$output" = "every 90min" ]
}

@test "_loop_schedule_desc: period=45 offset=0 zh" {
  run _loop_schedule_desc 45 0 zh
  [ "$status" -eq 0 ]
  [ "$output" = "每45分鐘" ]
}

# ─── Chinese locale (divisor periods) ───────────────────────────────────────

@test "_loop_schedule_desc: period=60 offset=18 zh" {
  run _loop_schedule_desc 60 18 zh
  [ "$status" -eq 0 ]
  [ "$output" = "每小時 :18" ]
}

@test "_loop_schedule_desc: period=30 offset=0 zh" {
  run _loop_schedule_desc 30 0 zh
  [ "$status" -eq 0 ]
  [ "$output" = "每30分鐘 (:00 :30)" ]
}

@test "_loop_schedule_desc: period=15 offset=7 zh" {
  run _loop_schedule_desc 15 7 zh
  [ "$status" -eq 0 ]
  [ "$output" = "每15分鐘 (:07 :22 :37 :52)" ]
}
