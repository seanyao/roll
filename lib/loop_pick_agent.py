#!/usr/bin/env python3
"""Classify a backlog story into a complexity tier (US-AGENT-022).

Supersedes the three-dimensional (type/est_min/risk_zone) hard-rule matcher
and the history-driven soft preference (US-AGENT-004/005). Routing now turns
on a single axis: the story's ``est_min`` estimate maps to one of three
complexity tiers — ``easy`` / ``default`` / ``hard``. The tier → agent
resolution (reading ``agents.yaml`` slots, fallback) lands in US-AGENT-023;
this module is the pure classifier.

Emits a single line on stdout::

    <tier> <rationale>

where ``tier`` is one of ``easy`` / ``default`` / ``hard``.

Tier boundaries (centralised constants, intentionally NOT user-configurable
to keep routing variance to a single axis):

    est_min <= 8           → easy
    8 < est_min <= 20      → default
    est_min > 20           → hard
    missing / illegal est  → default

Exit codes:
  0 — tier classified (always succeeds once the story is found)
  1 — story id not found in backlog / unrecoverable error

Usage:
  loop_pick_agent.py --story-id US-AGENT-022 --backlog .roll/backlog.md
  loop_pick_agent.py --est-min 12          # classify a bare estimate
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# Complexity-tier boundaries. Single source of truth — change here only.
EASY_MAX_MIN = 8        # est_min <= 8        → easy
HARD_MIN_MIN = 20       # est_min >  20       → hard
TIER_EASY = "easy"
TIER_DEFAULT = "default"
TIER_HARD = "hard"

PROFILE_BLOCK_RE = re.compile(r"\*\*Agent profile:\*\*")
EST_RE = re.compile(r"^\s*-\s*est_min:\s*(\d+)")
ANCHOR_TEMPLATE = '<a id="{anchor}"></a>'


def _classify_complexity(est_min) -> str:
    """Map an ``est_min`` estimate onto a complexity tier.

    ``<= 8`` → easy, ``> 20`` → hard, ``8 < x <= 20`` → default. A missing or
    non-integer estimate (None, "", non-numeric) falls back to ``default``.
    """
    if est_min is None:
        return TIER_DEFAULT
    try:
        n = int(est_min)
    except (TypeError, ValueError):
        return TIER_DEFAULT
    if n < 0:
        # Negative estimate is invalid data → treat like missing.
        return TIER_DEFAULT
    if n <= EASY_MAX_MIN:
        return TIER_EASY
    if n > HARD_MIN_MIN:
        return TIER_HARD
    return TIER_DEFAULT


def _id_to_anchor(story_id: str) -> str:
    return story_id.lower()


def _find_feature_md(backlog_path: Path, story_id: str) -> Path | None:
    """Resolve feature md path by scanning backlog rows for the story id."""
    if not backlog_path.exists():
        return None
    link_re = re.compile(
        r"\[" + re.escape(story_id) + r"\]\((\.roll/features/[^)]+?)#",
        re.IGNORECASE,
    )
    for line in backlog_path.read_text(encoding="utf-8").splitlines():
        m = link_re.search(line)
        if m:
            return Path(m.group(1))
    return None


def _read_est_min(feature_md: Path, story_id: str):
    """Return the story's est_min as an int, or None if not found."""
    if not feature_md.exists():
        return None
    anchor = ANCHOR_TEMPLATE.format(anchor=_id_to_anchor(story_id))
    text = feature_md.read_text(encoding="utf-8")
    if anchor not in text:
        return None

    # Slice from the anchor to the next anchor or EOF.
    start = text.index(anchor)
    next_anchor_match = re.search(r'<a id="[^"]+"></a>', text[start + len(anchor):])
    end = start + len(anchor) + (next_anchor_match.start() if next_anchor_match else len(text))
    section = text[start:end]

    if not PROFILE_BLOCK_RE.search(section):
        return None

    for line in section.splitlines():
        m = EST_RE.match(line)
        if m:
            return int(m.group(1))
    return None


def classify_story(story_id: str, backlog_path: Path) -> tuple[str, str] | None:
    """Return (tier, rationale) for a backlog story, or None on hard error."""
    feature_md = _find_feature_md(backlog_path, story_id)
    if feature_md is None:
        return None  # story id not in backlog
    est_min = _read_est_min(feature_md, story_id)
    tier = _classify_complexity(est_min)
    if est_min is None:
        rationale = f"no est_min for {story_id}; tier={tier} (default)"
    else:
        rationale = f"est_min={est_min} → tier={tier}"
    return (tier, rationale)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--story-id")
    parser.add_argument("--backlog", default=".roll/backlog.md")
    parser.add_argument("--est-min", default=None,
                        help="classify a bare estimate without a backlog lookup")
    # Accepted for backward-compatible invocation; routing no longer reads
    # agent-routes.yaml or runs.jsonl (US-AGENT-022 retires the 3-dim matcher
    # and history soft preference). Tier→agent resolution is US-AGENT-023.
    parser.add_argument("--routes", default=None, help=argparse.SUPPRESS)
    parser.add_argument("--runs", default=None, help=argparse.SUPPRESS)
    args = parser.parse_args()

    if args.est_min is not None:
        tier = _classify_complexity(args.est_min)
        print(f"{tier} est_min={args.est_min} → tier={tier}")
        return 0

    if not args.story_id:
        print("loop_pick_agent: --story-id or --est-min required", file=sys.stderr)
        return 1

    result = classify_story(args.story_id, Path(args.backlog))
    if result is None:
        print(f"loop_pick_agent: cannot classify {args.story_id}", file=sys.stderr)
        return 1
    tier, rationale = result
    print(f"{tier} {rationale}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
