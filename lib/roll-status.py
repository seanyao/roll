#!/usr/bin/env python3
"""
roll-status — render the `roll status` page.

One-screen sync health: global conventions, AI clients table (with drift fix hints),
project templates, and this-project metrics.

Usage:
  python3 lib/roll-status.py              # live data
  python3 lib/roll-status.py --no-color
  python3 lib/roll-status.py --demo       # render with fixture data
"""

from __future__ import annotations
import argparse, os, re, subprocess, sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

_LIB_DIR = os.path.dirname(os.path.realpath(__file__))
if _LIB_DIR not in sys.path:
    sys.path.insert(0, _LIB_DIR)
import roll_render
from roll_render import COLS, c, row, section_head, strw, pad

# ════════════════════════════════════════════════════════════════════════════
# Paths
# ════════════════════════════════════════════════════════════════════════════
def _roll_home() -> Path:
    return Path(os.environ.get("ROLL_HOME") or os.path.expanduser("~/.roll"))

def _global_dir() -> Path:
    return _roll_home() / "conventions" / "global"

def _templates_dir() -> Path:
    return _roll_home() / "conventions" / "templates"

def _config_path() -> Path:
    return _roll_home() / "config.yaml"

def _shared_root() -> Path:
    return Path(os.environ.get("ROLL_SHARED_ROOT") or os.path.expanduser("~/.shared/roll"))

def _project_slug() -> str:
    path = os.path.realpath(os.getcwd())
    try:
        common = subprocess.check_output(
            ["git", "-C", path, "rev-parse", "--git-common-dir"],
            stderr=subprocess.DEVNULL, text=True,
        ).strip()
        if common.endswith("/.git"):
            path = common[:-5]
    except Exception:
        pass
    import hashlib
    base = re.sub(r"[^A-Za-z0-9]+", "-", os.path.basename(path)).strip("-")
    h = hashlib.md5(path.encode()).hexdigest()[:6]
    return f"{base}-{h}"

# ════════════════════════════════════════════════════════════════════════════
# Data loaders
# ════════════════════════════════════════════════════════════════════════════
CONVENTION_FILES = ["AGENTS.md", "CLAUDE.md", "GEMINI.md", ".cursor-rules", "project_rules.md"]
TEMPLATES = ["fullstack", "frontend-only", "backend-service", "cli"]

def _global_conventions() -> List[Tuple[str, bool]]:
    gd = _global_dir()
    return [(f, (gd / f).exists()) for f in CONVENTION_FILES]

def _parse_ai_entries() -> List[Dict[str, str]]:
    cfg = _config_path()
    if not cfg.exists():
        return []
    entries = []
    for line in cfg.read_text(errors="ignore").splitlines():
        m = re.match(r"^ai_[a-z]+:\s*(.+)", line)
        if not m:
            continue
        val = m.group(1).strip().replace("~", str(Path.home()))
        parts = val.split("|")
        if len(parts) < 3:
            continue
        ai_dir, cfg_file, src_file = parts[0].strip(), parts[1].strip(), parts[2].strip()
        name = os.path.basename(ai_dir).lstrip(".")
        if name in ("workspace", "agent"):
            name = os.path.basename(os.path.dirname(ai_dir)).lstrip(".")
        entries.append({"name": name, "ai_dir": ai_dir, "cfg_file": cfg_file, "src_file": src_file})
    return entries

def _ai_sync_status(entry: Dict[str, str]) -> str:
    ai_dir = Path(entry["ai_dir"])
    cfg_file = ai_dir / entry["cfg_file"]
    roll_md = ai_dir / "roll.md"
    src = _global_dir() / entry["src_file"]

    if not cfg_file.exists():
        return "missing"
    if not roll_md.exists():
        return "out-of-sync"
    try:
        if src.exists() and roll_md.read_bytes() != src.read_bytes():
            return "out-of-sync"
    except Exception:
        return "out-of-sync"
    try:
        if "@roll.md" not in cfg_file.read_text(errors="ignore"):
            return "out-of-sync"
    except Exception:
        return "out-of-sync"
    return "sync"

def _ai_skill_count(entry: Dict[str, str]) -> int:
    skills_dir = Path(entry["ai_dir"]) / "skills"
    if not skills_dir.exists():
        return 0
    try:
        return sum(1 for p in skills_dir.iterdir() if p.name.startswith("roll-") and (p.is_symlink() or p.is_dir()))
    except Exception:
        return 0

def _template_count(tpl: str) -> int:
    d = _templates_dir() / tpl
    if not d.exists():
        return 0
    try:
        return sum(1 for p in d.rglob("*") if p.is_file())
    except Exception:
        return 0

def _skills_installed() -> int:
    sd = _roll_home() / "skills"
    if not sd.exists():
        return 0
    try:
        return sum(1 for p in sd.iterdir() if p.is_dir())
    except Exception:
        return 0

def _launchd_state(service: str, slug: str) -> str:
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

# ════════════════════════════════════════════════════════════════════════════
# Demo fixture
# ════════════════════════════════════════════════════════════════════════════
def _demo_data() -> Dict[str, Any]:
    return dict(
        conventions=[
            ("AGENTS.md", True), ("CLAUDE.md", True), ("GEMINI.md", False),
            (".cursor-rules", True), ("project_rules.md", False),
        ],
        ai_clients=[
            {"name": "claude",  "cfg_file": "CLAUDE.md",  "path": "~/.claude/CLAUDE.md",   "sync": "sync",        "skills": 12},
            {"name": "cursor",  "cfg_file": "AGENTS.md",  "path": "~/.cursor/AGENTS.md",    "sync": "out-of-sync", "skills": 12},
            {"name": "gemini",  "cfg_file": "GEMINI.md",  "path": "~/.gemini/GEMINI.md",    "sync": "missing",     "skills": 0},
        ],
        templates=[
            ("fullstack", 14), ("frontend-only", 9), ("backend-service", 11), ("cli", 7),
        ],
        skills_installed=12,
        project_has_agents=True,
        project_has_backlog=True,
        project_features_count=23,
        loop_state="enabled",
        dream_state="not-installed",
    )

# ════════════════════════════════════════════════════════════════════════════
# Render helpers
# ════════════════════════════════════════════════════════════════════════════
def _hr() -> None:
    print(c("faint", "─" * COLS))

def _render_health(d: Dict[str, Any]) -> None:
    clients = d["ai_clients"]
    synced = sum(1 for x in clients if x["sync"] == "sync")
    total  = len(clients)
    skills = d["skills_installed"]
    tpls   = len([t for t in d["templates"] if t[1] > 0])

    has_drift = synced < total
    if has_drift:
        dot  = c("amber", "!")
        word = c("amber", "drift", bold=True)
        detail = (c("dim", f"  {synced}/{total} AI clients in sync") + c("muted", " · ") +
                  c("dim", f"{skills} skills") + c("muted", " · ") +
                  c("dim", f"{tpls} templates"))
    else:
        dot  = c("green", "●")
        word = c("green", "healthy", bold=True)
        detail = (c("dim", f"  {synced}/{total} AI clients in sync") + c("muted", " · ") +
                  c("dim", f"{skills} skills mounted") + c("muted", " · ") +
                  c("dim", f"{tpls} templates present"))

    print()
    print("  " + dot + " " + word + detail)
    print()
    _hr()
    print()

def _render_global_conventions(conventions: list) -> None:
    section_head("GLOBAL CONVENTIONS", "全局约定", "~/.roll/conventions/global/")
    print()
    for fname, exists in conventions:
        if exists:
            print("  " + c("green", "+") + " " + c("fg", fname))
        else:
            print("  " + c("red", "−") + " " + c("dim", fname) + "  " + c("red", "missing"))
    print()
    _hr()
    print()

def _render_ai_clients(clients: list) -> None:
    section_head("AI CLIENTS", "AI 客户端同步", "convention · path · sync · skills")
    print()

    # Header
    hdr = ("  " + pad(c("dim", "name"),       14) +
           pad(c("dim", "convention"), 14) +
           pad(c("dim", "sync"),       14) +
           c("dim", "skills"))
    print(hdr)
    print("  " + c("faint", "─" * (COLS - 4)))

    for cl in clients:
        sync_s = cl["sync"]
        name   = cl["name"]
        cfg    = cl["cfg_file"]
        path   = cl.get("path", "")
        sk     = cl.get("skills", 0)

        if sync_s == "sync":
            sync_col = c("green", "✓ in sync")
            name_col = c("fg", name)
        elif sync_s == "out-of-sync":
            sync_col = c("amber", "~ out of sync")
            name_col = c("amber", name)
        else:
            sync_col = c("red", "− missing")
            name_col = c("red", name)

        row_line = ("  " + pad(name_col, 14) +
                    pad(c("dim", cfg), 14) +
                    pad(sync_col, 14) +
                    c("dim", str(sk)))
        print(row_line)

        if sync_s in ("out-of-sync", "missing"):
            hint = ("       " + c("dim", "fix: ") +
                    c("blue", f"roll setup -f {name}"))
            print(hint)

    print()
    _hr()
    print()

def _render_templates(templates: list) -> None:
    section_head("PROJECT TEMPLATES", "项目模板", "~/.roll/conventions/templates/")
    print()
    parts = []
    for tpl, count in templates:
        if count > 0:
            parts.append(c("fg", tpl) + c("dim", f" {count}f"))
        else:
            parts.append(c("red", "−") + " " + c("dim", tpl + " missing"))
    print("  " + c("muted", "  ·  ").join(parts))
    print()
    _hr()
    print()

def _render_this_project(d: Dict[str, Any]) -> None:
    section_head("THIS PROJECT", "本项目", os.path.basename(os.getcwd()))
    print()

    def _file_row(label: str, exists: bool, detail: str = "") -> None:
        if exists:
            sym = c("green", "+")
            lbl = c("fg", label)
        else:
            sym = c("red", "−")
            lbl = c("dim", label) + "  " + c("red", "missing")
        line = "  " + sym + " " + lbl
        if detail and exists:
            line += c("dim", f"  {detail}")
        print(line)

    _file_row("AGENTS.md",        d["project_has_agents"])
    _file_row(".roll/backlog.md",       d["project_has_backlog"])
    _file_row(".roll/features/",   d["project_features_count"] > 0,
              f"{d['project_features_count']} feature docs")

    # Loop & dream launchd
    for svc, state_key in [("loop", "loop_state"), ("dream", "dream_state")]:
        state = d.get(state_key, "not-installed")
        if state == "enabled":
            dot = c("green", "●")
            word = c("green", f"{svc} · launchd enabled")
        elif state == "installed-off":
            dot = c("amber", "⚠")
            word = c("amber", f"{svc} · launchd off")
        else:
            dot = c("red", "○")
            word = c("dim", f"{svc} · launchd not installed")
        print("  " + dot + " " + word)

    print()

# ════════════════════════════════════════════════════════════════════════════
# Live data collection
# ════════════════════════════════════════════════════════════════════════════
def _live_data() -> Dict[str, Any]:
    slug = _project_slug()
    entries = _parse_ai_entries()
    ai_clients = []
    for e in entries:
        ai_clients.append({
            "name":     e["name"],
            "cfg_file": e["cfg_file"],
            "path":     str(Path(e["ai_dir"]) / e["cfg_file"]).replace(str(Path.home()), "~"),
            "sync":     _ai_sync_status(e),
            "skills":   _ai_skill_count(e),
        })
    templates = [(t, _template_count(t)) for t in TEMPLATES]
    feat_dir = Path(".roll/features")
    return dict(
        conventions       = _global_conventions(),
        ai_clients        = ai_clients,
        templates         = templates,
        skills_installed  = _skills_installed(),
        project_has_agents  = Path("AGENTS.md").exists(),
        project_has_backlog = Path(".roll/backlog.md").exists(),
        project_features_count = sum(1 for _ in feat_dir.glob("*.md")) if feat_dir.exists() else 0,
        loop_state  = _launchd_state("loop", slug),
        dream_state = _launchd_state("dream", slug),
    )

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

    d = _demo_data() if args.demo else _live_data()

    _render_health(d)
    _render_global_conventions(d["conventions"])
    _render_ai_clients(d["ai_clients"])
    _render_templates(d["templates"])
    _render_this_project(d)

if __name__ == "__main__":
    main()
