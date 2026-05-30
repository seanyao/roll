"""
github_sync — GitHub Issues REST API client + auth (US-SYNC-001).

This is the pure API layer for the ``roll backlog sync`` feature: it fetches
issues from a GitHub repository, follows pagination via the ``Link`` header,
resolves auth from ``$GITHUB_TOKEN`` then ``gh auth token``, and surfaces a
friendly hint when the rate-limit budget runs low. It deliberately does NOT
touch ``.roll/backlog.md`` — downstream stories (US-SYNC-002+) consume the
issues this module returns.

Design (mirrors lib/prices_fetcher.py):
  * ``resolve_token(...)`` — pure-ish: env first, ``gh auth token`` fallback,
                             raises ``AuthError`` when neither is available.
  * ``fetch_issues(owner, repo, ...)`` — orchestrator; follows Link-header
                             pagination, honours rate-limit headers.
  * The HTTP layer is injectable via the ``opener`` parameter so tests can
    mock pagination / auth / rate-limit responses without network access.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from typing import Any, Callable, Dict, List, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

API_ROOT = "https://api.github.com"
DEFAULT_TIMEOUT = 15
DEFAULT_PER_PAGE = 100
# When fewer than this many requests remain in the rate-limit window we warn
# and back off rather than hammering the API into a hard 429.
RATE_LIMIT_FLOOR = 5


class AuthError(RuntimeError):
    """Raised when no GitHub credential can be resolved."""


class RateLimitError(RuntimeError):
    """Raised when GitHub returns HTTP 429 / the rate-limit budget is exhausted."""


class GitHubAPIError(RuntimeError):
    """Raised for non-success HTTP responses other than rate-limiting."""


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
def resolve_token(env: Optional[Dict[str, str]] = None,
                  gh_token_fn: Optional[Callable[[], Optional[str]]] = None
                  ) -> str:
    """Resolve a GitHub token.

    Order: ``$GITHUB_TOKEN`` → ``gh auth token`` (fallback) → ``AuthError``
    with a hint on how to configure credentials.

    ``env`` and ``gh_token_fn`` are injectable for tests.
    """
    env = os.environ if env is None else env
    token = (env.get("GITHUB_TOKEN") or "").strip()
    if token:
        return token

    fn = gh_token_fn if gh_token_fn is not None else _gh_auth_token
    gh_token = (fn() or "").strip()
    if gh_token:
        return gh_token

    raise AuthError(
        "no GitHub credential found.\n"
        "  set GITHUB_TOKEN, or run `gh auth login` so `gh auth token` works.\n"
        "  未找到 GitHub 凭据：请设置 GITHUB_TOKEN，或运行 `gh auth login`。"
    )


def _gh_auth_token() -> Optional[str]:
    """Return the token from `gh auth token`, or None if gh is absent/unauthed."""
    try:
        out = subprocess.check_output(
            ["gh", "auth", "token"],
            text=True, stderr=subprocess.DEVNULL,
        )
        return out.strip()
    except (OSError, subprocess.CalledProcessError):
        return None


# ---------------------------------------------------------------------------
# HTTP layer (injectable)
# ---------------------------------------------------------------------------
class _Response:
    """Normalized response shape returned by the default opener."""

    def __init__(self, status: int, headers: Dict[str, str], body: str) -> None:
        self.status = status
        self.headers = headers
        self.body = body


def _default_opener(req: Request, timeout: float) -> _Response:
    """Perform a real HTTP request and normalize it into a ``_Response``."""
    try:
        with urlopen(req, timeout=timeout) as resp:
            data = resp.read().decode("utf-8", errors="replace")
            headers = {k.lower(): v for k, v in resp.headers.items()}
            status = getattr(resp, "status", None) or resp.getcode()
            return _Response(status, headers, data)
    except HTTPError as exc:
        body = ""
        try:
            body = exc.read().decode("utf-8", errors="replace")
        except Exception:  # pragma: no cover - defensive
            pass
        headers = {k.lower(): v for k, v in (exc.headers or {}).items()}
        return _Response(exc.code, headers, body)
    except (URLError, OSError, TimeoutError) as exc:
        raise GitHubAPIError(f"request failed: {exc}") from exc


def _parse_link_header(value: Optional[str]) -> Dict[str, str]:
    """Parse a GitHub ``Link`` header into a {rel: url} map."""
    rels: Dict[str, str] = {}
    if not value:
        return rels
    for part in value.split(","):
        segs = part.split(";")
        if len(segs) < 2:
            continue
        url = segs[0].strip().lstrip("<").rstrip(">")
        for seg in segs[1:]:
            seg = seg.strip()
            if seg.startswith("rel="):
                rel = seg[len("rel="):].strip().strip('"')
                rels[rel] = url
    return rels


def _check_rate_limit(resp: _Response,
                      warn: Callable[[str], None]) -> None:
    """Inspect rate-limit headers / 429 status; warn + raise when exhausted."""
    if resp.status == 429:
        raise RateLimitError(
            "GitHub rate limit hit (HTTP 429); retry later or authenticate.\n"
            "  触发 GitHub 限流 (HTTP 429)：请稍后重试或配置鉴权。"
        )
    remaining_raw = resp.headers.get("x-ratelimit-remaining")
    if remaining_raw is None:
        return
    try:
        remaining = int(remaining_raw)
    except ValueError:
        return
    if remaining < RATE_LIMIT_FLOOR:
        reset = resp.headers.get("x-ratelimit-reset", "")
        warn(
            f"GitHub rate-limit low: {remaining} requests left "
            f"(resets at epoch {reset}); backing off.\n"
            f"  GitHub 配额不足：剩余 {remaining} 次，正在退避。"
        )
        if remaining <= 0:
            raise RateLimitError(
                "GitHub rate-limit budget exhausted; aborting.\n"
                "  GitHub 配额已耗尽：已中止。"
            )


# ---------------------------------------------------------------------------
# Issues
# ---------------------------------------------------------------------------
def fetch_issues(owner: str,
                 repo: str,
                 *,
                 state: str = "all",
                 token: Optional[str] = None,
                 per_page: int = DEFAULT_PER_PAGE,
                 timeout: float = DEFAULT_TIMEOUT,
                 opener: Optional[Callable[[Request, float], _Response]] = None,
                 warn: Optional[Callable[[str], None]] = None,
                 sleep: Callable[[float], None] = time.sleep,
                 ) -> List[Dict[str, Any]]:
    """Fetch all issues for ``owner/repo`` (default ``state=all``).

    Follows ``Link``-header pagination, applies the resolved bearer token, and
    honours rate-limit headers (backing off below ``RATE_LIMIT_FLOOR``). The
    ``opener``/``warn``/``sleep`` hooks are injectable for tests.

    Pull requests (which the issues endpoint includes) are filtered out — only
    true issues are returned, matching what downstream backlog sync expects.
    """
    if token is None:
        token = resolve_token()
    if opener is None:
        opener = _default_opener
    if warn is None:
        warn = lambda msg: print(msg, file=sys.stderr)  # noqa: E731

    url: Optional[str] = (
        f"{API_ROOT}/repos/{owner}/{repo}/issues"
        f"?state={state}&per_page={per_page}"
    )
    issues: List[Dict[str, Any]] = []
    while url:
        req = Request(url, headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "roll/github_sync",
            "X-GitHub-Api-Version": "2022-11-28",
        })
        resp = opener(req, timeout)
        _check_rate_limit(resp, warn)
        if resp.status == 401 or resp.status == 403:
            # 403 without a 429 is most often a bad/expired token.
            raise AuthError(
                f"GitHub returned HTTP {resp.status}; check your token scopes.\n"
                f"  GitHub 返回 HTTP {resp.status}：请检查 token 权限。"
            )
        if resp.status < 200 or resp.status >= 300:
            raise GitHubAPIError(
                f"GitHub returned HTTP {resp.status} for {url}"
            )
        page = json.loads(resp.body) if resp.body.strip() else []
        for item in page:
            # The issues endpoint also returns PRs; skip them.
            if "pull_request" in item:
                continue
            issues.append(item)
        links = _parse_link_header(resp.headers.get("link"))
        next_url = links.get("next")
        url = next_url
        if url:
            # Be polite between pages when the budget is getting tight.
            remaining_raw = resp.headers.get("x-ratelimit-remaining")
            if remaining_raw is not None:
                try:
                    if int(remaining_raw) < RATE_LIMIT_FLOOR:
                        sleep(1.0)
                except ValueError:
                    pass
    return issues


# ---------------------------------------------------------------------------
# Backlog write (US-SYNC-002)
#
# Single-direction mapping: GitHub issues → .roll/backlog.md rows. label→type
# mapping decides the backlog prefix (FIX / US / REFACTOR), title becomes the
# Description, and state (open/closed) becomes the status emoji. New rows are
# appended to the bottom of the target Markdown table.
# ---------------------------------------------------------------------------

# label → backlog type. First matching label (case-insensitive) wins; an issue
# with no recognised label defaults to US.
_LABEL_TYPE_MAP = {
    "bug": "FIX",
    "enhancement": "US",
    "feature": "US",
    "us": "US",
    "refactor": "REFACTOR",
}
DEFAULT_TYPE = "US"

# state → backlog status column.
_STATE_STATUS_MAP = {
    "open": "📋 Todo",
    "closed": "✅ Done",
}
DEFAULT_STATUS = "📋 Todo"


def map_label_to_type(labels: List[Any]) -> str:
    """Map a GitHub issue's labels to a backlog type prefix.

    ``labels`` is the raw ``issue["labels"]`` list (each entry a dict with a
    ``name`` key, as GitHub returns them, or a plain string). The first label
    that matches a known mapping wins; with no match we fall back to
    ``DEFAULT_TYPE`` (US).
    """
    for label in labels or []:
        name = label.get("name", "") if isinstance(label, dict) else str(label)
        key = name.strip().lower()
        if key in _LABEL_TYPE_MAP:
            return _LABEL_TYPE_MAP[key]
    return DEFAULT_TYPE


def map_state_to_status(state: Optional[str]) -> str:
    """Map a GitHub issue state (``open``/``closed``) to a backlog status."""
    return _STATE_STATUS_MAP.get((state or "").strip().lower(), DEFAULT_STATUS)


def gh_id(issue: Dict[str, Any]) -> str:
    """Return the canonical GitHub id token for an issue, e.g. ``GH-13``.

    This is stable across syncs and independent of the label→type prefix, so
    it is what idempotency detection keys on (US-SYNC-003).
    """
    return f"GH-{issue.get('number')}"


def issue_to_row(issue: Dict[str, Any]) -> str:
    """Render a single GitHub issue as a backlog Markdown table row.

    The id is ``<TYPE>-GH-<number>`` (e.g. ``US-GH-13`` / ``FIX-GH-13``): the
    label→type mapping supplies the prefix and ``GH-<number>`` is the stable
    GitHub id (US-SYNC-003). The issue title becomes the Description and the
    state becomes the status column.
    """
    title = (issue.get("title") or "").strip()
    type_prefix = map_label_to_type(issue.get("labels", []))
    status = map_state_to_status(issue.get("state"))
    row_id = f"{type_prefix}-{gh_id(issue)}"
    return f"| {row_id} | {title} | {status} |"


def _append_rows_to_table(content: str, rows: List[str]) -> str:
    """Append ``rows`` to the bottom of the first Markdown table in ``content``.

    A "table" here is the contiguous run of lines starting with ``|`` that
    follows the ``|---|`` separator. New rows are inserted directly after the
    last existing body row of that table, so subsequent (non-table) content is
    preserved.
    """
    if not rows:
        return content
    lines = content.split("\n")
    sep_idx = None
    for idx, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("|") and set(stripped) <= set("|-: "):
            sep_idx = idx
            break
    if sep_idx is None:
        # No table found — append the rows at the end as a fallback.
        tail = "\n".join(rows)
        if content and not content.endswith("\n"):
            return content + "\n" + tail + "\n"
        return content + tail + "\n"
    # Find the last contiguous body row after the separator.
    insert_at = sep_idx + 1
    while insert_at < len(lines) and lines[insert_at].strip().startswith("|"):
        insert_at += 1
    new_lines = lines[:insert_at] + rows + lines[insert_at:]
    return "\n".join(new_lines)


def _gh_id_present(content: str, ident: str) -> bool:
    """Return True if backlog ``content`` already contains the GitHub id token.

    Matches the ``GH-<number>`` token so ``GH-1`` does not spuriously match
    ``GH-13``. The token always appears inside a row id of the form
    ``<TYPE>-GH-<number>`` (the char before ``GH`` is the prefix hyphen), so the
    leading boundary must reject only an alphanumeric — never the hyphen. A
    label/type change between syncs still counts as "already exists" (we skip
    rather than duplicate).
    """
    import re
    return re.search(r'(?<![0-9A-Za-z])' + re.escape(ident) + r'(?![0-9A-Za-z-])',
                     content) is not None


def parse_labels_filter(value: Optional[str]) -> List[str]:
    """Parse a ``--label`` flag value into a normalized list of label names.

    The flag is comma-separated and may be passed multiple times (the caller
    joins repeats with commas before calling this); ``"P1, bug"`` → ``["p1",
    "bug"]``. Names are lower-cased and stripped so matching is
    case-insensitive (US-SYNC-005). Empty / whitespace-only tokens are dropped.
    """
    if not value:
        return []
    out: List[str] = []
    for tok in value.split(","):
        key = tok.strip().lower()
        if key and key not in out:
            out.append(key)
    return out


def issue_has_label(issue: Dict[str, Any], wanted: List[str]) -> bool:
    """Return True if ``issue`` carries any of the ``wanted`` labels (OR).

    ``wanted`` is the normalized list from :func:`parse_labels_filter`. An
    empty ``wanted`` matches every issue (no filter). Matching is
    case-insensitive and uses OR semantics — a single overlapping label is
    enough (US-SYNC-005).
    """
    if not wanted:
        return True
    have = set()
    for label in issue.get("labels", []) or []:
        name = label.get("name", "") if isinstance(label, dict) else str(label)
        key = name.strip().lower()
        if key:
            have.add(key)
    return any(w in have for w in wanted)


def filter_issues_by_label(issues: List[Dict[str, Any]],
                           wanted: List[str]) -> List[Dict[str, Any]]:
    """Filter ``issues`` to those matching any ``wanted`` label (US-SYNC-005)."""
    if not wanted:
        return list(issues)
    return [i for i in issues if issue_has_label(i, wanted)]


# A top-level GitHub task-list item: ``- [ ] text`` or ``- [x] text`` with NO
# leading indentation. Nested items (indented) are intentionally ignored so we
# only capture the issue's primary acceptance criteria, not sub-points.
import re as _re  # noqa: E402

_TOP_LEVEL_CHECKBOX = _re.compile(r'^[-*] \[([ xX])\] (.+?)\s*$')


def extract_ac_items(body: Optional[str]) -> List[str]:
    """Extract top-level ``- [ ]`` / ``- [x]`` checkbox items from an issue body.

    Only checkbox items with no leading indentation are returned — nested
    (indented) list items are ignored so we capture the issue's primary
    acceptance criteria, not sub-bullets (US-SYNC-005). Returns the raw item
    text (the label after the checkbox), in document order. ``\\r\\n`` line
    endings are tolerated.
    """
    if not body:
        return []
    items: List[str] = []
    for raw in body.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        # A leading space means the item is nested under another bullet — skip.
        if raw[:1] == " " or raw[:1] == "\t":
            continue
        m = _TOP_LEVEL_CHECKBOX.match(raw)
        if m:
            items.append(m.group(2).strip())
    return items


def render_ac_section(issue: Dict[str, Any]) -> str:
    """Render the AC section body for a feature stub from an issue (US-SYNC-005).

    Each top-level checkbox in the issue body becomes a Markdown ``- [ ]`` AC
    line (state normalized to unchecked — the backlog tracks completion, not
    the upstream issue). When the issue has no checkboxes the section is empty.
    """
    items = extract_ac_items(issue.get("body"))
    return "\n".join(f"- [ ] {it}" for it in items)


def write_feature_stub(issue: Dict[str, Any],
                       features_dir: str,
                       *,
                       epic: str = "backlog-lifecycle") -> str:
    """Create or append a feature file stub for ``issue`` (US-SYNC-005).

    Writes ``<features_dir>/<epic>/GH-<number>.md``. If the file does not exist
    a stub is created with a heading + AC section; if it exists the AC items are
    appended (idempotency at the row level is handled upstream, but appending
    here is non-destructive to any human-authored prose). Returns the path
    written.
    """
    ident = gh_id(issue)
    epic_dir = os.path.join(features_dir, epic)
    os.makedirs(epic_dir, exist_ok=True)
    path = os.path.join(epic_dir, f"{ident}.md")
    ac_body = render_ac_section(issue)
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as fh:
            existing = fh.read()
        block = ac_body + "\n" if ac_body else ""
        sep = "" if existing.endswith("\n") or not existing else "\n"
        with open(path, "a", encoding="utf-8") as fh:
            if block:
                fh.write(sep + block)
        return path
    title = (issue.get("title") or "").strip()
    type_prefix = map_label_to_type(issue.get("labels", []))
    parts = [
        f"# {ident} {title}".rstrip(),
        "",
        f"> Synced from GitHub issue #{issue.get('number')} "
        f"({type_prefix}).",
        "",
        "## AC",
        "",
    ]
    stub = "\n".join(parts)
    if ac_body:
        stub += ac_body + "\n"
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(stub)
    return path


def dry_run_line(issue: Dict[str, Any], *, skipped: bool) -> str:
    """Render the ``--dry-run`` preview line for a single issue (US-SYNC-004).

    Format:
      ``+ GH-13 [US] 需求：roll backlog 支持从 GitHub Issues 同步``  (would add)
      ``= GH-12 [FIX] (skipped, already exists)``                  (would skip)

    The ``GH-<number>`` token is the stable id; the bracketed token is the
    label→type prefix; the leading ``+``/``=`` marks add vs skip.
    """
    ident = gh_id(issue)
    type_prefix = map_label_to_type(issue.get("labels", []))
    if skipped:
        return f"= {ident} [{type_prefix}] (skipped, already exists)"
    title = (issue.get("title") or "").strip()
    return f"+ {ident} [{type_prefix}] {title}"


def dry_run_preview(issues: List[Dict[str, Any]],
                    backlog_path: str) -> Dict[str, Any]:
    """Compute the sync diff for ``issues`` WITHOUT writing ``backlog_path``.

    Mirrors :func:`sync_to_backlog`'s idempotency logic (an issue whose
    ``GH-<number>`` id already appears in the backlog is a skip) but performs
    no file write — the backlog file is read-only here (US-SYNC-004 dry-run).
    Returns ``{"added": N, "skipped": M, "total": K, "lines": [...]}`` where
    ``lines`` are the formatted preview lines in issue order.
    """
    with open(backlog_path, "r", encoding="utf-8") as fh:
        content = fh.read()
    lines: List[str] = []
    added = 0
    skipped = 0
    for issue in issues:
        ident = gh_id(issue)
        is_skip = _gh_id_present(content, ident)
        if is_skip:
            skipped += 1
        else:
            added += 1
        lines.append(dry_run_line(issue, skipped=is_skip))
    return {
        "added": added,
        "skipped": skipped,
        "total": len(issues),
        "lines": lines,
    }


def sync_to_backlog(issues: List[Dict[str, Any]],
                    backlog_path: str) -> Dict[str, Any]:
    """Append backlog rows for new ``issues`` to the table in ``backlog_path``.

    Idempotent (US-SYNC-003): an issue whose ``GH-<number>`` id already appears
    in the backlog is skipped (status/description left untouched) and reported
    in ``skipped``. Returns a summary dict
    ``{"added": N, "skipped": M, "total": K, "rows": [...], "skipped_ids": [...]}``.
    """
    with open(backlog_path, "r", encoding="utf-8") as fh:
        content = fh.read()
    rows: List[str] = []
    skipped_ids: List[str] = []
    for issue in issues:
        ident = gh_id(issue)
        if _gh_id_present(content, ident):
            skipped_ids.append(ident)
            continue
        rows.append(issue_to_row(issue))
    updated = _append_rows_to_table(content, rows)
    with open(backlog_path, "w", encoding="utf-8") as fh:
        fh.write(updated)
    return {
        "added": len(rows),
        "skipped": len(skipped_ids),
        "total": len(issues),
        "rows": rows,
        "skipped_ids": skipped_ids,
    }


# ---------------------------------------------------------------------------
# Config persistence (US-SYNC-006)
#
# After a successful `roll backlog sync --repo owner/repo`, the resolved repo /
# labels / timestamp are persisted to `.roll/local.yaml` under a `backlog_sync:`
# block so subsequent `roll backlog sync` (no flags) can reuse them. We parse /
# rewrite YAML with the same regex-on-text approach the rest of the codebase
# uses (lib/roll-home.py, lib/roll-loop-status.py) — no PyYAML dependency, and
# the block is replaced surgically so unrelated keys (`agent:`, `loop_schedule:`)
# survive untouched.
# ---------------------------------------------------------------------------
SYNC_CONFIG_KEY = "backlog_sync"
DEFAULT_SYNC_DIRECTION = "issues-to-backlog"


def read_sync_config(local_yaml_path: str) -> Dict[str, Any]:
    """Read the ``backlog_sync:`` block from ``local_yaml_path``.

    Returns a dict with whatever keys are present (``repo``, ``direction``,
    ``labels``, ``last_sync_at``); an empty dict when the file is missing or
    has no ``backlog_sync:`` block (US-SYNC-006). ``labels`` is normalized to a
    list. Parsing is line-based so it tolerates the rest of the YAML without a
    full parser.
    """
    if not os.path.exists(local_yaml_path):
        return {}
    with open(local_yaml_path, "r", encoding="utf-8") as fh:
        lines = fh.read().replace("\r\n", "\n").replace("\r", "\n").split("\n")
    # Locate the top-level `backlog_sync:` key.
    start = None
    for idx, line in enumerate(lines):
        if line.rstrip() == f"{SYNC_CONFIG_KEY}:" or \
                line.startswith(f"{SYNC_CONFIG_KEY}:"):
            # Must be a top-level key (no leading indentation).
            if line[:1] not in (" ", "\t"):
                start = idx
                break
    if start is None:
        return {}
    cfg: Dict[str, Any] = {}
    for line in lines[start + 1:]:
        if line.strip() == "":
            continue
        # A new top-level key (no indentation) ends the block.
        if line[:1] not in (" ", "\t"):
            break
        m = re.match(r'^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$', line)
        if not m:
            continue
        key, raw = m.group(1), m.group(2).strip()
        if key == "labels":
            cfg["labels"] = _parse_yaml_inline_list(raw)
        else:
            # Strip surrounding quotes if present.
            if len(raw) >= 2 and raw[0] in "'\"" and raw[-1] == raw[0]:
                raw = raw[1:-1]
            cfg[key] = raw
    return cfg


def _parse_yaml_inline_list(raw: str) -> List[str]:
    """Parse a YAML inline list literal (``[]`` / ``[a, b]``) into a list."""
    raw = raw.strip()
    if not raw or raw == "[]":
        return []
    if raw.startswith("[") and raw.endswith("]"):
        inner = raw[1:-1]
        return [tok.strip().strip("'\"") for tok in inner.split(",")
                if tok.strip()]
    # A bare scalar (single label without brackets).
    return [raw.strip("'\"")]


def _render_sync_block(repo: str,
                       labels: List[str],
                       last_sync_at: str,
                       direction: str = DEFAULT_SYNC_DIRECTION) -> str:
    """Render the ``backlog_sync:`` YAML block (no trailing newline)."""
    labels_lit = "[" + ", ".join(labels) + "]" if labels else "[]"
    return (
        f"{SYNC_CONFIG_KEY}:\n"
        f"  repo: {repo}\n"
        f"  direction: {direction}\n"
        f"  labels: {labels_lit}\n"
        f"  last_sync_at: {last_sync_at}"
    )


def write_sync_config(local_yaml_path: str,
                      repo: str,
                      *,
                      labels: Optional[List[str]] = None,
                      last_sync_at: Optional[str] = None,
                      direction: str = DEFAULT_SYNC_DIRECTION) -> None:
    """Persist the ``backlog_sync:`` block to ``local_yaml_path`` (US-SYNC-006).

    Replaces an existing top-level ``backlog_sync:`` block in place (preserving
    every other key) or appends a new one when absent. Creates the file if it
    does not exist. ``last_sync_at`` defaults to the current UTC time in RFC3339
    form (``2026-05-28T10:00:00Z``).
    """
    labels = list(labels or [])
    if last_sync_at is None:
        last_sync_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    block = _render_sync_block(repo, labels, last_sync_at, direction)

    if not os.path.exists(local_yaml_path):
        os.makedirs(os.path.dirname(local_yaml_path) or ".", exist_ok=True)
        with open(local_yaml_path, "w", encoding="utf-8") as fh:
            fh.write(block + "\n")
        return

    with open(local_yaml_path, "r", encoding="utf-8") as fh:
        original = fh.read()
    text = original.replace("\r\n", "\n").replace("\r", "\n")
    lines = text.split("\n")

    start = None
    for idx, line in enumerate(lines):
        if (line.rstrip() == f"{SYNC_CONFIG_KEY}:" or
                line.startswith(f"{SYNC_CONFIG_KEY}:")) and \
                line[:1] not in (" ", "\t"):
            start = idx
            break

    if start is None:
        # Append the block, keeping a single blank-line separator.
        sep = "" if text.endswith("\n\n") or text == "" else (
            "\n" if text.endswith("\n") else "\n\n")
        new_text = text + sep + block + "\n"
    else:
        # Find the end of the existing block (next top-level key or EOF).
        end = start + 1
        while end < len(lines):
            line = lines[end]
            if line.strip() != "" and line[:1] not in (" ", "\t"):
                break
            end += 1
        new_lines = lines[:start] + block.split("\n") + lines[end:]
        new_text = "\n".join(new_lines)
        if not new_text.endswith("\n"):
            new_text += "\n"

    with open(local_yaml_path, "w", encoding="utf-8") as fh:
        fh.write(new_text)


# ---------------------------------------------------------------------------
# CLI entry — `python3 lib/github_sync.py issues owner/repo` for ad-hoc use /
# direct testing when bin/roll is unavailable.
# ---------------------------------------------------------------------------
def _load_issues_for_sync(owner: str, repo: str) -> List[Dict[str, Any]]:
    """Fetch open issues for sync, honouring a test fixture override.

    When ``ROLL_SYNC_FIXTURE`` points at a JSON file, its contents are used
    instead of a live API call. This lets the ``roll backlog sync`` integration
    test exercise the full bin/roll → python write path with mocked GitHub
    responses and zero network access.
    """
    fixture = os.environ.get("ROLL_SYNC_FIXTURE")
    if fixture:
        with open(fixture, "r", encoding="utf-8") as fh:
            return json.load(fh)
    return fetch_issues(owner, repo, state="open")


def _cmd_sync(argv: List[str]) -> int:  # pragma: no cover - thin CLI wrapper
    backlog = ".roll/backlog.md"
    if "--backlog" in argv:
        backlog = argv[argv.index("--backlog") + 1]
    features_dir = ".roll/features"
    if "--features" in argv:
        features_dir = argv[argv.index("--features") + 1]
    local_yaml = ".roll/local.yaml"
    if "--local-yaml" in argv:
        local_yaml = argv[argv.index("--local-yaml") + 1]

    # US-SYNC-006: resolve --repo from the flag first; otherwise fall back to
    # the persisted backlog_sync.repo in .roll/local.yaml. With neither, the
    # first sync must be explicit.
    cfg = read_sync_config(local_yaml)
    if "--repo" in argv:
        repo_arg = argv[argv.index("--repo") + 1]
    else:
        repo_arg = cfg.get("repo") or ""
    if not repo_arg:
        print("usage: github_sync.py sync --repo <owner/repo> "
              "[--backlog <path>] [--features <dir>] [--label <a,b>] [--dry-run]\n"
              "  no --repo and no backlog_sync.repo in .roll/local.yaml: "
              "first sync must pass --repo.\n"
              "  首次 sync 必须显式 --repo（local.yaml 中尚无 backlog_sync.repo）。",
              file=sys.stderr)
        return 1
    if "/" not in repo_arg:
        print(f"invalid --repo {repo_arg!r}: expected owner/repo",
              file=sys.stderr)
        return 1
    owner, repo = repo_arg.split("/", 1)
    # --label may be repeated; each value is comma-separated. Join repeats with
    # commas so parse_labels_filter sees one flat list (OR semantics). With no
    # --label flag, fall back to persisted config labels (US-SYNC-006).
    label_parts: List[str] = []
    for i, tok in enumerate(argv):
        if tok == "--label" and i + 1 < len(argv):
            label_parts.append(argv[i + 1])
    if label_parts:
        wanted = parse_labels_filter(",".join(label_parts))
    else:
        wanted = parse_labels_filter(",".join(cfg.get("labels") or []))
    dry_run = "--dry-run" in argv
    try:
        issues = _load_issues_for_sync(owner, repo)
    except AuthError as exc:
        print(f"auth error: {exc}", file=sys.stderr)
        return 2
    except RateLimitError as exc:
        print(f"rate limit: {exc}", file=sys.stderr)
        return 3
    except GitHubAPIError as exc:
        print(f"api error: {exc}", file=sys.stderr)
        return 4
    issues = filter_issues_by_label(issues, wanted)
    if dry_run:
        # US-SYNC-004: preview only — compute the diff, leave backlog.md
        # untouched, exit 0 on a successful dry run.
        preview = dry_run_preview(issues, backlog)
        for line in preview["lines"]:
            print(line)
        print(f"added: {preview['added']}, skipped: {preview['skipped']}, "
              f"total issues: {preview['total']} (dry-run, no changes written)")
        return 0
    summary = sync_to_backlog(issues, backlog)
    # US-SYNC-005: for each newly-added issue, materialize a feature stub whose
    # AC section is its top-level issue-body checkboxes.
    skipped_set = set(summary["skipped_ids"])
    for issue in issues:
        if gh_id(issue) in skipped_set:
            continue
        write_feature_stub(issue, features_dir)
    for row in summary["rows"]:
        print(f"+ {row}")
    for ident in summary["skipped_ids"]:
        print(f"skipped (already exists): {ident}")
    print(f"added: {summary['added']}, skipped: {summary['skipped']}, "
          f"total issues: {summary['total']}")
    # US-SYNC-006: persist the resolved repo/labels/timestamp so subsequent
    # `roll backlog sync` (no flags) can reuse them.
    write_sync_config(local_yaml, repo_arg, labels=wanted)
    return 0


def _main(argv: List[str]) -> int:  # pragma: no cover - thin CLI wrapper
    if not argv or argv[0] in ("-h", "--help", "help"):
        print("usage: github_sync.py issues <owner/repo> [--state all|open|closed]")
        print("       github_sync.py sync --repo <owner/repo> [--backlog <path>] [--dry-run]")
        return 0
    cmd = argv[0]
    if cmd == "sync":
        return _cmd_sync(argv[1:])
    if cmd == "on-loop-cycle":
        # US-SYNC-008: print "true"/"false" for backlog_sync.on_loop_cycle so the
        # roll-loop preflight hook can read the switch without a YAML parser.
        # Default false when the file or the key is absent.
        rest = argv[1:]
        local_yaml = ".roll/local.yaml"
        if "--local-yaml" in rest:
            local_yaml = rest[rest.index("--local-yaml") + 1]
        cfg = read_sync_config(local_yaml)
        raw = str(cfg.get("on_loop_cycle", "")).strip().lower()
        print("true" if raw in ("true", "1", "yes", "on") else "false")
        return 0
    if cmd != "issues" or len(argv) < 2 or "/" not in argv[1]:
        print("usage: github_sync.py issues <owner/repo>", file=sys.stderr)
        return 1
    owner, repo = argv[1].split("/", 1)
    state = "all"
    if "--state" in argv:
        state = argv[argv.index("--state") + 1]
    try:
        issues = fetch_issues(owner, repo, state=state)
    except AuthError as exc:
        print(f"auth error: {exc}", file=sys.stderr)
        return 2
    except RateLimitError as exc:
        print(f"rate limit: {exc}", file=sys.stderr)
        return 3
    except GitHubAPIError as exc:
        print(f"api error: {exc}", file=sys.stderr)
        return 4
    print(json.dumps(
        [{"number": i.get("number"), "title": i.get("title"),
          "state": i.get("state")} for i in issues],
        ensure_ascii=False, indent=2,
    ))
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(_main(sys.argv[1:]))
