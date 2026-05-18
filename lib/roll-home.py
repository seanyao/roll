#!/usr/bin/env python3
"""
roll-home — render the `roll` bare-command home dashboard.

One-screen overview: current loop state, three autonomous layers, four
defenses, delivery pipeline, current-focus DoD, and items needing human
attention. Reads all state files per-project (slug = basename-md5_6).

Usage:
  python3 lib/roll-home.py              # live data
  python3 lib/roll-home.py --no-color
  python3 lib/roll-home.py --en | --zh  # collapse bilingual rows
  python3 lib/roll-home.py --demo       # render with fixture data
"""

from __future__ import annotations
import argparse, hashlib, os, re, subprocess, sys, time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

os.environ.setdefault("TZ", "Asia/Shanghai")
time.tzset()

_LIB_DIR = os.path.dirname(os.path.realpath(__file__))
if _LIB_DIR not in sys.path:
    sys.path.insert(0, _LIB_DIR)
import roll_render
from roll_render import COLS, c, row, section_head, strw, pad

# ════════════════════════════════════════════════════════════════════════════
# Paths
# ════════════════════════════════════════════════════════════════════════════
def _project_slug(path: Optional[str] = None) -> str:
    path = os.path.realpath(path or os.getcwd())
    try:
        common = subprocess.check_output(
            ["git", "-C", path, "rev-parse", "--git-common-dir"],
            stderr=subprocess.DEVNULL, text=True,
        ).strip()
        if common.endswith("/.git"):
            path = common[:-5]
    except Exception:
        pass
    base = re.sub(r"[^A-Za-z0-9]+", "-", os.path.basename(path)).strip("-")
    h = hashlib.md5(path.encode()).hexdigest()[:6]
    return f"{base}-{h}"

def _shared_root() -> Path:
    return Path(os.environ.get("ROLL_SHARED_ROOT") or os.path.expanduser("~/.shared/roll"))

def _roll_pkg_dir() -> Path:
    pkg = os.environ.get("ROLL_PKG_DIR")
    return Path(pkg) if pkg else Path(_LIB_DIR).parent

# ════════════════════════════════════════════════════════════════════════════
# Loaders
# ════════════════════════════════════════════════════════════════════════════
def _load_yaml_flat(path: Path) -> Dict[str, str]:
    out: Dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.open(errors="ignore"):
        m = re.match(r"^([\w_]+):\s*(.*?)\s*$", line)
        if m:
            out[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return out

def _load_config() -> Dict[str, str]:
    for p in [
        os.path.expanduser("~/.roll/config.yaml"),
        os.path.join(os.getcwd(), ".roll.yaml"),
    ]:
        d = _load_yaml_flat(Path(p))
        if d:
            return d
    return {}

def _git_info() -> Tuple[str, str]:
    try:
        branch = subprocess.check_output(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            stderr=subprocess.DEVNULL, text=True,
        ).strip()
    except Exception:
        branch = "—"
    try:
        dirty = bool(subprocess.check_output(
            ["git", "status", "--porcelain"],
            stderr=subprocess.DEVNULL, text=True,
        ).strip())
        status = "dirty" if dirty else "✓"
    except Exception:
        status = "—"
    return branch, status

def _roll_version() -> str:
    roll_bin = _roll_pkg_dir() / "bin" / "roll"
    if roll_bin.exists():
        for line in roll_bin.open(errors="ignore"):
            m = re.match(r'^VERSION="([^"]+)"', line)
            if m:
                return m.group(1)
    return "—"

def _launchd_svc_state(service: str, slug: str) -> str:
    label = f"com.roll.{service}.{slug}"
    plist = Path(os.path.expanduser("~/Library/LaunchAgents")) / f"{label}.plist"
    if not plist.exists():
        return "not-installed"
    try:
        out = subprocess.check_output(
            ["launchctl", "list", label], stderr=subprocess.DEVNULL, text=True,
        )
        return "enabled" if out.strip() else "installed-off"
    except Exception:
        return "installed-off"

def _dream_last_hours() -> Optional[int]:
    log = _shared_root() / "dream" / "log.md"
    if not log.exists():
        return None
    try:
        return int((time.time() - log.stat().st_mtime) / 3600)
    except Exception:
        return None

def _peer_last() -> Optional[Tuple[str, int]]:
    peer_dir = _shared_root() / "peer"
    if not peer_dir.exists():
        return None
    logs = sorted(peer_dir.glob("*.log"))
    if not logs:
        return None
    latest = logs[-1]
    try:
        days = int((time.time() - latest.stat().st_mtime) / 86400)
        for line in latest.read_text(errors="ignore").splitlines():
            m = re.search(r"\b(AGREE|REFINE|OBJECT|ESCALATE)\b", line)
            if m:
                return (m.group(1), days)
        return ("—", days)
    except Exception:
        return None

def _backlog_counts() -> Tuple[int, int, int, str, str, str, int]:
    """(ideas, todo, in_progress, id, title, link, refactor_pending)."""
    bl = Path("BACKLOG.md")
    if not bl.exists():
        return (0, 0, 0, "", "", "", 0)
    ideas = todo = in_prog = refactors = 0
    ip_id = ip_title = ip_link = ""
    for line in bl.read_text(errors="ignore").splitlines():
        if "| 📋 Todo |" in line:
            if re.match(r"^\|\s*IDEA-", line):
                ideas += 1
            elif re.match(r"^\| REFACTOR-", line):
                refactors += 1
            else:
                todo += 1
        elif "| 🔨 In Progress |" in line:
            in_prog += 1
            if not ip_id:
                m = re.search(r"(US|FIX|REFACTOR)-[A-Z]*-?\d+", line)
                if m:
                    ip_id = m.group(0)
                parts = [p.strip() for p in line.split("|")]
                if len(parts) >= 4:
                    ip_title = parts[2][:60]
                m2 = re.search(r"docs/features/[^\)]+", line)
                if m2:
                    ip_link = m2.group(0)
    return (ideas, todo, in_prog, ip_id, ip_title, ip_link, refactors)

def _alert_count(slug: str) -> int:
    af = _shared_root() / "loop" / f"ALERT-{slug}.md"
    if not af.exists():
        return 0
    return sum(1 for l in af.read_text(errors="ignore").splitlines() if l.startswith("# ALERT"))

def _proposal_count() -> int:
    p = Path("PROPOSALS.md")
    if not p.exists():
        return 0
    return sum(1 for l in p.read_text(errors="ignore").splitlines() if l.startswith("## PROPOSAL"))

def _release_ready() -> bool:
    briefs_dir = Path("docs/briefs")
    if not briefs_dir.exists():
        return False
    try:
        tag = subprocess.check_output(
            ["git", "describe", "--tags", "--abbrev=0"],
            stderr=subprocess.DEVNULL, text=True,
        ).strip()
        log = subprocess.check_output(
            ["git", "log", f"{tag}..HEAD", "--pretty=format:%s"],
            stderr=subprocess.DEVNULL, text=True,
        )
        if not any(
            l for l in log.splitlines()
            if l and not re.match(r"^(docs|chore)(\([^)]*\))?:", l)
        ):
            return False
        briefs = sorted(briefs_dir.glob("*.md"))
        if not briefs:
            return False
        return bool(re.search(r"✅ 可发版|Release ready", briefs[-1].read_text(errors="ignore")))
    except Exception:
        return False

def _tcr_last_min() -> Optional[int]:
    try:
        ts = subprocess.check_output(
            ["git", "log", "--grep=^tcr:", "-1", "--format=%ct"],
            stderr=subprocess.DEVNULL, text=True,
        ).strip()
        return int((time.time() - int(ts)) / 60) if ts else None
    except Exception:
        return None

def _ac_completion(feature_link: str) -> Tuple[int, int]:
    if not feature_link:
        return (0, 0)
    path_str, _, anchor = feature_link.partition("#")
    if not path_str or not Path(path_str).exists():
        return (0, 0)
    text = Path(path_str).read_text(errors="ignore")
    in_sec = done = total = 0
    for line in text.splitlines():
        if f'id="{anchor}"' in line:
            in_sec = 1
            continue
        if in_sec and re.match(r"^## ", line):
            break
        if in_sec:
            if re.search(r"\[x\]", line, re.IGNORECASE):
                done += 1
                total += 1
            elif "[ ]" in line:
                total += 1
    return (done, total)

# ════════════════════════════════════════════════════════════════════════════
# Demo fixture
# ════════════════════════════════════════════════════════════════════════════
def _demo_data() -> Dict[str, Any]:
    return dict(
        project_name="myapp", version="2026.518.3",
        agent="claude", git_branch="main", git_status="✓",
        timestamp="06:38",
        state={"status": "idle", "current_item": ""},
        loop_state="enabled", loop_minute=38,
        loop_active_start=10, loop_active_end=18,
        dream_state="enabled", dream_hour=3, dream_minute=12,
        dream_last_hours=4, refactor_pending=4,
        peer_last=("AGREE", 1), tcr_last_min=4,
        ideas=2, todo=14, in_progress=1,
        in_prog_id="US-VIEW-002", in_prog_title="roll 裸命令打出一屏总览",
        in_prog_link="", ac_done=0, ac_total=9,
        alerts=0, proposals=0, release_ready=False,
    )

# ════════════════════════════════════════════════════════════════════════════
# Render helpers
# ════════════════════════════════════════════════════════════════════════════
def _hr() -> None:
    print(c("faint", "─" * COLS))

def _svc_badge(state: str, paused: bool = False) -> Tuple[str, str]:
    if paused:
        return (c("amber", "⏸"), c("amber", "paused  "))
    if state == "enabled":
        return (c("green", "●"), c("green", "enabled "))
    if state == "installed-off":
        return (c("amber", "⚠"), c("amber", "off     "))
    return (c("red", "○"), c("red", "missing "))

# ════════════════════════════════════════════════════════════════════════════
# Main renderer
# ════════════════════════════════════════════════════════════════════════════
def render(d: Dict[str, Any]) -> None:
    state = d.get("state", {})
    status = state.get("status", "idle")
    in_prog = d.get("in_progress", 0)
    tcr_min = d.get("tcr_last_min")

    # ── Identity ─────────────────────────────────────────────────────────────
    print()
    left = ("  " + c("fg", "roll", bold=True) + c("muted", " · ") +
            c("yellow", f"Roll v{d['version']}"))
    git_col = "green" if d["git_status"] == "✓" else "amber"
    right = (c("dim", f"agent {d['agent']}") + c("muted", " · ") +
             c(git_col, f"git {d['git_status']}") + c("muted", " · ") +
             c("dim", d["git_branch"]) + c("muted", " · ") +
             c("dim", d["timestamp"]) + "  ")
    print(row(left, right))
    print()

    # ── Eyebrow ──────────────────────────────────────────────────────────────
    if status == "running":
        sid = state.get("current_item", "—")
        print("  " + c("purple", "⏵", bold=True) + " " +
              c("fg", "now working ") + c("blue", sid, bold=True))
    elif status == "paused":
        print("  " + c("amber", "⏸ paused") + c("dim", "  ·  run: ") + c("blue", "roll loop resume"))
    else:
        lm = d.get("loop_minute", 0)
        print("  " + c("muted", "●") + " " + c("dim", f"next :{lm:02d}") + c("muted", "  ·  ") + c("dim", "idle"))
    print()
    _hr()
    print()

    # ── THREE LAYERS ─────────────────────────────────────────────────────────
    section_head("THREE LAYERS", "三层自治", "loop · dream · peer")
    print()

    lbl_w = 8   # "Loop    " / "Dream   " / "Peer    "
    st_w  = 9   # "enabled " / "off     " / "missing "

    # Loop
    dot, word = _svc_badge(d["loop_state"], status == "paused")
    loop_sched = c("dim", f"every :{d['loop_minute']:02d}") + c("muted", "  ") + c("dim", f"{d['loop_active_start']:02d}:00–{d['loop_active_end']:02d}:00")
    if in_prog:
        loop_detail = c("dim", "   now: ") + c("purple", "⏵", bold=True) + " " + c("blue", d.get("in_prog_id", ""))
    elif tcr_min is not None:
        loop_detail = c("dim", f"   last tcr {tcr_min}min ago")
    else:
        loop_detail = ""
    print("  " + dot + " " + c("fg", pad("Loop", lbl_w), bold=True) + word + loop_sched + loop_detail)

    # Dream
    d_dot, d_word = _svc_badge(d["dream_state"])
    dream_sched = c("dim", f"{d['dream_hour']:02d}:{d['dream_minute']:02d}")
    dlh = d.get("dream_last_hours")
    last_scan = c("dim", f"   last scan {dlh}h ago") if dlh is not None else c("dim", "   no scan yet")
    rp = d.get("refactor_pending", 0)
    dream_detail = last_scan + c("muted", " · ") + c("dim", f"{rp} REFACTOR queued")
    print("  " + d_dot + " " + c("fg", pad("Dream", lbl_w), bold=True) + d_word + dream_sched + dream_detail)

    # Peer
    pl = d.get("peer_last")
    if pl:
        res, days = pl
        peer_detail = c("dim", f"   last {res} {days}d ago")
    else:
        peer_detail = c("dim", "   last —")
    print("  " + c("green", "●") + " " + c("fg", pad("Peer", lbl_w), bold=True) +
          c("green", pad("ready   ", st_w)) + c("dim", "on complexity=large") + peer_detail)
    print()
    _hr()
    print()

    # ── FOUR DEFENSES ────────────────────────────────────────────────────────
    section_head("FOUR DEFENSES", "四道防线", "tcr · review · spar · sentinel")
    print()
    tcr_chip = (c("green", "✓ TCR") + c("dim", f" {tcr_min}min")) if tcr_min is not None else c("red", "○ TCR")
    print("  " + tcr_chip +
          "   " + c("green", "● Auto Review") +
          "   " + c("muted", "○ Spar") +
          "   " + c("muted", "○ Sentinel"))
    print()
    _hr()
    print()

    # ── PIPELINE ─────────────────────────────────────────────────────────────
    section_head("PIPELINE", "交付流水线", "idea → backlog → build → verify → release")
    print()
    ideas = d.get("ideas", 0)
    todo = d.get("todo", 0)
    idea_s   = c("blue", str(ideas))  if ideas else c("dim", "0")
    todo_s   = c("blue", str(todo))   if todo  else c("dim", "0")
    build_s  = (c("purple", f"▲{in_prog}", bold=True) + " " + c("muted", "🔨")) if in_prog else c("dim", "0")
    rr = d.get("release_ready", False)
    release_s = c("green", "ready") if rr else c("muted", "—")
    print("  " +
          c("dim", "Ideas ")    + idea_s   + c("muted", "  ▸  ") +
          c("dim", "Backlog ")  + todo_s   + c("muted", "  ▸  ") +
          c("dim", "Build ")    + build_s  + c("muted", "  ▸  ") +
          c("dim", "Verify ")   + c("muted", "—") + c("muted", "  ▸  ") +
          c("dim", "Release ")  + release_s)
    print()
    _hr()
    print()

    # ── CURRENT FOCUS · DoD ──────────────────────────────────────────────────
    if in_prog:
        section_head("CURRENT FOCUS · DoD", "当前焦点", "build > 0")
        print()
        print("  " + c("purple", "🔨", bold=True) + " " +
              c("blue", d.get("in_prog_id", ""), bold=True) +
              c("muted", "  ") + c("dim", d.get("in_prog_title", "")))
        print()
        ac_done  = d.get("ac_done", 0)
        ac_total = d.get("ac_total", 0)
        ac_chip = (c("green", "[✓ AC]") if ac_total > 0 and ac_done == ac_total
                   else c("amber", f"[○ AC {ac_done}/{ac_total}]"))
        tcr_chip2 = c("green", "[✓ TCR]") if tcr_min is not None else c("muted", "[○ TCR]")
        chips = [ac_chip, c("muted", "[○ CI]"), tcr_chip2, c("muted", "[○ Peer]")]
        chips2 = [c("muted", "[○ Coverage]"), c("muted", "[○ Docs]"), c("muted", "[○ Spar]"), c("muted", "[○ Branch]")]
        print("  " + "  ".join(chips))
        print("  " + "  ".join(chips2))
        print()
        _hr()
        print()

    # ── NEED YOU ─────────────────────────────────────────────────────────────
    section_head("NEED YOU", "需要你介入", "alerts · proposals · release")
    print()
    alerts    = d.get("alerts", 0)
    proposals = d.get("proposals", 0)
    if not alerts and not proposals and not rr:
        print("  " + c("green", "✓") + " " + c("dim", "AI 自驱中 — 无需介入"))
    else:
        if alerts:
            print("  " + c("red", "⚠") + " " + c("red", f"{alerts} ALERT", bold=True) +
                  c("dim", "          run: ") + c("blue", "roll alert"))
        if proposals:
            print("  " + c("amber", "▤") + " " + c("amber", f"{proposals} PROPOSAL", bold=True) +
                  c("dim", "      see: ") + c("blue", "PROPOSALS.md"))
        if rr:
            print("  " + c("green", "✓") + " " + c("green", "Release ready", bold=True) +
                  c("dim", "    run: ") + c("blue", "roll release"))
    print()
    _hr()
    print()

    # ── Quick-nav ─────────────────────────────────────────────────────────────
    nav = ["roll loop", "roll backlog", "roll brief", "roll status", "roll peer", "roll --help"]
    print("  " + c("muted", "  ·  ").join(c("blue", cmd) for cmd in nav))
    print()

# ════════════════════════════════════════════════════════════════════════════
# Entry
# ════════════════════════════════════════════════════════════════════════════
def main() -> None:
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("--demo",     action="store_true")
    ap.add_argument("--no-color", dest="no_color", action="store_true")
    ap.add_argument("--en",       action="store_true")
    ap.add_argument("--zh",       action="store_true")
    args, _ = ap.parse_known_args()

    if args.no_color or os.environ.get("NO_COLOR") or not sys.stdout.isatty():
        roll_render.USE_COLOR = False

    if args.demo:
        d = _demo_data()
    else:
        slug    = _project_slug()
        config  = _load_config()
        state   = _load_yaml_flat(_shared_root() / "loop" / f"state-{slug}.yaml")
        bra, gs = _git_info()
        ideas, todo, in_prog, ip_id, ip_title, ip_link, refactor_pending = _backlog_counts()
        ac_done, ac_total = _ac_completion(ip_link) if in_prog else (0, 0)

        def _ci(k: str, default: int) -> int:
            try:
                return int(config.get(k) or default)
            except Exception:
                return default

        d = dict(
            project_name   = os.path.basename(os.getcwd()),
            version        = _roll_version(),
            agent          = config.get("primary_agent") or "claude",
            git_branch     = bra,
            git_status     = gs,
            timestamp      = datetime.now().strftime("%H:%M"),
            state          = state,
            loop_state     = _launchd_svc_state("loop", slug),
            loop_minute    = _ci("loop_minute", 38),
            loop_active_start = _ci("loop_active_start", 10),
            loop_active_end   = _ci("loop_active_end", 18),
            dream_state    = _launchd_svc_state("dream", slug),
            dream_hour     = _ci("loop_dream_hour", 3),
            dream_minute   = _ci("loop_dream_minute", 12),
            dream_last_hours = _dream_last_hours(),
            refactor_pending = refactor_pending,
            peer_last      = _peer_last(),
            tcr_last_min   = _tcr_last_min(),
            ideas=ideas, todo=todo, in_progress=in_prog,
            in_prog_id=ip_id, in_prog_title=ip_title, in_prog_link=ip_link,
            ac_done=ac_done, ac_total=ac_total,
            alerts         = _alert_count(slug),
            proposals      = _proposal_count(),
            release_ready  = _release_ready(),
        )

    render(d)

if __name__ == "__main__":
    main()
