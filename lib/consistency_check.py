#!/usr/bin/env python3
"""Consistency check orchestrator (US-CONSIST-001).

Runs checks across five dimensions, produces structured pass/gap reports.

Usage:
  python3 lib/consistency_check.py [--json] [--project-dir DIR]

Exit:
  0 — all dimensions pass
  1 — one or more dimensions have gaps
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

DIMENSIONS = ["code", "docs", "i18n", "tests", "site"]


def _read_done_features(backlog_path: Path) -> dict[str, list[str]]:
    """Extract features with ≥1 ✅ Done story from backlog.

    Returns {feature_name: [story_id, ...]}.
    """
    text = backlog_path.read_text(encoding="utf-8")
    features: dict[str, list[str]] = {}
    current_feature: str | None = None

    for line in text.splitlines():
        m = re.search(r"^### Feature:\s*(.+)$", line)
        if m:
            current_feature = m.group(1).strip()
            features[current_feature] = []
            continue

        if current_feature and "✅ Done" in line:
            m2 = re.search(r"\[(US-|FIX-|REFACTOR-)([^\]]+)\]", line)
            if m2:
                features[current_feature].append(m2.group(1) + m2.group(2))

    return {k: v for k, v in features.items() if v}


def check_features_catalog(project_dir: Path) -> dict[str, Any]:
    """Dimension: code — features.md catalog completeness.

    Reuses logic from release.sh _enforce_features_catalog.
    """
    backlog = project_dir / ".roll" / "backlog.md"
    features = project_dir / ".roll" / "features.md"

    if not backlog.exists() or not features.exists():
        return {"status": "pass", "gaps": []}

    done_features = _read_done_features(backlog)
    if not done_features:
        return {"status": "pass", "gaps": []}

    features_text = features.read_text(encoding="utf-8")
    gaps: list[str] = []

    for feat_name in done_features:
        escaped = re.escape(feat_name)
        if not re.search(r"(^|[\s/])" + escaped + r"([\s/).]|$)", features_text):
            gaps.append(
                f"Feature '{feat_name}' has Done stories but is missing from features.md catalog"
            )

    return {
        "status": "pass" if not gaps else "fail",
        "gaps": gaps,
    }


def check_i18n(project_dir: Path) -> dict[str, Any]:
    """Dimension: i18n — guide file parity + i18n key completeness."""
    gaps: list[str] = []

    # 1. Guide file parity (guide/en ↔ guide/zh)
    guide_en = project_dir / "guide" / "en"
    guide_zh = project_dir / "guide" / "zh"
    if guide_en.exists() and guide_zh.exists():
        en_files = {p.name for p in guide_en.iterdir() if p.is_file()}
        zh_files = {p.name for p in guide_zh.iterdir() if p.is_file()}
        en_only = en_files - zh_files
        zh_only = zh_files - en_files
        for f in sorted(en_only):
            gaps.append(f"guide/en/{f} has no corresponding guide/zh/{f}")
        for f in sorted(zh_only):
            gaps.append(f"guide/zh/{f} has no corresponding guide/en/{f}")

    # 2. i18n key completeness (EN ↔ ZH pairing)
    i18n_dir = project_dir / "lib" / "i18n"
    if i18n_dir.exists():
        keys_en: set[str] = set()
        keys_zh: set[str] = set()
        for sh_file in sorted(i18n_dir.glob("*.sh")):
            text = sh_file.read_text(encoding="utf-8")
            for m in re.finditer(r'_i18n_set\s+(en|zh)\s+([^\s]+)', text):
                lang = m.group(1)
                key = m.group(2)
                if lang == "en":
                    keys_en.add(key)
                else:
                    keys_zh.add(key)
        en_only_keys = keys_en - keys_zh
        zh_only_keys = keys_zh - keys_en
        for k in sorted(en_only_keys):
            gaps.append(f"i18n key '{k}' has EN but is missing ZH translation")
        for k in sorted(zh_only_keys):
            gaps.append(f"i18n key '{k}' has ZH but is missing EN translation")

    return {
        "status": "pass" if not gaps else "fail",
        "gaps": gaps,
    }


def check_tests_placeholder(_project_dir: Path, dim: str) -> dict[str, Any]:
    """Placeholder for dimensions not yet implemented."""
    return {
        "status": "pass",
        "gaps": [],
        "note": "placeholder — will be implemented in US-CONSIST-003",
    }


def run_all(project_dir: Path) -> dict[str, Any]:
    report: dict[str, Any] = {
        "overall": "pass",
        "dimensions": {},
    }

    for dim in DIMENSIONS:
        if dim == "code":
            result = check_features_catalog(project_dir)
        elif dim == "i18n":
            result = check_i18n(project_dir)
        elif dim == "tests":
            result = check_tests_placeholder(project_dir, dim)
        elif dim in ("docs", "site"):
            result = {
                "status": "pass",
                "gaps": [],
                "note": "placeholder — will be implemented in US-CONSIST-002/004",
            }
        else:
            result = {
                "status": "pass",
                "gaps": [],
                "note": f"unknown dimension: {dim}",
            }

        report["dimensions"][dim] = result
        if result["status"] == "fail":
            report["overall"] = "fail"

    return report


def format_human(report: dict[str, Any]) -> str:
    lines: list[str] = []
    lines.append("Consistency Report")
    lines.append("=" * 50)

    for dim, result in report["dimensions"].items():
        icon = "✅" if result["status"] == "pass" else "❌"
        lines.append(f"{icon} {dim}: {result['status']}")
        for gap in result.get("gaps", []):
            lines.append(f"   • {gap}")
        note = result.get("note", "")
        if note:
            lines.append(f"   ℹ {note}")

    lines.append("-" * 50)
    lines.append(f"Overall: {report['overall']}")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Consistency check orchestrator")
    parser.add_argument(
        "--json", action="store_true", help="Output machine-readable JSON"
    )
    parser.add_argument(
        "--project-dir", type=Path, default=Path.cwd(), help="Project directory"
    )
    args = parser.parse_args()

    report = run_all(args.project_dir)

    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print(format_human(report))

    return 0 if report["overall"] == "pass" else 1


if __name__ == "__main__":
    sys.exit(main())
