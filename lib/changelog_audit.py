#!/usr/bin/env python3
"""Changelog audit module (US-CONSIST-002).

Checks that ✅ Done backlog stories are reflected in CHANGELOG.md.
Provides both coverage checking and gap reporting.

Usage as library:
  from lib.changelog_audit import check_changelog_coverage
  result = check_changelog_coverage(done_stories, changelog_path)
"""

from __future__ import annotations

from pathlib import Path
from typing import Any


def _read_changelog_text(changelog_path: Path) -> str:
    """Read changelog text, returning empty string if file is missing."""
    if not changelog_path.exists():
        return ""
    return changelog_path.read_text(encoding="utf-8")


def check_changelog_coverage(
    done_stories: dict[str, list[str]],
    changelog_path: Path,
) -> dict[str, Any]:
    """Check that Done stories appear in CHANGELOG.md.

    Args:
        done_stories: {feature_name: [story_id, ...]} from backlog
        changelog_path: Path to CHANGELOG.md

    Returns:
        {"status": "pass"|"fail", "gaps": [descriptions...]}
    """
    if not changelog_path.exists():
        return {"status": "pass", "gaps": []}

    changelog_text = _read_changelog_text(changelog_path)
    gaps: list[str] = []

    for feature_name, story_ids in done_stories.items():
        for story_id in story_ids:
            if story_id not in changelog_text:
                gaps.append(
                    f"Story '{story_id}' (feature '{feature_name}') is Done "
                    "but not referenced in CHANGELOG.md"
                )

    return {
        "status": "pass" if not gaps else "fail",
        "gaps": gaps,
    }


def check_features_md_coverage(
    done_features: dict[str, list[str]],
    features_md_path: Path,
) -> dict[str, Any]:
    """Check that features with Done stories are listed in features.md.

    Args:
        done_features: {feature_name: [story_id, ...]} from backlog
        features_md_path: Path to .roll/features.md

    Returns:
        {"status": "pass"|"fail", "gaps": [descriptions...]}
    """
    import re

    if not features_md_path.exists():
        return {"status": "pass", "gaps": []}

    features_text = features_md_path.read_text(encoding="utf-8")
    gaps: list[str] = []

    for feature_name in done_features:
        escaped = re.escape(feature_name)
        if not re.search(r"(^|[\s/])" + escaped + r"([\s/).]|$)", features_text):
            gaps.append(
                f"Feature '{feature_name}' has Done stories but is missing "
                "from features.md catalog"
            )

    return {
        "status": "pass" if not gaps else "fail",
        "gaps": gaps,
    }


def check_guide_doc_coverage(
    done_features: dict[str, list[str]],
    guide_en_dir: Path,
) -> dict[str, Any]:
    """Check that features with Done stories have guide documentation.

    Heuristic: checks whether a .md file in guide/en/ references the feature
    name or its story IDs.

    Args:
        done_features: {feature_name: [story_id, ...]} from backlog
        guide_en_dir: Path to guide/en/

    Returns:
        {"status": "pass"|"fail", "gaps": [descriptions...]}
    """
    if not guide_en_dir.exists() or not guide_en_dir.is_dir():
        return {"status": "pass", "gaps": []}

    # Collect all guide text
    all_guide_text = ""
    for md_file in sorted(guide_en_dir.glob("*.md")):
        try:
            all_guide_text += md_file.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue

    # Also read practices/ subdirectory
    practices_dir = guide_en_dir / "practices"
    if practices_dir.exists() and practices_dir.is_dir():
        for md_file in sorted(practices_dir.glob("*.md")):
            try:
                all_guide_text += md_file.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue

    gaps: list[str] = []
    for feature_name, story_ids in done_features.items():
        found = False
        # Check if feature name appears in guide text
        if feature_name.lower() in all_guide_text.lower():
            found = True
        # Check if any story ID appears
        for sid in story_ids:
            if sid in all_guide_text:
                found = True
                break
        if not found:
            gaps.append(
                f"Feature '{feature_name}' has Done stories but no guide "
                "documentation found in guide/en/"
            )

    return {
        "status": "pass" if not gaps else "fail",
        "gaps": gaps,
    }
