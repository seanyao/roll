"""
pi agent usage extractor.

pi runs in the loop as ``pi -p`` (text mode), whose stdout is ONLY the
assistant's answer text — it carries no token/cost summary.  So stdout
scraping (the ``extract()`` registry contract) cannot recover usage and
always returns None for real pi output.

Instead, pi persists every session to disk at::

    ~/.pi/agent/sessions/<encoded-cwd>/<ISO-ts>_<uuid>.jsonl

Each file is NDJSON: one ``{"type":"session","cwd":<abs-worktree-path>}``
header line followed by ``{"type":"message","message":{...}}`` lines.
Assistant messages carry a per-call ``usage`` block including pi's own
cost calc.  The authoritative usage path is therefore ``usage_from_session``,
which sums per-message usage for a cycle's worktree.  See ``pi_emit.py``
(live capture) and ``backfill-pi-usage.py`` (historical backfill).
"""

import glob
import json
import os
from typing import Optional


def extract(stdin_lines: list[str]) -> Optional[dict]:
    """Registry contract stub.

    pi ``-p`` text-mode stdout carries no usage data, so this always
    returns None and the caller falls back to the null-payload path.
    Real usage is recovered from session files via ``usage_from_session``.
    Kept so the agent_usage REGISTRY contract / tests stay valid.
    """
    return None


# ── Session-file extraction (authoritative) ────────────────────────────────

# pi reports a per-message ``cost.total``; we sum it into ``cost_reported``
# for audit only.  The authoritative list cost is frozen by the writers from
# lib/prices/snapshot-*-deepseek.json in deepseek's native currency (CNY) —
# we never convert currencies (the CLI already shows the currency symbol).
def _sessions_base_dir(base_dir: Optional[str]) -> str:
    """Resolve the pi sessions root: arg → env → default."""
    return (
        base_dir
        or os.environ.get("ROLL_PI_SESSIONS_DIR")
        or os.path.expanduser("~/.pi/agent/sessions")
    )


def _sum_session_file(path: str) -> Optional[dict]:
    """Sum per-message assistant usage in a single session jsonl.

    Returns a usage dict (tokens summed) or None when the file has no
    assistant usage.  Field mapping from pi → roll schema:
    cacheWrite→cache_creation_tokens, cacheRead→cache_read_tokens.

    ``cost_reported`` carries pi's own per-message ``cost.total`` summed,
    purely for audit — it is NOT the authoritative cost.  The authoritative
    list cost is frozen by the writers (pi_emit / backfill) from the deepseek
    price snapshot in its native currency (CNY), matching claude's
    ``_price_at_snapshot`` convention.  We never convert currencies.
    """
    tin = tout = tcr = tcw = 0
    cost = 0.0
    model = None
    seen = False
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    o = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if o.get("type") != "message":
                    continue
                m = o.get("message") or {}
                if m.get("role") != "assistant":
                    continue
                u = m.get("usage")
                if not u:
                    continue
                seen = True
                if m.get("model"):
                    model = m["model"]
                tin += int(u.get("input") or 0)
                tout += int(u.get("output") or 0)
                tcr += int(u.get("cacheRead") or 0)
                tcw += int(u.get("cacheWrite") or 0)
                cost += float((u.get("cost") or {}).get("total") or 0.0)
    except OSError:
        return None
    if not seen:
        return None
    return {
        "model": model or "deepseek-v4-pro",
        "input_tokens": tin,
        "output_tokens": tout,
        "cache_creation_tokens": tcw,
        "cache_read_tokens": tcr,
        "cost_reported": cost,
        "duration_ms": None,
    }


def _session_cwd(path: str) -> Optional[str]:
    """Read the header ``session`` line and return its ``cwd``, or None."""
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    o = json.loads(line)
                except json.JSONDecodeError:
                    return None
                if o.get("type") == "session":
                    return o.get("cwd")
                # session header is expected first; bail after first JSON line
                return None
    except OSError:
        return None
    return None


def usage_from_session(
    cwd: Optional[str] = None,
    cycle_id: Optional[str] = None,
    slug: Optional[str] = None,
    base_dir: Optional[str] = None,
) -> Optional[dict]:
    """Recover a pi cycle's usage by reading its persisted session file(s).

    Matching: scan ``<base>/*/*.jsonl`` and select files whose session
    header ``cwd`` equals the target worktree path (authoritative).  When
    ``cwd`` isn't given but ``cycle_id`` is, also accept files whose path
    contains ``cycle-<cycle_id>`` (dir-name fallback).

    Retries reuse the same worktree → multiple session files may match;
    their usage is SUMMED (so token totals reflect wasted retry work too).

    Returns the merged usage dict (tokens + model + ``cost_reported``), or
    None when nothing matches / zero tokens (callers then skip writing,
    preserving "n/a not fake zero").  The authoritative list cost is left to
    the writer, which freezes it from the CNY price snapshot.
    """
    base = _sessions_base_dir(base_dir)
    files = sorted(glob.glob(os.path.join(base, "*", "*.jsonl")))
    if not files:
        return None

    matched = []
    for path in files:
        if cwd is not None and _session_cwd(path) == cwd:
            matched.append(path)
            continue
        if cycle_id is not None and ("cycle-%s" % cycle_id) in path:
            matched.append(path)

    if not matched:
        return None

    agg = {
        "model": None,
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_creation_tokens": 0,
        "cache_read_tokens": 0,
        "cost_reported": 0.0,
        "duration_ms": None,
    }
    got = False
    for path in matched:
        s = _sum_session_file(path)
        if s is None:
            continue
        got = True
        agg["model"] = agg["model"] or s["model"]
        agg["input_tokens"] += s["input_tokens"]
        agg["output_tokens"] += s["output_tokens"]
        agg["cache_creation_tokens"] += s["cache_creation_tokens"]
        agg["cache_read_tokens"] += s["cache_read_tokens"]
        agg["cost_reported"] += s["cost_reported"]

    if not got:
        return None
    has_tokens = (
        agg["input_tokens"] or agg["output_tokens"]
        or agg["cache_creation_tokens"] or agg["cache_read_tokens"]
    )
    if not has_tokens:
        return None
    agg["model"] = agg["model"] or "deepseek-v4-pro"
    return agg
