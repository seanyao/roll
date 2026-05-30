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
  5. alerts   — raw failure / alert text placeholder

US-LOOP-041 layers failure / alert *highlighting* on top of the US-LOOP-040
renderer. The relevant signal lines are flagged with a severity prefix and
ANSI colour:

  * RED + ``✗`` — runs.jsonl ``status`` is ``failed`` / ``aborted``; the latest
    ``ci`` outcome is ``red``; or the events tail has a ``cycle_end`` whose
    outcome is not ``ok`` / ``idle``.
  * YELLOW + ``⚠`` — latest ``ci`` outcome is ``heal-attempting``; an
    ``ALERT-<slug>.md`` exists and is non-empty; or ``tcr_count == 0`` while
    ``built[]`` is non-empty (suspected zero-diff).
  * default colour, no prefix — a fully green cycle (built/idle + ci green +
    no alert).

ANSI escapes are only emitted when stdout is a TTY (``sys.stdout.isatty()``)
and ``NO_COLOR`` is unset (see https://no-color.org). Pipes, redirects and
test captures get plain text — no escape codes are written.

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
        --alert  <ALERT-<slug>.md> \
        [--cycle-id <id>] [--color {auto,always,never}]

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


def _latest_cycle_end_outcome(events: List[Dict[str, Any]]) -> Optional[str]:
    """Newest ``cycle_end`` event outcome from an events stream, or None."""
    for ev in reversed(events):
        if ev.get("stage") == "cycle_end":
            outcome = ev.get("outcome")
            if outcome:
                return str(outcome)
    return None


def _alert_active(path: Optional[str]) -> bool:
    """True when an ALERT-<slug>.md file exists and has non-whitespace content."""
    if not path or not os.path.isfile(path):
        return False
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            return bool(fh.read().strip())
    except OSError:
        return False


# ── ANSI colouring (US-LOOP-041) ─────────────────────────────────────────────
# Severity ranks: 0 = none/green, 1 = warn (yellow), 2 = fail (red).
_SEV_NONE = 0
_SEV_WARN = 1
_SEV_FAIL = 2

_ANSI = {_SEV_WARN: "\033[33m", _SEV_FAIL: "\033[31m"}
_ANSI_RESET = "\033[0m"
_PREFIX = {_SEV_NONE: "", _SEV_WARN: "⚠ ", _SEV_FAIL: "✗ "}


def _color_enabled(mode: str) -> bool:
    """Decide whether ANSI escapes should be emitted.

    ``always`` forces colour, ``never`` forces plain text, ``auto`` (default)
    honours NO_COLOR (https://no-color.org) and only colours a real TTY.
    """
    if mode == "always":
        return True
    if mode == "never":
        return False
    if os.environ.get("NO_COLOR") is not None:
        return False
    try:
        return bool(sys.stdout.isatty())
    except (ValueError, AttributeError):
        return False


def _decorate(text: str, sev: int, color: bool) -> str:
    """Apply severity prefix + (optional) ANSI colour to a single line.

    The leading indentation is preserved; the prefix and colour wrap only the
    non-indented payload so columns still line up.
    """
    if sev == _SEV_NONE:
        return text
    stripped = text.lstrip(" ")
    indent = text[: len(text) - len(stripped)]
    payload = _PREFIX[sev] + stripped
    if color:
        payload = _ANSI[sev] + payload + _ANSI_RESET
    return indent + payload


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


def _result_severity(row: Dict[str, Any]) -> int:
    """Severity for the result line (US-LOOP-041)."""
    status = str(row.get("status", ""))
    if status in ("failed", "aborted"):
        return _SEV_FAIL
    built = row.get("built") or []
    tcr = row.get("tcr_count", 0)
    if built and tcr == 0:  # suspected zero-diff: built something but no commit
        return _SEV_WARN
    return _SEV_NONE


def _ci_severity(outcome: Optional[str]) -> int:
    """Severity for the ci line (US-LOOP-041)."""
    if outcome == "red":
        return _SEV_FAIL
    if outcome == "heal-attempting":
        return _SEV_WARN
    return _SEV_NONE


def render(runs: Optional[str], events: Optional[str], backlog: Optional[str],
           cron_log: Optional[str], cycle_id: str = "",
           alert: Optional[str] = None, color: bool = False) -> str:
    """Build the summary block as a string.

    ``color`` toggles ANSI escapes; severity prefixes (``✗`` / ``⚠``) are
    always applied to flagged lines regardless of ``color`` (US-LOOP-041).
    """
    row = _read_last_json_line(runs, cycle_id)
    ev_list = _read_json_lines(events)
    ci_outcome = _latest_ci_outcome(ev_list)
    cycle_end_outcome = _latest_cycle_end_outcome(ev_list)
    alert_on = _alert_active(alert)
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

    # cycle_end fail severity applies to the result line when it's worse than
    # what the runs.jsonl status alone implies.
    cycle_end_sev = _SEV_NONE
    if cycle_end_outcome is not None and cycle_end_outcome not in ("ok", "idle"):
        cycle_end_sev = _SEV_FAIL

    # 1. result
    if row is not None:
        result_sev = max(_result_severity(row), cycle_end_sev)
        lines.append(_decorate("  " + _fmt_result(row), result_sev, color))
    else:
        lines.append(_decorate("  result: n/a", cycle_end_sev, color))

    # 2. ci
    lines.append(_decorate("  " + _fmt_ci(ci_outcome),
                           _ci_severity(ci_outcome), color))

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

    # 5. alerts / failure highlight (US-LOOP-041)
    alerts = (row.get("alerts") if row else None) or []
    if isinstance(alerts, list) and alerts:
        lines.append(_decorate("  alerts:", _SEV_FAIL, color))
        for a in alerts:
            lines.append(_decorate("    " + str(a), _SEV_FAIL, color))
    if alert_on:
        lines.append(_decorate("  alert: ALERT file active — see log",
                               _SEV_WARN, color))

    return "\n".join(lines)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Render a loop cycle exit summary block.")
    parser.add_argument("--runs", default=None, help="path to runs.jsonl")
    parser.add_argument("--events", default=None, help="path to events.ndjson")
    parser.add_argument("--backlog", default=None, help="path to .roll/backlog.md")
    parser.add_argument("--cron-log", default=None, help="path to cron-<slug>.log")
    parser.add_argument("--cycle-id", default="", help="cycle id to prefer")
    parser.add_argument("--alert", default=None, help="path to ALERT-<slug>.md")
    parser.add_argument("--color", choices=("auto", "always", "never"),
                        default="auto", help="ANSI colour mode (default: auto)")
    args = parser.parse_args(argv)

    try:
        color = _color_enabled(args.color)
        out = render(args.runs, args.events, args.backlog,
                     args.cron_log, args.cycle_id,
                     alert=args.alert, color=color)
    except Exception:  # noqa: BLE001 — silent fallback per AC: never error
        return 0
    sys.stdout.write(out + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
