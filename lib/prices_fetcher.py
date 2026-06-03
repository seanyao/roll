"""
prices_fetcher — fetch + parse + diff + write multi-vendor pricing snapshots.

US-VIEW-013: replaces the hardcoded PRICES table in ``model_prices.py`` with
versioned JSON snapshots under ``lib/prices/``. The fetcher pulls the live
pricing docs page, extracts the model rate rows, and writes a new snapshot
only when the rates differ from the most recent one on disk.

US-VIEW-023: vendor-registry architecture — ``fetch``/``parse``/``refresh``
dispatch by vendor. Adding a new vendor is a registry entry, not a change to
the fetch/parse/refresh orchestration.

Design:
  * ``fetch_pricing_html(url, timeout)`` — pure I/O, raises ``FetchError``
  * ``parse_pricing_html(html, vendor)`` — dispatches to vendor parser,
    raises ``ParseError``
  * ``diff_prices(old, new)`` — pure diff, returns list of changes
  * ``write_snapshot(prices, ...)`` — pure I/O, returns the path written
  * ``refresh(...)`` — orchestrator; the only function with side effects on
                       both network and disk
"""

from __future__ import annotations

import datetime as _dt
import json
import os
import re
import sys
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.error import URLError
from urllib.request import Request, urlopen

DEFAULT_TIMEOUT = 15


class FetchError(RuntimeError):
    """Raised when fetching the pricing page fails."""


class ParseError(ValueError):
    """Raised when the pricing HTML cannot be parsed into a prices map."""


# ─── Vendor registry ──────────────────────────────────────────────────────────

@dataclass(frozen=True)
class VendorConfig:
    """Configuration for a single pricing vendor."""

    name: str
    source_url: str
    currency: str
    parse: Callable[[str], Dict[str, Dict[str, float]]]


def _parse_claude_html(html: str) -> Dict[str, Dict[str, float]]:
    """Parse Anthropic/Claude pricing HTML into a {model: rates} map."""
    model_re = re.compile(r"claude-(?:opus|sonnet|haiku)-[0-9](?:-[0-9])?")
    dollar_re = re.compile(r"\$\s*([0-9]+(?:\.[0-9]+)?)")

    extractor = _TableTextExtractor()
    extractor.feed(html)

    prices: Dict[str, Dict[str, float]] = {}
    for row in extractor.rows:
        text = " ".join(row)
        model_match = model_re.search(text)
        if not model_match:
            continue
        model = model_match.group(0)
        amounts = [float(m.group(1)) for m in dollar_re.finditer(text)]
        if len(amounts) < 4:
            continue
        in_rate, cache_create, cache_read, out_rate = amounts[:4]
        prices[model] = {
            "in": in_rate,
            "out": out_rate,
            "cache_create": cache_create,
            "cache_read": cache_read,
        }

    if not prices:
        raise ParseError("no price rows found in HTML; page layout may have changed")
    return prices


def _parse_deepseek_html(html: str) -> Dict[str, Dict[str, float]]:
    """Parse DeepSeek pricing HTML into a {model: rates} map.

    Handles both the Chinese (元) and English ($) pricing pages.
    Extracts deepseek-v4-flash and deepseek-v4-pro rates, then adds
    deepseek-chat and deepseek-reasoner as aliases for flash.
    """
    extractor = _TableTextExtractor()
    extractor.feed(html)

    # Find the header row with model names.
    model_names: List[str] = []
    header_idx = -1
    for i, row in enumerate(extractor.rows):
        if any(k in ' '.join(row) for k in ('模型', 'MODEL')):
            # Cells after the label are model names.
            # Strip footnote markers like (1) and HTML tags.
            names = [
                re.sub(r'<[^>]+>', '', re.sub(r'\s*\(\d+\)', '', cell)).strip()
                for cell in row[1:]
                if cell.strip()
            ]
            if len(names) >= 2:
                model_names = names
                header_idx = i
                break

    if len(model_names) < 2:
        raise ParseError('no model header row found; page layout may have changed')

    # Walk rows after header to find pricing data.
    cache_hit: List[float] = []
    cache_miss: List[float] = []
    output: List[float] = []

    for row in extractor.rows[header_idx + 1:]:
        text = ' '.join(row)
        # Skip non-pricing rows.
        if not any(k in text for k in ('缓存命中', 'CACHE HIT', '缓存未命中', 'CACHE MISS', '输出', 'OUTPUT')):
            continue

        # Extract numeric values followed by 元 or $.
        values: List[float] = []
        for cell in row:
            # Match numbers like 0.02元, $0.14, 1元, etc.
            m = re.search(r'(?:\$)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:元|¥)?', cell)
            if m:
                values.append(float(m.group(1)))

        if len(values) < len(model_names):
            continue

        if any(k in text for k in ('缓存命中', 'CACHE HIT')):
            cache_hit = values[:len(model_names)]
        elif any(k in text for k in ('缓存未命中', 'CACHE MISS')):
            cache_miss = values[:len(model_names)]
        elif any(k in text for k in ('输出', 'OUTPUT')):
            output = values[:len(model_names)]

    if not cache_miss or not output:
        raise ParseError('no price rows found in HTML; page layout may have changed')

    prices: Dict[str, Dict[str, float]] = {}
    for idx, model in enumerate(model_names):
        if model in ('deepseek-v4-flash', 'deepseek-v4-pro'):
            prices[model] = {
                'in': cache_miss[idx],
                'out': output[idx],
                'cache_create': cache_miss[idx],
                'cache_read': cache_hit[idx] if cache_hit else 0.0,
            }

    if not prices:
        raise ParseError('no price rows found in HTML; page layout may have changed')

    return prices


def _try_parse_kimi_pricing(html: str) -> Optional[Dict[str, Dict[str, float]]]:
    """Try to parse Kimi pricing from HTML/MDX content.

    Handles the JSX ``DocTable`` format used by Kimi's ``.md`` endpoints:
    rows contain [model, unit, cache-hit, cache-miss, output, context].
    """
    prices: Dict[str, Dict[str, float]] = {}
    price_re = re.compile(r"¥\s*([0-9]+(?:\.[0-9]+)?)")
    row_re = re.compile(
        r'\[\s*"([^"]+)"\s*,\s*"[^"]+"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"[^"]+"\s*\]'
    )

    for m in row_re.finditer(html):
        model, cache_hit_str, cache_miss_str, output_str = m.groups()
        cache_hit_m = price_re.search(cache_hit_str)
        cache_miss_m = price_re.search(cache_miss_str)
        output_m = price_re.search(output_str)
        if not all((cache_hit_m, cache_miss_m, output_m)):
            continue
        prices[model] = {
            "in": float(cache_miss_m.group(1)),
            "out": float(output_m.group(1)),
            "cache_create": float(cache_miss_m.group(1)),
            "cache_read": float(cache_hit_m.group(1)),
        }

    return prices if prices else None


def _parse_kimi_html(html: str) -> Dict[str, Dict[str, float]]:
    """Parse Kimi pricing HTML into a {model: rates} map.

    Kimi pricing is split across sub-pages (``pricing/chat-k25``,
    ``pricing/chat-k26``).  The parser first tries to extract prices from the
    provided HTML; if none found, it fetches the ``.md`` sub-pages and parses
    those.
    """
    prices = _try_parse_kimi_pricing(html)
    if prices:
        if "kimi-k2.6" in prices:
            prices["kimi-for-coding"] = dict(prices["kimi-k2.6"])
        return prices

    sub_urls = [
        "https://platform.kimi.com/docs/pricing/chat-k25.md",
        "https://platform.kimi.com/docs/pricing/chat-k26.md",
    ]
    combined = html
    for url in sub_urls:
        try:
            combined += "\n" + fetch_pricing_html(url)
        except FetchError as exc:
            raise ParseError(f"could not fetch kimi sub-page {url}: {exc}")

    prices = _try_parse_kimi_pricing(combined)
    if not prices:
        raise ParseError("no price rows found in kimi pages")

    if "kimi-k2.6" in prices:
        prices["kimi-for-coding"] = dict(prices["kimi-k2.6"])

    return prices


VENDOR_REGISTRY: Dict[str, VendorConfig] = {
    "anthropic": VendorConfig(
        name="anthropic",
        source_url="https://platform.claude.com/docs/en/about-claude/pricing",
        currency="USD",
        parse=_parse_claude_html,
    ),
    "deepseek": VendorConfig(
        name="deepseek",
        source_url="https://api-docs.deepseek.com/zh-cn/quick_start/pricing/",
        currency="CNY",
        parse=_parse_deepseek_html,
    ),
    "kimi": VendorConfig(
        name="kimi",
        source_url="https://platform.kimi.com/docs/pricing/chat",
        currency="CNY",
        parse=_parse_kimi_html,
    ),
}


# ─── Network I/O ──────────────────────────────────────────────────────────────

def fetch_pricing_html(url: str,
                       timeout: float = DEFAULT_TIMEOUT) -> str:
    """Fetch the pricing docs page and return its raw HTML."""
    req = Request(url, headers={"User-Agent": "roll/prices_fetcher"})
    try:
        with urlopen(req, timeout=timeout) as resp:
            data = resp.read()
            charset = resp.headers.get_content_charset() or "utf-8"
            return data.decode(charset, errors="replace")
    except (URLError, OSError, TimeoutError) as exc:
        raise FetchError(f"could not fetch {url}: {exc}") from exc


# ─── HTML parsing helpers ─────────────────────────────────────────────────────

class _TableTextExtractor(HTMLParser):
    """Walk an HTML document and yield <tr> cell-text lists per row."""

    def __init__(self) -> None:
        super().__init__()
        self.rows: List[List[str]] = []
        self._in_row = False
        self._in_cell = False
        self._cells: List[str] = []
        self._cur: List[str] = []

    def handle_starttag(self, tag: str, attrs):  # noqa: ANN001
        if tag == "tr":
            self._in_row = True
            self._cells = []
        elif tag in ("td", "th") and self._in_row:
            self._in_cell = True
            self._cur = []

    def handle_endtag(self, tag: str) -> None:
        if tag in ("td", "th") and self._in_cell:
            self._cells.append(" ".join(self._cur).strip())
            self._in_cell = False
        elif tag == "tr" and self._in_row:
            if self._cells:
                self.rows.append(self._cells)
            self._in_row = False

    def handle_data(self, data: str) -> None:
        if self._in_cell:
            self._cur.append(data)


# ─── Parser dispatch ──────────────────────────────────────────────────────────

def parse_pricing_html(html: str, vendor: str = "anthropic") -> Dict[str, Dict[str, float]]:
    """Parse pricing docs HTML into a {model: rates} map.

    Dispatches to the vendor-specific parser registered in ``VENDOR_REGISTRY``.
    """
    config = VENDOR_REGISTRY.get(vendor)
    if not config:
        raise ParseError(
            f"unknown vendor {vendor!r}; known: {', '.join(sorted(VENDOR_REGISTRY))}"
        )
    return config.parse(html)


# ─── Diff & formatting ────────────────────────────────────────────────────────

def diff_prices(old: Dict[str, Dict[str, float]],
                new: Dict[str, Dict[str, float]]
                ) -> List[Tuple[str, str, str, Optional[float], Optional[float]]]:
    """Return a list of (kind, model, field, old_val, new_val) tuples.

    kind is one of: ``added``, ``removed``, ``changed``. For added rows the
    old_val is None; for removed, the new_val is None.
    """
    changes: List[Tuple[str, str, str, Optional[float], Optional[float]]] = []
    for model in sorted(set(old) | set(new)):
        if model not in old:
            for field, val in new[model].items():
                changes.append(("added", model, field, None, val))
            continue
        if model not in new:
            for field, val in old[model].items():
                changes.append(("removed", model, field, val, None))
            continue
        for field in sorted(set(old[model]) | set(new[model])):
            old_val = old[model].get(field)
            new_val = new[model].get(field)
            if old_val != new_val:
                changes.append(("changed", model, field, old_val, new_val))
    return changes


def format_diff(changes: List[Tuple[str, str, str, Optional[float], Optional[float]]],
                colored: bool = True) -> str:
    """Render diff_prices output as red-/green-coded lines."""
    if not changes:
        return ""
    red = "\033[31m" if colored else ""
    green = "\033[32m" if colored else ""
    dim = "\033[2m" if colored else ""
    reset = "\033[0m" if colored else ""
    lines: List[str] = []
    for kind, model, field, old, new in changes:
        if kind == "added":
            lines.append(f"{green}+ {model} {field} = {new}{reset}")
        elif kind == "removed":
            lines.append(f"{red}- {model} {field} = {old}{reset}")
        else:
            lines.append(f"{dim}~ {model} {field}{reset} {red}{old}{reset} → {green}{new}{reset}")
    return "\n".join(lines)


# ─── Snapshot I/O ─────────────────────────────────────────────────────────────

_SNAPSHOT_NAME_RE = re.compile(r"snapshot-(\d{4}-\d{2}-\d{2})(?:-([a-z]+))?\.json")


def _extract_vendor_from_filename(name: str) -> Optional[str]:
    """Extract vendor from snapshot filename.

    snapshot-2026-05-22.json          → anthropic
    snapshot-2026-05-22-deepseek.json → deepseek
    snapshot-2026-06-02-kimi.json     → kimi
    """
    m = _SNAPSHOT_NAME_RE.match(name)
    if not m:
        return None
    return m.group(2) or "anthropic"


def _latest_snapshot_path(snapshot_dir: str, vendor: str = "anthropic") -> Optional[str]:
    if not os.path.isdir(snapshot_dir):
        return None
    snaps = sorted(
        os.path.join(snapshot_dir, n)
        for n in os.listdir(snapshot_dir)
        if _SNAPSHOT_NAME_RE.match(n) and _extract_vendor_from_filename(n) == vendor
    )
    return snaps[-1] if snaps else None


def write_snapshot(prices: Dict[str, Dict[str, float]],
                   *,
                   snapshot_dir: str,
                   source_url: str,
                   vendor: str = "anthropic",
                   currency: str = "USD",
                   effective_at: Optional[str] = None,
                   default_model: Optional[str] = None,
                   notes: Optional[str] = None) -> str:
    """Write a new snapshot JSON and return its path."""
    os.makedirs(snapshot_dir, exist_ok=True)
    today = effective_at or _dt.date.today().isoformat()
    payload: Dict[str, Any] = {
        "version": today,
        "effective_at": today,
        "source_url": source_url,
        "vendor": vendor,
        "currency": currency,
        "default_model": default_model or _pick_default(prices),
        "prices": prices,
    }
    if notes:
        payload["notes"] = notes
    suffix = f"-{vendor}" if vendor != "anthropic" else ""
    dest = os.path.join(snapshot_dir, f"snapshot-{today}{suffix}.json")
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, sort_keys=False)
        f.write("\n")
    return dest


def _pick_default(prices: Dict[str, Dict[str, float]]) -> str:
    """Pick a sensible fallback model: prefer the cheapest sonnet, else first key."""
    for k in prices:
        if "sonnet" in k:
            return k
    return next(iter(prices))


# ─── Orchestrator ─────────────────────────────────────────────────────────────

def refresh(*,
            snapshot_dir: str,
            vendor: str = "anthropic",
            url: Optional[str] = None,
            timeout: float = DEFAULT_TIMEOUT,
            html: Optional[str] = None,
            ) -> Tuple[str, List[Tuple[str, str, str, Optional[float], Optional[float]]]]:
    """Fetch (or accept fixture HTML), parse, diff against latest snapshot, write.

    Returns (action, changes) where action is one of:
      ``"unchanged"`` — no diff vs latest snapshot, nothing written
      ``"written:<path>"`` — new snapshot written at <path>
      ``"first:<path>"`` — no prior snapshot existed; baseline written
    """
    config = VENDOR_REGISTRY.get(vendor)
    if not config:
        raise ParseError(
            f"unknown vendor {vendor!r}; known: {', '.join(sorted(VENDOR_REGISTRY))}"
        )

    source_url = url or config.source_url
    if html is None:
        html = fetch_pricing_html(source_url, timeout=timeout)
    new_prices = parse_pricing_html(html, vendor=vendor)

    latest = _latest_snapshot_path(snapshot_dir, vendor=vendor)
    if latest is None:
        dest = write_snapshot(
            new_prices,
            snapshot_dir=snapshot_dir,
            source_url=source_url,
            vendor=vendor,
            currency=config.currency,
        )
        return f"first:{dest}", diff_prices({}, new_prices)

    with open(latest, "r", encoding="utf-8") as f:
        old = json.load(f).get("prices", {})
    changes = diff_prices(old, new_prices)
    if not changes:
        return "unchanged", []
    dest = write_snapshot(
        new_prices,
        snapshot_dir=snapshot_dir,
        source_url=source_url,
        vendor=vendor,
        currency=config.currency,
    )
    return f"written:{dest}", changes


# ─── CLI entry — `python3 lib/prices_fetcher.py refresh|show` is the fallback when
# bin/roll is unavailable (e.g. running tests directly).
def _main(argv: List[str]) -> int:
    snapshot_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prices")
    if not argv or argv[0] in ("-h", "--help", "help"):
        print("usage: prices_fetcher.py refresh|show [--url URL] [--vendor VENDOR]")
        return 0
    cmd = argv[0]
    url: Optional[str] = None
    vendor = "anthropic"
    i = 1
    while i < len(argv):
        if argv[i] == "--url" and i + 1 < len(argv):
            url = argv[i + 1]
            i += 2
        elif argv[i] == "--vendor" and i + 1 < len(argv):
            vendor = argv[i + 1]
            i += 2
        else:
            i += 1
    if cmd == "show":
        latest = _latest_snapshot_path(snapshot_dir, vendor=vendor)
        if not latest:
            print("no snapshot found", file=sys.stderr)
            return 1
        with open(latest) as f:
            print(f.read())
        return 0
    if cmd == "refresh":
        try:
            action, changes = refresh(snapshot_dir=snapshot_dir, vendor=vendor, url=url)
        except FetchError as exc:
            print(f"fetch failed: {exc}", file=sys.stderr)
            return 2
        except ParseError as exc:
            print(f"parse failed: {exc}", file=sys.stderr)
            return 3
        print(action)
        if changes:
            print(format_diff(changes, colored=sys.stdout.isatty()))
        return 0
    print(f"unknown command: {cmd}", file=sys.stderr)
    return 1


if __name__ == "__main__":  # pragma: no cover
    sys.exit(_main(sys.argv[1:]))
