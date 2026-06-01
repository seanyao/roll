#!/usr/bin/env python3
"""US-CL-006: changelog generate — deterministic draft generator.

Extracts ✅ Done stories from .roll/backlog.md, filters internal entries,
applies mechanical lint, and produces a draft ## Unreleased section.

Usage:
  python3 lib/changelog_generate.py           # output draft to stdout
  python3 lib/changelog_generate.py --write   # append to CHANGELOG.md
  python3 lib/changelog_generate.py --json    # machine-readable
"""
from __future__ import annotations
import argparse
import json
import re
import sys
from pathlib import Path

# ─── Filters ─────────────────────────────────────────────────────────────────
# Skip patterns: test infrastructure, internal contracts, dev-only changes.
# These mirror the filter rules in $roll-.changelog SKILL.md Section 3.
SKIP_PATTERNS = [
    re.compile(r"test\s+infrastructure|bats\s|fixture|teardown|isolation|CI\s+时序", re.I),
    re.compile(r"SKILL\.md|prompt\s+内部|schema\s+|contract\s+test|enum\s+强制", re.I),
    re.compile(r"内部重构|提取函数|变量改名|目录调整|死代码|消重", re.I),
    re.compile(r"发版脚本自身|release\.sh\s+逻辑|TCR\s+节奏|pre-commit|钩子", re.I),
    re.compile(r"仅开发者|只开发者|维护者可见|内部可见", re.I),
]

# Category detection (best-effort keyword matching)
CATEGORIES = [
    ("新功能", [r"新增", r"添加", r"支持", r"新命令", r"新功能", r"引入", r"上线"]),
    ("稳定性", [r"修复", r"崩溃", r"卡死", r"误报", r"泄漏", r"竞争", r"并发", r"死锁", r"幽灵"]),
    ("可见性", [r"显示", r"dashboard", r"状态", r"可见", r"查看", r"实时", r"弹窗", r"日志"]),
    ("自动化流水线", [r"PR\s", r"合并", r"auto-merge", r"loop\s", r"调度", r"launchd", r"定时"]),
    ("工程和测试", [r"测试", r"CI\s", r"重构", r"提取", r"优化", r"提速", r"并行"]),
]

CATEGORY_ORDER = ["新功能", "稳定性", "可见性", "自动化流水线", "工程和测试", "其他"]

# Changelog lint rules (inline copy of _changelog_lint_bullet for portability).
LINT_BACKTICK_ID = re.compile(r"`[^`]*(_|\(\))[^`]*`")
LINT_FILE_SUFFIX = re.compile(r"\.(md|sh|yml|ts|bats)([^A-Za-z0-9]|$)")
LINT_INTERNAL_WORD = re.compile(r"(Phase|Step)\s+[0-9]+|Helper|Schema|Fixture|Refactor")
LINT_PATH_FRAG = re.compile(r"(^|[^A-Za-z0-9_])(\.roll|docs|bin|tests|scripts)/")


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _read_done_stories(backlog_path: Path) -> list[tuple[str, str, str]]:
    """Extract ✅ Done rows from backlog table.

    Returns list of (story_id, description, source_tag).
    """
    rows: list[tuple[str, str, str]] = []
    text = backlog_path.read_text(encoding="utf-8")
    for line in text.splitlines():
        if not line.startswith("|") or line.count("|") < 4:
            continue
        if "✅ Done" not in line:
            continue
        parts = line.split("|")
        if len(parts) < 4:
            continue
        # story id from first column
        id_m = re.search(r"\[([A-Z]+-[A-Z0-9-]+-\d+|FIX-\d+|REFACTOR-\d+)\]", parts[1])
        story_id = id_m.group(1) if id_m else ""
        desc = parts[2].strip()
        if not desc or desc.lower() == "description":
            continue
        # source tag: loop-executed stories get [loop]
        source = "loop" if re.search(r"US-AUTO|US-LOOP|FIX-|REFACTOR-", story_id) else ""
        rows.append((story_id, desc, source))
    return rows


def _is_internal(desc: str) -> bool:
    for pat in SKIP_PATTERNS:
        if pat.search(desc):
            return True
    return False


def _clean_description(desc: str) -> str:
    # Remove depends-on / manual-only tags
    desc = re.sub(r"`?depends-on:[^`|]+`?", "", desc)
    desc = re.sub(r"`?manual-only:[^`|]+`?", "", desc)
    # Remove markdown links — keep link text only
    desc = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", desc)
    # Collapse whitespace
    desc = re.sub(r"\s+", " ", desc).strip()
    # Remove leading em-dash / hyphen noise
    desc = re.sub(r"^[—\-]\s*", "", desc)
    return desc


def _detect_category(desc: str) -> str:
    for cat, patterns in CATEGORIES:
        for pat in patterns:
            if re.search(pat, desc, re.I):
                return cat
    return "其他"


def _already_in_changelog(story_id: str, desc: str, changelog_path: Path) -> bool:
    if not changelog_path.exists():
        return False
    text = changelog_path.read_text(encoding="utf-8")
    if story_id in text:
        return True
    # Also check by description text (cleaned, first 20 chars) to catch
    # entries that don't carry the story ID.
    desc_stub = desc[:20].strip()
    if desc_stub and desc_stub in text:
        return True
    return False


def _lint_bullet(bullet: str) -> list[str]:
    """Return list of violation tags (empty = clean)."""
    viols: list[str] = []
    stripped = re.sub(r"`[^`]*`", "", bullet)
    if LINT_BACKTICK_ID.search(bullet):
        viols.append("backtick-identifier")
    if LINT_FILE_SUFFIX.search(stripped):
        viols.append("file-suffix")
    if LINT_INTERNAL_WORD.search(bullet):
        viols.append("internal-word")
    # length: visible chars > 50
    vis_len = len(stripped.strip())
    if vis_len > 50:
        viols.append("over-length")
    if LINT_PATH_FRAG.search(stripped):
        viols.append("path-fragment")
    return viols


def _format_bullet(desc: str, source: str) -> str:
    tag = f" [{source}]" if source else ""
    return f"- {desc}{tag}"


def _build_draft(groups: dict[str, list[tuple[str, str, str]]]) -> str:
    lines = ["## Unreleased", ""]
    for cat in CATEGORY_ORDER:
        if cat not in groups:
            continue
        lines.append(f"### {cat}")
        lines.append("")
        for _story_id, desc, source in groups[cat]:
            bullet = _format_bullet(desc, source)
            viols = _lint_bullet(bullet)
            if viols:
                bullet += f"  # lint: {', '.join(viols)}"
            lines.append(bullet)
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def _write_to_changelog(draft: str, changelog_path: Path) -> None:
    """Merge draft into CHANGELOG.md, avoiding duplicates."""
    if changelog_path.exists():
        text = changelog_path.read_text(encoding="utf-8")
    else:
        text = "# Changelog\n\n"

    if "## Unreleased" not in text:
        # Insert right after the title
        text = text.rstrip("\n") + "\n\n" + draft
    else:
        # Extract existing Unreleased section, merge new bullets
        # Pattern: from ## Unreleased up to next ## or EOF
        m = re.search(r"^(## Unreleased\s*\n)(.*?)(?=\n## |\Z)", text, re.MULTILINE | re.DOTALL)
        if not m:
            text = text.rstrip("\n") + "\n\n" + draft
        else:
            existing = m.group(2)
            new_lines = draft.splitlines()[2:]  # drop "## Unreleased" and blank line
            merged = existing.rstrip("\n") + "\n"
            for line in new_lines:
                # Skip category headers already present
                if line.startswith("### ") and line in existing:
                    continue
                # Skip bullets already present
                bullet_core = re.sub(r"\s*\[loop\]\s*$", "", line).strip()
                if bullet_core and bullet_core not in existing:
                    merged += line + "\n"
            text = text[: m.start()] + "## Unreleased\n" + merged + text[m.end() :]

    changelog_path.write_text(text, encoding="utf-8")


# ─── Main ────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(
        description="Generate a draft ## Unreleased section from backlog ✅ Done stories."
    )
    ap.add_argument("--backlog", default=".roll/backlog.md", help="Path to backlog file")
    ap.add_argument("--changelog", default="CHANGELOG.md", help="Path to CHANGELOG.md")
    ap.add_argument("--write", action="store_true", help="Write draft to CHANGELOG.md")
    ap.add_argument("--json", action="store_true", help="Machine-readable output")
    args = ap.parse_args()

    backlog = Path(args.backlog)
    changelog = Path(args.changelog)

    if not backlog.exists():
        print("Error: backlog file not found", file=sys.stderr)
        return 1

    rows = _read_done_stories(backlog)

    filtered: list[tuple[str, str, str, str]] = []
    for story_id, desc, source in rows:
        if _already_in_changelog(story_id, desc, changelog):
            continue
        if _is_internal(desc):
            continue
        cleaned = _clean_description(desc)
        if not cleaned:
            continue
        cat = _detect_category(cleaned)
        filtered.append((story_id, cleaned, source, cat))

    if args.json:
        json.dump(
            {
                "stories_found": len(rows),
                "stories_drafted": len(filtered),
                "draft": [
                    {"id": sid, "desc": d, "category": c, "source": s}
                    for sid, d, s, c in filtered
                ],
            },
            sys.stdout,
            indent=2,
            ensure_ascii=False,
        )
        print()
        return 0

    if not filtered:
        print("# No new ✅ Done stories found for CHANGELOG.")
        return 0

    groups: dict[str, list[tuple[str, str, str]]] = {}
    for story_id, desc, source, cat in filtered:
        groups.setdefault(cat, []).append((story_id, desc, source))

    draft = _build_draft(groups)

    if args.write:
        _write_to_changelog(draft, changelog)
        print(f"Updated {changelog}")
    else:
        print(draft, end="")

    return 0


if __name__ == "__main__":
    sys.exit(main())
