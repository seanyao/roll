#!/usr/bin/env python3
"""Score one loop cycle's *result* against a multi-dimensional rubric (US-EVAL-001).

This is the pure-function ground floor of loop-result-eval. It defines the
rubric — which dimensions exist, how each maps a cycle's *facts* to a 0..1
score, and how the weighted dimensions roll up into a single 1..10 cycle
score — and nothing else. It does NOT collect facts, read runs.jsonl, or
talk to git/gh; that wiring lands in US-EVAL-002.

Distinct from skill self-scoring (US-SKILL-010..015): that is the agent's
*subjective* self-review of a single skill run, written by the agent into
``.roll/notes/*.md``. This is an *objective* result eval, computed from cycle
facts with zero extra tokens, destined for the runs.jsonl ``result_eval`` block.

Dimensions (each scored on 0..1; see ``DIMENSIONS`` for weights):

    outcome         did the cycle actually merge into main?
                    1.0 merged · 0.0 not merged · unknown if merge state absent
    correctness     is the produced PR's CI green?
                    1.0 green · 0.0 red · unknown if no CI signal
    scope_fidelity  did the cycle complete the story it was routed to (vs
                    going idle, picking an already-Done story, or drifting)?
                    1.0 completed · 0.0 idle / wrong / drifted
    quality         did the cycle add/adjust tests and avoid immediate rework?
                    1.0 tcr_count>=1 and no follow-up rework FIX · 0.5 tests
                    but a rework FIX landed · 0.0 no test activity
    efficiency      duration vs the story's est_min budget.
                    1.0 within budget · graded down past it · unknown if no
                    duration or no est_min to compare against
    cleanliness     no orphan worktrees/branches and no ALERTs raised.
                    1.0 clean · 0.0 alerts or orphans present

Each dimension may evaluate to the sentinel ``UNKNOWN`` when its required
facts are absent (e.g. CI could not be fetched). Unknown dimensions are
*excluded* from the weighted sum and the weights of the remaining dimensions
are renormalised, so a missing fact never silently scores 0 (AC of US-EVAL-002).

The 1..10 cycle score is::

    weighted = sum(score_i * weight_i for known dims) / sum(weight_i for known dims)
    cycle_score = round(1 + weighted * 9)        # 0.0 → 1, 1.0 → 10

``result_eval`` schema (the block US-EVAL-002 writes into runs.jsonl)::

    {
      "version": 1,
      "score": <int 1..10>,
      "dims": { "<dim>": <float 0..1> | "unknown", ... }
    }

Backward compatibility: older runs.jsonl records simply have no ``result_eval``
key; consumers must treat its absence as "not scored" rather than an error.

CLI (used by the bats unit test) — reads a JSON facts object from --facts or
stdin and prints the result_eval JSON::

    loop_result_eval.py --facts '{"status":"merged","ci":"green",...}'
    echo '{...}' | loop_result_eval.py

Exit codes:
  0 — scored
  1 — bad/unreadable facts JSON
"""
from __future__ import annotations

import argparse
import json
import sys

# Sentinel for a dimension whose facts are unavailable this cycle. Distinct
# from a real 0.0 score (which means "measured, and bad").
UNKNOWN = "unknown"

SCHEMA_VERSION = 1

# Rubric: dimension name → weight. Centralised single source of truth —
# tunable here, but intentionally NOT a user-facing high-frequency knob.
# Weights are relative; they are renormalised over the known dimensions, so
# their absolute scale does not matter, only their ratio.
DIMENSIONS = (
    ("outcome", 3.0),         # merged into main is what ultimately matters
    ("correctness", 2.0),     # green CI on the produced PR
    ("scope_fidelity", 2.0),  # did the right, intended work
    ("quality", 1.0),         # tests added, no immediate rework
    ("efficiency", 1.0),      # within the story's time budget
    ("cleanliness", 1.0),     # no orphans / alerts
)

DIM_WEIGHTS = dict(DIMENSIONS)


def _truthy_merged(facts) -> bool:
    """A cycle counts as merged when status==merged or merged flag is set."""
    if str(facts.get("status", "")).strip().lower() == "merged":
        return True
    return bool(facts.get("merged"))


def _score_outcome(facts):
    """1.0 merged · 0.0 not merged. Unknown only when there is no signal at
    all (no status and no explicit merged flag)."""
    if "merged" not in facts and not facts.get("status"):
        return UNKNOWN
    return 1.0 if _truthy_merged(facts) else 0.0


def _score_correctness(facts):
    """CI verdict: green → 1.0, red/failing → 0.0, otherwise unknown."""
    ci = facts.get("ci")
    if ci is None or str(ci).strip() == "":
        return UNKNOWN
    ci = str(ci).strip().lower()
    if ci in ("green", "pass", "passing", "success"):
        return 1.0
    if ci in ("red", "fail", "failing", "failure"):
        return 0.0
    return UNKNOWN


def _score_scope_fidelity(facts):
    """Did the cycle complete the story it was routed to?

    idle / no story picked → 0.0. A story routed but ending without a built
    artefact (drifted / picked-already-Done) → 0.0. Routed and present in
    built[] → 1.0.
    """
    status = str(facts.get("status", "")).strip().lower()
    if status == "idle" or not facts.get("routed_story"):
        return 0.0
    built = facts.get("built") or []
    routed = facts.get("routed_story")
    if isinstance(built, list) and routed in built:
        return 1.0
    # Routed but nothing built for it → drifted / no-op.
    return 0.0


def _score_quality(facts):
    """Tests added/adjusted and no immediate rework.

    tcr_count missing → unknown (no test signal). >=1 with no rework FIX →
    1.0; >=1 but a rework FIX landed → 0.5; 0 → 0.0.
    """
    tcr = facts.get("tcr_count")
    if tcr is None:
        return UNKNOWN
    try:
        tcr = int(tcr)
    except (TypeError, ValueError):
        return UNKNOWN
    if tcr <= 0:
        return 0.0
    if facts.get("rework_fix"):
        return 0.5
    return 1.0


def _score_efficiency(facts):
    """duration_sec vs est_min budget. Unknown when either is missing.

    Within budget → 1.0. Over budget grades down linearly to a 0.2 floor at
    3x the budget (a cycle that blows way past est is bad but not zero).
    """
    duration_sec = facts.get("duration_sec")
    est_min = facts.get("est_min")
    if duration_sec is None or est_min is None:
        return UNKNOWN
    try:
        duration_min = float(duration_sec) / 60.0
        budget = float(est_min)
    except (TypeError, ValueError):
        return UNKNOWN
    if budget <= 0:
        return UNKNOWN
    if duration_min <= budget:
        return 1.0
    overrun = duration_min / budget  # >1
    # 1x → 1.0, 3x → 0.2, clamped.
    graded = 1.0 - (overrun - 1.0) * 0.4
    return max(0.2, min(1.0, graded))


def _score_cleanliness(facts):
    """No ALERTs and no orphan worktrees/branches → 1.0, else 0.0."""
    alerts = facts.get("alerts") or []
    orphans = facts.get("orphans") or []
    if alerts or orphans:
        return 0.0
    return 1.0


_SCORERS = {
    "outcome": _score_outcome,
    "correctness": _score_correctness,
    "scope_fidelity": _score_scope_fidelity,
    "quality": _score_quality,
    "efficiency": _score_efficiency,
    "cleanliness": _score_cleanliness,
}


def score_dimensions(facts: dict) -> dict:
    """Return {dim: float 0..1 | UNKNOWN} for every rubric dimension."""
    facts = facts or {}
    return {name: _SCORERS[name](facts) for name, _ in DIMENSIONS}


def aggregate(dims: dict) -> int:
    """Roll the per-dimension scores up into a 1..10 cycle score.

    Unknown dimensions are excluded and the remaining weights renormalised.
    When every dimension is unknown, returns the neutral midpoint (5).
    """
    num = 0.0
    den = 0.0
    for name, weight in DIMENSIONS:
        s = dims.get(name, UNKNOWN)
        if s == UNKNOWN:
            continue
        num += float(s) * weight
        den += weight
    if den == 0:
        return 5  # no measurable dimension → neutral
    weighted = num / den  # 0..1
    return int(round(1 + weighted * 9))


def score_cycle(facts: dict) -> dict:
    """Compute the full ``result_eval`` block for one cycle's facts."""
    dims = score_dimensions(facts)
    return {
        "version": SCHEMA_VERSION,
        "score": aggregate(dims),
        "dims": dims,
    }


# ─────────────────────────────────────────────────────────────────────────────
# US-EVAL-004: self-evolution signals — repeated low-score patterns.
#
# This is the pure *detection* half. Given an ordered (oldest→newest) list of
# runs.jsonl records, it finds dimensions that have been low (0.0) for N cycles
# in a row and turns each into a structured improvement *signal*. It does NOT
# write the brief, touch the backlog, or dedup against history — that side-
# effecting wiring lives in bin/roll, which dedups on each signal's stable
# ``key`` so the same standing pattern is surfaced once, not every cycle.
#
# A signal is advisory only: it is meant to be surfaced in the brief's
# improvement-signal section and to seed a *candidate* backlog draft marked
# "📋 待人确认" — never to auto-activate a story or auto-edit code.
# ─────────────────────────────────────────────────────────────────────────────

# How many consecutive low cycles a dimension must show before it is a signal.
SIGNAL_STREAK = 3

# Per-dimension signal metadata: the candidate backlog item kind (FIX vs IDEA)
# and a human-facing description of what the streak means. A dimension that
# keeps measuring 0.0 means the loop is reliably failing that axis, so most map
# to FIX; scope_fidelity (repeatedly idle / off-scope) is a process IDEA.
_SIGNAL_META = {
    "outcome":        ("FIX",  "cycles keep failing to merge into main"),
    "correctness":    ("FIX",  "produced PRs keep failing CI"),
    "scope_fidelity": ("IDEA", "cycles keep going idle or off-scope"),
    "quality":        ("FIX",  "cycles keep landing without test activity"),
    "efficiency":     ("IDEA", "cycles keep blowing past their est_min budget"),
    "cleanliness":    ("FIX",  "cycles keep leaving orphans / raising ALERTs"),
}


def _result_eval_of(record):
    """Pull a usable result_eval block out of a record, or None.

    Accepts either a full runs.jsonl record ({..., "result_eval": {...}}) or a
    bare result_eval block ({"score":.., "dims":{...}})."""
    if not isinstance(record, dict):
        return None
    ev = record.get("result_eval", record)
    if isinstance(ev, dict) and isinstance(ev.get("dims"), dict):
        return ev
    return None


def detect_signals(records, streak: int = SIGNAL_STREAK):
    """Detect repeated-low-score patterns over an ordered record list.

    ``records`` is oldest→newest. A dimension fires a signal when its most
    recent ``streak`` *scored* cycles all measure exactly 0.0 (low) on it —
    "unknown" cycles are skipped (they neither confirm nor break the streak,
    so a missing CI signal does not mask a real failing streak). Each signal
    is a dict::

        {
          "key": "lowdim:<dim>",      # stable id for dedup
          "dim": "<dim>",
          "kind": "FIX" | "IDEA",
          "streak": <int>,            # how many low cycles in a row
          "summary": "<one-line human description>",
        }

    Returns signals in DIMENSIONS order (deterministic, locale-independent).
    """
    try:
        streak = int(streak)
    except (TypeError, ValueError):
        streak = SIGNAL_STREAK
    if streak < 1:
        streak = 1

    evals = [ev for ev in (_result_eval_of(r) for r in (records or [])) if ev]
    signals = []
    for name, _weight in DIMENSIONS:
        # Walk newest→oldest, counting a leading run of known-low scores.
        run = 0
        for ev in reversed(evals):
            v = (ev.get("dims") or {}).get(name, UNKNOWN)
            if v == UNKNOWN or v is None:
                continue  # unknown neither extends nor breaks the streak
            try:
                fv = float(v)
            except (TypeError, ValueError):
                continue
            if fv <= 0.0:
                run += 1
            else:
                break  # a known-good cycle breaks the streak
        if run >= streak:
            kind, why = _SIGNAL_META.get(name, ("IDEA", "repeated low score"))
            signals.append({
                "key": "lowdim:" + name,
                "dim": name,
                "kind": kind,
                "streak": run,
                "summary": "%s for %d cycles in a row" % (why, run),
            })
    return signals


def main() -> int:
    parser = argparse.ArgumentParser(description="Score a loop cycle result.")
    parser.add_argument("--facts", default=None,
                        help="cycle facts as a JSON object; reads stdin if omitted")
    parser.add_argument("--signals", action="store_true",
                        help="read a JSON array of runs records from --facts/stdin "
                             "and emit detected self-evolution signals")
    parser.add_argument("--streak", type=int, default=SIGNAL_STREAK,
                        help="consecutive low cycles required to fire a signal")
    args = parser.parse_args()

    raw = args.facts if args.facts is not None else sys.stdin.read()

    if args.signals:
        try:
            records = json.loads(raw) if raw.strip() else []
        except (ValueError, AttributeError) as exc:
            print(f"loop_result_eval: bad records JSON: {exc}", file=sys.stderr)
            return 1
        if not isinstance(records, list):
            print("loop_result_eval: --signals expects a JSON array", file=sys.stderr)
            return 1
        print(json.dumps(detect_signals(records, args.streak), sort_keys=True))
        return 0

    try:
        facts = json.loads(raw) if raw.strip() else {}
    except (ValueError, AttributeError) as exc:
        print(f"loop_result_eval: bad facts JSON: {exc}", file=sys.stderr)
        return 1
    if not isinstance(facts, dict):
        print("loop_result_eval: facts must be a JSON object", file=sys.stderr)
        return 1

    print(json.dumps(score_cycle(facts), sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
