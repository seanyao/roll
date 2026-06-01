"""
kimi (Moonshot Kimi CLI) agent usage extractor.

Two paths are supported, mirroring pi.py:

1. ``extract()`` — the registry stdout-scrape contract, kept for legacy
   callers (and as a fallback when session files are absent).
2. ``usage_from_session()`` — authoritative recovery from kimi-code's
   persisted session files at ``~/.kimi-code/sessions/wd_*/session_*/agents/main/wire.jsonl``.
   Each wire file is NDJSON with one or more ``{"type":"usage.record","model":...,"usage":{...}}``
   lines whose token fields are summed per cycle.

FIX-154 added the session path so loop cycles run by kimi-code (the
default agent today) no longer show ``—/—`` for tokens and cost in the
RECENT dashboard.

The stdout-scrape contract still recognises (case-insensitive)::

    Model: kimi-k2
    Tokens: input=15300 output=3120
    Input tokens:  15,300
    Output tokens:  3,120
    Total tokens:  18,420

When an explicit USD cost line isn't present, cost is computed from
``lib/model_prices.py`` (list price).
"""

import glob
import json
import os
import re
import sys
from typing import Optional

# model_prices lives one level up (lib/), alongside this package.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
try:
    import model_prices
except Exception:  # pragma: no cover - import guard
    model_prices = None

# Default model when the output omits an explicit model line.
_DEFAULT_MODEL = "kimi-k2"

_MODEL_RE = re.compile(r"^\s*model\s*[:=]\s*([A-Za-z0-9][\w.\-]*)", re.IGNORECASE)
_INPUT_RE = re.compile(r"input(?:\s+tokens)?\s*[:=]\s*([\d,]+)", re.IGNORECASE)
_OUTPUT_RE = re.compile(r"output(?:\s+tokens)?\s*[:=]\s*([\d,]+)", re.IGNORECASE)
_TOTAL_RE = re.compile(r"total(?:\s+tokens)?\s*[:=]\s*([\d,]+)", re.IGNORECASE)
_COST_RE = re.compile(r"cost\s*[:=]?\s*\$?\s*([\d.]+)\s*(?:usd)?", re.IGNORECASE)


def _to_int(s: str) -> int:
    """Parse a token count string, tolerating thousands separators."""
    return int(s.replace(",", ""))


def extract(stdin_lines: list[str]) -> Optional[dict]:
    """Parse Kimi CLI stdout and return a usage dict, or None.

    Scans every line (the usage summary is at the tail but may be wrapped
    by surrounding text) and accumulates the last seen model / token / cost
    values.  Requires at least one of input/output/total tokens to be found;
    otherwise returns None (caller falls back to null payload).
    """
    if not stdin_lines:
        return None

    model = None
    tin = tout = ttotal = None
    cost = None

    for raw in stdin_lines:
        line = raw.rstrip("\n")

        m = _MODEL_RE.match(line)
        if m:
            model = m.group(1)

        m = _INPUT_RE.search(line)
        if m:
            tin = _to_int(m.group(1))

        m = _OUTPUT_RE.search(line)
        if m:
            tout = _to_int(m.group(1))

        m = _TOTAL_RE.search(line)
        if m:
            ttotal = _to_int(m.group(1))

        m = _COST_RE.search(line)
        if m:
            try:
                cost = float(m.group(1))
            except ValueError:
                pass

    # Require at least one token figure; otherwise this isn't a kimi cycle.
    if tin is None and tout is None and ttotal is None:
        return None
    if tin is None and tout is None and ttotal is not None:
        # No split available — attribute the whole total to input so the
        # cycle is non-zero; output stays 0.
        tin = ttotal
        tout = 0
    else:
        tin = tin or 0
        tout = tout or 0
        if ttotal is not None and tin == 0 and tout == 0:
            tin = ttotal

    model = model or _DEFAULT_MODEL

    if cost is None:
        if model_prices is not None:
            cost = model_prices.compute_list_cost(
                model,
                input_tokens=tin,
                output_tokens=tout,
            )
        else:  # pragma: no cover - only when model_prices unimportable
            cost = 0.0

    return {
        "model": model,
        "input_tokens": tin,
        "output_tokens": tout,
        "cost_list_usd": cost,
        "duration_ms": None,
    }


# ── Session-file extraction (authoritative, FIX-154) ───────────────────────

# kimi-code persists every CLI session under
# ``~/.kimi-code/sessions/wd_<cwd-basename>_<8-hex>/session_<uuid>/agents/main/wire.jsonl``
# where ``<cwd-basename>`` is the basename of the cycle's worktree
# (e.g. ``roll-ecf079-cycle-20260601-170905-54957``).
# Each wire file is NDJSON; one or more lines have::
#
#     {"type": "usage.record", "model": "kimi-code/kimi-for-coding",
#      "usage": {"inputOther": <int>, "output": <int>,
#                "inputCacheRead": <int>, "inputCacheCreation": <int>},
#      "usageScope": "turn", "time": <ms>}
#
# We sum across all matching wire files (retries reuse the same worktree).


def _kimi_sessions_base_dir(base_dir: Optional[str]) -> str:
    """Resolve kimi-code's sessions root: arg → env → default."""
    return (
        base_dir
        or os.environ.get("ROLL_KIMI_SESSIONS_DIR")
        or os.path.expanduser("~/.kimi-code/sessions")
    )


def _sum_wire_file(path: str) -> Optional[dict]:
    """Sum ``usage.record`` lines in a single kimi wire.jsonl.

    Returns a usage dict or None when no usage records are found.
    Field mapping kimi → roll::

        inputOther         → input_tokens
        output             → output_tokens
        inputCacheRead     → cache_read_tokens
        inputCacheCreation → cache_creation_tokens
    """
    tin = tout = tcr = tcw = 0
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
                if o.get("type") != "usage.record":
                    continue
                u = o.get("usage") or {}
                seen = True
                if o.get("model"):
                    model = o["model"]
                tin += int(u.get("inputOther") or 0)
                tout += int(u.get("output") or 0)
                tcr += int(u.get("inputCacheRead") or 0)
                tcw += int(u.get("inputCacheCreation") or 0)
    except OSError:
        return None
    if not seen:
        return None
    return {
        "model": model or _DEFAULT_MODEL,
        "input_tokens": tin,
        "output_tokens": tout,
        "cache_creation_tokens": tcw,
        "cache_read_tokens": tcr,
        "duration_ms": None,
    }


def usage_from_session(
    cwd: Optional[str] = None,
    cycle_id: Optional[str] = None,
    slug: Optional[str] = None,
    base_dir: Optional[str] = None,
) -> Optional[dict]:
    """Recover a kimi cycle's usage by reading its persisted wire file(s).

    Matching: scan ``<base>/wd_*/session_*/agents/main/wire.jsonl`` and
    select files whose ``wd_*`` directory name contains the worktree
    basename (authoritative when ``cwd`` is given) or the ``cycle_id``
    substring (fallback).

    Retries can produce multiple wire files for the same cycle; their
    usage is SUMMED so token totals reflect retry work too.

    Returns the merged usage dict (tokens + model), or None when nothing
    matches / zero tokens — caller writes nothing in that case, preserving
    "n/a, not fake zero".
    """
    base = _kimi_sessions_base_dir(base_dir)
    files = sorted(glob.glob(
        os.path.join(base, "wd_*", "session_*", "agents", "main", "wire.jsonl")
    ))
    if not files:
        return None

    cwd_basename = os.path.basename(cwd.rstrip("/")) if cwd else None
    matched = []
    for path in files:
        # Session dir name: wd_<cwd-basename>_<8-hex>
        # Path: <base>/wd_<cwd-basename>_<hash>/session_<uuid>/agents/main/wire.jsonl
        wd_seg = path[len(base):].lstrip(os.sep).split(os.sep, 1)[0]
        if cwd_basename and ("wd_%s_" % cwd_basename) in (wd_seg + "_"):
            matched.append(path)
            continue
        if cycle_id and ("cycle-%s" % cycle_id) in wd_seg:
            matched.append(path)

    if not matched:
        return None

    agg = {
        "model": None,
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_creation_tokens": 0,
        "cache_read_tokens": 0,
        "duration_ms": None,
    }
    got = False
    for path in matched:
        s = _sum_wire_file(path)
        if s is None:
            continue
        got = True
        agg["model"] = agg["model"] or s["model"]
        agg["input_tokens"] += s["input_tokens"]
        agg["output_tokens"] += s["output_tokens"]
        agg["cache_creation_tokens"] += s["cache_creation_tokens"]
        agg["cache_read_tokens"] += s["cache_read_tokens"]

    if not got:
        return None
    has_tokens = (
        agg["input_tokens"] or agg["output_tokens"]
        or agg["cache_creation_tokens"] or agg["cache_read_tokens"]
    )
    if not has_tokens:
        return None
    agg["model"] = agg["model"] or _DEFAULT_MODEL
    return agg
