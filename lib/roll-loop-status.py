#!/usr/bin/env python3
"""
roll-loop-status — render the `roll loop` health dashboard.

Reads (all per-project, slug = <basename>-<md5_6chars> of project root):
  $ROLL_SHARED_ROOT/loop/events-<slug>.ndjson   structured per-cycle events
  $ROLL_SHARED_ROOT/loop/cron-<slug>.log        wall-clock dur + cost per cycle
  $ROLL_SHARED_ROOT/loop/state-<slug>.yaml      idle | running | paused
  ./BACKLOG.md                                   story id → description

Writes (stdout):
  Static 100-col colored print, EN/ZH paired rows. Designed for a 5-10s glance,
  leaves the dashboard in scrollback. Honors NO_COLOR; degrades to 80 cols.

Usage:
  python3 lib/roll-loop-status.py              # default 3-day window
  python3 lib/roll-loop-status.py --days 7
  python3 lib/roll-loop-status.py --no-color
  python3 lib/roll-loop-status.py --en | --zh  # collapse bilingual rows
  python3 lib/roll-loop-status.py --demo       # render with fixture data

  Wire it in bin/roll under `loop status` (replace _loop_status with a call to
  this script).
"""

from __future__ import annotations
import argparse, hashlib, json, os, re, subprocess, sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

# Shared rendering primitives — see lib/roll_render.py for the design system.
_LIB_DIR = os.path.dirname(os.path.realpath(__file__))
if _LIB_DIR not in sys.path:
    sys.path.insert(0, _LIB_DIR)
import roll_render
from roll_render import (
    PAL, BOLD, RESET, COLS, c, strw, pad, row,
    fmt_dur, fmt_delta, trunc, empty_rollup,
    section_head, metric, metric_dur, metric_dollar,
    day_band, cycle_row,
)

# ════════════════════════════════════════════════════════════════════════════
# Paths — must match bin/roll's _project_slug + _SHARED_ROOT defaults
# ════════════════════════════════════════════════════════════════════════════
def project_slug(path: Optional[str] = None) -> str:
    path = os.path.realpath(path or os.getcwd())
    try:  # resolve git worktree → main tree (FIX-034 in bin/roll)
        common = subprocess.check_output(
            ["git", "-C", path, "rev-parse", "--git-common-dir"],
            stderr=subprocess.DEVNULL, text=True
        ).strip()
        if common.endswith("/.git"):
            path = common[:-5]
    except Exception:
        pass
    base = re.sub(r"[^A-Za-z0-9]+", "-", os.path.basename(path)).strip("-")
    h = hashlib.md5(path.encode()).hexdigest()[:6]
    return f"{base}-{h}"

def shared_root() -> Path:
    return Path(os.environ.get("ROLL_SHARED_ROOT") or os.path.expanduser("~/.shared/roll"))

# ════════════════════════════════════════════════════════════════════════════
# Loaders
# ════════════════════════════════════════════════════════════════════════════
def load_events(slug: str, days: int) -> List[Dict[str, Any]]:
    path = shared_root() / "loop" / f"events-{slug}.ndjson"
    if not path.exists():
        return []
    cutoff = datetime.now(timezone.utc) - timedelta(days=days + 1)  # +1 for grace
    out: List[Dict[str, Any]] = []
    with path.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                e = json.loads(line)
                e["_ts"] = datetime.fromisoformat(e["ts"].replace("Z", "+00:00"))
                if e["_ts"] >= cutoff:
                    out.append(e)
            except Exception:
                continue
    return out

# cron.log entry format (from bin/roll):
#   "03:49:25  cycle done — done · 981s · $4.53"
#   "03:57:35  cycle done — done · 1 tcr · 538s · $3.20"
_CRON_PAT = re.compile(
    r"^(\d{2}:\d{2}):(\d{2})\s+cycle done — (\w+)"
    r"(?:\s*·\s*(\d+)\s+tcr)?"
    r"\s*·\s*(\d+)s"
    r"\s*·\s*\$([\d.]+)"
)

def load_cron_log(slug: str) -> List[Dict[str, Any]]:
    """Return ordered list of cron entries with local HH:MM:SS + extracted fields."""
    path = shared_root() / "loop" / f"cron-{slug}.log"
    if not path.exists():
        return []
    out: List[Dict[str, Any]] = []
    with path.open(errors="ignore") as f:
        for line in f:
            m = _CRON_PAT.match(line.strip())
            if m:
                out.append({
                    "hhmm": m.group(1),
                    "ss": int(m.group(2)),
                    "outcome": m.group(3),
                    "tcr": int(m.group(4) or 0),
                    "duration_s": int(m.group(5)),
                    "cost": float(m.group(6)),
                })
    return out

def load_state(slug: str) -> Dict[str, str]:
    """Tiny YAML reader — only the flat keys bin/roll writes."""
    path = shared_root() / "loop" / f"state-{slug}.yaml"
    if not path.exists():
        return {}
    out: Dict[str, str] = {}
    for line in path.open(errors="ignore"):
        m = re.match(r"^([\w_]+):\s*(.*?)\s*$", line)
        if m:
            out[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return out

def load_backlog(project_root: Optional[Path] = None) -> Dict[str, str]:
    """Map story id → description from BACKLOG.md table rows."""
    path = (project_root or Path()) / "BACKLOG.md"
    if not path.exists():
        return {}
    out: Dict[str, str] = {}
    pat = re.compile(r"^\|\s*(?:\[)?([A-Z]+-\d+)(?:\]\([^)]+\))?\s*\|\s*([^|]+?)\s*\|")
    with path.open() as f:
        for line in f:
            m = pat.match(line)
            if m:
                out[m.group(1)] = m.group(2)
    return out

# ════════════════════════════════════════════════════════════════════════════
# Cycle aggregation — group events by cycle label; attach cron + story id
# ════════════════════════════════════════════════════════════════════════════
_STORY_ID_PAT = re.compile(r"\b([A-Z]+-\d+)\b")

def _extract_story_id(ev_detail: str) -> Optional[str]:
    if not ev_detail:
        return None
    m = _STORY_ID_PAT.search(ev_detail)
    return m.group(1) if m else None

def normalize_cycle_label(lbl: str) -> str:
    """Strip the 'loop/cycle-' branch-name prefix so pr events bucket with
    their cycle_start/end siblings (Bug A — see plan §3)."""
    if lbl.startswith("loop/cycle-"):
        return lbl[len("loop/cycle-"):]
    return lbl

def aggregate(events: List[Dict[str, Any]], cron: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Build a per-cycle list (newest first), tmp-* filtered."""
    by_label: Dict[str, Dict[str, Any]] = defaultdict(
        lambda: {"start": None, "end": None, "outcome": None, "story": None,
                 "pr": None, "label": None, "fail_detail": None}
    )
    for e in events:
        lbl = normalize_cycle_label(e.get("label", ""))
        if not lbl or lbl.startswith("tmp-"):
            continue
        cy = by_label[lbl]
        cy["label"] = lbl
        stage = e.get("stage", "")
        detail = e.get("detail", "")
        if stage == "cycle_start":
            cy["start"] = e["_ts"]
        elif stage == "cycle_end":
            cy["end"] = e["_ts"]
            cy["outcome"] = e.get("outcome", "done")
        elif stage == "idle":
            # Bug B: cycles that find no Todo emit 'idle' instead of 'cycle_end'.
            # Treat as terminal with a distinct outcome so they stop showing
            # as 'still running' forever.
            cy["end"] = e["_ts"]
            cy["outcome"] = "idle"
        elif stage == "pr":
            cy["pr"] = detail
            sid = _extract_story_id(detail) or _extract_story_id(lbl)
            if sid and not cy.get("story"):
                cy["story"] = sid
        elif stage == "pick_todo":
            sid = _extract_story_id(detail)
            if sid:
                cy["story"] = sid
        elif stage in ("test", "build") and e.get("outcome") == "fail":
            cy["fail_detail"] = detail or stage

    # Drop incomplete entries; sort newest-first by start time.
    cycles = [v for v in by_label.values() if v["start"]]
    cycles.sort(key=lambda x: x["start"], reverse=True)

    # Match cron-log entries by HH:MM:SS proximity to cycle_end (within ±90s).
    # Cron logs are local-time HH:MM:SS; events are UTC.
    for cy in cycles:
        end_local = (cy["end"] or cy["start"]).astimezone()
        target = end_local.hour * 3600 + end_local.minute * 60 + end_local.second
        best = None
        best_dt = 999
        for cr in cron:
            ch, cm = cr["hhmm"].split(":")
            csec = int(ch) * 3600 + int(cm) * 60 + cr["ss"]
            dt = abs(csec - target)
            if dt < best_dt:
                best_dt = dt
                best = cr
        if best and best_dt <= 120:
            cy["cron"] = best
        # Default outcome if missing (e.g. cycle never ended → still running, or crashed).
        if not cy.get("outcome"):
            cy["outcome"] = "running" if not cy.get("end") else "unknown"
    return cycles

# ════════════════════════════════════════════════════════════════════════════
# Rollup math — by day buckets in LOCAL time
# ════════════════════════════════════════════════════════════════════════════
def bucket_by_day(cycles: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    out: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for cy in cycles:
        day = cy["start"].astimezone().strftime("%Y-%m-%d")
        out[day].append(cy)
    return out

def rollup_for_day(day_cycles: List[Dict[str, Any]]) -> Dict[str, Any]:
    r = {"cycles": len(day_cycles), "prs": 0, "failed": 0,
         "duration_s": 0, "cost": 0.0, "tokens": 0}
    for cy in day_cycles:
        if cy.get("outcome") == "fail":
            r["failed"] += 1
        if cy.get("pr") and cy["pr"].startswith("http"):
            r["prs"] += 1
        cr = cy.get("cron")
        if cr:
            r["duration_s"] += cr["duration_s"]
            r["cost"] += cr["cost"]
    return r

# ════════════════════════════════════════════════════════════════════════════
# Render
# ════════════════════════════════════════════════════════════════════════════
def render(events, cron, state, backlog, *, days=3, lang="both", now=None):
    now = now or datetime.now(timezone.utc).astimezone()
    cycles = aggregate(events, cron)
    by_day = bucket_by_day(cycles)
    days_keys = sorted(by_day.keys(), reverse=True)[:days]

    def bilingual(en_line, zh_line):
        """Emit EN row then ZH row, honoring --en / --zh."""
        if lang in ("both", "en"):
            print(en_line)
        if lang in ("both", "zh") and zh_line is not None:
            print(zh_line)

    # ── Title row ───────────────────────────────────────────────────────────
    n_cycles = len(cycles)
    title_l = c("fg", "roll loop", bold=True) + c("muted", "  ·  ") + c("dim", "health")
    title_r = c("dim", now.strftime("%Y-%m-%d %H:%M")) + c("muted", " · ") + c("muted", f"{n_cycles} cycles / {days*24}h")
    print(row(title_l, title_r))
    print()

    # ── Status eyebrow ─────────────────────────────────────────────────────
    status_word = (state.get("status") or "idle").lower()
    if status_word == "running":
        item = state.get("current_item") or "—"
        eb_l = (c("purple", "⏵", bold=True) + " " +
                c("purple", "RUNNING", bold=True) + c("muted", "   ") +
                c("dim", "story ") + c("blue", item, bold=True))
        eb_zh = (c("dim", "  正在运行 · 当前 ") + c("blue", item))
    elif status_word == "paused":
        eb_l = (c("amber", "⏸ PAUSED", bold=True) + c("muted", "   ") +
                c("dim", "since ") + c("fg", state.get("paused_at", "—")) +
                c("muted", " · ") + c("dim", state.get("paused_reason", "")))
        eb_zh = c("dim", "  已暂停 · run: roll loop resume")
    else:
        eb_l = (c("blue", "● IDLE", bold=True) + c("muted", "   ") +
                c("dim", "next run ") + c("fg", _next_cron_hint(state), bold=True))
        eb_zh = c("dim", f"  闲置 · 距下一轮 {_next_cron_hint(state, zh=True)}")

    last = cycles[0] if cycles else None
    if last:
        story = last.get("story") or "—"
        title = backlog.get(story, "") if story != "—" else ""
        glyph = c("green", "✓", bold=True) if last["outcome"] == "done" else c("red", "✗", bold=True)
        eb_r = (c("dim", "last ") + glyph + " " +
                c("fg", last["start"].astimezone().strftime("%H:%M")) + "  " +
                c("blue", story, bold=True) + "  " +
                c("fg", trunc(title, 32)))
    else:
        eb_r = c("muted", "no cycles yet")
    print(row(eb_l, eb_r))
    if lang != "en" and last:
        zh_title = ""  # BACKLOG.md is single-language; leave ZH side as the running indicator only
        print(eb_zh + " " * max(0, COLS - strw(eb_zh) - strw(eb_r)) + c("dim", ""))
    print()

    print(c("faint", "─" * COLS))
    print()

    # ── 3-day rollup ────────────────────────────────────────────────────────
    section_head("ROLLUP", "近 " + str(days) + " 天", "↑ today vs yesterday · 今日 vs 昨日")
    print()

    # column widths: name(14) val(6) gap(2) delta(10) yest(10) -2d(8) gap(3) trend(rest)
    cols = days_keys + [""] * (3 - len(days_keys))  # pad to at least 3 columns
    today_key = cols[0] if cols else None
    yest_key  = cols[1] if len(cols) > 1 else None
    d2_key    = cols[2] if len(cols) > 2 else None

    today = rollup_for_day(by_day.get(today_key, [])) if today_key else empty_rollup()
    yest  = rollup_for_day(by_day.get(yest_key, []))  if yest_key  else empty_rollup()
    d2    = rollup_for_day(by_day.get(d2_key, []))    if d2_key    else empty_rollup()

    # column headers
    hdr_en = ("  " + c("muted", pad("", 14)) +
              c("fg", pad("Today", 18), bold=True) +
              c("dim", pad("Yesterday", 10)) +
              c("muted", pad("−2d", 8)) + "   " +
              c("muted", "trend · 趋势"))
    hdr_zh = ("  " + c("muted", pad("", 14)) +
              c("dim", pad("今日", 18)) +
              c("muted", pad("昨日", 10)) +
              c("muted", pad("前天", 8)))
    bilingual(hdr_en, hdr_zh)

    metric("cycles",    today["cycles"],    yest["cycles"],    d2["cycles"],    "up_good")
    metric("merged PRs", today["prs"],      yest["prs"],       d2["prs"],       "up_good")
    metric("failed",    today["failed"],    yest["failed"],    d2["failed"],    "up_bad",
           yest_color="amber" if yest["failed"] > 0 else "dim",
           yest_suffix="⚠" if yest["failed"] > 0 else "")
    metric_dur("duration", today["duration_s"], yest["duration_s"], d2["duration_s"])
    metric_dollar("cost", today["cost"], yest["cost"], d2["cost"])

    print()
    print(c("faint", "─" * COLS))
    print()

    # ── Recent cycles ───────────────────────────────────────────────────────
    section_head("RECENT", f"最近 {len(cycles)} 个 cycle",
                 "t · time   Δ · duration   $ · cost   id · backlog")
    print()

    if not cycles:
        print("  " + c("dim", "no cycles yet — first run fires on next cron tick"))
        print("  " + c("dim", "尚无 cycle · 等待下一次 cron 触发"))
        return

    for day_key in days_keys:
        day_cycles = by_day[day_key]
        if not day_cycles:
            continue
        day_band(day_key, len(day_cycles),
                 sum(1 for c0 in day_cycles if c0["outcome"] == "fail"),
                 now)
        for cy in day_cycles:
            cycle_row(cy, backlog)
        print()

    print(c("faint", "─" * COLS))
    print()
    print("  " +
          c("dim", "drill   ") + c("blue", "roll loop show <cycle>") +
          c("muted", "       ") +
          c("dim", "watch   ") + c("blue", "roll loop --watch") +
          c("muted", "       ") +
          c("dim", "more   ") + c("blue", "roll loop --days 7"))

def _next_cron_hint(state: Dict[str, str], zh: bool = False) -> str:
    """Best-effort next-cron string. The real schedule lives in launchd/cron;
    we only have access to last_run here, so we approximate to the next :48."""
    now = datetime.now().astimezone()
    minute_target = 48  # bin/roll default; per-project may differ
    nxt = now.replace(minute=minute_target, second=0, microsecond=0)
    if nxt <= now:
        nxt += timedelta(hours=1)
    delta = nxt - now
    mins = int(delta.total_seconds() // 60)
    secs = int(delta.total_seconds() % 60)
    if zh:
        return f"{mins} 分 {secs:02d} 秒"
    return nxt.strftime("%H:%M") + f" · in {mins}m {secs:02d}s"

# ════════════════════════════════════════════════════════════════════════════
# Demo fixture — lets you preview the output without real data
# ════════════════════════════════════════════════════════════════════════════
def _demo_data():
    now = datetime.now(timezone.utc)
    events, cron = [], []
    cycle_id = 0
    for d in (2, 1, 0):
        day = now - timedelta(days=d)
        n_cycles = [3, 4, 5][2 - d]
        for i in range(n_cycles):
            hour = 0 + i * 5
            start = day.replace(hour=hour, minute=48, second=0, microsecond=0)
            end = start + timedelta(seconds=540 + i * 120)
            label = start.strftime("%Y%m%d-%H%M%S-30585")
            story = ["FIX-048", "US-112", "FIX-047", "REFACT-9", "FIX-040"][i % 5]
            outcome = "fail" if (d == 1 and i == 2) else "done"
            events.extend([
                {"ts": start.isoformat().replace("+00:00", "Z"), "stage": "cycle_start",
                 "label": label, "detail": "", "outcome": "", "_ts": start},
                {"ts": start.isoformat().replace("+00:00", "Z"), "stage": "pick_todo",
                 "label": label, "detail": f"{story} picked", "outcome": "ok",
                 "_ts": start + timedelta(seconds=2)},
                {"ts": end.isoformat().replace("+00:00", "Z"), "stage": "cycle_end",
                 "label": label, "detail": "", "outcome": outcome, "_ts": end},
            ])
            if outcome == "done":
                events.append({"ts": end.isoformat().replace("+00:00", "Z"),
                               "stage": "pr", "label": label,
                               "detail": f"https://github.com/x/y/pull/{50 + cycle_id}",
                               "outcome": "ok", "_ts": end - timedelta(seconds=1)})
            local = end.astimezone()
            cron.append({"hhmm": local.strftime("%H:%M"), "ss": local.second,
                         "outcome": outcome, "tcr": 1 if outcome == "done" else 0,
                         "duration_s": int((end - start).total_seconds()),
                         "cost": 3.20 + i * 0.32})
            cycle_id += 1
    state = {"status": "idle", "last_run_outcome": "success"}
    backlog = {
        "FIX-048":  "Dedupe Todo across cycles",
        "US-112":   "Loop run summary report",
        "FIX-047":  "Cycle log rotation by day",
        "REFACT-9": "Extract stage runner module",
        "FIX-040":  "8/12 tests failed → bail",
    }
    return events, cron, state, backlog

# ════════════════════════════════════════════════════════════════════════════
# CLI
# ════════════════════════════════════════════════════════════════════════════
def main(argv=None):
    p = argparse.ArgumentParser(description="roll loop status — health dashboard")
    p.add_argument("--days", type=int, default=3, help="window in days (default 3)")
    p.add_argument("--no-color", action="store_true", help="strip ANSI (also honors NO_COLOR=1)")
    p.add_argument("--en", action="store_true", help="EN rows only")
    p.add_argument("--zh", action="store_true", help="ZH rows only")
    p.add_argument("--demo", action="store_true", help="render with fixture data")
    args = p.parse_args(argv)

    roll_render.USE_COLOR = (not args.no_color
                             and not os.environ.get("NO_COLOR")
                             and (sys.stdout.isatty() or os.environ.get("FORCE_COLOR")))

    lang = "en" if args.en else ("zh" if args.zh else "both")

    if args.demo:
        events, cron, state, backlog = _demo_data()
    else:
        slug = project_slug()
        events  = load_events(slug, args.days)
        cron    = load_cron_log(slug)
        state   = load_state(slug)
        backlog = load_backlog()

    render(events, cron, state, backlog, days=args.days, lang=lang)

if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass  # piped to `less` etc.
