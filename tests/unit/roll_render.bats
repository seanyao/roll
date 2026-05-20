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

@test "cycle_row: includes model column before cost (claude-opus-4-7-...)" {
  run run_py '
import io, contextlib
from datetime import datetime, timezone
cy = {
    "outcome": "done",
    "start": datetime(2026,5,19,22,37,0,tzinfo=timezone.utc),
    "duration_s": 1080,
    "tokens": 3_600_000,
    "cost_list": 2.65,
    "model": "claude-opus-4-7-20251001",
    "story": "US-VIEW-010",
}
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    roll_render.cycle_row(cy, {})
out = buf.getvalue()
i_model = out.find("opus-4-7")
i_cost  = out.find("$2.65")
i_id    = out.find("US-VIEW-010")
print(i_model > 0, i_model < i_cost, i_cost < i_id)
'
  [ "$status" -eq 0 ]
  [[ "$output" == *"True True True"* ]]
}

@test "cycle_row: missing model renders em-dash placeholder, not omitted" {
  run run_py '
import io, contextlib
from datetime import datetime, timezone
cy = {
    "outcome": "done",
    "start": datetime(2026,5,19,22,37,0,tzinfo=timezone.utc),
    "duration_s": 60,
    "tokens": 1000,
    "cost_list": 0.0,
    "model": None,
    "story": "US-X",
}
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    roll_render.cycle_row(cy, {})
out = buf.getvalue()
# em-dash appears at least once in the row (model column reserves space)
print("—" in out)
'
  [ "$status" -eq 0 ]
  [[ "$output" == *"True"* ]]
}

@test "cycle_row: narrow screen (COLS<100) omits model column" {
  run run_py '
import io, contextlib
from datetime import datetime, timezone
roll_render.COLS = 80
cy = {
    "outcome": "done",
    "start": datetime(2026,5,19,22,37,0,tzinfo=timezone.utc),
    "duration_s": 600,
    "tokens": 2_000_000,
    "cost_list": 1.20,
    "model": "claude-sonnet-4-6",
    "story": "US-X",
}
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    roll_render.cycle_row(cy, {})
out = buf.getvalue()
print("sonnet-4-6" in out)
'
  [ "$status" -eq 0 ]
  [[ "$output" == *"False"* ]]
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

# ─── US-VIEW-010: list-price cost (supersedes FIX-060 cost_reported_usd path) ──

@test "US-VIEW-010: aggregate sums token counts across multiple usage events" {
  run run_status '
from datetime import datetime, timezone
ts = datetime(2026,5,18,10,0,0,tzinfo=timezone.utc)
events = [
  {"ts": ts.isoformat(), "stage": "cycle_start", "label": "L6", "_ts": ts},
  {"ts": ts.isoformat(), "stage": "usage", "label": "L6", "outcome": "ok",
   "detail": {"model": "claude-sonnet-4-6",
              "input_tokens": 100, "output_tokens": 50,
              "cache_creation_tokens": 0, "cache_read_tokens": 0}},
  {"ts": ts.isoformat(), "stage": "usage", "label": "L6", "outcome": "ok",
   "detail": {"model": "claude-sonnet-4-6",
              "input_tokens": 3, "output_tokens": 0,
              "cache_creation_tokens": 0, "cache_read_tokens": 122089}},
]
cs = mod.aggregate(events, [])
ue = cs[0].get("usage_event") or {}
print(ue.get("input_tokens"), ue.get("output_tokens"), ue.get("cache_read_tokens"))
'
  [ "$status" -eq 0 ]
  # Summed: 100+3 = 103 input, 50+0 = 50 output, 0+122089 = 122089 cache_read
  [[ "$output" == *"103 50 122089"* ]]
}

# ─── US-VIEW-010 AC #3: cost column never trusts cost_reported_usd ───────────

@test "US-VIEW-010: backfill_usage always uses list-price (ignores cost_reported_usd)" {
  # AC #3 of US-VIEW-010: cost column shows list-price, NOT the AI client's
  # reported total_cost_usd (which may include subscription discounts).
  run run_status '
from datetime import datetime, timezone
ts = datetime(2026,5,18,10,0,0,tzinfo=timezone.utc)
# Tokens here are SUMMED per-cycle totals (aggregate sums per-turn deltas now —
# US-VIEW-010). List-price math over these tokens IS the true cycle cost, so
# cost_reported_usd is no longer needed as a workaround and must be ignored.
cycles = [{
    "label": "L5",
    "start": ts,
    "usage_event": {
        "model": "claude-sonnet-4-6",
        "input_tokens": 1000,
        "output_tokens": 500,
        "cache_creation_tokens": 200,
        "cache_read_tokens": 122089,
        "cost_reported_usd": 9.25,
    },
}]
mod.backfill_usage_from_claude_sessions(cycles, "no-such-slug")
# Sonnet-4-6 list price:
#   1000*3 + 500*15 + 200*3.75 + 122089*0.30
#   = 3000 + 7500 + 750 + 36626.7
#   = 47876.7 / 1e6 = $0.0479 (NOT the reported $9.25 — that must be ignored)
import math
assert math.isclose(cycles[0]["cost_list"], 0.0479, abs_tol=0.001), cycles[0]["cost_list"]
print("list-price")
'
  [ "$status" -eq 0 ]
  [[ "$output" == *"list-price"* ]]
}

# ─── US-VIEW-011: PR landing state per cycle ─────────────────────────────────

_pr_aggregate_check() {
  # Helper: feed cycle_start + pr event(s) + cycle_end, return (pr_outcome, pr_num).
  local outcome="$1" extra="${2:-}"
  run run_status "
from datetime import datetime, timezone, timedelta
ts = datetime(2026,5,20,10,0,0,tzinfo=timezone.utc)
events = [
  {'ts': ts.isoformat(), 'stage': 'cycle_start', 'label': 'L1', '_ts': ts},
  {'ts': (ts+timedelta(seconds=60)).isoformat(), 'stage': 'pr',
   'label': 'L1', 'detail': 'https://github.com/x/y/pull/42',
   'outcome': '${outcome}', '_ts': ts+timedelta(seconds=60)},
  ${extra}
  {'ts': (ts+timedelta(seconds=120)).isoformat(), 'stage': 'cycle_end',
   'label': 'L1', 'outcome': 'done', '_ts': ts+timedelta(seconds=120)},
]
cs = mod.aggregate(events, [])
print(cs[0].get('pr_outcome'), cs[0].get('pr_num'))
"
}

@test "US-VIEW-011 aggregate: outcome=merged captured + PR# parsed" {
  _pr_aggregate_check "merged"
  [ "$status" -eq 0 ]
  [[ "$output" == *"merged 42"* ]]
}

@test "US-VIEW-011 aggregate: outcome=closed captured" {
  _pr_aggregate_check "closed"
  [ "$status" -eq 0 ]
  [[ "$output" == *"closed 42"* ]]
}

@test "US-VIEW-011 aggregate: outcome=open captured" {
  _pr_aggregate_check "open"
  [ "$status" -eq 0 ]
  [[ "$output" == *"open 42"* ]]
}

@test "US-VIEW-011 aggregate: legacy outcome=ok renders as open (backward compat)" {
  _pr_aggregate_check "ok"
  [ "$status" -eq 0 ]
  [[ "$output" == *"open 42"* ]]
}

@test "US-VIEW-011 aggregate: later pr event overwrites earlier (open→merged)" {
  _pr_aggregate_check "open" "
  {'ts': (ts+timedelta(seconds=90)).isoformat(), 'stage': 'pr',
   'label': 'L1', 'detail': 'https://github.com/x/y/pull/42',
   'outcome': 'merged', '_ts': ts+timedelta(seconds=90)},"
  [ "$status" -eq 0 ]
  [[ "$output" == *"merged 42"* ]]
}

@test "US-VIEW-011 rollup: only merged outcome counts as merged PR" {
  run run_status '
from datetime import datetime, timezone, timedelta
ts = datetime(2026,5,20,10,0,0,tzinfo=timezone.utc)
def mkcy(lbl, oc, sec):
  s = ts + timedelta(seconds=sec)
  e = s + timedelta(seconds=30)
  return [
    {"ts": s.isoformat(), "stage": "cycle_start", "label": lbl, "_ts": s},
    {"ts": e.isoformat(), "stage": "pr", "label": lbl,
     "detail": "https://github.com/x/y/pull/1", "outcome": oc, "_ts": e},
    {"ts": e.isoformat(), "stage": "cycle_end", "label": lbl,
     "outcome": "done", "_ts": e},
  ]
events = mkcy("M", "merged", 0) + mkcy("C", "closed", 100) + mkcy("O", "open", 200)
cs = mod.aggregate(events, [])
r = mod.rollup_for_day(cs)
print("prs=" + str(r["prs"]))
'
  [ "$status" -eq 0 ]
  [[ "$output" == *"prs=1"* ]]
}

@test "US-VIEW-011 cycle_row: pr_outcome=merged appends #NN with ✓" {
  run run_py '
import io, contextlib
from datetime import datetime, timezone
cy = {
    "outcome": "done",
    "start": datetime(2026,5,20,10,0,0,tzinfo=timezone.utc),
    "duration_s": 600, "tokens": 1_000_000, "cost_list": 1.50,
    "model": "claude-opus-4-7-20251001", "story": "US-VIEW-011",
    "pr_num": 77, "pr_outcome": "merged",
}
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    roll_render.cycle_row(cy, {})
out = buf.getvalue()
# id appears, then #77 ✓ after it; glyph stays ✓
print("#77" in out, "#77 ✓" in out, out.lstrip().startswith("✓"))
'
  [ "$status" -eq 0 ]
  [[ "$output" == *"True True True"* ]]
}

@test "US-VIEW-011 cycle_row: pr_outcome=closed appends #NN ↩ and glyph becomes ⊘" {
  run run_py '
import io, contextlib
from datetime import datetime, timezone
cy = {
    "outcome": "done",
    "start": datetime(2026,5,20,10,0,0,tzinfo=timezone.utc),
    "duration_s": 600, "tokens": 1_000_000, "cost_list": 1.50,
    "model": "claude-opus-4-7-20251001", "story": "US-VIEW-011",
    "pr_num": 99, "pr_outcome": "closed",
}
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    roll_render.cycle_row(cy, {})
out = buf.getvalue()
# closed PR: marker #99 ↩ and glyph ⊘ (not ✓)
print("#99 ↩" in out, "⊘" in out, "✓" not in out)
'
  [ "$status" -eq 0 ]
  [[ "$output" == *"True True True"* ]]
}

@test "US-VIEW-011 cycle_row: pr_outcome=open appends #NN …" {
  run run_py '
import io, contextlib
from datetime import datetime, timezone
cy = {
    "outcome": "done",
    "start": datetime(2026,5,20,10,0,0,tzinfo=timezone.utc),
    "duration_s": 600, "tokens": 1_000_000, "cost_list": 1.50,
    "model": "claude-opus-4-7-20251001", "story": "US-VIEW-011",
    "pr_num": 55, "pr_outcome": "open",
}
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    roll_render.cycle_row(cy, {})
out = buf.getvalue()
print("#55 …" in out, out.lstrip().startswith("✓"))
'
  [ "$status" -eq 0 ]
  [[ "$output" == *"True True"* ]]
}

@test "US-VIEW-011 cycle_row: no pr_num leaves row unchanged (no marker, no glyph swap)" {
  run run_py '
import io, contextlib
from datetime import datetime, timezone
cy = {
    "outcome": "done",
    "start": datetime(2026,5,20,10,0,0,tzinfo=timezone.utc),
    "duration_s": 600, "tokens": 1_000_000, "cost_list": 1.50,
    "model": "claude-opus-4-7-20251001", "story": "US-VIEW-011",
}
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    roll_render.cycle_row(cy, {})
out = buf.getvalue()
# no PR markers anywhere
print("#" not in out, "↩" not in out, "⊘" not in out, "…" not in out)
'
  [ "$status" -eq 0 ]
  [[ "$output" == *"True True True True"* ]]
}
