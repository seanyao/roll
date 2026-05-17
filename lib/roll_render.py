"""
roll_render — shared terminal rendering primitives for roll CLI views.

Color palette, glyphs, padding/alignment, semantic deltas, and the layout
helpers used to print the static CLI dashboards (loop status, home, status,
backlog, brief, setup, init, peer). Every visible color lives in PAL;
NO_COLOR=1 falls through to glyph + weight + spacing only.

CJK display width is honored via strw() — CJK and fullwidth glyphs occupy
2 cells; this is what keeps EN/ZH paired rows aligned.

Set roll_render.USE_COLOR from the entry script after parsing flags / TTY.
"""

from __future__ import annotations
import re
from datetime import datetime
from typing import Any, Dict, List, Tuple
from unicodedata import east_asian_width

# ════════════════════════════════════════════════════════════════════════════
# ANSI / color
# ════════════════════════════════════════════════════════════════════════════
USE_COLOR = True
COLS = 100  # fixed 100-col grid; auto-narrow handled in caller's render

def _rgb(hexstr: str) -> str:
    h = hexstr.lstrip("#")
    return f"\033[38;2;{int(h[0:2],16)};{int(h[2:4],16)};{int(h[4:6],16)}m"

# Single source of truth — every visible color in the design lives here.
PAL = {
    "fg":     _rgb("e6edf3"),
    "dim":    _rgb("8b949e"),
    "muted":  _rgb("6e7681"),
    "faint":  _rgb("484f58"),
    "blue":   _rgb("58a6ff"),
    "green":  _rgb("3fb950"),
    "amber":  _rgb("d29922"),
    "red":    _rgb("f85149"),
    "purple": _rgb("bc8cff"),
    "pink":   _rgb("f778ba"),
    "yellow": _rgb("e3b341"),
}
BOLD = "\033[1m"
RESET = "\033[0m"

def c(color: str, s: str, *, bold: bool = False) -> str:
    if not USE_COLOR:
        return s
    return f"{PAL.get(color, '')}{BOLD if bold else ''}{s}{RESET}"

# ════════════════════════════════════════════════════════════════════════════
# East-Asian display width — CJK and fullwidth glyphs occupy 2 cells.
# This is what keeps EN/ZH paired rows column-aligned in the terminal.
# ════════════════════════════════════════════════════════════════════════════
_ANSI_RE = re.compile(r"\033\[[\d;]*m")

def strip_ansi(s: str) -> str:
    """Strip ANSI escape sequences (CSI SGR) from a string."""
    return _ANSI_RE.sub("", s)

def strw(s: str) -> int:
    """Display width of a string after stripping ANSI escapes."""
    bare = _ANSI_RE.sub("", s)
    w = 0
    for ch in bare:
        w += 2 if east_asian_width(ch) in ("F", "W") else 1
    return w

def pad(s: str, w: int, align: str = "l") -> str:
    sw = strw(s)
    if sw >= w:
        return s
    fill = " " * (w - sw)
    return fill + s if align == "r" else s + fill

def row(left: str, right: str, width: int = COLS) -> str:
    """Two-end-flush row at `width` columns."""
    gap = max(1, width - strw(left) - strw(right))
    return left + " " * gap + right

# ════════════════════════════════════════════════════════════════════════════
# Formatters
# ════════════════════════════════════════════════════════════════════════════
def fmt_dur(s: int) -> str:
    if s < 3600:
        return f"{s // 60}m"
    return f"{s // 3600}h {(s % 3600) // 60}m"

def fmt_delta(today: float, yest: float, *, kind: str, unit: str = "") -> Tuple[str, str]:
    """Return (delta_string, semantic_color). kind ∈ {'up_good','up_bad','any'}.
    `unit`: '' → plain int, '$' → currency, 'm' → minutes (caller pre-converts)."""
    if yest == 0 and today == 0:
        return ("—", "muted")
    if yest == 0:
        return ("▲ new", "amber")
    diff = today - yest
    if abs(diff) < 1e-9:
        return ("=", "muted")
    arrow = "▲" if diff > 0 else "▼"
    sign = "+" if diff > 0 else "−"
    mag = abs(diff)
    if unit == "$":
        body = f"{sign}${mag:.2f}"
    elif unit == "m":
        body = f"{sign}{int(round(mag))}m"
    else:
        body = f"{sign}{int(round(mag))}"
    color = {
        "up_good": "green" if diff > 0 else "amber",
        "up_bad":  "red"   if diff > 0 else "green",
        "any":     "amber",
    }[kind]
    return (f"{arrow} {body}", color)

def trunc(s: str, n: int) -> str:
    if strw(s) <= n:
        return s
    out = ""
    for ch in s:
        if strw(out) + strw(ch) + 1 > n:
            return out + "…"
        out += ch
    return out

def empty_rollup() -> Dict[str, Any]:
    return {"cycles": 0, "prs": 0, "failed": 0, "duration_s": 0, "cost": 0.0, "tokens": 0}

# ════════════════════════════════════════════════════════════════════════════
# Section / metric / cycle rows — printers used by all dashboards
# ════════════════════════════════════════════════════════════════════════════
def section_head(en: str, zh: str, hint: str) -> None:
    left = "  " + c("pink", en, bold=True) + c("muted", "  ·  ") + c("dim", zh)
    print(row(left, c("muted", hint)))

def metric(name: str, t: int, y: int, d2: int, kind: str, *,
           yest_color: str = "dim", yest_suffix: str = "") -> None:
    delta_text, delta_c = fmt_delta(float(t), float(y), kind=kind)
    yest_str = f"{y}" + (f" {yest_suffix}" if yest_suffix else "")
    print("  " +
          c("dim", pad(name, 14)) +
          c("fg", pad(str(t), 6, "r"), bold=True) + "  " +
          c(delta_c, pad(delta_text, 10), bold=(delta_c != "muted")) +
          c(yest_color, pad(yest_str, 10), bold=bool(yest_suffix)) +
          c("muted", pad(str(d2), 8)))

def metric_dur(name: str, t: int, y: int, d2: int) -> None:
    # work in whole minutes for the delta so it reads naturally (▲ +14m)
    t_m = t // 60
    y_m = y // 60
    delta_text, delta_c = fmt_delta(float(t_m), float(y_m), kind="up_bad", unit="m")
    print("  " +
          c("dim", pad(name, 14)) +
          c("fg", pad(fmt_dur(t), 6, "r"), bold=True) + "  " +
          c(delta_c, pad(delta_text, 10), bold=(delta_c != "muted")) +
          c("dim", pad(fmt_dur(y), 10)) +
          c("muted", pad(fmt_dur(d2), 8)))

def metric_dollar(name: str, t: float, y: float, d2: float) -> None:
    delta_text, delta_c = fmt_delta(t, y, kind="up_bad", unit="$")
    print("  " +
          c("dim", pad(name, 14)) +
          c("fg", pad(f"${t:.2f}", 6, "r"), bold=True) + "  " +
          c(delta_c, pad(delta_text, 10), bold=(delta_c != "muted")) +
          c("dim", pad(f"${y:.2f}", 10)) +
          c("muted", pad(f"${d2:.2f}", 8)))

def day_band(day_key: str, n_total: int, n_failed: int, now: datetime) -> None:
    from datetime import timedelta
    today = now.strftime("%Y-%m-%d")
    yest  = (now - timedelta(days=1)).strftime("%Y-%m-%d")
    if day_key == today:
        label = "Today · 今日"
    elif day_key == yest:
        label = "Yesterday · 昨日"
    else:
        n = (now.date() - datetime.strptime(day_key, "%Y-%m-%d").date()).days
        label = f"−{n} days · 前 {n} 天"
    weekday = datetime.strptime(day_key, "%Y-%m-%d").strftime("%a")
    weekday_zh = ["周一","周二","周三","周四","周五","周六","周日"][
        datetime.strptime(day_key, "%Y-%m-%d").weekday()]
    count_str = f"{n_total} cycles" + (f" · {n_failed} failed" if n_failed else " · 0 failed")
    left = ("  " + c("faint", "─ ") +
            c("fg", label, bold=True) +
            c("muted", " · ") + c("dim", day_key) +
            c("muted", " · ") + c("dim", f"{weekday} · {weekday_zh}") + " ")
    right = "  " + c("dim", count_str)
    dashes = max(2, COLS - strw(left) - strw(right))
    print(left + c("faint", "─" * dashes) + right)

def cycle_row(cy: Dict[str, Any], backlog: Dict[str, str]) -> None:
    outcome = cy.get("outcome", "done")
    glyph_c, glyph = {
        "done":     ("green",  "✓"),
        "ok":       ("green",  "✓"),
        "fail":     ("red",    "✗"),
        "running":  ("purple", "⏵"),
        "idle":     ("muted",  "·"),
    }.get(outcome, ("muted", "·"))
    time_str = cy["start"].astimezone().strftime("%H:%M")
    cr = cy.get("cron") or {}
    # duration prefers the explicit cy["duration_s"] (computed from event
    # timestamps or runs.jsonl) so it shows for all completed cycles, not
    # only the one that happens to be in the latest cron.log dump.
    dur_s = cy.get("duration_s") or cr.get("duration_s") or 0
    dur = fmt_dur(dur_s) if dur_s else "—"
    cost = f"${cr.get('cost', 0):.2f}" if cr else "—"
    sid = cy.get("story") or "—"
    built = cy.get("built") or ([sid] if sid != "—" else [])
    # Join multiple stories with " | ". Drop empties and dedupe in order.
    seen = set()
    ids = []
    for s in built:
        if s and s not in seen:
            seen.add(s)
            ids.append(s)
    ids_str = " | ".join(ids) if ids else sid
    time_c  = "red" if outcome == "fail" else "fg"
    sid_c   = "red" if outcome == "fail" else "blue"

    print(
        "  " + c(glyph_c, glyph, bold=True) + "  " +
        c(time_c, pad(time_str, 5), bold=(outcome == "fail")) + "   " +
        c("muted", pad(dur, 4, "r")) + "  " +
        c("muted", pad(cost, 6, "r")) + "   " +
        c(sid_c, ids_str, bold=True)
    )
    if outcome == "fail" and cy.get("fail_detail"):
        print(" " * 8 + c("dim", "→ ") + c("amber", f"roll loop show {cy['label']}"))
