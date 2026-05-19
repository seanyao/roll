#!/usr/bin/env python3
"""roll-init — v2 terminal view for `roll init` (US-VIEW-008)."""
from __future__ import annotations

import argparse
import os
import sys

_LIB_DIR = os.path.dirname(os.path.realpath(__file__))
if _LIB_DIR not in sys.path:
    sys.path.insert(0, _LIB_DIR)
import roll_render
from roll_render import c, row, COLS

# ════════════════════════════════════════════════════════════════════════════
# Demo data — 6 steps mirror cmd_init's actual phases.
# AC text: detect → AGENTS.md → BACKLOG.md → docs/features/ → merge CLAUDE.md → link skills
# Each entry: (label, [(op, filename)]) where op ∈ {"+", "~"}.
# ════════════════════════════════════════════════════════════════════════════

_DEMO_STEPS = [
    ("Detect project type",          []),
    ("Create AGENTS.md",             [("+", "AGENTS.md")]),
    ("Create .roll/backlog.md",      [("+", ".roll/backlog.md")]),
    ("Create .roll/features/",       [("+", ".roll/features/")]),
    ("Merge existing CLAUDE.md",     [("~", "CLAUDE.md")]),
    ("Link skills to AI clients",    [("+", "~/.claude/skills/roll-build"),
                                      ("+", "~/.claude/skills/roll-fix")]),
]

_NEXT_STEPS = [
    ("Edit .roll/backlog.md",     "open the backlog and add your first US"),
    ("Run roll loop now",         "execute one cycle manually to test the flow"),
    ("Enable loop scheduling",    "roll loop on  — let it run hourly"),
]


# ════════════════════════════════════════════════════════════════════════════
# Render
# ════════════════════════════════════════════════════════════════════════════

def _divider(char: str = "─") -> None:
    print(c("dim", char * min(COLS, 80)))


def _op_marker(op: str) -> str:
    if op == "+":
        return c("green", "+", bold=True)
    if op == "~":
        return c("amber", "~", bold=True)
    return c("dim", op)


def render_demo(project_path: str = "~/myproject") -> None:
    left  = "  " + c("blue", "INIT", bold=True) + c("dim", "  ·  ") + c("dim", "项目初始化")
    right = c("dim", project_path) + "  "
    print(row(left, right))
    _divider()
    print()

    for i, (label, files) in enumerate(_DEMO_STEPS, start=1):
        num  = c("dim", f"  {i}.")
        icon = c("green", "✓")
        print(f"{num} {icon}  {label}")
        for op, fname in files:
            mark = _op_marker(op)
            color = "green" if op == "+" else "amber"
            print("       " + mark + "  " + c(color, fname))

    print()
    _divider()
    print("  " + c("green", "✓") + " " + c("green", "Project ready", bold=True))
    print()
    print("  " + c("pink", "NEXT", bold=True) + c("dim", "  ·  下一步"))
    for i, (label, hint) in enumerate(_NEXT_STEPS, start=1):
        num = c("dim", f"  {i}.")
        print(f"{num} {c('fg', label, bold=True)}")
        print("     " + c("dim", hint))
    _divider("═")


# ════════════════════════════════════════════════════════════════════════════
# Entry point
# ════════════════════════════════════════════════════════════════════════════

def main() -> None:
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("--demo",     action="store_true")
    ap.add_argument("--no-color", dest="no_color", action="store_true")
    ap.add_argument("--en",       action="store_true")
    ap.add_argument("--zh",       action="store_true")
    args, _ = ap.parse_known_args()

    if args.no_color or os.environ.get("NO_COLOR") or not sys.stdout.isatty():
        roll_render.USE_COLOR = False

    render_demo(project_path=os.getcwd())


if __name__ == "__main__":
    main()
