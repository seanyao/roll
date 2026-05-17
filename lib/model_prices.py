"""
model_prices — list-price table for Anthropic Claude API models.

Pricing is per million tokens (MTok), USD. These are the public list rates;
discounts (Pro subscription, prepay credits, etc.) are intentionally not
modeled — IDEA-025 is about cross-account / cross-project comparable cost.

Update this table when Anthropic changes pricing. Unknown models fall back
to sonnet rates with a stderr warning so dashboards don't blank out.
"""

import sys
from typing import Dict, Optional

# Rates per million tokens (USD).
PRICES: Dict[str, Dict[str, float]] = {
    # Claude 4.x family (current as of 2026-05).
    "claude-opus-4-7":    {"in": 15.00, "out": 75.00, "cache_create": 18.75, "cache_read": 1.50},
    "claude-opus-4-6":    {"in": 15.00, "out": 75.00, "cache_create": 18.75, "cache_read": 1.50},
    "claude-sonnet-4-6":  {"in":  3.00, "out": 15.00, "cache_create":  3.75, "cache_read": 0.30},
    "claude-sonnet-4":    {"in":  3.00, "out": 15.00, "cache_create":  3.75, "cache_read": 0.30},
    "claude-haiku-4-5":   {"in":  1.00, "out":  5.00, "cache_create":  1.25, "cache_read": 0.10},
    # Older fallbacks
    "claude-3-5-sonnet":  {"in":  3.00, "out": 15.00, "cache_create":  3.75, "cache_read": 0.30},
}

DEFAULT = "claude-sonnet-4-6"
_warned: set = set()

def _resolve(model: Optional[str]) -> Dict[str, float]:
    if not model:
        return PRICES[DEFAULT]
    # Strip date suffixes like '-20251001' or '[1m]' context tags.
    base = model.split("[")[0].rstrip("0123456789-")
    # Try a prefix match against the table; longest match wins.
    candidates = [k for k in PRICES if model.startswith(k) or base.startswith(k)]
    if candidates:
        return PRICES[max(candidates, key=len)]
    if model not in _warned:
        _warned.add(model)
        print(f"[model_prices] warn: unknown model {model!r}, falling back to {DEFAULT}",
              file=sys.stderr)
    return PRICES[DEFAULT]

def compute_list_cost(model: Optional[str],
                      *,
                      input_tokens: int = 0,
                      output_tokens: int = 0,
                      cache_creation_tokens: int = 0,
                      cache_read_tokens: int = 0) -> float:
    """Return USD cost at list price for one cycle's token usage."""
    p = _resolve(model)
    total = (input_tokens         * p["in"]
           + output_tokens        * p["out"]
           + cache_creation_tokens * p["cache_create"]
           + cache_read_tokens    * p["cache_read"]) / 1_000_000
    return round(total, 4)

def total_tokens(*,
                 input_tokens: int = 0,
                 output_tokens: int = 0,
                 cache_creation_tokens: int = 0,
                 cache_read_tokens: int = 0) -> int:
    return int(input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens)
