"""
model_prices — list-price table for Anthropic Claude API models.

Pricing is per million tokens (MTok), USD. These are the public list rates;
discounts (Pro subscription, prepay credits, etc.) are intentionally not
modeled — IDEA-025 is about cross-account / cross-project comparable cost.

US-VIEW-013: prices are no longer hardcoded here. They live in versioned
snapshot files under ``lib/prices/snapshot-YYYY-MM-DD.json`` and are loaded
at module import time. ``roll prices refresh`` produces new snapshots; this
module never writes — it only loads the latest one.

Unknown models fall back to the snapshot's ``default_model`` with a stderr
warning so dashboards don't blank out.
"""

import json
import os
import sys
from typing import Any, Dict, List, Optional, Tuple

_LIB_DIR = os.path.dirname(os.path.abspath(__file__))
SNAPSHOT_DIR = os.path.join(_LIB_DIR, "prices")


def list_snapshots(snapshot_dir: str = SNAPSHOT_DIR) -> List[str]:
    """Return absolute paths of all snapshot files, sorted oldest → newest by filename."""
    if not os.path.isdir(snapshot_dir):
        return []
    entries = [
        os.path.join(snapshot_dir, name)
        for name in os.listdir(snapshot_dir)
        if name.startswith("snapshot-") and name.endswith(".json")
    ]
    return sorted(entries)


def load_snapshot(path: str) -> Dict[str, Any]:
    """Load a snapshot file and validate its shape."""
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    for key in ("version", "effective_at", "source_url", "prices"):
        if key not in data:
            raise ValueError(f"snapshot {path!r} missing required key {key!r}")
    if not isinstance(data["prices"], dict) or not data["prices"]:
        raise ValueError(f"snapshot {path!r} has empty or invalid prices map")
    data.setdefault("default_model", next(iter(data["prices"])))
    return data


def load_latest_snapshot(snapshot_dir: str = SNAPSHOT_DIR) -> Dict[str, Any]:
    """Load the newest snapshot by filename. Raises FileNotFoundError if none exist."""
    snaps = list_snapshots(snapshot_dir)
    if not snaps:
        raise FileNotFoundError(
            f"no price snapshots found in {snapshot_dir}; run `roll prices refresh`"
        )
    return load_snapshot(snaps[-1])


_SNAPSHOT: Dict[str, Any] = load_latest_snapshot()
PRICES: Dict[str, Dict[str, float]] = _SNAPSHOT["prices"]
DEFAULT: str = _SNAPSHOT["default_model"]
VERSION: str = _SNAPSHOT["version"]
EFFECTIVE_AT: str = _SNAPSHOT["effective_at"]
SOURCE_URL: str = _SNAPSHOT["source_url"]

_warned: set = set()


def snapshot_meta() -> Tuple[str, str, str]:
    """Return (version, effective_at, source_url) of the active snapshot."""
    return VERSION, EFFECTIVE_AT, SOURCE_URL


def _resolve(model: Optional[str], prices: Optional[Dict[str, Dict[str, float]]] = None,
             default: Optional[str] = None) -> Dict[str, float]:
    table = prices if prices is not None else PRICES
    fallback = default if default is not None else DEFAULT
    if not model:
        return table[fallback]
    base = model.split("[")[0].rstrip("0123456789-")
    candidates = [k for k in table if model.startswith(k) or base.startswith(k)]
    if candidates:
        return table[max(candidates, key=len)]
    if model not in _warned:
        _warned.add(model)
        print(f"[model_prices] warn: unknown model {model!r}, falling back to {fallback}",
              file=sys.stderr)
    return table[fallback]


def compute_list_cost(model: Optional[str],
                      *,
                      input_tokens: int = 0,
                      output_tokens: int = 0,
                      cache_creation_tokens: int = 0,
                      cache_read_tokens: int = 0,
                      prices: Optional[Dict[str, Dict[str, float]]] = None,
                      default: Optional[str] = None) -> float:
    """Return USD cost at list price for one cycle's token usage."""
    p = _resolve(model, prices=prices, default=default)
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
