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


# ─────────────────────────────────────────────────────────────────────────────
# US-AGENT-030: transparent, auditable in-tier soft nudge.
#
# The complexity tier (easy/default/hard from ``_classify_complexity``) is a
# HARD constraint — it decides which agents.yaml slot is consulted and a task is
# NEVER moved out of its tier. On top of that hard floor this adds a SOFT
# priority: among the candidate agents already associated with this tier, prefer
# the one with the best per-(agent × story_type) historical hit-rate.
#
# How this differs from the US-AGENT-022-retired soft preference (the whole
# point of the story):
#   - deterministic: same history in → same agent out. No rng, no time seed,
#     no decay clock. ``nudge_within_tier`` is a pure function of its arguments.
#   - auditable: every decision returns a human-readable rationale string that
#     the caller logs into runs.jsonl + the event log.
#   - sample floor: a (agent, story_type) combo below ``sample_floor`` does not
#     participate; the slot agent is kept and the audit line says so.
#   - one switch: ``enabled=False`` makes this an exact identity — it returns
#     the slot agent unchanged, behaving precisely like US-AGENT-023.
# ─────────────────────────────────────────────────────────────────────────────

# Default minimum samples a (agent × story_type) combo needs before its hit-rate
# is allowed to influence routing. Below this the combo is statistically
# meaningless, so we keep the operator's slot choice. Centralised constant.
SAMPLE_FLOOR = 8


def nudge_within_tier(slot_agent, candidates, story_type, hit_rates,
                      sample_floor=SAMPLE_FLOOR, enabled=True):
    """Reorder same-tier candidates by historical hit-rate; return the winner.

    Pure function — no I/O, no randomness, no clock. Given the same arguments
    it always returns the same ``(chosen_agent, rationale)`` pair.

    Args:
      slot_agent:   the agent the est_min tier slot resolved to (the hard-floor
                    default). Always the fallback / tie-break winner.
      candidates:   iterable of in-tier candidate agent names (already
                    constrained to this tier + installed by the caller). The
                    slot agent is folded in even if absent.
      story_type:   the story's type bucket (e.g. "US" / "FIX"); the hit-rate is
                    looked up per (agent, story_type).
      hit_rates:    {"<agent>\\x1f<story_type>": {"hit_rate": float,
                    "sample_n": int}}  (the loop_result_eval read model).
      sample_floor: combos with sample_n < this are ignored (default 8).
      enabled:      when False, returns (slot_agent, "<reason: disabled>") with
                    no reordering — exact US-AGENT-023 behaviour.

    Returns:
      (chosen_agent, rationale) where rationale is a one-line audit string.
    """
    if not slot_agent:
        return (slot_agent, "no slot agent; nudge skipped")
    if not enabled:
        return (slot_agent, "nudge disabled; keeping est_min slot %s" % slot_agent)

    # Build the candidate set: the slot agent is always in the running, plus any
    # caller-supplied in-tier candidates. De-dup but keep a deterministic order
    # (slot agent first, then the rest sorted) so iteration is reproducible.
    seen = {slot_agent}
    rest = []
    for c in (candidates or []):
        if c and c not in seen:
            seen.add(c)
            rest.append(c)
    ordered = [slot_agent] + sorted(rest)

    def _stat(agent):
        key = "%s\x1f%s" % (agent, story_type)
        st = (hit_rates or {}).get(key) or {}
        try:
            n = int(st.get("sample_n", 0))
        except (TypeError, ValueError):
            n = 0
        try:
            hr = float(st.get("hit_rate", 0.0))
        except (TypeError, ValueError):
            hr = 0.0
        return hr, n

    # Eligible = combos that clear the sample floor.
    eligible = []
    for a in ordered:
        hr, n = _stat(a)
        if n >= sample_floor:
            eligible.append((a, hr, n))

    if not eligible:
        return (slot_agent,
                "n<%d for all %s candidates in this tier; keeping slot %s"
                % (sample_floor, story_type, slot_agent))

    # Best hit-rate wins. Deterministic tie-break: the slot agent first (it is
    # always index 0 in ``ordered``), then the earliest candidate in the stable
    # order. Sort by (-hit_rate, ordered_index) so ties never depend on dict
    # iteration or locale.
    index_of = {}
    for i, a in enumerate(ordered):
        index_of[a] = i
    eligible.sort(key=lambda t: (-t[1], index_of[t[0]]))
    best_agent, best_hr, best_n = eligible[0]

    slot_hr, slot_n = _stat(slot_agent)
    if best_agent == slot_agent:
        return (slot_agent,
                "%s best for %s in-tier (hit_rate %.2f, n=%d); slot kept"
                % (slot_agent, story_type, best_hr, best_n))
    return (best_agent,
            "%s in-tier hit_rate %.2f (n=%d) > slot %s %.2f (n=%d) for %s -> prefer %s"
            % (best_agent, best_hr, best_n, slot_agent, slot_hr, slot_n,
               story_type, best_agent))


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
    # US-AGENT-030: in-tier soft nudge. When --nudge is given, the other --nudge-*
    # args drive nudge_within_tier and the chosen agent + rationale are printed as
    # "<agent>\t<rationale>" (tab-separated so the rationale can carry spaces).
    parser.add_argument("--nudge", action="store_true",
                        help="reorder in-tier candidates by historical hit-rate")
    parser.add_argument("--slot-agent", default=None,
                        help="the est_min tier slot agent (nudge hard-floor default)")
    parser.add_argument("--story-type", default="",
                        help="story type bucket for the hit-rate lookup (US/FIX/...)")
    parser.add_argument("--candidates", default="",
                        help="comma-separated in-tier candidate agent names")
    parser.add_argument("--hit-rates", default=None,
                        help="hit-rate read model JSON (from loop_result_eval --hit-rates); "
                             "reads stdin if omitted")
    parser.add_argument("--sample-floor", type=int, default=SAMPLE_FLOOR,
                        help="min sample_n a combo needs to influence routing")
    parser.add_argument("--disabled", action="store_true",
                        help="run the identity path (exact US-AGENT-023 behaviour)")
    args = parser.parse_args()

    if args.nudge:
        if not args.slot_agent:
            print("loop_pick_agent: --slot-agent required with --nudge", file=sys.stderr)
            return 1
        import json
        raw = args.hit_rates
        if raw is None:
            raw = sys.stdin.read()
        try:
            hit_rates = json.loads(raw) if raw and raw.strip() else {}
        except (ValueError, TypeError) as exc:
            print(f"loop_pick_agent: bad hit-rates JSON: {exc}", file=sys.stderr)
            return 1
        candidates = [c.strip() for c in args.candidates.split(",") if c.strip()]
        chosen, rationale = nudge_within_tier(
            args.slot_agent, candidates, args.story_type, hit_rates,
            sample_floor=args.sample_floor, enabled=not args.disabled)
        # Tab-separated: field 1 = chosen agent, field 2 = audit rationale.
        print(f"{chosen}\t{rationale}")
        return 0

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
