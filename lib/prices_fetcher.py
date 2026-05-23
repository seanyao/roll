"""
prices_fetcher — fetch + parse + diff + write Claude API pricing snapshots.

US-VIEW-013: replaces the hardcoded PRICES table in ``model_prices.py`` with
versioned JSON snapshots under ``lib/prices/``. The fetcher pulls the live
pricing docs page, extracts the model rate rows, and writes a new snapshot
only when the rates differ from the most recent one on disk.

Design:
  * ``fetch_pricing_html(url, timeout)`` — pure I/O, raises ``FetchError``
  * ``parse_pricing_html(html)`` — pure parser, raises ``ParseError``
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
from html.parser import HTMLParser
from typing import Any, Dict, List, Optional, Tuple
from urllib.error import URLError
from urllib.request import Request, urlopen

DEFAULT_SOURCE_URL = "https://platform.claude.com/docs/en/about-claude/pricing"
DEFAULT_TIMEOUT = 15

_MODEL_RE = re.compile(r"claude-(?:opus|sonnet|haiku)-[0-9](?:-[0-9])?")
_DOLLAR_RE = re.compile(r"\$\s*([0-9]+(?:\.[0-9]+)?)")


class FetchError(RuntimeError):
    """Raised when fetching the pricing page fails."""


class ParseError(ValueError):
    """Raised when the pricing HTML cannot be parsed into a prices map."""


def fetch_pricing_html(url: str = DEFAULT_SOURCE_URL,
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


def parse_pricing_html(html: str) -> Dict[str, Dict[str, float]]:
    """Parse pricing docs HTML into a {model: rates} map.

    The parser is intentionally tolerant: it scans every table row, looks for
    one ``claude-*`` model identifier and four dollar amounts on that row, and
    treats them as ``in / cache_create / cache_read / out`` in the order they
    appear. (Anthropic's table renders columns in that order.)
    """
    parser = _TableTextExtractor()
    parser.feed(html)

    prices: Dict[str, Dict[str, float]] = {}
    for row in parser.rows:
        text = " ".join(row)
        model_match = _MODEL_RE.search(text)
        if not model_match:
            continue
        model = model_match.group(0)
        amounts = [float(m.group(1)) for m in _DOLLAR_RE.finditer(text)]
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


def write_snapshot(prices: Dict[str, Dict[str, float]],
                   *,
                   snapshot_dir: str,
                   source_url: str = DEFAULT_SOURCE_URL,
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
        "default_model": default_model or _pick_default(prices),
        "prices": prices,
    }
    if notes:
        payload["notes"] = notes
    dest = os.path.join(snapshot_dir, f"snapshot-{today}.json")
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


def refresh(*,
            snapshot_dir: str,
            url: str = DEFAULT_SOURCE_URL,
            timeout: float = DEFAULT_TIMEOUT,
            html: Optional[str] = None,
            ) -> Tuple[str, List[Tuple[str, str, str, Optional[float], Optional[float]]]]:
    """Fetch (or accept fixture HTML), parse, diff against latest snapshot, write.

    Returns (action, changes) where action is one of:
      ``"unchanged"`` — no diff vs latest snapshot, nothing written
      ``"written:<path>"`` — new snapshot written at <path>
      ``"first:<path>"`` — no prior snapshot existed; baseline written
    """
    if html is None:
        html = fetch_pricing_html(url, timeout=timeout)
    new_prices = parse_pricing_html(html)

    # Load latest if any
    latest = _latest_snapshot_path(snapshot_dir)
    if latest is None:
        dest = write_snapshot(new_prices, snapshot_dir=snapshot_dir, source_url=url)
        return f"first:{dest}", diff_prices({}, new_prices)

    with open(latest, "r", encoding="utf-8") as f:
        old = json.load(f).get("prices", {})
    changes = diff_prices(old, new_prices)
    if not changes:
        return "unchanged", []
    dest = write_snapshot(new_prices, snapshot_dir=snapshot_dir, source_url=url)
    return f"written:{dest}", changes


def _latest_snapshot_path(snapshot_dir: str) -> Optional[str]:
    if not os.path.isdir(snapshot_dir):
        return None
    snaps = sorted(
        os.path.join(snapshot_dir, n)
        for n in os.listdir(snapshot_dir)
        if n.startswith("snapshot-") and n.endswith(".json")
    )
    return snaps[-1] if snaps else None


# CLI entry — `python3 lib/prices_fetcher.py refresh|show` is the fallback when
# bin/roll is unavailable (e.g. running tests directly).
def _main(argv: List[str]) -> int:
    snapshot_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prices")
    if not argv or argv[0] in ("-h", "--help", "help"):
        print("usage: prices_fetcher.py refresh|show [--url URL]")
        return 0
    cmd = argv[0]
    url = DEFAULT_SOURCE_URL
    if "--url" in argv:
        url = argv[argv.index("--url") + 1]
    if cmd == "show":
        latest = _latest_snapshot_path(snapshot_dir)
        if not latest:
            print("no snapshot found", file=sys.stderr)
            return 1
        with open(latest) as f:
            print(f.read())
        return 0
    if cmd == "refresh":
        try:
            action, changes = refresh(snapshot_dir=snapshot_dir, url=url)
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
