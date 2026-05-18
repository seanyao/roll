#!/usr/bin/env python3
"""
roll-help — render the `roll --help` page.

Compact wordmark + grouped commands (AUTONOMY / PROJECT / MACHINE) + examples.

Usage:
  python3 lib/roll-help.py              # live
  python3 lib/roll-help.py --no-color
  python3 lib/roll-help.py --demo       # same as live, no fixture needed
"""

from __future__ import annotations
import argparse, os, re, sys
from pathlib import Path

_LIB_DIR = os.path.dirname(os.path.realpath(__file__))
if _LIB_DIR not in sys.path:
    sys.path.insert(0, _LIB_DIR)
import roll_render
from roll_render import COLS, c, row, section_head, strw, pad

# ════════════════════════════════════════════════════════════════════════════
# Version
# ════════════════════════════════════════════════════════════════════════════
def _roll_version() -> str:
    roll_bin = Path(_LIB_DIR).parent / "bin" / "roll"
    if roll_bin.exists():
        for line in roll_bin.open(errors="ignore"):
            m = re.match(r'^VERSION="([^"]+)"', line)
            if m:
                return m.group(1)
    return "—"

# ════════════════════════════════════════════════════════════════════════════
# Command table
# ════════════════════════════════════════════════════════════════════════════
# (name, args_hint, en_desc, zh_desc, star)
AUTONOMY = [
    ("loop",     "<on|off|now|status|…>", "manage the autonomous BACKLOG executor",       "管理自主执行循环",          True),
    ("brief",    "",                       "show latest owner brief",                     "查看最新简报",              True),
    ("backlog",  "[block|defer|…]",        "view and manage pending tasks",               "查看和管理待处理任务",        True),
    ("peer",     "",                       "cross-agent negotiation & review",            "跨 Agent 协商对审",         False),
    ("alert",    "",                       "view and clear loop alerts",                  "查看 / 清除 loop 告警",     False),
]

PROJECT = [
    ("init",      "",              "create AGENTS.md + BACKLOG.md + docs/",              "初始化项目工作流文件",         False),
    ("status",    "",              "show current state and drift",                        "显示当前状态和漂移项",         False),
    ("agent",     "[use <name>]",  "per-project agent selection",                        "切换项目 agent",             False),
    ("ci",        "[--wait]",      "show or wait for current commit's CI status",         "查看 / 等待 CI 状态",        False),
    ("release",   "",              "run the release script (human-only)",                 "执行发版脚本（仅人工）",        False),
    ("review-pr", "<number>",      "AI-powered code review for a PR",                    "AI 代码评审",               False),
]

MACHINE = [
    ("setup",   "[-f]",   "first-time install or re-sync",   "首次安装或重新同步",   False),
    ("update",  "",       "upgrade to latest + re-sync",     "升级到最新版并重新同步", False),
    ("version", "",       "print installed roll version",    "显示已安装版本",        False),
]

EXAMPLES = [
    ("roll loop on",                             "启用自主执行循环"),
    ("roll brief",                               "查看最新简报"),
    ("roll backlog defer US-DOC '过早引入'",      "推迟一类任务"),
    ("roll agent use kimi",                      "切换当前项目到 kimi"),
]

# ════════════════════════════════════════════════════════════════════════════
# Render
# ════════════════════════════════════════════════════════════════════════════
def _hr() -> None:
    print(c("faint", "─" * COLS))

def _cmd_block(entries: list) -> None:
    """Render a command group — two lines per command (EN + ZH)."""
    for name, args, en_desc, zh_desc, star in entries:
        star_mark = c("amber", " ★") if star else "  "
        en_line = (
            "  " +
            c("blue", name, bold=True) +
            star_mark +
            "  " +
            (c("dim", args + "  ") if args else "    ") +
            c("fg", en_desc)
        )
        zh_line = "  " + " " * (strw(name) + 2 + 2) + c("dim", zh_desc)
        print(en_line)
        print(zh_line)

def render(version: str) -> None:
    # ── Wordmark ──────────────────────────────────────────────────────────────
    print()
    left = ("  " + c("fg", "roll", bold=True) + c("muted", " · ") +
            c("dim", "autonomous delivery for software teams"))
    right = c("yellow", f"v{version}") + "  "
    print(row(left, right))
    print("  " + c("dim", "自主交付，人只做三件事：提需求、审核、发版"))
    print()
    print("  " + c("dim", "usage  ") + c("fg", "roll") + c("dim", " <command> [options]"))
    print()
    _hr()
    print()

    # ── AUTONOMY ──────────────────────────────────────────────────────────────
    section_head("AUTONOMY", "日常使用", "★ = most used")
    print()
    _cmd_block(AUTONOMY)
    print()
    _hr()
    print()

    # ── PROJECT ───────────────────────────────────────────────────────────────
    section_head("PROJECT", "项目内", "per-repo setup and CI")
    print()
    _cmd_block(PROJECT)
    print()
    _hr()
    print()

    # ── MACHINE ───────────────────────────────────────────────────────────────
    section_head("MACHINE", "全局", "install, upgrade, version")
    print()
    _cmd_block(MACHINE)
    print()
    _hr()
    print()

    # ── Examples ──────────────────────────────────────────────────────────────
    print("  " + c("muted", "examples"))
    print()
    for cmd, zh in EXAMPLES:
        print("  " + c("blue", cmd) + "  " + c("dim", zh))
    print()
    print("  " + c("dim", "docs: ") + c("blue", "github.com/seanyao/Roll") +
          c("muted", "  ·  ") +
          c("dim", "issues: ") + c("blue", "github.com/seanyao/Roll/issues"))
    print()

# ════════════════════════════════════════════════════════════════════════════
# Entry
# ════════════════════════════════════════════════════════════════════════════
def main() -> None:
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("--demo",     action="store_true")
    ap.add_argument("--no-color", dest="no_color", action="store_true")
    ap.add_argument("--en",       action="store_true")
    ap.add_argument("--zh",       action="store_true")
    args, _ = ap.parse_known_args()

    if args.no_color or os.environ.get("NO_COLOR"):
        roll_render.USE_COLOR = False

    render(_roll_version())

if __name__ == "__main__":
    main()
