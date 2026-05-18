#!/usr/bin/env python3
"""
roll-backlog — v2 terminal view for `roll backlog`.

Parses BACKLOG.md and renders items grouped by type:
  Bug Fixes (red) · User Stories (blue) · Refactors (amber) · Ideas (dim)

In-progress items get a ⏵ purple marker.
Blocked and Deferred items appear in their own sections below.
"""
from __future__ import annotations

import os
import re
import sys
from typing import List, NamedTuple, Optional

sys.path.insert(0, os.path.dirname(__file__))
import roll_render as rr
from roll_render import c, pad, row, trunc, strw, COLS

# ════════════════════════════════════════════════════════════════════════════
# BACKLOG parsing
# ════════════════════════════════════════════════════════════════════════════

class Item(NamedTuple):
    id: str
    desc: str
    status: str        # raw status cell content
    reason: str        # extracted reason from Blocked/Deferred status


_ID_RE = re.compile(r"\[([^\]]+)\]\([^)]+\)")       # [US-XXX](link)
_REASON_RE = re.compile(r"\[([^\]]+)\]")            # [reason text]


def _parse_id(cell: str) -> str:
    m = _ID_RE.search(cell)
    if m:
        return m.group(1)
    return cell.strip()


def _parse_reason(status_cell: str) -> str:
    # Skip the leading emoji word, extract first [...] block
    m = _REASON_RE.search(status_cell)
    return m.group(1) if m else ""


def parse_backlog(path: str) -> List[Item]:
    items: List[Item] = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line.startswith("|"):
                continue
            parts = [p.strip() for p in line.split("|")]
            if len(parts) < 4:
                continue
            id_cell = parts[1]
            desc_cell = parts[2]
            status_cell = parts[3] if len(parts) > 3 else ""
            item_id = _parse_id(id_cell)
            if not re.match(r"(US|FIX|REFACTOR|IDEA)-", item_id):
                continue
            reason = _parse_reason(status_cell) if ("Blocked" in status_cell or "Deferred" in status_cell) else ""
            items.append(Item(item_id, desc_cell, status_cell, reason))
    return items


def classify(items: List[Item]):
    todo_fix: List[Item] = []
    todo_us: List[Item] = []
    todo_ref: List[Item] = []
    todo_idea: List[Item] = []
    in_progress: List[Item] = []
    blocked: List[Item] = []
    deferred: List[Item] = []

    for it in items:
        st = it.status
        if "In Progress" in st:
            in_progress.append(it)
        elif "Blocked" in st:
            blocked.append(it)
        elif "Deferred" in st:
            deferred.append(it)
        elif "Todo" in st:
            if it.id.startswith("FIX-"):
                todo_fix.append(it)
            elif it.id.startswith("US-"):
                todo_us.append(it)
            elif it.id.startswith("REFACTOR-"):
                todo_ref.append(it)
            elif it.id.startswith("IDEA-"):
                todo_idea.append(it)

    return todo_fix, todo_us, todo_ref, todo_idea, in_progress, blocked, deferred


# ════════════════════════════════════════════════════════════════════════════
# Rendering
# ════════════════════════════════════════════════════════════════════════════

_MAX_DESC = 62

BG_RUN = "\033[48;2;40;20;70m"    # faint purple bg for in-progress row


def _render_item_row(it: Item, color: str, *, glyph: str = " ", bg: str = "") -> None:
    """Print one item line: glyph · ID · description."""
    id_str = c(color, pad(it.id, 16))
    desc = trunc(it.desc, _MAX_DESC)
    desc_str = c(color, desc) if color != "dim" else c("dim", desc)
    line = f"  {glyph} {id_str}  {desc_str}"
    if bg and rr.USE_COLOR:
        print(bg + line + rr.RESET)
    else:
        print(line)


def _render_group(title_en: str, title_zh: str, color: str, items: List[Item]) -> None:
    if not items:
        return
    n = len(items)
    header = c(color, f"  {title_en}", bold=True) + c("muted", "  ·  ") + c("dim", title_zh) + c("muted", f"  ({n})")
    print(header)
    for it in items:
        _render_item_row(it, color)
    print()


def _render_in_progress(items: List[Item]) -> None:
    for it in items:
        glyph = c("purple", "⏵")
        id_str = c("purple", pad(it.id, 16), bold=True)
        desc = trunc(it.desc, _MAX_DESC)
        desc_str = c("purple", desc)
        line = f"  {glyph} {id_str}  {desc_str}"
        if rr.USE_COLOR:
            print(BG_RUN + line + rr.RESET)
        else:
            print(f"  ⏵ {it.id}  {it.desc}")


def render(path: str) -> None:
    items = parse_backlog(path)
    todo_fix, todo_us, todo_ref, todo_idea, in_progress, blocked, deferred = classify(items)

    todo_total = len(todo_fix) + len(todo_us) + len(todo_ref) + len(todo_idea) + len(in_progress)
    blocked_count = len(blocked)
    deferred_count = len(deferred)

    # ── Header ──────────────────────────────────────────────────────────────
    print()
    tags = c("fg", f"{todo_total} Todo", bold=True)
    if blocked_count:
        tags += c("muted", " · ") + c("amber", f"{blocked_count} Blocked")
    if deferred_count:
        tags += c("muted", " · ") + c("dim", f"{deferred_count} Deferred")
    header_left = "  " + c("pink", "BACKLOG", bold=True) + c("muted", "  ·  ") + c("dim", "待处理任务")
    print(row(header_left, "  " + tags))
    print()

    # ── In-progress (shown first, above groups) ──────────────────────────────
    if in_progress:
        _render_in_progress(in_progress)
        print()

    # ── Todo groups in priority order ────────────────────────────────────────
    _render_group("Bug Fixes", "缺陷修复", "red", todo_fix)
    _render_group("User Stories", "用户故事", "blue", todo_us)
    _render_group("Refactors", "重构", "amber", todo_ref)
    _render_group("Ideas", "创意", "dim", todo_idea)

    if todo_total == 0 and not in_progress:
        print(c("green", "  ✓ Nothing pending — backlog is clear  暂无待处理任务"))
        print()

    # ── Blocked ──────────────────────────────────────────────────────────────
    if blocked:
        print(c("amber", "  Blocked", bold=True) + c("muted", "  ·  ") + c("dim", "已阻塞") + c("muted", f"  ({blocked_count})"))
        for it in blocked:
            id_str = c("amber", pad(it.id, 16))
            desc = trunc(it.desc, 50)
            reason_str = c("muted", f"  ({it.reason})") if it.reason else ""
            print(f"  🔒 {id_str}  {c('dim', desc)}{reason_str}")
        print()

    # ── Deferred ─────────────────────────────────────────────────────────────
    if deferred:
        print(c("dim", f"  Deferred  ·  已推迟  ({deferred_count})"))
        for it in deferred:
            id_str = c("dim", pad(it.id, 16))
            desc = trunc(it.desc, 50)
            reason_str = c("muted", f"  ({it.reason})") if it.reason else ""
            print(f"  ⏸ {id_str}  {c('dim', desc)}{reason_str}")
        print()

    # ── Footer ───────────────────────────────────────────────────────────────
    print(c("muted", "  ") + c("dim", "triage: ") + c("blue", "roll backlog block/defer/unblock <pattern> [reason]"))
    print()


# ════════════════════════════════════════════════════════════════════════════
# Entry
# ════════════════════════════════════════════════════════════════════════════

def main() -> None:
    args = sys.argv[1:]
    demo = "--demo" in args
    no_color = "--no-color" in args or not sys.stdout.isatty() or os.getenv("NO_COLOR")
    rr.USE_COLOR = not no_color

    backlog = "BACKLOG.md"
    if not demo and not os.path.isfile(backlog):
        print(f"Error: {backlog} not found — run 'roll init' first", file=sys.stderr)
        sys.exit(1)

    if demo:
        _write_demo(backlog)

    render(backlog)

    if demo:
        os.unlink(backlog)


def _write_demo(path: str) -> None:
    with open(path, "w") as f:
        f.write("""# Project Backlog

## 🐛 Bug Fixes
| ID | Description | Status |
|----|-------------|--------|
| FIX-042 | Fix outer runner tmux kill matching wrong session | 🔨 In Progress |
| FIX-043 | Handle stale state in loop now command | 📋 Todo |

## Epic: Autonomous Evolution
### Feature: autonomous-evolution
| Story | Description | Status |
|-------|-------------|--------|
| [US-AUTO-042](docs/features/autonomous-evolution.md) | Loop cost telemetry — write model and token data per cycle | 📋 Todo |

## ♻️ Refactor
| ID | Description | Status |
|----|-------------|--------|
| REFACTOR-010 | Simplify CI test parallelism strategy | 🔒 Blocked [waiting on CI infra] |

## 💡 Ideas
| ID | Description | Status |
|----|-------------|--------|
| IDEA-025 | Dashboard cost from list-price tokens | ⏸ Deferred [design pending] |
""")


if __name__ == "__main__":
    main()
