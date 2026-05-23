#!/usr/bin/env python3
"""FIX-112: revert 🔨 In Progress stories whose latest cycle definitively
failed and has been quiet for a while. Default safe gate is conservative:

- Story row is currently 🔨 In Progress in backlog
- Most recent `pick_todo <story_id>` event in events-<slug>.ndjson lives in
  a cycle whose `cycle_end` outcome is one of: failed | aborted | blocked
- That cycle_end timestamp is at least N hours ago (default 4)

Stories that match are flipped back to 📋 Todo and an ALERT note is appended
to the per-project ALERT file. Stories still actively running, or claimed
by a human / agent for legitimate work (no failed cycle_end), stay alone.

Usage:
  python3 lib/loop_unstick.py            # apply (writes backlog + ALERT)
  python3 lib/loop_unstick.py --dry-run  # report what would change, write nothing
  python3 lib/loop_unstick.py --ttl-hours 8

Returns 0 always (idempotent). Prints one line per reverted story.
"""
from __future__ import annotations
import argparse, json, os, re, sys, time
from datetime import datetime, timezone, timedelta
from pathlib import Path

_LIB_DIR = os.path.dirname(os.path.realpath(__file__))
if _LIB_DIR not in sys.path:
    sys.path.insert(0, _LIB_DIR)

# FIX-108-compatible: accept multi-segment story IDs (US-VIEW-011, US-I18N-001)
# and alphanumeric segments (K8S, D2, 2FA-ish layouts within rules).
ID_RE   = re.compile(r"^\s*\[?([A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-\d+)")
TICK    = chr(96)

def _shared_root() -> Path:
    # bin/roll uses _SHARED_ROOT, lib/roll-home.py uses ROLL_SHARED_ROOT.
    # Honor both so tests that sandbox either name work transparently.
    root = os.environ.get("ROLL_SHARED_ROOT") or os.environ.get("_SHARED_ROOT")
    return Path(root or os.path.expanduser("~/.shared/roll"))

def _project_slug() -> str:
    try:
        import subprocess, hashlib
        path = os.path.realpath(os.getcwd())
        common = subprocess.check_output(
            ["git", "-C", path, "rev-parse", "--git-common-dir"],
            stderr=subprocess.DEVNULL, text=True,
        ).strip()
        if common.endswith("/.git"):
            path = common[:-5]
    except Exception:
        path = os.path.realpath(os.getcwd())
    import hashlib
    base = re.sub(r"[^A-Za-z0-9]+", "-", os.path.basename(path)).strip("-")
    h = hashlib.md5(path.encode()).hexdigest()[:6]
    return f"{base}-{h}"

def _read_events(slug: str) -> list:
    path = _shared_root() / "loop" / f"events-{slug}.ndjson"
    out = []
    if not path.exists():
        return out
    with path.open(errors="ignore") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
                ts = ev.get("ts", "")
                ev["_ts"] = datetime.fromisoformat(ts.replace("Z", "+00:00")) if ts else None
                out.append(ev)
            except Exception:
                continue
    return out

def _scan_in_progress(backlog: Path) -> list:
    """Return list of (line_index, story_id, raw_line) for rows that are 🔨 In Progress."""
    if not backlog.exists():
        return []
    rows = []
    for i, line in enumerate(backlog.open(errors="ignore")):
        if "| 🔨 In Progress |" not in line:
            continue
        if not line.startswith("|"):
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) < 4:
            continue
        m = ID_RE.match(parts[1])
        if not m:
            continue
        rows.append((i, m.group(1), line.rstrip("\n")))
    return rows

def _cycle_end_for_pick(events: list, story_id: str):
    """Return (cycle_end_ts, outcome) of the latest cycle that picked
    story_id, or None if no such cycle / cycle still running."""
    # Walk events back to front looking for the latest pick_todo matching story_id
    latest_pick = None
    for ev in reversed(events):
        if ev.get("stage") == "pick_todo" and ev.get("detail") == story_id:
            latest_pick = ev
            break
    if not latest_pick:
        return None
    label = latest_pick.get("label", "")
    # Look forward (from the pick) for cycle_end with the same label
    pick_idx = events.index(latest_pick)
    for ev in events[pick_idx + 1:]:
        if ev.get("stage") == "cycle_end" and ev.get("label", "").endswith(label):
            return ev.get("_ts"), ev.get("outcome", "")
    return None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--ttl-hours", type=float, default=4.0,
                    help="Minimum hours since failed cycle_end before reverting (default 4)")
    ap.add_argument("--backlog", default=".roll/backlog.md")
    args = ap.parse_args()

    backlog = Path(args.backlog)
    if not backlog.exists():
        print(f"backlog not found: {backlog}", file=sys.stderr)
        return 0

    slug = _project_slug()
    events = _read_events(slug)
    in_progress = _scan_in_progress(backlog)
    if not in_progress:
        return 0

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=args.ttl_hours)
    candidates_to_revert = []

    failed_outcomes = {"failed", "aborted", "blocked"}
    for line_idx, sid, raw in in_progress:
        result = _cycle_end_for_pick(events, sid)
        if not result:
            continue  # still running OR no failed cycle yet — leave alone
        end_ts, outcome = result
        if outcome not in failed_outcomes:
            continue
        if not end_ts or end_ts > cutoff:
            continue  # too recent
        age_hours = (now - end_ts).total_seconds() / 3600
        candidates_to_revert.append((line_idx, sid, raw, outcome, age_hours))

    if not candidates_to_revert:
        return 0

    if args.dry_run:
        for line_idx, sid, raw, outcome, age in candidates_to_revert:
            print(f"would-revert {sid} (cycle ended {outcome} {age:.1f}h ago)")
        return 0

    # Apply: read backlog, flip status, write back.
    lines = backlog.read_text(errors="ignore").splitlines(keepends=True)
    for line_idx, sid, raw, outcome, age in candidates_to_revert:
        lines[line_idx] = lines[line_idx].replace("| 🔨 In Progress |", "| 📋 Todo |")

    backlog.write_text("".join(lines))

    # Append ALERT
    alert_file = _shared_root() / "loop" / f"ALERT-{slug}.md"
    alert_file.parent.mkdir(parents=True, exist_ok=True)
    with alert_file.open("a") as f:
        for line_idx, sid, raw, outcome, age in candidates_to_revert:
            ts = now.strftime("%Y-%m-%dT%H:%M:%SZ")
            f.write(f"[{ts}] unstick: reverted {sid} (cycle ended {outcome} {age:.1f}h ago, > {args.ttl_hours}h TTL)\n")

    for line_idx, sid, raw, outcome, age in candidates_to_revert:
        print(f"reverted {sid} (cycle ended {outcome} {age:.1f}h ago)")

    return 0

if __name__ == "__main__":
    sys.exit(main())
