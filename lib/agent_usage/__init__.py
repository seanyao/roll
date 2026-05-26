"""
agent_usage — plugin registry for extracting token/cost usage from
non-claude agent stdout.

Contract
--------
Each plugin module exports a single function:

    def extract(stdin_lines: list[str]) -> dict | None:
        '''Parse agent stdout lines and return structured usage data.

        Returns None if the format wasn't recognized (caller falls back
        to null payload — fully backward-compatible with US-LOOP-010).

        Return dict shape:
            {
                "model": str,           # e.g. "deepseek-v4-pro"
                "input_tokens": int,    # never None
                "output_tokens": int,   # never None
                "cost_list_usd": float, # never None
                "duration_ms": int | None,
            }
        '''

Adding a new agent
------------------
1. Create ``lib/agent_usage/<agent>.py`` implementing ``extract()``
2. Register it here by adding one entry to ``REGISTRY``
3. Add a fixture file under ``tests/fixtures/<agent>_output_sample.txt``
4. Add unit tests in ``tests/unit/agent_usage_<agent>.bats``
5. Run ``npm test`` to verify no regressions
"""
from __future__ import annotations

import importlib
import logging
import os
from typing import Callable, Dict, Optional

_log = logging.getLogger(__name__)

# Registry: agent name → extract function
# Agent names match ROLL_LOOP_AGENT env var values (e.g. "pi", "deepseek", "kimi").
REGISTRY: Dict[str, Callable] = {}


def _lazy_import(module_name: str) -> Optional[Callable]:
    """Import a plugin module and return its extract function, or None on failure."""
    try:
        mod = importlib.import_module(module_name)
        extract = getattr(mod, "extract", None)
        if extract is None:
            _log.warning("agent_usage plugin %s has no extract() function", module_name)
            return None
        if not callable(extract):
            _log.warning("agent_usage plugin %s.extract is not callable", module_name)
            return None
        return extract
    except Exception:
        _log.warning("agent_usage plugin %s failed to load", module_name, exc_info=True)
        return None


# Populate REGISTRY from known plugins
_PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))
_PLUGINS = {
    # agent name → python module name (relative to this package)
    "pi": ".pi",
}

for _agent, _mod_suffix in _PLUGINS.items():
    _extract = _lazy_import(__package__ + _mod_suffix)
    if _extract is not None:
        REGISTRY[_agent] = _extract


def extract_usage(agent: str, stdin_lines: list[str]) -> Optional[dict]:
    """Look up agent in REGISTRY and call its extract().

    Returns None if agent not registered, plugin not loadable, or
    extract() returns None / raises an exception.  The caller falls
    back to the null-payload passthrough path (US-LOOP-010 compatible).
    """
    extract_fn = REGISTRY.get(agent)
    if extract_fn is None:
        return None
    try:
        result = extract_fn(stdin_lines)
        if result is None:
            return None
        # Validate required fields
        for key in ("model", "input_tokens", "output_tokens", "cost_list_usd"):
            if result.get(key) is None:
                _log.warning(
                    "agent_usage plugin %s returned None for required field %r",
                    agent, key,
                )
                return None
        return result
    except Exception:
        _log.warning(
            "agent_usage plugin %s raised during extract()", agent, exc_info=True,
        )
        return None
