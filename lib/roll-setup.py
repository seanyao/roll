#!/usr/bin/env python3
"""roll-setup — v2 terminal view for `roll setup`.

Reads a single JSON document from stdin describing the real outcomes of
`bin/roll cmd_setup`'s step sequence (detect platform / install skills /
sync conventions / etc). Renders the v2 UI preserving the visual style
of US-VIEW-007 while reflecting actual results.

Input schema matches `lib/roll-init.py` (see that file for details).
"""
from __future__ import annotations

import argparse
import json
import os
import sys

_LIB_DIR = os.path.dirname(os.path.realpath(__file__))
if _LIB_DIR not in sys.path:
    sys.path.insert(0, _LIB_DIR)
import roll_render
from roll_render import c, row, COLS


def _divider(char: str = "─") -> None:
    print(c("dim", char * min(COLS, 80)))


def _step_icon(status: str) -> str:
    if status == "ok":
        return c("green", "✓")
    if status == "skip":
        return c("amber", "↷")
    if status == "forced":
        return c("blue", "~")
    if status == "fail":
        return c("red", "✗", bold=True)
    return c("dim", "·")


def render(payload: dict) -> None:
    header_label = payload.get("header_label", "SETUP")
    subtitle = payload.get("subtitle", "初始化")
    right_text = payload.get("project_path") or payload.get("right", "")

    left = "  " + c("blue", header_label, bold=True) + c("dim", "  ·  ") + c("dim", subtitle)
    right = c("dim", right_text) + "  " if right_text else ""
    print(row(left, right))
    _divider()
    print()

    for step in payload.get("steps", []):
        num = c("dim", f"  {step.get('num', 0)}.")
        icon = _step_icon(step.get("status", "ok"))
        label = step.get("label", "")
        print(f"{num} {icon}  {label}")
        note = step.get("note") or step.get("error")
        if note:
            tone = "red" if step.get("status") == "fail" else "dim"
            print("       " + c(tone, str(note)))

    print()
    _divider()

    footer = payload.get("footer") or {}
    f_status = footer.get("status", "ok")
    f_label = footer.get("label", "Setup complete")
    icon_color = "green" if f_status == "ok" else "red"
    msg = c(icon_color, f_label)
    next_hint = footer.get("hint")
    if next_hint:
        print(f"  {msg}  —  {next_hint}")
    else:
        print(f"  {msg}")
    _divider("═")


def _read_payload() -> dict:
    raw = sys.stdin.read()
    if not raw.strip():
        sys.stderr.write("roll-setup.py: expected JSON on stdin\n")
        sys.exit(1)
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        sys.stderr.write(f"roll-setup.py: invalid JSON on stdin: {exc}\n")
        sys.exit(1)


def main() -> None:
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("--no-color", dest="no_color", action="store_true")
    args, _ = ap.parse_known_args()

    if args.no_color or os.environ.get("NO_COLOR") or not sys.stdout.isatty():
        roll_render.USE_COLOR = False

    render(_read_payload())


if __name__ == "__main__":
    main()
