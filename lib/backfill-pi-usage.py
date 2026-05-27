#!/usr/bin/env python3
"""
backfill-pi-usage — one-time, idempotent recovery of pi/deepseek token+cost
into an existing loop events file.

Why this exists
---------------
Before US-LOOP-026 the loop ran pi via ``pi -p`` (text mode), which prints no
usage. loop-fmt's old passthrough still appended a ``stage=="usage"`` event on
every retry attempt, each with ``model=="pi"`` and null tokens — so a single
cycle accumulated up to ~180 empty usage events. The dashboard SUMS token
fields across same-label usage events; with all-null tokens the SUM was 0
(harmless), but it means every affected cycle shows ``—/—``.

pi persists every session to ``~/.pi/agent/sessions/<enc-cwd>/<ts>_<uuid>.jsonl``
with real per-message usage. This script recovers that, and rewrites the events
file so each affected cycle is left with **exactly one** authoritative usage
event (real tokens, cost frozen in native CNY) — collapsing the N null events to
avoid the dashboard ×N inflation.

Safety / idempotency
--------------------
- Backs up the events file to ``<file>.bak-<UTC>`` first; aborts if backup fails.
- Only touches labels whose usage events are all pi-vendor (``model`` in
  {"pi", "deepseek-v4-pro"}) AND carry null tokens AND match a pi session.
  claude cycles, already-real cycles, and unmatched-null cycles are passed
  through untouched.
- Re-runnable: once a label has a real-token usage event it is no longer a
  candidate, so a second run is a no-op.
- FIX-065 tripwire: refuses to rewrite a production ``~/.shared/roll`` events
  file from a test context (BATS / temp cwd) unless HOME itself is sandboxed.

Usage
-----
    python3 lib/backfill-pi-usage.py --slug roll-ecf079
    python3 lib/backfill-pi-usage.py --events /path/to/events.ndjson --dry-run
"""

import argparse
import importlib.util
import json
import os
import shutil
import sys
from datetime import datetime, timezone

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))

PI_VENDOR_MODELS = ("pi", "deepseek-v4-pro")


def _load_pi_emit():
    spec = importlib.util.spec_from_file_location(
        "pi_emit", os.path.join(_THIS_DIR, "agent_usage", "pi_emit.py")
    )
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _default_events_path(slug, shared=None):
    base = shared or os.environ.get("LOOP_SHARED_ROOT") \
        or os.path.expanduser("~/.shared/roll")
    return os.path.join(base, "loop", "events-%s.ndjson" % slug)


def _is_test_context():
    return bool(os.environ.get("BATS_TEST_FILENAME")) or _cwd_is_temp()


def _cwd_is_temp():
    p = os.environ.get("PWD") or os.getcwd()
    return any(seg in p for seg in ("/tmp/", "/private/tmp/", "/var/folders/", "/tmp."))


def _home_is_sandbox():
    home = os.environ.get("HOME") or ""
    return any(seg in home for seg in ("/tmp/", "/private/tmp/", "/var/folders/", "/tmp."))


def _tripwire(evfile):
    """FIX-065: refuse a prod write from a test context."""
    home = os.environ.get("HOME") or ""
    if not home or _home_is_sandbox():
        return
    prod = os.path.join(home, ".shared", "roll") + os.sep
    if os.path.abspath(evfile).startswith(os.path.abspath(prod)) and _is_test_context():
        raise SystemExit(
            "[FIX-065] refusing to rewrite prod events file from test context: %s" % evfile
        )


def _scan(lines):
    """Parse lines → (events_or_None list, per-label usage summary).

    Returns (parsed, labels) where parsed is a list of (raw_line, obj_or_None)
    preserving order, and labels maps label → {"pi": bool, "real": bool}.
    """
    parsed = []
    labels = {}
    for raw in lines:
        obj = None
        try:
            obj = json.loads(raw)
        except (ValueError, TypeError):
            obj = None
        parsed.append((raw, obj))
        if not obj or obj.get("stage") != "usage":
            continue
        lab = obj.get("label")
        d = obj.get("detail") or {}
        rec = labels.setdefault(lab, {"pi": False, "real": False})
        if d.get("model") in PI_VENDOR_MODELS:
            rec["pi"] = True
        if d.get("input_tokens"):
            rec["real"] = True
    return parsed, labels


def backfill(evfile, slug=None, shared=None, base_dir=None, dry_run=False):
    """Rewrite evfile so each recoverable pi cycle nets one real usage event.

    Returns a stats dict.
    """
    _tripwire(evfile)
    pi_emit = _load_pi_emit()

    with open(evfile) as f:
        lines = f.readlines()

    parsed, labels = _scan(lines)

    # Candidate = pi-vendor, all-null, and a session match yields real usage.
    candidates = [l for l, r in labels.items() if r["pi"] and not r["real"]]
    replacement = {}  # label -> detail payload
    matched, unmatched = [], []
    for lab in candidates:
        cwd = os.path.join(
            (shared or os.environ.get("LOOP_SHARED_ROOT")
             or os.path.expanduser("~/.shared/roll")),
            "worktrees", "%s-cycle-%s" % (slug, lab),
        )
        ev = pi_emit.build_event(cwd=cwd, cycle_id=lab, slug=slug, base_dir=base_dir)
        if ev is None:
            unmatched.append(lab)
            continue
        replacement[lab] = ev["detail"]
        matched.append(lab)

    if dry_run:
        return {
            "candidates": len(candidates),
            "matched": len(matched),
            "unmatched": len(unmatched),
            "matched_labels": sorted(matched),
            "unmatched_labels": sorted(unmatched),
            "written": False,
        }

    # Backup before any write; abort the whole run if backup fails.
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    bak = "%s.bak-%s" % (evfile, stamp)
    shutil.copy2(evfile, bak)

    # Stream rewrite: for an affected label, the FIRST usage line becomes the
    # real event (original ts preserved so it stays in its day bucket), every
    # subsequent same-label usage line is dropped → exactly one per label.
    emitted = set()
    out = []
    for raw, obj in parsed:
        if not obj or obj.get("stage") != "usage":
            out.append(raw)
            continue
        lab = obj.get("label")
        if lab not in replacement:
            out.append(raw)  # claude / already-real / unmatched-null: untouched
            continue
        if lab in emitted:
            continue  # collapse the remaining null duplicates away
        new_ev = {
            "ts": obj.get("ts"),
            "stage": "usage",
            "label": lab,
            "detail": replacement[lab],
            "outcome": "ok",
        }
        out.append(json.dumps(new_ev) + "\n")
        emitted.add(lab)

    tmp = evfile + ".tmp-%s" % stamp
    with open(tmp, "w") as f:
        f.writelines(out)
    os.replace(tmp, evfile)

    return {
        "candidates": len(candidates),
        "matched": len(matched),
        "unmatched": len(unmatched),
        "matched_labels": sorted(matched),
        "unmatched_labels": sorted(unmatched),
        "backup": bak,
        "written": True,
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description="backfill pi/deepseek usage into events file")
    ap.add_argument("--slug", help="project slug (resolves default events path + session cwd)")
    ap.add_argument("--events", help="explicit events file path (overrides --slug default)")
    ap.add_argument("--shared", help="shared root (default ~/.shared/roll)")
    ap.add_argument("--base-dir", help="pi sessions root override (tests)")
    ap.add_argument("--dry-run", action="store_true", help="report only, write nothing")
    args = ap.parse_args(argv)

    evfile = args.events or _default_events_path(args.slug, args.shared)
    if not os.path.isfile(evfile):
        print("[backfill] no events file: %s" % evfile, file=sys.stderr)
        return 1
    if not args.slug:
        # slug is needed to reconstruct session cwd; derive from filename.
        base = os.path.basename(evfile)
        if base.startswith("events-") and base.endswith(".ndjson"):
            args.slug = base[len("events-"):-len(".ndjson")]

    stats = backfill(
        evfile, slug=args.slug, shared=args.shared,
        base_dir=args.base_dir, dry_run=args.dry_run,
    )
    mode = "DRY-RUN" if args.dry_run else "WROTE"
    print("[backfill] %s %s" % (mode, evfile))
    print("  candidates=%d matched=%d unmatched=%d"
          % (stats["candidates"], stats["matched"], stats["unmatched"]))
    if stats.get("backup"):
        print("  backup=%s" % stats["backup"])
    if stats["unmatched_labels"]:
        print("  unmatched (left as null): %s" % ", ".join(stats["unmatched_labels"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
