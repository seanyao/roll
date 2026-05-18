#!/usr/bin/env python3
"""
roll-brief — v2 terminal view for `roll brief`.

Parses the latest .roll/briefs/<date>.md and renders it as three sections:
  SUMMARY    — eyebrow + shipped/watch/decide counts
  HIGHLIGHTS — completed story list
  DECIDE     — action-required items with D1/D2/... numbering
"""
from __future__ import annotations

import os
import re
import sys
import time
from typing import Dict, List, Tuple

_LIB_DIR = os.path.dirname(os.path.realpath(__file__))
if _LIB_DIR not in sys.path:
    sys.path.insert(0, _LIB_DIR)
import roll_render as rr
from roll_render import c, pad, row, trunc, strw, COLS

# ════════════════════════════════════════════════════════════════════════════
# Brief parsing — section-based
# ════════════════════════════════════════════════════════════════════════════

def _age_str(mtime: float) -> str:
    age_s = int(time.time() - mtime)
    if age_s < 3600:
        return f"{age_s // 60}m ago"
    if age_s < 86400:
        return f"{age_s // 3600}h ago"
    return f"{age_s // 86400}d ago"


def _split_sections(lines: List[str]) -> Dict[str, List[str]]:
    """Split markdown into {section_heading: [body_lines], ...}.
    Key '' holds lines before the first section header.
    Key '@title' holds the # title line.
    """
    sections: Dict[str, List[str]] = {"": []}
    current = ""
    for line in lines:
        if line.startswith("# "):
            sections["@title"] = [line]
        elif line.startswith("## "):
            current = line[3:].strip()
            sections[current] = []
        else:
            sections[current].append(line)
    return sections


def _parse_table(body: List[str]) -> List[Tuple[str, str]]:
    """Extract (id, desc) pairs from a markdown table body."""
    rows = []
    for line in body:
        if not line.strip().startswith("|"):
            continue
        parts = [p.strip() for p in line.strip().split("|")]
        if len(parts) < 3:
            continue
        cell0 = parts[1]
        cell1 = parts[2] if len(parts) > 2 else ""
        # skip separator rows like |---|---| and header rows
        if re.match(r"[-:]+$", cell0.replace(" ", "")):
            continue
        if cell0.lower() in ("编号", "story", "id", ""):
            continue
        rows.append((cell0, cell1))
    return rows


def _parse_numbered_list(body: List[str]) -> List[str]:
    """Extract items from a numbered markdown list."""
    items = []
    for line in body:
        m = re.match(r"^\d+\.\s+(.*)", line.rstrip())
        if m:
            text = m.group(1)
            text = re.sub(r"\*\*(.*?)\*\*", r"\1", text)
            items.append(text.strip())
    return items


class Brief:
    def __init__(self) -> None:
        self.path: str = ""
        self.mtime: float = 0.0
        self.title_date: str = ""
        self.coverage: str = ""
        self.shipped: List[Tuple[str, str]] = []
        self.in_progress: List[Tuple[str, str]] = []
        self.pending_count: int = 0
        self.decide: List[str] = []
        self.alert_count: int = 0


def parse_brief(path: str) -> Brief:
    b = Brief()
    b.path = path
    b.mtime = os.path.getmtime(path)

    with open(path, encoding="utf-8") as f:
        raw = f.read()

    lines = raw.splitlines()
    sections = _split_sections(lines)

    # Title date
    title_lines = sections.get("@title", [])
    if title_lines:
        m = re.search(r"(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})", title_lines[0])
        if m:
            b.title_date = m.group(1)

    # Coverage from preamble blockquote
    for line in sections.get("", []):
        if line.startswith("> ") and "覆盖" in line:
            b.coverage = line[2:].strip()

    # 已完成
    for key, body in sections.items():
        if key.startswith("已完成"):
            b.shipped = _parse_table(body)
            break

    # 进行中
    for key, body in sections.items():
        if key.startswith("进行中"):
            b.in_progress = _parse_table(body)
            break

    # Pending count from section header
    for key in sections:
        m = re.search(r"待处理.*?(\d+)", key)
        if m:
            b.pending_count = int(m.group(1))

    # 需人工介入
    for key, body in sections.items():
        if key.startswith("需人工介入"):
            b.decide = _parse_numbered_list(body)
            break

    # Footer alert count
    for line in lines:
        if line.startswith("*状态") or ("告警" in line and line.startswith("*")):
            m = re.search(r"告警\s*(\d+)", line)
            if m:
                b.alert_count = int(m.group(1))
            break

    return b


# ════════════════════════════════════════════════════════════════════════════
# Rendering
# ════════════════════════════════════════════════════════════════════════════

_MAX_DESC = 60


def _render_eyebrow(b: Brief) -> None:
    brief_file = os.path.basename(b.path)
    age = _age_str(b.mtime)
    left = "  " + c("pink", "BRIEF", bold=True) + c("muted", "  ·  ") + c("dim", "简报")
    right = c("dim", brief_file) + c("muted", "  ·  ") + c("amber", age)
    print(row(left, "  " + right))
    if b.title_date:
        cov = (c("muted", "  ·  ") + c("dim", b.coverage)) if b.coverage else ""
        print("  " + c("dim", b.title_date) + cov)
    print()


def _render_summary(b: Brief) -> None:
    n_shipped = len(b.shipped)
    n_watch = len(b.in_progress)
    n_decide = len(b.decide)

    tags = c("green", f"✓ {n_shipped} Shipped") + c("muted", "  ·  ")
    tags += (c("amber", f"! {n_watch} Watch") if n_watch else c("dim", f"! {n_watch} Watch"))
    tags += c("muted", "  ·  ")
    tags += (c("amber", f"⚠ {n_decide} Decide") if n_decide else c("dim", f"⚠ {n_decide} Decide"))

    left = "  " + c("fg", "SUMMARY", bold=True) + c("muted", "  ·  ") + c("dim", "摘要")
    print(row(left, "  " + tags))
    print()

    print("    " + c("green", "✓") + c("muted", "  ") +
          c("fg", f"{n_shipped} Shipped", bold=True) +
          c("dim", f"  ·  已完成 {n_shipped} 项"))

    if n_watch:
        print("    " + c("amber", "!") + c("muted", "  ") +
              c("amber", f"{n_watch} Watch", bold=True) +
              c("dim", f"  ·  进行中 {n_watch} 项"))
    else:
        print("    " + c("dim", "!") + c("muted", "  ") + c("dim", f"{n_watch} Watch"))

    if n_decide:
        print("    " + c("amber", "⚠") + c("muted", "  ") +
              c("amber", f"{n_decide} Decide", bold=True) +
              c("dim", f"  ·  需人工介入 {n_decide} 项"))
    else:
        print("    " + c("dim", "⚠") + c("muted", "  ") + c("dim", f"{n_decide} Decide"))

    if b.pending_count:
        print("    " + c("dim", f"·  {b.pending_count} 项待处理"))

    print()


def _render_highlights(b: Brief) -> None:
    if not b.shipped:
        return
    n = len(b.shipped)
    header = (c("blue", "  HIGHLIGHTS", bold=True) +
               c("muted", "  ·  ") + c("dim", "已完成") + c("muted", f"  ({n})"))
    print(header)
    for (id_cell, desc) in b.shipped:
        desc_t = trunc(desc, _MAX_DESC)
        print("    " + c("muted", "— ") + c("blue", pad(id_cell, 18)) + "  " + c("dim", desc_t))
    print()


def _render_decide(b: Brief) -> None:
    if not b.decide:
        return
    n = len(b.decide)
    header = (c("amber", "  DECIDE", bold=True) +
               c("muted", "  ·  ") + c("dim", "需人工介入") + c("muted", f"  ({n})"))
    print(header)
    print()
    for idx, item in enumerate(b.decide, start=1):
        label = c("amber", f"  D{idx}", bold=True)
        body = trunc(item, COLS - 8)
        print(f"{label}  {c('fg', body)}")
    print()


def _render_footer() -> None:
    parts = [
        c("dim", "next: ") + c("blue", "roll loop now"),
        c("dim", "regen: ") + c("blue", "roll brief --regen"),
        c("dim", "alerts: ") + c("blue", "roll alert"),
    ]
    print("  " + c("muted", "  ·  ").join(parts))
    print()


def render(path: str) -> None:
    b = parse_brief(path)
    print()
    _render_eyebrow(b)
    _render_summary(b)
    _render_highlights(b)
    _render_decide(b)
    _render_footer()


# ════════════════════════════════════════════════════════════════════════════
# Entry
# ════════════════════════════════════════════════════════════════════════════

def main() -> None:
    args = sys.argv[1:]
    no_color = "--no-color" in args or not sys.stdout.isatty() or os.getenv("NO_COLOR")
    rr.USE_COLOR = not no_color

    briefs_dir = ".roll/briefs"
    briefs = sorted(
        f for f in os.listdir(briefs_dir) if f.endswith(".md")
    ) if os.path.isdir(briefs_dir) else []

    if not briefs:
        print("No brief yet — run 'roll brief --regen'  暂无简报", file=sys.stderr)
        sys.exit(1)

    latest = os.path.join(briefs_dir, briefs[-1])
    render(latest)


if __name__ == "__main__":
    main()
