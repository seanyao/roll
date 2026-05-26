#!/usr/bin/env python3
"""
roll-loop-story — compact per-story rollup for `roll loop story <ID>`.

Loads the same event / cron / runs / git-merge sources as roll-loop-status,
filters cycles to one story id (case-insensitive), and renders a single
panel covering cycles count, span, duration, tokens, cost, model, PR list,
and recent cycle lines.

Usage:
  roll loop story US-LOOP-004
  roll loop story us-loop-004                # case-insensitive
  roll loop story US-LOOP-004 --json         # machine-readable
  roll loop story US-LOOP-004 --days 30      # widen window (default 30)

Exit codes:
  0 — at least one cycle found
  2 — story id has no cycles in the event window
"""
from __future__ import annotations
import argparse, importlib.util, json, os, sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

_LIB_DIR = os.path.dirname(os.path.realpath(__file__))

# Reuse the loaders + aggregator from roll-loop-status.py. importlib because the
# filename has a hyphen and isn't import-safe.
_spec = importlib.util.spec_from_file_location(
    "_rls", os.path.join(_LIB_DIR, "roll-loop-status.py")
)
rls = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rls)


def collect_cycles(days: int) -> List[Dict[str, Any]]:
    slug = rls.project_slug()
    events = rls.load_events(slug, days)
    cron = rls.load_cron_log(slug)
    runs = rls.load_runs(slug)
    git_merges = rls.load_pr_merges_from_git(days)
    cycles = rls.aggregate(events, cron)
    if runs:
        rls.merge_runs_into_cycles(cycles, runs)
    if git_merges:
        rls.repair_orphan_cycles_from_git(cycles, git_merges)
    rls.backfill_usage_from_claude_sessions(cycles, slug)
    return cycles


def _outcome_glyph(o: str) -> str:
    return {"fail": "✗", "running": "⏵", "idle": "·"}.get(o, "✓")


def _fmt_dt(dt: datetime) -> str:
    return dt.astimezone().strftime("%Y-%m-%d %H:%M")


def _fmt_dur(s: int) -> str:
    if not s:
        return "—"
    h, rem = divmod(s, 3600)
    m, _ = divmod(rem, 60)
    return f"{h}h {m:02d}m" if h else f"{m}m"


def _fmt_tokens(n: int) -> str:
    if not n:
        return "0"
    if n >= 1_000_000:
        return f"{n/1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n/1_000:.0f}k"
    return str(n)


def _fmt_pr(p: Dict[str, Any]) -> str:
    g = {"merged": "✓", "closed": "✗"}.get(p["outcome"], "⏵")
    return f"#{p['num']} {g}"


def render_panel(r: Dict[str, Any], description: str = "") -> str:
    head = f"── {r['story_id']}"
    if description:
        head += f" · {description}"
    head += " " + "─" * max(0, 78 - len(head))

    cycles = r["cycles"]
    span = "—"
    if r.get("span_start") and r.get("span_end"):
        span = f"{_fmt_dt(r['span_start'])}  →  {_fmt_dt(r['span_end'])}"
    elif r.get("span_start"):
        span = f"{_fmt_dt(r['span_start'])}  →  (running)"

    counts = f"  cycles    {r['count']}  (✓ {r['ok_count']}  ✗ {r['fail_count']}  ⏵ {r['running_count']})"
    line_span = f"  span      {span}"
    line_dur = (f"  duration  {_fmt_dur(r['duration_s'])}"
                f"   tokens  in {_fmt_tokens(r['input_tokens'])}"
                f"  out {_fmt_tokens(r['output_tokens'])}"
                f"  cache w {_fmt_tokens(r['cache_creation_tokens'])}"
                f"  r {_fmt_tokens(r['cache_read_tokens'])}")
    model = r.get("model") or "—"
    line_cost = f"  cost      ${r['cost']:.2f}    model  {model}"

    prs = r.get("prs") or []
    line_prs = "  PRs       " + (" ".join(_fmt_pr(p) for p in prs[:8]) if prs else "—")

    # Recent 3 cycles (oldest → newest of the matched set; mirror confirmed layout).
    recent = sorted(cycles, key=lambda c: c.get("start") or datetime.min.replace(tzinfo=timezone.utc))[-3:]
    recent_lines: List[str] = []
    for i, cy in enumerate(recent):
        label = cy.get("label", "—")
        glyph = _outcome_glyph(cy.get("outcome", ""))
        cost = cy.get("cost_list")
        cost_s = f"${cost:.2f}" if cost is not None else "—"
        prefix = "  recent   " if i == 0 else "           "
        recent_lines.append(f"{prefix} {label}  {glyph}  {cost_s}")
    if not recent_lines:
        recent_lines.append("  recent    —")

    return "\n".join([head, counts, line_span, line_dur, line_cost, line_prs] + recent_lines)


def to_json(r: Dict[str, Any]) -> str:
    def conv(o: Any) -> Any:
        if isinstance(o, datetime):
            return o.astimezone(timezone.utc).isoformat()
        raise TypeError(f"{type(o)} not serializable")

    payload = {k: v for k, v in r.items() if k != "cycles"}
    payload["cycles"] = [
        {
            "label": cy.get("label"),
            "start": cy.get("start"),
            "end": cy.get("end"),
            "outcome": cy.get("outcome"),
            "duration_s": cy.get("duration_s"),
            "input_tokens": cy.get("input_tokens"),
            "output_tokens": cy.get("output_tokens"),
            "cache_creation_tokens": cy.get("cache_creation_tokens"),
            "cache_read_tokens": cy.get("cache_read_tokens"),
            "cost_list": cy.get("cost_list"),
            "model": cy.get("model"),
            "pr_num": cy.get("pr_num"),
            "pr_outcome": cy.get("pr_outcome"),
        }
        for cy in r.get("cycles", [])
    ]
    return json.dumps(payload, default=conv, indent=2)


def _backlog_description(story_id: str) -> str:
    bl = rls.load_backlog()
    return bl.get(story_id.upper(), "")


def main(argv=None) -> int:
    p = argparse.ArgumentParser(
        description="roll loop story — per-story cycle rollup")
    p.add_argument("story_id", help="Story ID (case-insensitive, e.g. US-LOOP-004)")
    p.add_argument("--days", type=int, default=30,
                   help="event window in days (default 30)")
    p.add_argument("--json", action="store_true",
                   help="emit machine-readable JSON instead of the panel")
    args = p.parse_args(argv)

    cycles = collect_cycles(args.days)
    r = rls.rollup_for_story(cycles, args.story_id)

    if args.json:
        print(to_json(r))
        return 0 if r["count"] > 0 else 2

    if r["count"] == 0:
        sys.stderr.write(
            f"roll loop story: no cycles found for {args.story_id} "
            f"in the last {args.days} days\n"
            f"未找到 {args.story_id} 在最近 {args.days} 天内的循环\n"
        )
        return 2

    print(render_panel(r, _backlog_description(args.story_id.upper())))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BrokenPipeError:
        pass
