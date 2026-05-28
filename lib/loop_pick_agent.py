#!/usr/bin/env python3
"""Pick a routing agent for a backlog story (US-AGENT-004).

Reads story metadata from the feature markdown (linked from the BACKLOG row)
and matches it against agent-routes.yaml hard rules. Emits a single line on
stdout:

    <agent> <rule_kind> <rationale>

Exit codes:
  0 — agent picked (rule_kind in {hard, default})
  1 — story id not found / unrecoverable error

Usage:
  loop_pick_agent.py --story-id US-AGENT-004 \\
                     --backlog .roll/backlog.md \\
                     --routes  .roll/agent-routes.yaml

History-driven soft preference (US-AGENT-005) lands on top of this in a
later commit; the present module only implements hard-rule selection.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("loop_pick_agent: PyYAML not installed", file=sys.stderr)
    sys.exit(2)


PROFILE_BLOCK_RE = re.compile(r"\*\*Agent profile:\*\*")
EST_RE = re.compile(r"^\s*-\s*est_min:\s*(\d+)")
RISK_RE = re.compile(r"^\s*-\s*risk_zone:\s*([a-zA-Z]+)")
CHAIN_RE = re.compile(r"^\s*-\s*chain_depth:\s*(\d+)")
ANCHOR_TEMPLATE = '<a id="{anchor}"></a>'


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
    for line in backlog_path.read_text().splitlines():
        m = link_re.search(line)
        if m:
            return Path(m.group(1))
    return None


def _read_profile(feature_md: Path, story_id: str) -> dict | None:
    """Return {est_min, risk_zone, chain_depth} or None if not found."""
    if not feature_md.exists():
        return None
    anchor = ANCHOR_TEMPLATE.format(anchor=_id_to_anchor(story_id))
    text = feature_md.read_text()
    if anchor not in text:
        return None

    # Slice from the anchor to the next anchor or EOF.
    start = text.index(anchor)
    next_anchor_match = re.search(r'<a id="[^"]+"></a>', text[start + len(anchor):])
    end = start + len(anchor) + (next_anchor_match.start() if next_anchor_match else len(text))
    section = text[start:end]

    if not PROFILE_BLOCK_RE.search(section):
        return None

    profile: dict[str, object] = {}
    for line in section.splitlines():
        m = EST_RE.match(line)
        if m:
            profile["est_min"] = int(m.group(1))
            continue
        m = RISK_RE.match(line)
        if m:
            profile["risk_zone"] = m.group(1).lower()
            continue
        m = CHAIN_RE.match(line)
        if m:
            profile["chain_depth"] = int(m.group(1))
    if "est_min" not in profile or "risk_zone" not in profile:
        return None
    profile.setdefault("chain_depth", 0)
    return profile


def _story_type(story_id: str) -> str:
    # Story id prefix → routing type. US-AGENT-004 → "US", FIX-* → "FIX",
    # REFACTOR-* → "REFACTOR". Default falls through to "US".
    prefix = story_id.split("-", 1)[0].upper()
    return prefix if prefix in {"FIX", "US", "REFACTOR"} else "US"


def _agent_matches(agent_cfg: dict, story_type: str, est_min: int, risk_zone: str) -> bool:
    types = agent_cfg.get("types") or []
    if story_type not in types:
        return False
    est_range = agent_cfg.get("est_min") or {}
    lo = est_range.get("min")
    hi = est_range.get("max")
    if lo is not None and est_min < lo:
        return False
    if hi is not None and est_min > hi:
        return False
    risk_list = agent_cfg.get("risk") or []
    if risk_zone not in risk_list:
        return False
    return True


def _hit_rates(runs_path: Path, story_type: str, window: int) -> dict[str, tuple[int, int]]:
    """Return {agent: (built_count, total_count)} for the requested story type
    over the last `window` runs.jsonl records that targeted that type. Records
    must carry `agent` and `story_type` (forward-looking schema, US-AGENT-005).
    Older records lacking these fields are skipped silently.
    """
    rates: dict[str, list[int]] = {}
    if window <= 0 or not runs_path.exists():
        return {}
    # Read all then take last N matching story_type.
    matching: list[dict] = []
    for line in runs_path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        if rec.get("story_type") != story_type:
            continue
        if "agent" not in rec:
            continue
        matching.append(rec)
    for rec in matching[-window:]:
        agent = rec["agent"]
        slot = rates.setdefault(agent, [0, 0])
        slot[1] += 1
        if rec.get("status") == "built":
            slot[0] += 1
    return {a: (b, t) for a, (b, t) in rates.items()}


def pick(story_id: str, backlog_path: Path, routes_path: Path,
         runs_path: Path | None = None) -> tuple[str, str, str] | None:
    """Return (agent, rule_kind, rationale) or None on hard error."""
    if not routes_path.exists():
        return None
    routes = yaml.safe_load(routes_path.read_text()) or {}
    agents = routes.get("agents") or {}
    history = routes.get("history") or {}
    cold = history.get("cold_start_default") or next(iter(agents), None)
    window = int(history.get("window_cycles", 0) or 0)
    threshold = float(history.get("prefer_threshold", 0.0) or 0.0)

    feature_md = _find_feature_md(backlog_path, story_id)
    if feature_md is None:
        return None  # story id not in backlog

    profile = _read_profile(feature_md, story_id)
    if profile is None:
        if cold is None:
            return None
        return (cold, "default", f"no profile for {story_id}; fell back to cold_start_default")

    story_type = _story_type(story_id)
    est_min = profile["est_min"]
    risk_zone = profile["risk_zone"]

    # Hard-rule candidate set in declaration order.
    matched: list[str] = []
    for name, cfg in agents.items():
        if _agent_matches(cfg or {}, story_type, est_min, risk_zone):
            matched.append(name)

    if not matched:
        if cold is None:
            return None
        return (cold, "default", f"no agent matched {story_type}/{est_min}/{risk_zone}; cold_start_default")

    # Single match → no soft pref needed.
    if len(matched) == 1 or runs_path is None or window <= 0:
        chosen = matched[0]
        rationale = f"hard: type={story_type} est={est_min} risk={risk_zone} matched {chosen}"
        return (chosen, "hard", rationale)

    # Multiple matches → consider history soft preference.
    rates = _hit_rates(runs_path, story_type, window)
    # Filter rates to candidates only, require sample ≥ 5 and rate ≥ threshold.
    eligible = []
    for cand in matched:
        built, total = rates.get(cand, (0, 0))
        if total >= 5:
            rate = built / total if total else 0.0
            if rate >= threshold:
                eligible.append((rate, cand))
    if eligible:
        eligible.sort(reverse=True)  # highest rate first
        rate, chosen = eligible[0]
        rationale = (
            f"soft: type={story_type} est={est_min} risk={risk_zone} "
            f"history_rate={rate:.2f} (threshold={threshold}) matched {chosen}"
        )
        return (chosen, "soft", rationale)

    # Fallback to hard-rule first.
    chosen = matched[0]
    rationale = f"hard: type={story_type} est={est_min} risk={risk_zone} matched {chosen} (no eligible history)"
    return (chosen, "hard", rationale)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--story-id", required=True)
    parser.add_argument("--backlog", default=".roll/backlog.md")
    parser.add_argument("--routes", default=".roll/agent-routes.yaml")
    parser.add_argument("--runs", default=None,
                        help="runs.jsonl path for history soft preference (US-AGENT-005)")
    args = parser.parse_args()

    runs = Path(args.runs) if args.runs else None
    result = pick(args.story_id, Path(args.backlog), Path(args.routes), runs)
    if result is None:
        print(f"loop_pick_agent: cannot route {args.story_id}", file=sys.stderr)
        return 1
    agent, rule_kind, rationale = result
    print(f"{agent} {rule_kind} {rationale}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
