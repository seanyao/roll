#!/usr/bin/env bats
# Unit tests for lib/roll_render.py + the 4 data bug fixes in
# lib/roll-loop-status.py (US-VIEW-001).

LIB="${BATS_TEST_DIRNAME}/../../lib"

# Run a python snippet against the renderer / status modules.
run_py() {
  python3 -c "
import sys
sys.path.insert(0, '${LIB}')
import roll_render
roll_render.USE_COLOR = False
$1
"
}

@test "strw: ASCII characters count 1 cell each" {
  run run_py 'print(roll_render.strw("hello"))'
  [ "$status" -eq 0 ]
  [ "$output" = "5" ]
}

@test "strw: CJK characters count 2 cells each" {
  run run_py 'print(roll_render.strw("近 3 天"))'
  [ "$status" -eq 0 ]
  # 近(2) + space(1) + 3(1) + space(1) + 天(2) = 7
  [ "$output" = "7" ]
}

@test "strw: ANSI escapes are stripped before measuring" {
  run run_py 'print(roll_render.strw("\x1b[31mhello\x1b[0m"))'
  [ "$status" -eq 0 ]
  [ "$output" = "5" ]
}

@test "strip_ansi: removes CSI SGR sequences" {
  run run_py 'print(repr(roll_render.strip_ansi("\x1b[90m08:52:44\x1b[0m  cycle done")))'
  [ "$status" -eq 0 ]
  [[ "$output" == *"'08:52:44  cycle done'"* ]]
}

@test "pad: right-align numeric value within width" {
  run run_py 'print(repr(roll_render.pad("42", 6, "r")))'
  [ "$status" -eq 0 ]
  [[ "$output" == *"'    42'"* ]]
}

@test "pad: left-align string within width" {
  run run_py 'print(repr(roll_render.pad("hi", 5)))'
  [ "$status" -eq 0 ]
  [[ "$output" == *"'hi   '"* ]]
}

@test "fmt_delta: zero today and yesterday returns em-dash" {
  run run_py 'print(roll_render.fmt_delta(0, 0, kind="up_good"))'
  [ "$status" -eq 0 ]
  [[ "$output" == *"'—'"* ]]
  [[ "$output" == *"'muted'"* ]]
}

@test "fmt_delta: up_bad with growth flags red" {
  # chr(36) = '$', avoids shell/python escaping mismatch when running under
  # bats on different bash versions.
  run run_py "print(roll_render.fmt_delta(15.0, 10.0, kind='up_bad', unit=chr(36)))"
  [ "$status" -eq 0 ]
  [[ "$output" == *'+$5.00'* ]]
  [[ "$output" == *"'red'"* ]]
}

@test "fmt_delta: up_good with growth flags green" {
  run run_py 'print(roll_render.fmt_delta(5, 2, kind="up_good"))'
  [ "$status" -eq 0 ]
  [[ "$output" == *"'▲ +3'"* ]]
  [[ "$output" == *"'green'"* ]]
}

# ─── fmt_model: cycle row model column (US-VIEW-010) ────────────────────────

@test "fmt_model: opus with date suffix strips claude- prefix and date" {
  run run_py 'print(roll_render.fmt_model("claude-opus-4-7-20251001"))'
  [ "$status" -eq 0 ]
  [ "$output" = "opus-4-7" ]
}

@test "fmt_model: sonnet without date suffix" {
  run run_py 'print(roll_render.fmt_model("claude-sonnet-4-6"))'
  [ "$status" -eq 0 ]
  [ "$output" = "sonnet-4-6" ]
}

@test "fmt_model: haiku with date suffix" {
  run run_py 'print(roll_render.fmt_model("claude-haiku-4-5-20251001"))'
  [ "$status" -eq 0 ]
  [ "$output" = "haiku-4-5" ]
}

@test "fmt_model: None returns em-dash" {
  run run_py 'print(roll_render.fmt_model(None))'
  [ "$status" -eq 0 ]
  [ "$output" = "—" ]
}

@test "fmt_model: empty string returns em-dash" {
  run run_py 'print(roll_render.fmt_model(""))'
  [ "$status" -eq 0 ]
  [ "$output" = "—" ]
}

@test "fmt_model: non-claude vendor returns question mark" {
  run run_py 'print(roll_render.fmt_model("gpt-4-turbo"))'
  [ "$status" -eq 0 ]
  [ "$output" = "?" ]
}

# ─── roll-loop-status.py: 4 data bug regressions ────────────────────────────

run_status() {
  python3 -c "
import sys
sys.path.insert(0, '${LIB}')
import roll_render
roll_render.USE_COLOR = False
import importlib.util
spec = importlib.util.spec_from_file_location('status', '${LIB}/roll-loop-status.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
$1
"
}

@test "Bug A: pr label with loop/cycle- prefix normalizes to bare cycle id" {
  run run_status 'print(mod.normalize_cycle_label("loop/cycle-20260517-084804-59225"))'
  [ "$status" -eq 0 ]
  [ "$output" = "20260517-084804-59225" ]
}

@test "Bug A: pr event + cycle_start with mismatched labels bucket into one cycle" {
  run run_status '
from datetime import datetime, timezone, timedelta
ts = datetime(2026,5,17,8,48,0,tzinfo=timezone.utc)
te = ts + timedelta(minutes=5)
events = [
  {"ts": ts.isoformat(), "stage": "cycle_start", "label": "L1", "_ts": ts},
  {"ts": te.isoformat(), "stage": "pr",          "label": "loop/cycle-L1",
   "detail": "https://github.com/x/y/pull/9", "_ts": te},
  {"ts": te.isoformat(), "stage": "cycle_end",   "label": "L1", "outcome": "done", "_ts": te},
]
cs = mod.aggregate(events, [])
print(len(cs), cs[0]["pr"], cs[0]["outcome"])
'
  [ "$status" -eq 0 ]
  [[ "$output" == *"1 https://github.com/x/y/pull/9 done"* ]]
}

@test "Bug B: stage=idle is treated as cycle terminal with outcome=idle" {
  run run_status '
from datetime import datetime, timezone, timedelta
ts = datetime(2026,5,17,15,48,0,tzinfo=timezone.utc)
ti = ts + timedelta(seconds=115)
events = [
  {"ts": ts.isoformat(), "stage": "cycle_start", "label": "L2", "_ts": ts},
  {"ts": ti.isoformat(), "stage": "idle",        "label": "L2", "_ts": ti},
]
cs = mod.aggregate(events, [])
print(cs[0]["outcome"], cs[0]["end"] is not None)
'
  [ "$status" -eq 0 ]
  [[ "$output" == *"idle True"* ]]
}

@test "Bug C: today_key reflects real today even when no data for today" {
  run run_status '
import io, contextlib
from datetime import datetime, timezone, timedelta
now = datetime(2026,5,18,0,46,0,tzinfo=timezone.utc).astimezone()
ts = datetime(2026,5,17,8,48,0,tzinfo=timezone.utc)
events = [
  {"ts": ts.isoformat(), "stage": "cycle_start", "label": "L1", "_ts": ts},
  {"ts": (ts+timedelta(seconds=300)).isoformat(), "stage":"cycle_end", "label":"L1","outcome":"done", "_ts": ts+timedelta(seconds=300)},
]
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    mod.render(events, [], {}, {}, days=3, lang="en", now=now)
out = buf.getvalue()
import re
m = re.search(r"^\s*cycles\s+(\d+).*?(\d+)\s+(\d+)\s*$", out, re.M)
assert m, "cycles row not found"
print(m.group(1), m.group(2), m.group(3))   # today yest -2d
'
  [ "$status" -eq 0 ]
  # Today=0 (May 18 has no data), Yesterday=1 (May 17 cycle), -2d=0
  [[ "$output" == *"0 1 0"* ]]
}

# ─── cost_reported_usd regression (FIX-060) ──────────────────────────────────

@test "Bug E: aggregate keeps cost_reported_usd from last usage event" {
  run run_status '
from datetime import datetime, timezone, timedelta
ts = datetime(2026,5,18,10,0,0,tzinfo=timezone.utc)
events = [
  {"ts": ts.isoformat(), "stage": "cycle_start", "label": "L5", "_ts": ts},
  {"ts": ts.isoformat(), "stage": "usage", "label": "L5", "outcome": "ok",
   "detail": {"input_tokens": 100, "output_tokens": 50,
               "cache_creation_tokens": 0, "cache_read_tokens": 0,
               "cost_reported_usd": 5.0}},
  {"ts": ts.isoformat(), "stage": "usage", "label": "L5", "outcome": "ok",
   "detail": {"input_tokens": 3, "output_tokens": 0,
               "cache_creation_tokens": 0, "cache_read_tokens": 122089,
               "cost_reported_usd": 9.25}},
]
cs = mod.aggregate(events, [])
ue = cs[0].get("usage_event") or {}
print(ue.get("cost_reported_usd"))
'
  [ "$status" -eq 0 ]
  [[ "$output" == *"9.25"* ]]
}

@test "Bug E: backfill_usage uses cost_reported_usd instead of recomputing from last-event tokens" {
  run run_status '
from datetime import datetime, timezone
ts = datetime(2026,5,18,10,0,0,tzinfo=timezone.utc)
cycles = [{
    "label": "L5",
    "start": ts,
    "usage_event": {
        "input_tokens": 3,
        "output_tokens": 0,
        "cache_creation_tokens": 0,
        "cache_read_tokens": 122089,
        "cost_reported_usd": 9.25,
    },
}]
mod.backfill_usage_from_claude_sessions(cycles, "no-such-slug")
print(round(cycles[0].get("cost_list", 0), 2))
'
  [ "$status" -eq 0 ]
  # Must show 9.25 (cost_reported_usd), not ~0.04 (recomputed from 3 input tokens)
  [[ "$output" == *"9.25"* ]]
}
