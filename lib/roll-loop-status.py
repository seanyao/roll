#!/usr/bin/env python3
"""
roll-loop-status — render the `roll loop` health dashboard.

Reads (all per-project, slug = <basename>-<md5_6chars> of project root):
  $ROLL_SHARED_ROOT/loop/events-<slug>.ndjson   structured per-cycle events
  $ROLL_SHARED_ROOT/loop/cron-<slug>.log        wall-clock dur + cost per cycle
  $ROLL_SHARED_ROOT/loop/state-<slug>.yaml      idle | running | paused
  ./.roll/backlog.md                                   story id → description

Writes (stdout):
  Static 100-col colored print, EN/ZH paired rows. Designed for a 5-10s glance,
  leaves the dashboard in scrollback. Honors NO_COLOR; degrades to 80 cols.

Usage:
  python3 lib/roll-loop-status.py              # default 3-day window
  python3 lib/roll-loop-status.py --days 7
  python3 lib/roll-loop-status.py --no-color
  python3 lib/roll-loop-status.py --en | --zh  # collapse bilingual rows
  ROLL_RENDER_FIXTURE=1 python3 lib/roll-loop-status.py   # render with fixture data (test only)

  Wire it in bin/roll under `loop status` (replace _loop_status with a call to
  this script).
"""

from __future__ import annotations
import argparse, hashlib, json, os, re, subprocess, sys, time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

# Display TZ is fixed to Asia/Shanghai (UTC+8). Internal datetimes stay UTC;
# only display conversions honor this. Set the process TZ so .astimezone()
# without args resolves to Beijing time across all renderers.
os.environ.setdefault("TZ", "Asia/Shanghai")
time.tzset()

# Shared rendering primitives — see lib/roll_render.py for the design system.
_LIB_DIR = os.path.dirname(os.path.realpath(__file__))
if _LIB_DIR not in sys.path:
    sys.path.insert(0, _LIB_DIR)
import roll_render
from roll_render import (
    PAL, BOLD, RESET, COLS, c, strw, pad, row,
    fmt_dur, fmt_delta, fmt_tokens, trunc, empty_rollup,
    section_head, metric, metric_dur, metric_dollar, metric_tokens,
    day_band, cycle_row,
)

# ════════════════════════════════════════════════════════════════════════════
# Paths — must match bin/roll's _project_slug + _SHARED_ROOT defaults
# ════════════════════════════════════════════════════════════════════════════
def project_slug(path: Optional[str] = None) -> str:
    # US-LOOP-006: cycle wrapper exports ROLL_MAIN_SLUG — honour it.
    env_slug = os.environ.get("ROLL_MAIN_SLUG", "").strip()
    if env_slug:
        return env_slug

    path = os.path.realpath(path or os.getcwd())
    try:  # resolve git worktree → main tree (FIX-034 in bin/roll)
        common = subprocess.check_output(
            ["git", "-C", path, "rev-parse", "--git-common-dir"],
            stderr=subprocess.DEVNULL, text=True
        ).strip()
        if common.endswith("/.git"):
            path = common[:-5]
    except Exception:
        pass

    # US-OBS-010: derive slug from git remote URL for stable cross-machine
    # identity.  Normalize: strip .git, git@HOST:PATH → https://HOST/PATH,
    # lowercase.  Fallback chain: origin → first remote → path-based.
    remote_url = _git_remote_url(path)
    if remote_url:
        # Normalize
        remote_url = remote_url.rstrip("/")
        if remote_url.endswith(".git"):
            remote_url = remote_url[:-4]
        m = re.match(r"^git@([^:]+):(.+)$", remote_url)
        if m:
            remote_url = f"https://{m.group(1)}/{m.group(2)}"
        remote_url = remote_url.lower()
        base = re.sub(r"[^A-Za-z0-9]+", "-", os.path.basename(remote_url)).strip("-")
        h = hashlib.md5(remote_url.encode()).hexdigest()[:6]
        return f"{base}-{h}"

    base = re.sub(r"[^A-Za-z0-9]+", "-", os.path.basename(path)).strip("-")
    h = hashlib.md5(path.encode()).hexdigest()[:6]
    return f"{base}-{h}"


def _git_remote_url(repo_path: str) -> Optional[str]:
    """Return the normalized remote URL for a git repo, or None."""
    try:
        url = subprocess.check_output(
            ["git", "-C", repo_path, "remote", "get-url", "origin"],
            stderr=subprocess.DEVNULL, text=True
        ).strip()
        if url:
            return url
    except Exception:
        pass
    # Fallback: first available remote
    try:
        remotes = subprocess.check_output(
            ["git", "-C", repo_path, "remote"],
            stderr=subprocess.DEVNULL, text=True
        ).strip().splitlines()
        if remotes:
            url = subprocess.check_output(
                ["git", "-C", repo_path, "remote", "get-url", remotes[0]],
                stderr=subprocess.DEVNULL, text=True
            ).strip()
            if url:
                return url
    except Exception:
        pass
    return None

def shared_root() -> Path:
    return Path(os.environ.get("ROLL_SHARED_ROOT") or os.path.expanduser("~/.shared/roll"))

# ════════════════════════════════════════════════════════════════════════════
# Loaders
# ════════════════════════════════════════════════════════════════════════════
def load_events(slug: str, days: int) -> List[Dict[str, Any]]:
    # US-LOOP-023: read the head NDJSON plus its rotated siblings .1..4.
    # bin/roll rotates events-<slug>.ndjson at 10MB keeping 4 archives; without
    # this loop the dashboard silently dropped any cycle whose events landed in
    # a rotated file (the "永久留存" promise of US-LOOP-004 only held on disk).
    head = shared_root() / "loop" / f"events-{slug}.ndjson"
    candidates = [head] + [head.with_suffix(f".ndjson.{i}") for i in range(1, 5)]
    existing = [p for p in candidates if p.exists()]
    if not existing:
        return []
    cutoff = datetime.now(timezone.utc) - timedelta(days=days + 1)  # +1 for grace
    out: List[Dict[str, Any]] = []
    seen: set[str] = set()  # dedup on the raw JSON line (rotation is mv, so
                            # duplicates only appear from manual ops — defensive)
    for p in existing:
        with p.open() as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                if line in seen:
                    continue
                seen.add(line)
                try:
                    e = json.loads(line)
                    e["_ts"] = datetime.fromisoformat(e["ts"].replace("Z", "+00:00"))
                    if e["_ts"] >= cutoff:
                        out.append(e)
                except Exception:
                    continue
    out.sort(key=lambda e: e["_ts"])
    if os.environ.get("ROLL_DEBUG_LOAD"):
        print(f"roll-loop-status: loaded {len(out)} events from {len(existing)} files",
              file=sys.stderr)
    return out

# cron.log entry format (from bin/roll):
#   "03:49:25  cycle done — done · 981s · $4.53"
#   "03:57:35  cycle done — done · 1 tcr · 538s · $3.20"
_CRON_PAT = re.compile(
    r"^(\d{2}:\d{2}):(\d{2})\s+cycle done — (\w+)"
    r"(?:\s*·\s*(\d+)\s+tcr)?"
    r"\s*·\s*(\d+)s"
    r"\s*·\s*\$([\d.]+)"
)

def load_cron_log(slug: str) -> List[Dict[str, Any]]:
    """Return ordered list of cron entries with local HH:MM:SS + extracted fields."""
    path = shared_root() / "loop" / f"cron-{slug}.log"
    if not path.exists():
        return []
    out: List[Dict[str, Any]] = []
    with path.open(errors="ignore") as f:
        for line in f:
            # Bug D: cron.log lines are written with ANSI color escapes
            # (\033[90m...\033[0m). Strip them before regex matching.
            m = _CRON_PAT.match(roll_render.strip_ansi(line).strip())
            if m:
                out.append({
                    "hhmm": m.group(1),
                    "ss": int(m.group(2)),
                    "outcome": m.group(3),
                    "tcr": int(m.group(4) or 0),
                    "duration_s": int(m.group(5)),
                    "cost": float(m.group(6)),
                })
    return out

def load_state(slug: str) -> Dict[str, str]:
    """Tiny YAML reader — only the flat keys bin/roll writes."""
    path = shared_root() / "loop" / f"state-{slug}.yaml"
    if not path.exists():
        return {}
    out: Dict[str, str] = {}
    for line in path.open(errors="ignore"):
        m = re.match(r"^([\w_]+):\s*(.*?)\s*$", line)
        if m:
            out[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return out

def load_backlog(project_root: Optional[Path] = None) -> Dict[str, str]:
    """Map story id → description from .roll/backlog.md table rows."""
    path = (project_root or Path()) / ".roll/backlog.md"
    if not path.exists():
        return {}
    out: Dict[str, str] = {}
    pat = re.compile(r"^\|\s*(?:\[)?([A-Z]+-\d+)(?:\]\([^)]+\))?\s*\|\s*([^|]+?)\s*\|")
    with path.open() as f:
        for line in f:
            m = pat.match(line)
            if m:
                out[m.group(1)] = m.group(2)
    return out

# ════════════════════════════════════════════════════════════════════════════
# Cycle aggregation — group events by cycle label; attach cron + story id
# ════════════════════════════════════════════════════════════════════════════
# FIX-108: each segment was [A-Z]+ (letters only), so alphanumeric segments
# like I18N / K8S / D2 / S3 / 2FA failed to match — dashboard silently dropped
# any story id with a mixed-letter-digit segment (US-I18N-001 etc.). First
# char must still be a letter so "001-002" doesn't false-positive as an id.
_STORY_ID_PAT = re.compile(r"\b([A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-\d+)\b")
_PR_NUM_PAT = re.compile(r"/pull/(\d+)")

def _extract_story_id(ev_detail: str) -> Optional[str]:
    if not ev_detail:
        return None
    m = _STORY_ID_PAT.search(ev_detail)
    return m.group(1) if m else None

def _extract_pr_num(url: str) -> Optional[int]:
    if not url:
        return None
    m = _PR_NUM_PAT.search(url)
    return int(m.group(1)) if m else None

def _normalize_pr_outcome(raw: str) -> str:
    """US-VIEW-011: 3-state PR landing tracker.

    Legacy events wrote 'ok' at PR creation; treat as 'open' so old rows
    don't render as an unknown state. New events emit 'open' (PR created),
    'merged' (auto-merge landed), or 'closed' (PR closed without merge).
    """
    if raw in ("merged", "closed", "open"):
        return raw
    return "open"

def normalize_cycle_label(lbl: str) -> str:
    """Strip the 'loop/cycle-' branch-name prefix so pr events bucket with
    their cycle_start/end siblings (Bug A — see plan §3)."""
    if lbl.startswith("loop/cycle-"):
        return lbl[len("loop/cycle-"):]
    return lbl

def aggregate(events: List[Dict[str, Any]], cron: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Build a per-cycle list (newest first), tmp-* filtered."""
    by_label: Dict[str, Dict[str, Any]] = defaultdict(
        lambda: {"start": None, "end": None, "outcome": None, "story": None,
                 "pr": None, "label": None, "fail_detail": None}
    )
    for e in events:
        lbl = normalize_cycle_label(e.get("label", ""))
        if not lbl or lbl.startswith("tmp-"):
            continue
        cy = by_label[lbl]
        cy["label"] = lbl
        stage = e.get("stage", "")
        detail = e.get("detail", "")
        if stage == "cycle_start":
            cy["start"] = e["_ts"]
        elif stage == "cycle_end":
            cy["end"] = e["_ts"]
            cy["outcome"] = e.get("outcome", "done")
        elif stage == "idle":
            # Bug B: cycles that find no Todo emit 'idle' instead of 'cycle_end'.
            # Treat as terminal with a distinct outcome so they stop showing
            # as 'still running' forever.
            cy["end"] = e["_ts"]
            cy["outcome"] = "idle"
        elif stage == "pr":
            cy["pr"] = detail
            cy["pr_ts"] = e["_ts"]  # used to match cron-log lines (inner cycle done)
            # US-VIEW-011: capture PR # and landing outcome. Later pr events
            # win (open → merged/closed finalization in cycle_end path).
            pr_num = _extract_pr_num(detail)
            if pr_num is not None:
                cy["pr_num"] = pr_num
            cy["pr_outcome"] = _normalize_pr_outcome(e.get("outcome", ""))
            sid = _extract_story_id(detail) or _extract_story_id(lbl)
            if sid and not cy.get("story"):
                cy["story"] = sid
        elif stage == "pick_todo":
            sid = _extract_story_id(detail)
            if sid:
                cy["story"] = sid
        elif stage == "agent_used":
            # FIX-119: non-claude agents don't expose model in stream-json.
            # The inner runner emits an agent_used event with the agent name
            # so the dashboard can show it when cy["model"] is None.
            if detail:
                cy["agent"] = detail
        elif stage == "usage":
            # US-LOOP-004: loop-fmt emits this with full token / cost data.
            # Detail is a dict (not the legacy string form).
            # US-VIEW-010: token counts are per-turn deltas — sum across events
            # so list-price cost computed from totals matches actual API usage.
            # Non-additive fields (model, cost_reported_usd, duration_ms) take
            # the last value seen.
            d = e.get("detail") or {}
            if isinstance(d, dict):
                prev = cy.get("usage_event") or {}
                merged = dict(prev)
                merged.update(d)
                for k in ("input_tokens", "output_tokens",
                          "cache_creation_tokens", "cache_read_tokens"):
                    merged[k] = int(prev.get(k) or 0) + int(d.get(k) or 0)
                cy["usage_event"] = merged
        elif stage in ("test", "build") and e.get("outcome") == "fail":
            cy["fail_detail"] = detail or stage

    # Drop incomplete entries; sort newest-first by start time.
    cycles = [v for v in by_label.values() if v["start"]]
    cycles.sort(key=lambda x: x["start"], reverse=True)

    # Match cron-log entries by HH:MM:SS proximity to the inner cycle-done
    # signal (within ±120s). cron.log is overwritten each cycle, so only the
    # most recent cycle gets a cron entry — but it carries the only cost we
    # have. duration_s falls back to (end - start) for every other cycle.
    for cy in cycles:
        anchor = cy.get("pr_ts") or cy.get("end") or cy.get("start")
        target = anchor.hour * 3600 + anchor.minute * 60 + anchor.second
        best = None
        best_dt = 999
        for cr in cron:
            ch, cm = cr["hhmm"].split(":")
            csec = int(ch) * 3600 + int(cm) * 60 + cr["ss"]
            dt = abs(csec - target)
            if dt < best_dt:
                best_dt = dt
                best = cr
        if best and best_dt <= 120:
            cy["cron"] = best

        # Compute duration from event timestamps when cron didn't match.
        if cy.get("end") and cy.get("start"):
            cy["duration_s"] = int((cy["end"] - cy["start"]).total_seconds())
        elif cy.get("cron"):
            cy["duration_s"] = cy["cron"]["duration_s"]

        # Default outcome if missing (e.g. cycle never ended → still running, or crashed).
        if not cy.get("outcome"):
            cy["outcome"] = "running" if not cy.get("end") else "unknown"
    return cycles

def load_claude_session_usage(label: str, slug: str) -> Optional[Dict[str, Any]]:
    """Backfill from claude's own session log when events stream lacks
    token / cost data. Each cycle runs in a worktree whose path Claude maps
    to ~/.claude/projects/-<escaped-worktree-path>/<uuid>.jsonl. Sum tokens
    across all assistant turns; pick model from any; pull total_cost_usd
    from the trailing result event.

    Returns {model, input_tokens, output_tokens, cache_creation_tokens,
             cache_read_tokens, cost_reported_usd, duration_ms} or None."""
    # Worktree path: /Users/seanyao/.shared/roll/worktrees/<slug>-cycle-<label>/
    # Claude project dir mirrors that path with '/' → '-' + leading '-'.
    worktree_path = f"/Users/{os.environ.get('USER', 'seanyao')}/.shared/roll/worktrees/{slug}-cycle-{label}"
    # Claude escapes both '/' and '.' to '-' in the project dir name.
    proj_name = "-" + worktree_path.replace("/", "-").replace(".", "-").lstrip("-")
    proj_dir = Path.home() / ".claude" / "projects" / proj_name
    if not proj_dir.exists():
        return None
    # Take the largest .jsonl in that dir (one cycle = one session).
    jsonls = sorted(proj_dir.glob("*.jsonl"), key=lambda p: p.stat().st_size, reverse=True)
    if not jsonls:
        return None
    path = jsonls[0]

    sums = {"input_tokens": 0, "output_tokens": 0,
            "cache_creation_tokens": 0, "cache_read_tokens": 0}
    model = None
    cost = None
    duration_ms = None
    with path.open(errors="ignore") as f:
        for line in f:
            try:
                e = json.loads(line)
            except Exception:
                continue
            # result event has total_cost_usd + duration_ms
            if e.get("type") == "result":
                cost = e.get("total_cost_usd") or cost
                duration_ms = e.get("duration_ms") or duration_ms
                continue
            # assistant turns carry per-message usage
            msg = e.get("message") or {}
            usage = msg.get("usage") or {}
            if not usage:
                continue
            if msg.get("model") and not model:
                model = msg["model"]
            sums["input_tokens"]          += int(usage.get("input_tokens") or 0)
            sums["output_tokens"]         += int(usage.get("output_tokens") or 0)
            sums["cache_creation_tokens"] += int(usage.get("cache_creation_input_tokens") or 0)
            sums["cache_read_tokens"]     += int(usage.get("cache_read_input_tokens") or 0)
    if sums["input_tokens"] == 0 and sums["output_tokens"] == 0:
        return None
    return {"model": model, **sums,
            "cost_reported_usd": cost, "duration_ms": duration_ms}

def backfill_usage_from_claude_sessions(cycles: List[Dict[str, Any]], slug: str) -> None:
    """Populate cy['input_tokens'], cy['output_tokens'], cy['cost_list'],
    cy['model']. Two paths:
      1. usage_event from events stream (US-LOOP-004 writer side) — authoritative
      2. claude session JSONL backfill — for cycles that ran before the
         writer existed, or on machines where events.ndjson got truncated

    US-VIEW-012: dashboard exposes input + output only (the model's actual
    work). cache_creation / cache_read remain in the usage_event for
    compute_list_cost — they're still part of true API cost — but no longer
    surface in the UI where they previously inflated visible token totals.
    """
    import importlib.util
    spec = importlib.util.spec_from_file_location("model_prices",
                                                   os.path.join(_LIB_DIR, "model_prices.py"))
    mp = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mp)
    for cy in cycles:
        # Path 1: usage event written by loop-fmt at result time.
        ue = cy.get("usage_event")
        if isinstance(ue, dict) and (ue.get("input_tokens") or ue.get("output_tokens")):
            cy["input_tokens"]          = int(ue.get("input_tokens")          or 0)
            cy["output_tokens"]         = int(ue.get("output_tokens")         or 0)
            cy["cache_creation_tokens"] = int(ue.get("cache_creation_tokens") or 0)
            cy["cache_read_tokens"]     = int(ue.get("cache_read_tokens")     or 0)
            cy["model"] = ue.get("model")
            # US-VIEW-014: prefer the cost frozen at cycle_end so a later
            # prices refresh never rewrites a historical cycle's cost. Only
            # legacy events (pre-US-VIEW-014) fall back to recomputing — and
            # the row gets a muted [legacy] tag so it can't be mistaken for
            # the authoritative value.
            persisted = ue.get("cost_list_usd")
            if persisted is not None:
                cy["cost_list"]        = float(persisted)
                cy["cost_currency"]    = ue.get("cost_currency") or "USD"
                cy["cost_list_legacy"] = False
            else:
                cy["cost_list"] = mp.compute_list_cost(
                    ue.get("model"),
                    input_tokens=ue.get("input_tokens", 0),
                    output_tokens=ue.get("output_tokens", 0),
                    cache_creation_tokens=ue.get("cache_creation_tokens", 0),
                    cache_read_tokens=ue.get("cache_read_tokens", 0),
                )
                cy["cost_currency"]    = mp.currency_for(ue.get("model")) or "USD"
                cy["cost_list_legacy"] = True
            if ue.get("duration_ms") and not cy.get("duration_s"):
                cy["duration_s"] = int(ue["duration_ms"] / 1000)
            continue
        # Path 2: salvage from claude's own session log.
        if cy.get("input_tokens") or cy.get("output_tokens"):
            continue
        u = load_claude_session_usage(cy.get("label", ""), slug)
        if not u:
            continue
        cy["input_tokens"]          = int(u.get("input_tokens")          or 0)
        cy["output_tokens"]         = int(u.get("output_tokens")         or 0)
        cy["cache_creation_tokens"] = int(u.get("cache_creation_tokens") or 0)
        cy["cache_read_tokens"]     = int(u.get("cache_read_tokens")     or 0)
        cy["model"] = u["model"]
        cy["cost_list"] = mp.compute_list_cost(
            u["model"],
            input_tokens=u["input_tokens"],
            output_tokens=u["output_tokens"],
            cache_creation_tokens=u["cache_creation_tokens"],
            cache_read_tokens=u["cache_read_tokens"],
        )
        cy["cost_currency"]    = mp.currency_for(u["model"]) or "USD"
        # US-VIEW-014: session salvage never has a frozen cycle_end cost, so
        # this path is always legacy.
        cy["cost_list_legacy"] = True
        if u.get("duration_ms") and not cy.get("duration_s"):
            cy["duration_s"] = int(u["duration_ms"] / 1000)

def load_pr_merges_from_git(days: int) -> Dict[str, Dict[str, Any]]:
    """Repair fallback: when events.ndjson dropped the pr / cycle_end events
    for a cycle (events writer regressions, or cycle_end fired before PR
    merged), git log still has the merge commit. Two known subject formats:

      - Branch-named (Merge commit / older squash): "Merge pull request #N
        from seanyao/loop/cycle-LABEL" — the branch name carries the label.
      - Squash with default-title (newer GitHub UI / `gh pr merge --squash`):
        "loop cycle LABEL (#N)" — space-separated, no slash.

    FIX-107: the old --grep="loop/cycle-" + label_re missed the squash
    subject entirely, so PRs merged AFTER cycle_end never got their
    pr_outcome promoted to 'merged' on the dashboard.
    """
    try:
        out = subprocess.check_output(
            ["git", "log", f"--since={days + 1} days ago",
             "--grep=loop[ /]cycle", "--extended-regexp",
             "--format=%H|||%s|||%b<<<END>>>"],
            text=True, errors="ignore"
        )
    except Exception:
        return {}
    result: Dict[str, Dict[str, Any]] = {}
    # Accept both `loop/cycle-LABEL` and `loop cycle LABEL` (with or without
    # the leading `-` separator after `cycle`). LABEL = YYYYMMDD-HHMMSS-PID.
    label_re  = re.compile(r"loop[ /]cycle[-\s](\d{8}-\d+-\d+)")
    pr_re     = re.compile(r"#(\d+)")
    story_re  = re.compile(r"\b([A-Z]+(?:-[A-Z]+)*-\d+)\b")
    for chunk in out.split("<<<END>>>"):
        chunk = chunk.strip()
        if not chunk:
            continue
        try:
            _, subj, body = chunk.split("|||", 2)
        except ValueError:
            continue
        text = f"{subj}\n{body}"
        m = label_re.search(text)
        if not m:
            continue
        label = m.group(1)
        pr_m = pr_re.search(subj)
        stories = []
        for s in story_re.findall(text):
            if s not in stories:
                stories.append(s)
        result[label] = {"pr": pr_m.group(1) if pr_m else None, "stories": stories}
    return result

def repair_orphan_cycles_from_git(cycles: List[Dict[str, Any]], git_merges: Dict[str, Dict[str, Any]]) -> None:
    """Salvage data from git merges: for any cycle whose branch was merged,
    promote 'running'/'unknown' outcomes to 'done' and back-fill the
    built[] story list when events + runs.jsonl came up empty."""
    for cy in cycles:
        m = git_merges.get(cy.get("label", ""))
        if not m:
            continue
        if cy.get("outcome") in ("running", "unknown"):
            cy["outcome"] = "done"
        if m["pr"] and not cy.get("pr"):
            cy["pr"] = f"https://github.com/seanyao/roll/pull/{m['pr']}"
        # US-VIEW-011: a merge commit in git proves the PR landed.
        # Promote pr_outcome to 'merged' even when no terminal pr event
        # was emitted (older cycles, missed runs, events truncation).
        if m["pr"]:
            cy["pr_num"] = int(m["pr"])
            cy["pr_outcome"] = "merged"
        # Fill stories when our existing sources didn't carry them. Filter
        # to ones that actually appear in BACKLOG so we don't pull in stray
        # tokens from the merge body (PR numbers, file paths, etc.).
        if m["stories"] and not cy.get("built"):
            cy["built"] = m["stories"]
            cy["story"] = m["stories"][0]

def load_runs(slug: str) -> Dict[str, Dict[str, Any]]:
    """Map run_id → run row for the current project (filters out other slugs
    sharing ~/.shared/roll/loop/runs.jsonl). Lenient slug matching salvages
    entries written under buggy slugs (FIX-053): the bare project basename
    (e.g. 'Roll') or worktree paths (e.g. '{slug}-cycle-XXX')."""
    path = shared_root() / "loop" / "runs.jsonl"
    if not path.exists():
        return {}
    base = slug.split("-")[0]  # 'Roll-a43d1b' → 'Roll'
    out: Dict[str, Dict[str, Any]] = {}
    with path.open(errors="ignore") as f:
        for line in f:
            try:
                r = json.loads(line)
            except Exception:
                continue
            p = r.get("project", "")
            if p != slug and p != base and not p.startswith(f"{slug}-cycle-"):
                continue
            rid = r.get("run_id", "")
            if rid:
                out[rid] = r
    return out

def merge_runs_into_cycles(cycles: List[Dict[str, Any]], runs: Dict[str, Dict[str, Any]]) -> None:
    """Attach tcr_count + built stories from runs.jsonl onto matching cycles.

    The runs.jsonl `run_id` field has inconsistent time format across writer
    versions (sometimes UTC, sometimes Beijing local, sometimes with PID
    suffix), so string matching is unreliable. Match by `ts` proximity
    instead: each cycle gets the closest run whose ts is between this
    cycle's start and the next-newer cycle's start (i.e. the run wrote out
    before the next cycle began). Each run consumed exactly once."""
    # Parse run timestamps once.
    runs_list = []
    for rid, r in runs.items():
        try:
            ts = datetime.fromisoformat(r["ts"].replace("Z", "+00:00"))
            runs_list.append((ts, rid, r))
        except Exception:
            continue
    runs_list.sort(key=lambda x: x[0])
    consumed = set()

    # Cycles arrive newest-first; pair each with the next-older to bound
    # the matching window (so a cycle's run doesn't steal the next idle's).
    for i, cy in enumerate(cycles):
        start = cy["start"]
        # next newer cycle in real time = the cycle just above us in list
        next_start = cycles[i - 1]["start"] if i > 0 else start + timedelta(hours=2)
        # If there's a cycle_end, also clamp to end + 30min as upper bound.
        if cy.get("end"):
            clamp = cy["end"] + timedelta(minutes=30)
            window_end = min(next_start, clamp)
        else:
            window_end = next_start
        best = None
        for ts, rid, r in runs_list:
            if rid in consumed:
                continue
            if ts < start:
                continue
            if ts >= window_end:
                break
            if best is None or ts < best[0]:
                best = (ts, rid, r)
        if not best:
            continue
        ts, rid, r = best
        consumed.add(rid)
        cy["tcr_count"] = r.get("tcr_count", 0)
        cy["built"] = r.get("built", []) or []
        # Duration: cap runs.jsonl's reported duration_sec by (runs_ts -
        # cycle_start) since the field has been seen with garbage values.
        if r.get("duration_sec"):
            cap = int((ts - start).total_seconds())
            cy["duration_s"] = min(r["duration_sec"], cap) if cap > 0 else r["duration_sec"]
        # Outcome: runs.jsonl wins when events stream was vacuous.
        if cy.get("outcome") in ("unknown", "running") and r.get("status"):
            cy["outcome"] = {"built": "done", "interrupted": "fail"}.get(r["status"], r["status"])
        if not cy.get("story") and r["built"]:
            cy["story"] = r["built"][0]

# ════════════════════════════════════════════════════════════════════════════
# Rollup math — by day buckets in LOCAL time
# ════════════════════════════════════════════════════════════════════════════
def bucket_by_day(cycles: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    out: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for cy in cycles:
        day = cy["start"].astimezone().strftime("%Y-%m-%d")
        out[day].append(cy)
    return out

def rollup_for_story(cycles: List[Dict[str, Any]], story_id: str) -> Dict[str, Any]:
    """US-LOOP-024: aggregate cycles belonging to a single story.

    Case-insensitive match on cy["story"]. Sums duration / tokens / cost,
    splits outcomes into ✓ (done|idle) / ✗ (fail) / ⏵ (running), collects
    PR landings, captures the model from the first matching cycle.
    """
    sid_lower = (story_id or "").lower()
    matched = [cy for cy in cycles if (cy.get("story") or "").lower() == sid_lower]
    r: Dict[str, Any] = {
        "story_id": story_id,
        "cycles": matched,
        "count": len(matched),
        "ok_count": 0, "fail_count": 0, "running_count": 0,
        "span_start": None, "span_end": None,
        "duration_s": 0, "cost": 0.0,
        "input_tokens": 0, "output_tokens": 0,
        "cache_creation_tokens": 0, "cache_read_tokens": 0,
        "prs": [], "model": None,
    }
    for cy in matched:
        outcome = cy.get("outcome") or ""
        if outcome == "fail":
            r["fail_count"] += 1
        elif outcome == "running":
            r["running_count"] += 1
        else:
            r["ok_count"] += 1
        if cy.get("start"):
            if r["span_start"] is None or cy["start"] < r["span_start"]:
                r["span_start"] = cy["start"]
        if cy.get("end"):
            if r["span_end"] is None or cy["end"] > r["span_end"]:
                r["span_end"] = cy["end"]
        if cy.get("duration_s"):
            r["duration_s"] += cy["duration_s"]
        for tk in ("input_tokens", "output_tokens",
                   "cache_creation_tokens", "cache_read_tokens"):
            if cy.get(tk):
                r[tk] += cy[tk]
        if cy.get("cost_list") is not None:
            r["cost"] += cy["cost_list"]
        elif cy.get("cron"):
            r["cost"] += cy["cron"]["cost"]
        if cy.get("pr_num"):
            r["prs"].append({"num": cy["pr_num"],
                             "outcome": cy.get("pr_outcome") or "open"})
        if cy.get("model") and not r["model"]:
            r["model"] = cy["model"]
    return r


# US-SKILL-014: aggregate the last N self-score notes for the dashboard.
# Reads .roll/notes/*.md (frontmatter format from US-SKILL-010), returns
#   "self-score: mean 7.8 / min 4 / redo 2 (last 14)"
# or "" when no notes / "self-score: (n/a) — N sample(s), need 3 (last N)"
# when sample is too small.
def _self_score_summary_line(notes_dir = None, window: int = 14) -> str:
    notes_dir = notes_dir if notes_dir is not None else Path(".roll/notes")
    if not notes_dir.exists():
        return ""
    files = sorted(notes_dir.glob("*.md"))[-window:]
    if not files:
        return ""
    total = 0
    count = 0
    minv = 11
    redo = 0
    for f in files:
        score = None
        verdict = None
        for line in f.read_text(errors="ignore").splitlines():
            if line.startswith("score: "):
                try:
                    score = int(line.split(": ", 1)[1].strip())
                except ValueError:
                    score = None
            elif line.startswith("verdict: "):
                verdict = line.split(": ", 1)[1].strip()
            if score is not None and verdict is not None:
                break
        if score is None:
            continue
        count += 1
        total += score
        if score < minv:
            minv = score
        if verdict == "regression":
            redo += 1
        elif verdict == "ok" and score < 6:
            redo += 1
    if count < 3:
        return f"self-score: (n/a) — {count} sample(s), need 3 (last {window})"
    mean = total / count
    return f"self-score: mean {mean:.1f} / min {minv} / redo {redo} (last {window})"


# US-AGENT-010: per-agent hit-rate summary for the ROLLUP block.
# Aggregates the last `window_cycles` runs.jsonl records grouped by `agent`.
# Returns a single-line string like
#     "agents: pi 8/22 (36%) · deepseek 5/8 (63%) · claude 2/2 (n/a)"
# Empty agents / missing agent field are skipped. Sample < min_sample renders
# as "(n/a)" instead of a percentage to avoid noise from tiny windows.
def _agent_summary_line(records: List[Dict[str, Any]], window_cycles: int = 50,
                       min_sample: int = 5) -> str:
    if not records or window_cycles <= 0:
        return ""
    # Take the most recent `window_cycles` records that have an agent field.
    tail: List[Dict[str, Any]] = []
    for rec in records[-window_cycles:]:
        agent = (rec or {}).get("agent") or ""
        if not agent:
            continue
        tail.append(rec)
    if not tail:
        return ""
    counts: Dict[str, List[int]] = {}
    # preserve first-seen order for stable output
    order: List[str] = []
    for rec in tail:
        agent = rec.get("agent") or ""
        if not agent:
            continue
        if agent not in counts:
            counts[agent] = [0, 0]
            order.append(agent)
        counts[agent][1] += 1
        if rec.get("status") == "built":
            counts[agent][0] += 1
    if not order:
        return ""
    parts: List[str] = []
    for agent in order:
        built, total = counts[agent]
        if total < min_sample:
            parts.append(f"{agent} {built}/{total} (n/a)")
        else:
            pct = round(100 * built / total) if total else 0
            parts.append(f"{agent} {built}/{total} ({pct}%)")
    return "agents: " + " · ".join(parts)


def rollup_for_day(day_cycles: List[Dict[str, Any]]) -> Dict[str, Any]:
    # US-VIEW-012: track input + output separately so the daily summary can
    # show two metric rows. cache_read tokens deliberately excluded — they're
    # already captured in cy["cost_list"] via list-price math (compute_list_cost
    # reads all 4 fields), but they don't represent the model's actual work.
    # FIX-126: cost is tracked per-currency. deepseek bills in native CNY (¥),
    # claude in USD ($) — summing them into one number (and stamping it "$")
    # is meaningless. `cost` stays as a legacy scalar sum for back-compat with
    # callers that don't care about currency; `cost_by_cur` is the currency-
    # aware breakdown the dashboard ROLLUP renders (one row per currency).
    r = {"cycles": len(day_cycles), "prs": 0, "failed": 0,
         "duration_s": 0, "cost": 0.0, "cost_by_cur": {},
         "input_tokens": 0, "output_tokens": 0,
         "cache_creation_tokens": 0, "cache_read_tokens": 0}
    for cy in day_cycles:
        if cy.get("outcome") == "fail":
            r["failed"] += 1
        if cy.get("duration_s"):
            r["duration_s"] += cy["duration_s"]
        if cy.get("input_tokens"):
            r["input_tokens"] += cy["input_tokens"]
        if cy.get("output_tokens"):
            r["output_tokens"] += cy["output_tokens"]
        if cy.get("cache_creation_tokens"):
            r["cache_creation_tokens"] += cy["cache_creation_tokens"]
        if cy.get("cache_read_tokens"):
            r["cache_read_tokens"] += cy["cache_read_tokens"]
        # US-VIEW-011: rollup only counts cycles whose PR actually merged.
        # Backward compat: rows where pr_outcome is missing but pr URL exists
        # (no `pr` event after the writer upgrade ran for that cycle) are
        # treated conservatively as open — they shouldn't inflate merged count.
        if cy.get("pr_outcome") == "merged":
            r["prs"] += 1
        if cy.get("cost_list") is not None:
            r["cost"] += cy["cost_list"]
            cur = cy.get("cost_currency") or "USD"
            r["cost_by_cur"][cur] = r["cost_by_cur"].get(cur, 0.0) + cy["cost_list"]
        elif cy.get("cron"):
            # No claude session backfill available — fall back to whatever
            # cron.log carries (best-effort, only the latest cycle). cron.log
            # cost is claude's USD figure.
            r["cost"] += cy["cron"]["cost"]
            r["cost_by_cur"]["USD"] = r["cost_by_cur"].get("USD", 0.0) + cy["cron"]["cost"]
    return r

# ════════════════════════════════════════════════════════════════════════════
# Render
# ════════════════════════════════════════════════════════════════════════════
def render(events, cron, state, backlog, *, days=3, lang="both", now=None,
           runs=None, git_merges=None, claude_slug=None):
    now = now or datetime.now(timezone.utc).astimezone()
    cycles = aggregate(events, cron)
    if runs:
        merge_runs_into_cycles(cycles, runs)
    if git_merges:
        repair_orphan_cycles_from_git(cycles, git_merges)
    # Path 1 (usage_event from the events stream) is authoritative and needs no
    # slug; path 2 (claude session-log salvage) self-guards on the worktree dir
    # existing, so it's a no-op when claude_slug is empty. Always run both — the
    # old `if claude_slug:` gate dropped real per-currency cost for any caller
    # that didn't pass a slug (FIX-126).
    backfill_usage_from_claude_sessions(cycles, claude_slug or "")
    by_day = bucket_by_day(cycles)
    days_keys = sorted(by_day.keys(), reverse=True)[:days]

    def bilingual(en_line, zh_line):
        """Emit EN row then ZH row, honoring --en / --zh."""
        if lang in ("both", "en"):
            print(en_line)
        if lang in ("both", "zh") and zh_line is not None:
            print(zh_line)

    # ── Title row ───────────────────────────────────────────────────────────
    n_cycles = len(cycles)
    title_l = c("fg", "roll loop", bold=True) + c("muted", "  ·  ") + c("dim", "health")
    title_r = c("dim", now.strftime("%Y-%m-%d %H:%M")) + c("muted", " · ") + c("muted", f"{n_cycles} cycles / {days*24}h")
    print(row(title_l, title_r))
    print()

    # ── Status eyebrow ─────────────────────────────────────────────────────
    status_word = (state.get("status") or "idle").lower()
    if status_word == "running":
        item = state.get("current_item") or "—"
        eb_l = (c("purple", "⏵", bold=True) + " " +
                c("purple", "RUNNING", bold=True) + c("muted", "   ") +
                c("dim", "story ") + c("blue", item, bold=True))
        eb_zh = (c("dim", "  正在运行 · 当前 ") + c("blue", item))
    elif status_word == "paused":
        eb_l = (c("amber", "⏸ PAUSED", bold=True) + c("muted", "   ") +
                c("dim", "since ") + c("fg", state.get("paused_at", "—")) +
                c("muted", " · ") + c("dim", state.get("paused_reason", "")))
        eb_zh = c("dim", "  已暂停 · run: roll loop resume")
    else:
        # FIX-095: surface three-state install/enable status. Pre-FIX, every
        # case fell through to '● IDLE' which hid 'not installed' and
        # 'installed/off' from the user.
        install_state = _detect_install_state()
        if install_state == "not-installed":
            eb_l = (c("muted", "○ not installed", bold=True) + c("muted", "   ") +
                    c("dim", "run ") + c("fg", "roll loop on", bold=True) +
                    c("dim", " to enable"))
            eb_zh = c("dim", "  未安装 · 运行 ") + c("fg", "roll loop on") + c("dim", " 启用")
        elif install_state in ("stale", "disabled"):
            # FIX-098: 'stale' = plist on disk but agent not registered in launchd.
            # 'disabled' kept for back-compat (old install_state values). Both mean
            # the user needs to run 'roll loop on' to bootstrap the agent.
            eb_l = (c("amber", "◌ STALE — plist present, not loaded", bold=True) + c("muted", "   ") +
                    c("dim", "run ") + c("fg", "roll loop on", bold=True) + c("dim", " to repair"))
            eb_zh = c("dim", "  Plist 存在但未加载 · 运行 ") + c("fg", "roll loop on") + c("dim", " 修复")
        else:
            eb_l = (c("blue", "● IDLE", bold=True) + c("muted", " · ") +
                    c("dim", "enabled · next run ") + c("fg", _next_cron_hint(state), bold=True))
            eb_zh = c("dim", f"  已启用 · 闲置 · 距下一轮 {_next_cron_hint(state, zh=True)}")

    # 'last' = the most recent cycle the user can act on — skip cycles that
    # are still running (the running banner already announces those) and skip
    # idle cycles (they picked no story, so 'last · 23:48 —' carries no info).
    last = next(
        (cy for cy in cycles if cy.get("outcome") not in ("running", "idle")),
        None,
    ) or (cycles[0] if cycles else None)
    if last:
        story = last.get("story") or "—"
        title = backlog.get(story, "") if story != "—" else ""
        glyph_c, glyph_ch = {
            "done":    ("green",  "✓"),
            "ok":      ("green",  "✓"),
            "idle":    ("muted",  "·"),
            "fail":    ("red",    "✗"),
            "running": ("purple", "⏵"),
        }.get(last["outcome"], ("muted", "·"))
        glyph = c(glyph_c, glyph_ch, bold=True)
        eb_r = (c("dim", "last ") + glyph + " " +
                c("fg", last["start"].astimezone().strftime("%H:%M")) + "  " +
                c("blue", story, bold=True) + "  " +
                c("fg", trunc(title, 32)))
    else:
        eb_r = c("muted", "no cycles yet")
    print(row(eb_l, eb_r))
    if lang != "en" and last:
        # ZH eyebrow row is left-aligned only — mirroring the EN right side
        # would duplicate signal without adding info.
        print(eb_zh)
    print()

    print(c("faint", "─" * COLS))
    print()

    # ── 3-day rollup ────────────────────────────────────────────────────────
    section_head("ROLLUP", "近 " + str(days) + " 天", "↑ today vs yesterday · 今日 vs 昨日")
    print()

    # Bug C: today_key is derived from `now` (real today in local TZ), not
    # from sorted(by_day)[0]. If today has 0 cycles, the Today column shows 0
    # and yesterday's data stays under Yesterday — matching the day-band below.
    today_key = now.strftime("%Y-%m-%d")
    yest_key  = (now - timedelta(days=1)).strftime("%Y-%m-%d")
    d2_key    = (now - timedelta(days=2)).strftime("%Y-%m-%d")

    today = rollup_for_day(by_day.get(today_key, []))
    yest  = rollup_for_day(by_day.get(yest_key, []))
    d2    = rollup_for_day(by_day.get(d2_key, []))

    # 'partial' = today is still in progress — today's cycle count is under
    # yesterday's, so a 'down −23' delta against yesterday's full-day count
    # would otherwise read as a regression. Mute delta colors when partial;
    # 'failed' stays loud because a fail is a real alert regardless.
    is_partial = today["cycles"] < yest["cycles"]

    # column headers — 'trend' hint removed (we don't emit a trend column).
    # 'in progress' indicator stays on the day band + muted deltas, not the
    # column header (cramming '(in progress)' into 18 chars collides with
    # the Yesterday column).
    # Today column spans 22 cols = value(8) + gap(2) + delta(12), matching
    # the metric row geometry exactly so Yesterday and −2d line up under
    # their data — fixes the "yesterday/−2d squished" misalignment.
    hdr_en = ("  " + c("muted", pad("", 14)) +
              c("fg", pad("Today", 22), bold=True) +
              c("dim", pad("Yesterday", 10)) +
              c("muted", pad("−2d", 8)))
    hdr_zh = ("  " + c("muted", pad("", 14)) +
              c("dim", pad("今日", 22)) +
              c("muted", pad("昨日", 10)) +
              c("muted", pad("前天", 8)))
    bilingual(hdr_en, hdr_zh)

    metric("cycles",     today["cycles"],     yest["cycles"],     d2["cycles"],     "up_good", partial=is_partial)
    metric("merged PRs", today["prs"],        yest["prs"],        d2["prs"],        "up_good", partial=is_partial)
    # Failures stay loud — do NOT pass partial=True. A regression today is
    # a real alert even when comparing to a full yesterday.
    metric("failed",     today["failed"],     yest["failed"],     d2["failed"],     "up_bad",
           yest_color="amber" if yest["failed"] > 0 else "dim",
           yest_suffix="⚠" if yest["failed"] > 0 else "")
    metric_dur("duration", today["duration_s"], yest["duration_s"], d2["duration_s"], partial=is_partial)
    # US-VIEW-017: show all 4 token components so the cost is explainable.
    # cache_creation (↑) and cache_read (↓) typically account for 80-90% of
    # cost — hiding them makes the cost line incomprehensible.
    metric_tokens("input tokens",  today["input_tokens"],  yest["input_tokens"],  d2["input_tokens"],  partial=is_partial)
    metric_tokens("cache writes",  today["cache_creation_tokens"], yest["cache_creation_tokens"], d2["cache_creation_tokens"], partial=is_partial)
    metric_tokens("cache reads",   today["cache_read_tokens"],     yest["cache_read_tokens"],     d2["cache_read_tokens"],     partial=is_partial)
    metric_tokens("output tokens", today["output_tokens"], yest["output_tokens"], d2["output_tokens"], partial=is_partial)
    # FIX-126: one cost row per currency (deepseek ¥, claude $) — never summed
    # across currencies. Show a currency only if it has spend in any of the 3
    # days; default to a single USD row when there's no cost at all.
    _cost_days = (today, yest, d2)
    _currencies = []
    for _cur in ["USD", "CNY"]:
        if any(r["cost_by_cur"].get(_cur) for r in _cost_days):
            _currencies.append(_cur)
    for r in _cost_days:
        for _cur in r["cost_by_cur"]:
            if _cur not in _currencies and r["cost_by_cur"][_cur]:
                _currencies.append(_cur)
    if not _currencies:
        _currencies = ["USD"]
    for _cur in _currencies:
        _sym = "¥" if _cur == "CNY" else "$"
        _label = "cost" if len(_currencies) == 1 else "cost " + _sym
        metric_dollar(_label,
                      today["cost_by_cur"].get(_cur, 0.0),
                      yest["cost_by_cur"].get(_cur, 0.0),
                      d2["cost_by_cur"].get(_cur, 0.0),
                      partial=is_partial, symbol=_sym)

    # US-AGENT-010: per-agent hit-rate summary (single line).
    try:
        runs_records = list(runs.values()) if isinstance(runs, dict) else list(runs or [])
        runs_records.sort(key=lambda r: (r or {}).get("ts", ""))
        _agent_line = _agent_summary_line(runs_records, window_cycles=50)
    except Exception:
        _agent_line = ""
    if _agent_line:
        print("  " + c("dim", _agent_line))

    # US-SKILL-014: per-skill self-score trend (single line) under the agent line.
    try:
        _skill_line = _self_score_summary_line()
    except Exception:
        _skill_line = ""
    if _skill_line:
        print("  " + c("dim", _skill_line))

    print()
    print(c("faint", "─" * COLS))
    print()

    # ── Recent cycles ───────────────────────────────────────────────────────
    section_head("RECENT", f"最近 {len(cycles)} 个 cycle",
                 "t · time   Δ · duration   tok · tokens   $ · cost   id · backlog")
    print()

    if not cycles:
        print("  " + c("dim", "no cycles yet — first run fires on next cron tick"))
        print("  " + c("dim", "尚无 cycle · 等待下一次 cron 触发"))
        return

    for day_key in days_keys:
        day_cycles = by_day[day_key]
        if not day_cycles:
            continue
        day_band(day_key, len(day_cycles),
                 sum(1 for c0 in day_cycles if c0["outcome"] == "fail"),
                 now,
                 in_progress=(day_key == today_key and is_partial))
        for cy in reversed(day_cycles):
            cycle_row(cy, backlog)
        print()

    print(c("faint", "─" * COLS))
    print()
    print("  " +
          c("dim", "drill   ") + c("blue", "roll loop show <cycle>") +
          c("muted", "       ") +
          c("dim", "watch   ") + c("blue", "roll loop --watch") +
          c("muted", "       ") +
          c("dim", "more   ") + c("blue", "roll loop status --days 7"))

# US-LOOP-032: period 1–1440; offset 0–59 (deprecated, kept for backward compat)
def _schedule_valid(period: int, offset: int) -> bool:
    """Validate schedule spec: period 1–1440, offset in [0, 60)."""
    return 1 <= period <= 1440 and 0 <= offset < 60


def _read_schedule_spec(project_root: Optional[Path] = None) -> Tuple[int, int]:
    """US-LOOP-013: read loop schedule spec, mirroring bin/roll's _loop_schedule_spec.

    Returns (period_minutes, offset_minute).
    Priority: .roll/local.yaml → ~/.roll/config.yaml → default (60, hash-derived)
    """
    project_root = (project_root or Path()).resolve()

    # 1. Try project-level .roll/local.yaml
    local_file = project_root / ".roll" / "local.yaml"
    if local_file.exists():
        try:
            text = local_file.read_text(errors="ignore")
            # Parse loop_schedule block: loop_schedule:\n  period_minutes: N\n  offset_minute: N
            period_m = re.search(r'period_minutes:\s*(\d+)', text)
            offset_m = re.search(r'offset_minute:\s*(\d+)', text)
            if period_m and offset_m:
                period = int(period_m.group(1))
                offset = int(offset_m.group(1))
                if _schedule_valid(period, offset):
                    return (period, offset)
        except Exception:
            pass

    # 2. Try global ~/.roll/config.yaml loop_minute (backward compat)
    config_file = Path(os.path.expanduser("~/.roll/config.yaml"))
    if config_file.exists():
        try:
            text = config_file.read_text(errors="ignore")
            m = re.search(r'^loop_minute:\s*(\d+)', text, re.MULTILINE)
            if m:
                offset = int(m.group(1))
                return (60, offset)
        except Exception:
            pass

    # 3. Default: derive offset from project path hash (matches bin/roll)
    h = int(hashlib.md5(str(project_root).encode()).hexdigest()[:2], 16) % 60
    return (60, h)


def _read_plist_loop_minute() -> int:
    """FIX-063: read actual loop Minute from launchd plist (truth source).
    Falls back to 48 only when plist missing/unparseable.
    """
    import re as _re
    slug = project_slug()
    plist = Path(os.path.expanduser("~/Library/LaunchAgents")) / f"com.roll.loop.{slug}.plist"
    if not plist.exists():
        return 48
    try:
        text = plist.read_text(errors="ignore")
    except Exception:
        return 48
    m = _re.search(r"<key>Minute</key>\s*<integer>(\d+)</integer>", text)
    return int(m.group(1)) if m else 48


def _detect_install_state() -> str:
    """FIX-095 / FIX-098: classify the launchd install state of the loop service.

    Returns one of:
      'not-installed' — no plist for com.roll.loop.<slug> in ~/Library/LaunchAgents/
      'stale'         — plist on disk but agent NOT registered in launchd
                        (happens after roll loop off + roll update without roll loop on)
      'enabled'       — plist on disk AND registered in launchd

    FIX-098: switched from `launchctl print-disabled` (disabled-overrides DB) to
    `launchctl print gui/<uid>/<label>` which probes the actual launchd registry.
    The old approach returned false-positive 'enabled' when the disabled-overrides
    DB had no entry for the label (empty = not explicitly disabled, not loaded).
    """
    slug = project_slug()
    label = f"com.roll.loop.{slug}"
    plist = Path(os.path.expanduser("~/Library/LaunchAgents")) / f"{label}.plist"
    if not plist.exists():
        return "not-installed"
    try:
        uid = os.getuid()
        result = subprocess.run(
            ["launchctl", "print", f"gui/{uid}/{label}"],
            capture_output=True, timeout=2,
        )
        if result.returncode == 0:
            return "enabled"
        return "stale"
    except Exception:
        # launchctl missing or timed out — assume stale (safe: user sees STALE
        # banner and is told to run 'roll loop on' to repair).
        return "stale"


def _next_cron_hint(state: Dict[str, str], zh: bool = False) -> str:
    """US-LOOP-013: compute next cron fire time from schedule spec.

    Handles multi-trigger schedules (period < 60) by scanning forward
    from the current hour's offset minute.
    """
    now = datetime.now().astimezone()
    period, offset = _read_schedule_spec()

    # Start at offset minute within the current hour, then advance
    # by 'period' minutes until we find a slot after 'now'.
    nxt = now.replace(minute=offset, second=0, microsecond=0)
    while nxt <= now:
        nxt += timedelta(minutes=period)

    delta = nxt - now
    mins = int(delta.total_seconds() // 60)
    secs = int(delta.total_seconds() % 60)
    if zh:
        return f"{mins} 分 {secs:02d} 秒"
    return nxt.strftime("%H:%M") + f" · in {mins}m {secs:02d}s"

# ════════════════════════════════════════════════════════════════════════════
# Fixture data (test-only; opt in via ROLL_RENDER_FIXTURE=1)
# ════════════════════════════════════════════════════════════════════════════
def _fixture_data():
    now = datetime.now(timezone.utc)
    events, cron = [], []
    cycle_id = 0
    for d in (2, 1, 0):
        day = now - timedelta(days=d)
        n_cycles = [3, 4, 5][2 - d]
        for i in range(n_cycles):
            hour = 0 + i * 5
            start = day.replace(hour=hour, minute=48, second=0, microsecond=0)
            end = start + timedelta(seconds=540 + i * 120)
            label = start.strftime("%Y%m%d-%H%M%S-30585")
            story = ["FIX-048", "US-112", "FIX-047", "REFACT-9", "FIX-040"][i % 5]
            outcome = "fail" if (d == 1 and i == 2) else "done"
            events.extend([
                {"ts": start.isoformat().replace("+00:00", "Z"), "stage": "cycle_start",
                 "label": label, "detail": "", "outcome": "", "_ts": start},
                {"ts": start.isoformat().replace("+00:00", "Z"), "stage": "pick_todo",
                 "label": label, "detail": f"{story} picked", "outcome": "ok",
                 "_ts": start + timedelta(seconds=2)},
                {"ts": end.isoformat().replace("+00:00", "Z"), "stage": "cycle_end",
                 "label": label, "detail": "", "outcome": outcome, "_ts": end},
            ])
            if outcome == "done":
                events.append({"ts": end.isoformat().replace("+00:00", "Z"),
                               "stage": "pr", "label": label,
                               "detail": f"https://github.com/x/y/pull/{50 + cycle_id}",
                               "outcome": "ok", "_ts": end - timedelta(seconds=1)})
            local = end.astimezone()
            cron.append({"hhmm": local.strftime("%H:%M"), "ss": local.second,
                         "outcome": outcome, "tcr": 1 if outcome == "done" else 0,
                         "duration_s": int((end - start).total_seconds()),
                         "cost": 3.20 + i * 0.32})
            cycle_id += 1
    state = {"status": "idle", "last_run_outcome": "success"}
    backlog = {
        "FIX-048":  "Dedupe Todo across cycles",
        "US-112":   "Loop run summary report",
        "FIX-047":  "Cycle log rotation by day",
        "REFACT-9": "Extract stage runner module",
        "FIX-040":  "8/12 tests failed → bail",
    }
    return events, cron, state, backlog

# ════════════════════════════════════════════════════════════════════════════
# CLI
# ════════════════════════════════════════════════════════════════════════════
def main(argv=None):
    p = argparse.ArgumentParser(description="roll loop status — health dashboard")
    p.add_argument("--days", type=int, default=3, help="window in days (default 3)")
    p.add_argument("--no-color", action="store_true", help="strip ANSI (also honors NO_COLOR=1)")
    p.add_argument("--en", action="store_true", help="EN rows only")
    p.add_argument("--zh", action="store_true", help="ZH rows only")
    args = p.parse_args(argv)

    roll_render.USE_COLOR = (not args.no_color
                             and not os.environ.get("NO_COLOR")
                             and (sys.stdout.isatty() or os.environ.get("FORCE_COLOR")))

    lang = "en" if args.en else ("zh" if args.zh else "both")

    use_fixture = bool(os.environ.get("ROLL_RENDER_FIXTURE"))
    if use_fixture:
        events, cron, state, backlog = _fixture_data()
        runs = {}
        git_merges = {}
        slug = None
    else:
        slug = project_slug()
        events     = load_events(slug, args.days)
        cron       = load_cron_log(slug)
        state      = load_state(slug)
        backlog    = load_backlog()
        runs       = load_runs(slug)
        git_merges = load_pr_merges_from_git(args.days)

    render(events, cron, state, backlog, days=args.days, lang=lang,
           runs=runs, git_merges=git_merges,
           claude_slug=slug)

if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass  # piped to `less` etc.
