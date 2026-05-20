#!/usr/bin/env python3
"""roll-init — v2 terminal view for `roll init`.

Reads a single JSON document from stdin describing real step outcomes
captured by the bash flow in `bin/roll cmd_init`. Renders the v2 UI
(banner + horizontal rule + numbered steps + NEXT block) preserving the
visual style of US-VIEW-008 but reflecting what actually happened.

Input schema (single JSON object on stdin):
  {
    "kind": "init",                     # informational; UI label uses header_label
    "header_label": "INIT",             # banner label (e.g. "INIT" / "REINIT")
    "subtitle": "项目初始化",            # banner subtitle
    "project_path": "/path/to/project", # right-aligned banner text
    "steps": [
      {"num": 1, "label": "Detect project type", "status": "ok"},
      {"num": 2, "label": "Create AGENTS.md", "status": "ok",
       "files": [["+", "AGENTS.md"]]},
      {"num": 3, "label": "...", "status": "skip", "note": "already exists"},
      {"num": 4, "label": "...", "status": "fail", "error": "permission denied"}
    ],
    "footer": {"status": "ok", "label": "Project ready"},
    "next": [["Edit .roll/backlog.md", "open the backlog and add your first US"]]
  }

`status` values: ok | skip | fail.
`files` ops:     "+" created  "~" merged  "·" unchanged  "✗" failed.

If stdin is empty or invalid JSON, exit 1 with a short message — the
renderer is no longer runnable standalone, it always renders real data.
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


def _op_marker(op: str) -> str:
    if op == "+":
        return c("green", "+", bold=True)
    if op == "~":
        return c("amber", "~", bold=True)
    if op == "·":
        return c("dim", "·")
    if op == "✗":
        return c("red", "✗", bold=True)
    return c("dim", op)


def _step_icon(status: str) -> str:
    if status == "ok":
        return c("green", "✓")
    if status == "skip":
        return c("amber", "↷")
    if status == "fail":
        return c("red", "✗", bold=True)
    return c("dim", "·")


def _file_color(op: str) -> str:
    if op == "+":
        return "green"
    if op == "~":
        return "amber"
    if op == "✗":
        return "red"
    return "dim"


def render(payload: dict) -> None:
    header_label = payload.get("header_label", "INIT")
    subtitle = payload.get("subtitle", "项目初始化")
    project_path = payload.get("project_path", "")

    left = "  " + c("blue", header_label, bold=True) + c("dim", "  ·  ") + c("dim", subtitle)
    right = c("dim", project_path) + "  "
    print(row(left, right))
    _divider()
    print()

    for step in payload.get("steps", []):
        num = c("dim", f"  {step.get('num', 0)}.")
        icon = _step_icon(step.get("status", "ok"))
        label = step.get("label", "")
        print(f"{num} {icon}  {label}")
        for entry in step.get("files", []) or []:
            op, fname = entry[0], entry[1]
            mark = _op_marker(op)
            color = _file_color(op)
            print("       " + mark + "  " + c(color, fname))
        note = step.get("note") or step.get("error")
        if note:
            tone = "red" if step.get("status") == "fail" else "dim"
            print("       " + c(tone, str(note)))

    print()
    _divider()

    footer = payload.get("footer") or {}
    f_status = footer.get("status", "ok")
    f_label = footer.get("label", "Done")
    icon_color = "green" if f_status == "ok" else "red"
    icon = "✓" if f_status == "ok" else "✗"
    print("  " + c(icon_color, icon) + " " + c(icon_color, f_label, bold=True))

    next_items = payload.get("next") or []
    if next_items:
        print()
        print("  " + c("pink", "NEXT", bold=True) + c("dim", "  ·  下一步"))
        for i, entry in enumerate(next_items, start=1):
            label = entry[0]
            hint = entry[1] if len(entry) > 1 else ""
            num = c("dim", f"  {i}.")
            print(f"{num} {c('fg', label, bold=True)}")
            if hint:
                print("     " + c("dim", hint))
    _divider("═")


def _read_payload() -> dict:
    raw = sys.stdin.read()
    if not raw.strip():
        sys.stderr.write("roll-init.py: expected JSON on stdin\n")
        sys.exit(1)
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        sys.stderr.write(f"roll-init.py: invalid JSON on stdin: {exc}\n")
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
