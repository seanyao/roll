#!/usr/bin/env python3
"""Render a one-cycle exit summary block for the loop's .command window (US-LOOP-040).

When a `roll loop` cycle ends, the macOS `.command` Terminal window that was
attached to the tmux session is left showing only a `press enter to close`
prompt. The full Cycle Phase Breakdown / runs.jsonl data already exists on disk
but the user has to scroll back through tmux scrollback or open
``~/.shared/roll/loop/cron-<slug>.log`` to see what the cycle did.

This helper renders a compact ``─── Cycle <CYCLE_ID> Summary ───`` block to
stdout, consumed by the ``.command`` shell *before* the `press enter` prompt.
It is a pure read-side view: it never writes new files and never mutates loop
state.

Five signals (per the US-LOOP-040 issue):

  1. result   — runs.jsonl latest row's ``status`` + ``built[]`` + ``tcr_count``
                (idle cycle → ``idle: no story picked``)
  2. ci       — newest ``ci`` event outcome from events.ndjson tail
                (``ok``→green, ``red``→red, ``heal-attempting`` passthrough,
                no event → ``ci: n/a``)
  3. todo     — count of ``📋 Todo`` lines in .roll/backlog.md
  4. phases   — runs.jsonl ``phases`` map, top 5 by duration desc
  5. alerts   — raw failure / alert text placeholder (US-LOOP-041 adds colour)

Data-source priority: runs.jsonl latest matching row > events.ndjson tail >
fall back to the cron log's last 30 lines. Any missing source degrades
silently — the renderer never errors and never blocks `press enter`.

When no usable data exists at all (idle/aborted early-exit, runs.jsonl not yet
flushed) it prints a single
``(summary unavailable — see log: <cron-log>)`` line instead.

Invocation::

    python3 loop-exit-summary.py \
        --runs   <runs.jsonl> \
        --events <events.ndjson> \
        --backlog <.roll/backlog.md> \
        --cron-log <cron-<slug>.log> \
        [--cycle-id <id>]

All paths are optional; a missing / unreadable file is treated as absent.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Dict, List, Optional


def _read_last_json_line(path: Optional[str], cycle_id: str = "") -> Optional[Dict[str, Any]]:
    """Return the last well-formed JSON object from a .jsonl file.

    When ``cycle_id`` is given, prefer the last row whose ``cycle_id`` matches;
    otherwise fall back to the last parseable row. Returns None when the file
    is absent, empty, or has no parseable rows.
    """
    if not path or not os.path.isfile(path):
        return None
    last: Optional[Dict[str, Any]] = None
    matched: Optional[Dict[str, Any]] = None
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except (ValueError, TypeError):
                    continue
                if not isinstance(obj, dict):
                    continue
                last = obj
                if cycle_id and obj.get("cycle_id") == cycle_id:
                    matched = obj
    except OSError:
        return None
    return matched if matched is not None else last


def _read_json_lines(path: Optional[str]) -> List[Dict[str, Any]]:
    """Return all well-formed JSON objects from a .ndjson file (in order)."""
    out: List[Dict[str, Any]] = []
    if not path or not os.path.isfile(path):
        return out
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except (ValueError, TypeError):
                    continue
                if isinstance(obj, dict):
                    out.append(obj)
    except OSError:
        return out
    return out


def _latest_ci_outcome(events: List[Dict[str, Any]]) -> Optional[str]:
    """Newest ``ci`` event outcome from an events stream, or None."""
    for ev in reversed(events):
        if ev.get("stage") == "ci":
            outcome = ev.get("outcome")
            if outcome:
                return str(outcome)
    return None


def _count_todo(path: Optional[str]) -> Optional[int]:
    """Count lines bearing the 📋 Todo marker in backlog.md. None if absent."""
    if not path or not os.path.isfile(path):
        return None
    count = 0
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if "📋" in line and "Todo" in line:
                    count += 1
    except OSError:
        return None
    return count


def _tail_lines(path: Optional[str], n: int) -> List[str]:
    """Last ``n`` non-empty lines of a text file, or [] when absent."""
    if not path or not os.path.isfile(path):
        return []
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            lines = [ln.rstrip("\n") for ln in fh]
    except OSError:
        return []
    return lines[-n:]


def _fmt_ci(outcome: Optional[str]) -> str:
    if outcome is None:
        return "ci: n/a"
    mapping = {"ok": "green", "green": "green", "red": "red",
               "heal-attempting": "heal-attempting"}
    return "ci: " + mapping.get(outcome, outcome)


def _fmt_result(row: Dict[str, Any]) -> str:
    status = row.get("status", "")
    built = row.get("built") or []
    tcr = row.get("tcr_count", 0)
    if status == "idle" or (not built and status in ("", "idle")):
        return "idle: no story picked"
    if built:
        built_str = " ".join(str(b) for b in built)
        return "built: {0} · tcr commits: {1}".format(built_str, tcr)
    # non-idle terminal with no built[] (failed/aborted/blocked/orphan)
    return "{0} · tcr commits: {1}".format(status or "unknown", tcr)


def _fmt_phases(phases: Dict[str, Any], limit: int = 5) -> List[str]:
    rows: List[tuple] = []
    for name, dur in phases.items():
        try:
            rows.append((int(dur), str(name)))
        except (ValueError, TypeError):
            continue
    rows.sort(key=lambda r: (-r[0], r[1]))
    out = []
    for dur, name in rows[:limit]:
        out.append("  {0:<22} {1:>5}s".format(name, dur))
    return out


def render(runs: Optional[str], events: Optional[str], backlog: Optional[str],
           cron_log: Optional[str], cycle_id: str = "") -> str:
    """Build the summary block as a plain-text string (no ANSI in US-LOOP-040)."""
    row = _read_last_json_line(runs, cycle_id)
    ev_list = _read_json_lines(events)
    ci_outcome = _latest_ci_outcome(ev_list)
    todo = _count_todo(backlog)

    # Source priority: a usable runs.jsonl row is the primary feed. With no
    # row AND no events, fall back to the cron log's tail; if even that is
    # empty, emit the single "unavailable" placeholder line.
    have_primary = row is not None
    have_events = bool(ev_list)

    cid = cycle_id or (row.get("cycle_id") if row else "") or "unknown"
    lines: List[str] = []
    title = "─── Cycle {0} Summary ───".format(cid)

    if not have_primary and not have_events:
        tail = _tail_lines(cron_log, 30)
        if not tail:
            log_hint = cron_log or "~/.shared/roll/loop/cron-<slug>.log"
            return "(summary unavailable — see log: {0})".format(log_hint)
        # Degraded view: header + raw cron tail so the user still sees output.
        lines.append(title)
        lines.append("  (runs.jsonl + events unavailable — showing cron log tail)")
        for ln in tail:
            lines.append("  " + ln)
        return "\n".join(lines)

    lines.append(title)

    # 1. result
    if row is not None:
        lines.append("  " + _fmt_result(row))
    else:
        lines.append("  result: n/a")

    # 2. ci
    lines.append("  " + _fmt_ci(ci_outcome))

    # 3. todo
    if todo is not None:
        lines.append("  todo remaining: {0}".format(todo))
    else:
        lines.append("  todo remaining: n/a")

    # 4. phases (top 5 by duration desc)
    phases = (row.get("phases") if row else None) or {}
    if isinstance(phases, dict) and phases:
        phase_rows = _fmt_phases(phases)
        if phase_rows:
            lines.append("  phases (top 5 by time):")
            lines.extend(phase_rows)

    # 5. alerts / failure placeholder (raw text; US-LOOP-041 highlights it)
    alerts = (row.get("alerts") if row else None) or []
    if isinstance(alerts, list) and alerts:
        lines.append("  alerts:")
        for a in alerts:
            lines.append("    " + str(a))

    return "\n".join(lines)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Render a loop cycle exit summary block.")
    parser.add_argument("--runs", default=None, help="path to runs.jsonl")
    parser.add_argument("--events", default=None, help="path to events.ndjson")
    parser.add_argument("--backlog", default=None, help="path to .roll/backlog.md")
    parser.add_argument("--cron-log", default=None, help="path to cron-<slug>.log")
    parser.add_argument("--cycle-id", default="", help="cycle id to prefer")
    args = parser.parse_args(argv)

    try:
        out = render(args.runs, args.events, args.backlog,
                     args.cron_log, args.cycle_id)
    except Exception:  # noqa: BLE001 — silent fallback per AC: never error
        return 0
    sys.stdout.write(out + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
