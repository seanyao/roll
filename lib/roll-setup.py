#!/usr/bin/env python3
"""roll-setup — v2 terminal view for `roll setup`."""
from __future__ import annotations

import os
import sys

_LIB_DIR = os.path.dirname(os.path.realpath(__file__))
if _LIB_DIR not in sys.path:
    sys.path.insert(0, _LIB_DIR)
from roll_render import c, row, COLS

# ════════════════════════════════════════════════════════════════════════════
# Demo data
# ════════════════════════════════════════════════════════════════════════════

_DEMO_STEPS = [
    "Detect platform & shell",
    "Fetch latest roll version",
    "Install skills to ~/.claude",
    "Symlink bin/roll to PATH",
    "Check for config drift",
    "Apply convention templates",
]

# ════════════════════════════════════════════════════════════════════════════
# Rendering
# ════════════════════════════════════════════════════════════════════════════

def _divider(char: str = "─") -> None:
    print(c("dim", char * min(COLS, 80)))


def render_demo() -> None:
    left  = "  " + c("blue", "SETUP", bold=True) + c("dim", "  ·  ") + c("dim", "初始化")
    right = c("dim", "--demo")
    print(row(left, "  " + right))
    _divider()
    print()

    for i, label in enumerate(_DEMO_STEPS, start=1):
        num  = c("dim", f"  {i}.")
        icon = c("green", "✓")
        print(f"{num} {icon}  {label}")

    print()
    _divider()
    msg = c("green", "Setup complete")
    print(f"  {msg}  —  run {c('fg', 'roll init', bold=True)} inside a project to begin")
    _divider("═")


# ════════════════════════════════════════════════════════════════════════════
# Entry point
# ════════════════════════════════════════════════════════════════════════════

def main() -> None:
    render_demo()


if __name__ == "__main__":
    main()
