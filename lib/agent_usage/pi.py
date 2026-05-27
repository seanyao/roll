"""
pi agent usage extractor.

Parses pi-coding-agent stdout (text mode, --print / -p) to extract
cumulative session tokens and cost.

pi in --print mode outputs: the assistant's final text response, optionally
followed by a session summary block.  We scan the last N lines for known
summary patterns and fall back to None if nothing matches.
"""

import re
from typing import Optional


def extract(stdin_lines: list[str]) -> Optional[dict]:
    """Scan pi stdout for session usage information.

    Tries several known patterns in order:
    1. Compact key-value block (Input: N / Output: N / Cost: $X)
    2. JSON summary line (last line containing "tokens" + "cost")
    3. Footer-style inline (↑12.3k ↓4.5k $0.123)

    Returns None if no pattern matched.
    """
    if not stdin_lines:
        return None

    # Pattern 1: key-value block — looks for "Input: <n>" / "Output: <n>"
    # lines within the last 50 lines of output
    tail = stdin_lines[-50:]
    text = "\n".join(tail)

    result = _try_kv_block(text)
    if result:
        return result

    result = _try_json_summary(text)
    if result:
        return result

    result = _try_footer_inline(text)
    if result:
        return result

    return None


# ── Pattern 1: Key-Value Block ────────────────────────────────────────────

_KV_INPUT_RE = re.compile(r"^\s*(?:Input|输入)\s*(?:tokens)?\s*[:：]\s*([\d,]+)", re.MULTILINE | re.IGNORECASE)
_KV_OUTPUT_RE = re.compile(r"^\s*(?:Output|输出)\s*(?:tokens)?\s*[:：]\s*([\d,]+)", re.MULTILINE | re.IGNORECASE)
_KV_CACHE_READ_RE = re.compile(r"^\s*(?:Cache\s*Read|cache_read)\s*[:：]\s*([\d,]+)", re.MULTILINE | re.IGNORECASE)
_KV_CACHE_WRITE_RE = re.compile(r"^\s*(?:Cache\s*Write|cache_write)\s*[:：]\s*([\d,]+)", re.MULTILINE | re.IGNORECASE)
# Matches inline "Cost: 0.12" or "费用: 0.12" on the same line.
_KV_COST_RE = re.compile(r"^\s*(?:Cost|费用)\s*[:：]\s*\$?([\d.]+)", re.MULTILINE | re.IGNORECASE)
# Matches the two-line pattern:  "Cost\nTotal: 0.12"  (pi session summary style).
_KV_COST_SECTION_RE = re.compile(
    r"^\s*(?:Cost|费用)\s*$\s+(?:Total|合计)\s*[:：]\s*\$?([\d.]+)",
    re.MULTILINE | re.IGNORECASE,
)
_KV_MODEL_RE = re.compile(r"^\s*(?:Model|模型)\s*[:：]\s*(\S+)", re.MULTILINE | re.IGNORECASE)


def _try_kv_block(text: str) -> Optional[dict]:
    """Match the key-value summary block style."""
    input_match = _KV_INPUT_RE.search(text)
    output_match = _KV_OUTPUT_RE.search(text)
    # Prefer the two-line "Cost section + Total" pattern; fall back to inline "Cost: N".
    cost_match = _KV_COST_SECTION_RE.search(text) or _KV_COST_RE.search(text)

    if not input_match or not output_match:
        return None

    try:
        input_tokens = int(input_match.group(1).replace(",", ""))
        output_tokens = int(output_match.group(1).replace(",", ""))
    except (ValueError, IndexError):
        return None

    cost_usd = None
    if cost_match:
        try:
            cost_usd = float(cost_match.group(1))
        except (ValueError, IndexError):
            pass

    # Try to extract model name
    model = "deepseek-v4-pro"  # pi's default model
    model_match = _KV_MODEL_RE.search(text)
    if model_match:
        model = model_match.group(1).strip()

    return {
        "model": model,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cost_list_usd": cost_usd if cost_usd is not None else 0.0,
        "duration_ms": None,
    }


# ── Pattern 2: JSON Summary ───────────────────────────────────────────────

_JSON_SUMMARY_RE = re.compile(
    r'"input_tokens"\s*:\s*(\d+).*?"output_tokens"\s*:\s*(\d+)',
    re.DOTALL,
)
_JSON_MODEL_RE = re.compile(r'"model"\s*:\s*"([^"]+)"')
_JSON_COST_RE = re.compile(r'"cost_list_usd"\s*:\s*([\d.]+)')


def _try_json_summary(text: str) -> Optional[dict]:
    """Match a JSON-like usage summary line."""
    m = _JSON_SUMMARY_RE.search(text)
    if not m:
        return None
    try:
        input_tokens = int(m.group(1))
        output_tokens = int(m.group(2))
    except (ValueError, IndexError):
        return None

    model = "deepseek-v4-pro"
    model_m = _JSON_MODEL_RE.search(text)
    if model_m:
        model = model_m.group(1)

    cost_usd = 0.0
    cost_m = _JSON_COST_RE.search(text)
    if cost_m:
        try:
            cost_usd = float(cost_m.group(1))
        except (ValueError, IndexError):
            pass

    return {
        "model": model,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cost_list_usd": cost_usd,
        "duration_ms": None,
    }


# ── Pattern 3: Footer-Style Inline ────────────────────────────────────────

_FOOTER_RE = re.compile(
    r"↑\s*([\d.]+[kmb]?)\s*"
    r"↓\s*([\d.]+[kmb]?)\s*"
    r"(?:R\s*([\d.]+[kmb]?)\s*)?"
    r"(?:W\s*([\d.]+[kmb]?)\s*)?"
    r"\$\s*([\d.]+)",
    re.IGNORECASE,
)


def _parse_token_short(s: str) -> int:
    """Parse '12.3k' → 12300, '1.5M' → 1500000, '500' → 500."""
    s = s.strip().lower()
    if s.endswith("k"):
        return int(float(s[:-1]) * 1000)
    if s.endswith("m"):
        return int(float(s[:-1]) * 1_000_000)
    if s.endswith("b"):
        return int(float(s[:-1]) * 1_000_000_000)
    return int(float(s))


def _try_footer_inline(text: str) -> Optional[dict]:
    """Match footer-style inline: ↑12.3k ↓4.5k $0.123."""
    m = _FOOTER_RE.search(text)
    if not m:
        return None
    try:
        input_tokens = _parse_token_short(m.group(1))
        output_tokens = _parse_token_short(m.group(2))
        cost_usd = float(m.group(5))
    except (ValueError, IndexError):
        return None

    return {
        "model": "deepseek-v4-pro",
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cost_list_usd": cost_usd,
        "duration_ms": None,
    }
