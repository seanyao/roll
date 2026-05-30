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


def issue_to_row(issue: Dict[str, Any]) -> str:
    """Render a single GitHub issue as a backlog Markdown table row.

    The id is ``<TYPE>-<number>`` (e.g. ``US-13`` / ``FIX-13``); the issue
    title becomes the Description and the state becomes the status column.
    """
    number = issue.get("number")
    title = (issue.get("title") or "").strip()
    type_prefix = map_label_to_type(issue.get("labels", []))
    status = map_state_to_status(issue.get("state"))
    row_id = f"{type_prefix}-{number}"
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


def sync_to_backlog(issues: List[Dict[str, Any]],
                    backlog_path: str) -> Dict[str, Any]:
    """Append backlog rows for ``issues`` to the table in ``backlog_path``.

    Returns a summary dict ``{"added": N, "rows": [...]}``. This is the v1
    single-direction write: every issue is rendered and appended (idempotency
    /skip-existing arrives in US-SYNC-003).
    """
    with open(backlog_path, "r", encoding="utf-8") as fh:
        content = fh.read()
    rows = [issue_to_row(issue) for issue in issues]
    updated = _append_rows_to_table(content, rows)
    with open(backlog_path, "w", encoding="utf-8") as fh:
        fh.write(updated)
    return {"added": len(rows), "rows": rows}


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
    if "--repo" not in argv:
        print("usage: github_sync.py sync --repo <owner/repo> "
              "[--backlog <path>]", file=sys.stderr)
        return 1
    repo_arg = argv[argv.index("--repo") + 1]
    if "/" not in repo_arg:
        print(f"invalid --repo {repo_arg!r}: expected owner/repo",
              file=sys.stderr)
        return 1
    owner, repo = repo_arg.split("/", 1)
    backlog = ".roll/backlog.md"
    if "--backlog" in argv:
        backlog = argv[argv.index("--backlog") + 1]
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
    summary = sync_to_backlog(issues, backlog)
    for row in summary["rows"]:
        print(f"+ {row}")
    print(f"added: {summary['added']}, total issues: {len(issues)}")
    return 0


def _main(argv: List[str]) -> int:  # pragma: no cover - thin CLI wrapper
    if not argv or argv[0] in ("-h", "--help", "help"):
        print("usage: github_sync.py issues <owner/repo> [--state all|open|closed]")
        print("       github_sync.py sync --repo <owner/repo> [--backlog <path>]")
        return 0
    cmd = argv[0]
    if cmd == "sync":
        return _cmd_sync(argv[1:])
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
