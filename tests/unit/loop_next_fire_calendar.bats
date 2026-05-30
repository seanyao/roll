#!/usr/bin/env bats
# US-LOOP-036: _compute_next_fire — next fire epoch for daily (dream/brief)
# services. Two modes:
#   StartCalendarInterval (hour given): next HH:MM instant — today if not yet
#     passed, else tomorrow; calendar roll-over (year/leap-day) via timedelta.
#   StartInterval=86400 legacy (hour omitted): last_fire + 24h.

LIB="${BATS_TEST_DIRNAME}/../../lib"
STATUS="${LIB}/roll-loop-status.py"

# next_fire <kwargs-as-python> : eval _compute_next_fire and print the result
# as an ISO local datetime (or "None"). `now` is always a fixed instant so the
# assertion is deterministic across runners/timezones.
next_fire() {
  python3 -c "
import importlib.util
from datetime import datetime, timezone, timedelta
spec = importlib.util.spec_from_file_location('s', '${STATUS}')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
$1
"
}

@test "US-LOOP-036: calendar mode — HH:MM later today fires today" {
  run next_fire "
now = datetime(2026, 5, 30, 1, 0, 0).astimezone()
ep = m._compute_next_fire(hour=3, minute=20, now=now)
print(datetime.fromtimestamp(ep).strftime('%Y-%m-%d %H:%M'))
"
  [ "$status" -eq 0 ]
  [ "$output" = "2026-05-30 03:20" ]
}

@test "US-LOOP-036: calendar mode — HH:MM already passed fires tomorrow" {
  run next_fire "
now = datetime(2026, 5, 30, 5, 0, 0).astimezone()
ep = m._compute_next_fire(hour=3, minute=20, now=now)
print(datetime.fromtimestamp(ep).strftime('%Y-%m-%d %H:%M'))
"
  [ "$status" -eq 0 ]
  [ "$output" = "2026-05-31 03:20" ]
}

@test "US-LOOP-036: calendar mode — exact HH:MM now rolls to tomorrow" {
  run next_fire "
now = datetime(2026, 5, 30, 3, 20, 0).astimezone()
ep = m._compute_next_fire(hour=3, minute=20, now=now)
print(datetime.fromtimestamp(ep).strftime('%Y-%m-%d %H:%M'))
"
  [ "$status" -eq 0 ]
  [ "$output" = "2026-05-31 03:20" ]
}

@test "US-LOOP-036: calendar mode — year boundary rolls into next year" {
  run next_fire "
now = datetime(2026, 12, 31, 23, 50, 0).astimezone()
ep = m._compute_next_fire(hour=0, minute=10, now=now)
print(datetime.fromtimestamp(ep).strftime('%Y-%m-%d %H:%M'))
"
  [ "$status" -eq 0 ]
  [ "$output" = "2027-01-01 00:10" ]
}

@test "US-LOOP-036: calendar mode — leap-year Feb 29 is a valid fire day" {
  run next_fire "
now = datetime(2028, 2, 29, 1, 0, 0).astimezone()
ep = m._compute_next_fire(hour=3, minute=0, now=now)
print(datetime.fromtimestamp(ep).strftime('%Y-%m-%d %H:%M'))
"
  [ "$status" -eq 0 ]
  [ "$output" = "2028-02-29 03:00" ]
}

@test "US-LOOP-036: calendar mode — Feb 28 (non-leap) past time rolls to Mar 1" {
  run next_fire "
now = datetime(2027, 2, 28, 5, 0, 0).astimezone()
ep = m._compute_next_fire(hour=3, minute=0, now=now)
print(datetime.fromtimestamp(ep).strftime('%Y-%m-%d %H:%M'))
"
  [ "$status" -eq 0 ]
  [ "$output" = "2027-03-01 03:00" ]
}

@test "US-LOOP-036: legacy interval mode — last_fire + 24h" {
  run next_fire "
last = datetime(2026, 5, 30, 3, 0, 0).timestamp()
ep = m._compute_next_fire(hour=None, last_fire=last)
print(datetime.fromtimestamp(ep).strftime('%Y-%m-%d %H:%M'))
"
  [ "$status" -eq 0 ]
  [ "$output" = "2026-05-31 03:00" ]
}

@test "US-LOOP-036: legacy interval mode — no last_fire anchor returns None" {
  run next_fire "
print(m._compute_next_fire(hour=None, last_fire=None))
"
  [ "$status" -eq 0 ]
  [ "$output" = "None" ]
}
