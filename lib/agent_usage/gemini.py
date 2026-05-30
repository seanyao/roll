"""
gemini (Google Gemini CLI) agent usage extractor.

Like openai (and unlike pi, which persists usage to session files), the
Gemini CLI prints a token-usage summary to stdout at the end of a session.
So this plugin implements the standard ``extract()`` registry contract:
scrape the passthrough stdout lines for the usage / model lines.

Recognised lines (case-insensitive, robust to thousands separators)::

    Model: gemini-2.5-pro
    Tokens: input=15300 output=3120

The Gemini CLI's "stats" / session-summary block is also accepted::

    Input tokens:  15,300
    Output tokens:  3,120
    Total tokens:  18,420
    model: gemini-2.5-flash

When an explicit USD cost line isn't present, cost is computed from
``lib/model_prices.py`` (list price) so the dashboard never shows ``—``
for a recognised gemini cycle.  Returns None if no usage line is found,
so the caller falls back to the null payload (US-LOOP-010 compatible).
"""

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
_DEFAULT_MODEL = "gemini-2.5-pro"

_MODEL_RE = re.compile(r"^\s*model\s*[:=]\s*([A-Za-z0-9][\w.\-]*)", re.IGNORECASE)
_INPUT_RE = re.compile(r"input(?:\s+tokens)?\s*[:=]\s*([\d,]+)", re.IGNORECASE)
_OUTPUT_RE = re.compile(r"output(?:\s+tokens)?\s*[:=]\s*([\d,]+)", re.IGNORECASE)
_TOTAL_RE = re.compile(r"total(?:\s+tokens)?\s*[:=]\s*([\d,]+)", re.IGNORECASE)
_COST_RE = re.compile(r"cost\s*[:=]?\s*\$?\s*([\d.]+)\s*(?:usd)?", re.IGNORECASE)


def _to_int(s: str) -> int:
    """Parse a token count string, tolerating thousands separators."""
    return int(s.replace(",", ""))


def extract(stdin_lines: list[str]) -> Optional[dict]:
    """Parse Gemini CLI stdout and return a usage dict, or None.

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

    # Require at least one token figure; otherwise this isn't a gemini cycle.
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
