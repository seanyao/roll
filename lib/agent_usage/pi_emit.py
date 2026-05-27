#!/usr/bin/env python3
"""
pi_emit — write ONE authoritative usage event for a finished pi cycle.

pi runs as ``pi -p`` (text mode): its stdout carries no token/cost summary,
so loop-fmt's passthrough can only show progress, not capture usage. This
thin CLI is invoked once by bin/roll after the agent phase (when ``$WT`` and
``$CYCLE_ID`` are still in scope). It recovers the cycle's real usage from
pi's persisted session files via ``pi.usage_from_session`` and appends a
single ``stage=="usage"`` event to the loop events file.

Exactly one event per cycle — the dashboard SUMS token fields across same-
label usage events, so emitting once (here, post-cycle) instead of once per
retry attempt (the old loop-fmt path) avoids ×N inflation.

Cost is frozen at the active price snapshot in deepseek's native currency
(CNY) via ``model_prices.compute_list_cost`` — the same convention claude
uses (US-VIEW-014). pi's own ``cost.total`` (computed in USD) is kept as
``cost_reported_usd`` for audit only. We never convert currencies; the
dashboard already renders the right symbol from ``cost_currency``.

When ``usage_from_session`` finds nothing (no session match, zero tokens),
nothing is written — preserving "show n/a, not a fake zero".
"""

import argparse
import importlib.util
import json
import os
import sys
from datetime import datetime, timezone

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_LIB_DIR = os.path.dirname(_THIS_DIR)


def _load_model_prices():
    spec = importlib.util.spec_from_file_location(
        "model_prices", os.path.join(_LIB_DIR, "model_prices.py")
    )
    mp = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mp)
    return mp


def _load_pi():
    spec = importlib.util.spec_from_file_location(
        "agent_usage_pi", os.path.join(_THIS_DIR, "pi.py")
    )
    pi = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pi)
    return pi


def build_event(cwd=None, cycle_id=None, slug=None, base_dir=None):
    """Return the (line dict) usage event for a pi cycle, or None to skip.

    None means no recoverable usage — caller writes nothing.
    """
    pi = _load_pi()
    u = pi.usage_from_session(
        cwd=cwd, cycle_id=cycle_id, slug=slug, base_dir=base_dir
    )
    if u is None:
        return None

    mp = _load_model_prices()
    model = u.get("model") or "deepseek-v4-pro"
    totals = {
        "input_tokens": int(u.get("input_tokens") or 0),
        "output_tokens": int(u.get("output_tokens") or 0),
        "cache_creation_tokens": int(u.get("cache_creation_tokens") or 0),
        "cache_read_tokens": int(u.get("cache_read_tokens") or 0),
    }
    cost_list = mp.compute_list_cost(model, **totals)
    currency = mp.currency_for(model)

    payload = {
        "model": model,
        "input_tokens": totals["input_tokens"],
        "output_tokens": totals["output_tokens"],
        "cache_creation_tokens": totals["cache_creation_tokens"],
        "cache_read_tokens": totals["cache_read_tokens"],
        # pi's own per-message cost.total summed, in USD — audit only.
        "cost_reported_usd": u.get("cost_reported"),
        "duration_ms": u.get("duration_ms"),
        # Authoritative, frozen at snapshot in native currency (CNY).
        "cost_list_usd": cost_list,
        "cost_currency": currency,
        "prices_version": getattr(mp, "VERSION", None),
    }
    return {
        "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "stage": "usage",
        "label": cycle_id,
        "detail": payload,
        "outcome": "ok",
    }


def _default_events_path(slug, shared):
    base = shared or os.environ.get("LOOP_SHARED_ROOT") \
        or os.path.expanduser("~/.shared/roll")
    return os.path.join(base, "loop", "events-%s.ndjson" % slug)


def main(argv=None):
    ap = argparse.ArgumentParser(description="emit one pi usage event")
    ap.add_argument("--cwd", help="cycle worktree path (authoritative match)")
    ap.add_argument("--cycle", help="cycle id (label + dir-name fallback)")
    ap.add_argument("--slug", help="project slug (events filename)")
    ap.add_argument("--shared", help="shared root (for default events path)")
    ap.add_argument("--events", help="explicit events file path (preferred)")
    ap.add_argument("--base-dir", help="pi sessions root override (tests)")
    args = ap.parse_args(argv)

    event = build_event(
        cwd=args.cwd, cycle_id=args.cycle, slug=args.slug, base_dir=args.base_dir
    )
    if event is None:
        return 0  # nothing recoverable — write nothing (n/a, not fake zero)

    evfile = args.events or _default_events_path(args.slug, args.shared)
    try:
        os.makedirs(os.path.dirname(evfile), exist_ok=True)
        with open(evfile, "a") as f:
            f.write(json.dumps(event) + "\n")
    except OSError as e:
        print("[pi_emit] failed to write %s: %s" % (evfile, e), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
