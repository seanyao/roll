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

# FIX-121: agent → primary model used by `roll loop` dashboard's fallback
# when an event stream lacks an explicit model name (non-claude agents'
# stdout isn't stream-json so loop-fmt can't extract model). Keeps the
# model column consistent with claude's "opus-4-7" style.
_AGENT_PRIMARY_MODEL = {
    "pi":       "deepseek-v4-pro",
    "deepseek": "deepseek-v4-pro",
    "kimi":     "kimi-k2-0905",
}


def fmt_model(model) -> str:
    """Short label for the cycle row's model column.

    `claude-opus-4-7-20251001` → `opus-4-7`
    None / empty                → `—`
    Non-claude vendor            → `?`
    """
    if not model:
        return "—"
    if not model.startswith("claude-"):
        return "?"
    s = model[len("claude-"):]
    s = re.sub(r"-\d{6,8}$", "", s)
    return s if s else "?"

def fmt_tokens(n: int) -> str:
    """Format a token count with K / M / B unit scaling, 1 decimal place.
    Uppercase suffix disambiguates from duration's lowercase m / h on the
    same row (e.g. "19m  6.7M" reads cleanly as 19 minutes + 6.7M tokens)."""
    if not n:
        return "—"
    if n < 1_000:
        return str(int(n))
    if n < 1_000_000:
        return f"{n / 1_000:.1f}K".replace(".0K", "K")
    if n < 1_000_000_000:
        return f"{n / 1_000_000:.1f}M".replace(".0M", "M")
    return f"{n / 1_000_000_000:.1f}B".replace(".0B", "B")

# Subtle red wash for the entire failure row — doubles up the color signal
# so a fail can't be missed even when scanning at 2x speed. Used by
# cycle_row when outcome=fail.
BG_FAIL = "\033[48;2;55;15;15m"

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
    if unit in ("$", "¥"):
        body = f"{sign}{unit}{mag:.2f}"
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
    return {"cycles": 0, "prs": 0, "failed": 0, "duration_s": 0, "cost": 0.0,
            "input_tokens": 0, "output_tokens": 0}

# ════════════════════════════════════════════════════════════════════════════
# Section / metric / cycle rows — printers used by all dashboards
# ════════════════════════════════════════════════════════════════════════════
def section_head(en: str, zh: str, hint: str) -> None:
    left = "  " + c("pink", en, bold=True) + c("muted", "  ·  ") + c("dim", zh)
    print(row(left, c("muted", hint)))

def metric(name: str, t: int, y: int, d2: int, kind: str, *,
           yest_color: str = "dim", yest_suffix: str = "",
           partial: bool = False) -> None:
    """Print one metric row. When `partial=True` the delta is rendered in
    muted gray instead of green/red — today's incomplete, so a 'down −23'
    against yesterday's full day would otherwise read as an alarm.

    Column geometry (kept in lockstep with the header in roll-loop-status):
      indent 2 · name 14 · today_value 8 · gap 2 · delta 12 · yest 10 · d2 8
    """
    delta_text, delta_c = fmt_delta(float(t), float(y), kind=kind)
    if partial and delta_c not in ("muted",):
        delta_c = "muted"
    yest_str = f"{y}" + (f" {yest_suffix}" if yest_suffix else "")
    print("  " +
          c("dim", pad(name, 14)) +
          c("fg", pad(str(t), 8, "r"), bold=True) + "  " +
          c(delta_c, pad(delta_text, 12), bold=(delta_c != "muted")) +
          c(yest_color, pad(yest_str, 10), bold=bool(yest_suffix)) +
          c("muted", pad(str(d2), 8)))

def metric_dur(name: str, t: int, y: int, d2: int, *, partial: bool = False) -> None:
    # work in whole minutes for the delta so it reads naturally (▲ +14m)
    t_m = t // 60
    y_m = y // 60
    delta_text, delta_c = fmt_delta(float(t_m), float(y_m), kind="up_bad", unit="m")
    if partial and delta_c not in ("muted",):
        delta_c = "muted"
    print("  " +
          c("dim", pad(name, 14)) +
          c("fg", pad(fmt_dur(t), 8, "r"), bold=True) + "  " +
          c(delta_c, pad(delta_text, 12), bold=(delta_c != "muted")) +
          c("dim", pad(fmt_dur(y), 10)) +
          c("muted", pad(fmt_dur(d2), 8)))

def metric_dollar(name: str, t: float, y: float, d2: float, *,
                  partial: bool = False, symbol: str = "$") -> None:
    # FIX-126: currency-aware — deepseek cost is native CNY (¥), claude USD ($).
    # We never convert; the rollup shows one row per currency with its own
    # symbol, so a ¥-row and a $-row are never summed into a meaningless total.
    delta_text, delta_c = fmt_delta(t, y, kind="up_bad", unit=symbol)
    if partial and delta_c not in ("muted",):
        delta_c = "muted"
    print("  " +
          c("dim", pad(name, 14)) +
          c("fg", pad(f"{symbol}{t:.2f}", 8, "r"), bold=True) + "  " +
          c(delta_c, pad(delta_text, 12), bold=(delta_c != "muted")) +
          c("dim", pad(f"{symbol}{y:.2f}", 10)) +
          c("muted", pad(f"{symbol}{d2:.2f}", 8)))

def metric_tokens(name: str, t: int, y: int, d2: int, *, partial: bool = False) -> None:
    # Compose the delta string with token-unit scaling so a 200M increase
    # doesn't print '+200000000'.
    if y == 0 and t == 0:
        delta_text, delta_c = "—", "muted"
    elif y == 0:
        delta_text, delta_c = "▲ new", "amber"
    elif t == y:
        delta_text, delta_c = "=", "muted"
    else:
        diff = t - y
        arrow = "▲" if diff > 0 else "▼"
        sign = "+" if diff > 0 else "−"
        delta_text = f"{arrow} {sign}{fmt_tokens(abs(diff))}"
        delta_c = "red" if diff > 0 else "green"
    if partial and delta_c not in ("muted",):
        delta_c = "muted"
    print("  " +
          c("dim", pad(name, 14)) +
          c("fg", pad(fmt_tokens(t), 8, "r"), bold=True) + "  " +
          c(delta_c, pad(delta_text, 12), bold=(delta_c != "muted")) +
          c("dim", pad(fmt_tokens(y), 10)) +
          c("muted", pad(fmt_tokens(d2), 8)))

def day_band(day_key: str, n_total: int, n_failed: int, now: datetime, *,
             in_progress: bool = False) -> None:
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
    if in_progress:
        count_str += "  ·  " + "in progress"
    left = ("  " + c("faint", "─ ") +
            c("fg", label, bold=True) +
            c("muted", " · ") + c("dim", day_key) +
            c("muted", " · ") + c("dim", f"{weekday} · {weekday_zh}") + " ")
    if in_progress:
        right_inner = (c("dim", f"{n_total} cycles") +
                       (c("dim", f" · {n_failed} failed") if n_failed
                        else c("dim", " · 0 failed")) +
                       c("muted", "  ·  ") + c("amber", "in progress"))
    else:
        right_inner = c("dim", count_str)
    right = "  " + right_inner
    dashes = max(2, COLS - strw(left) - strw(right))
    print(left + c("faint", "─" * dashes) + right)

def cycle_row(cy: Dict[str, Any], backlog: Dict[str, str]) -> None:
    outcome = cy.get("outcome", "done")
    pr_outcome = cy.get("pr_outcome")
    glyph_c, glyph = {
        "done":     ("green",  "✓"),
        "ok":       ("green",  "✓"),
        "fail":     ("red",    "✗"),
        "running":  ("purple", "⏵"),
        "idle":     ("muted",  "·"),
    }.get(outcome, ("muted", "·"))
    # US-VIEW-011: a completed cycle whose PR was closed without merging is
    # a "wasted run" — flip the green ✓ to an amber ⊘ so it can't be
    # mistaken for a real delivery when scanning the dashboard.
    if outcome in ("done", "ok") and pr_outcome == "closed":
        glyph_c, glyph = "amber", "⊘"
    time_str = cy["start"].astimezone().strftime("%H:%M")
    cr = cy.get("cron") or {}
    # duration prefers the explicit cy["duration_s"] (computed from event
    # timestamps or runs.jsonl) so it shows for all completed cycles, not
    # only the one that happens to be in the latest cron.log dump.
    # For a currently-running cycle, show wall-clock elapsed (now - start).
    dur_s = cy.get("duration_s") or cr.get("duration_s") or 0
    if outcome == "running" and not dur_s and cy.get("start"):
        from datetime import datetime as _dt, timezone as _tz
        dur_s = int((_dt.now(_tz.utc) - cy["start"]).total_seconds())
    dur = fmt_dur(dur_s) if dur_s else "—"
    # US-VIEW-017: show all 4 token components when cache data is available.
    # Format: "in/cw↑ cr↓/out" (cache writes ↑, cache reads ↓).
    # Falls back to "in/out" for cycles that predate cache tracking.
    inp = cy.get('input_tokens') or 0
    out_tok = cy.get('output_tokens') or 0
    cw  = cy.get('cache_creation_tokens') or 0
    cr  = cy.get('cache_read_tokens') or 0
    if cw or cr:
        tok = (f"{fmt_tokens(inp)}"
               f"/{fmt_tokens(cw)}↑ {fmt_tokens(cr)}↓"
               f"/{fmt_tokens(out_tok)}")
    else:
        tok = f"{fmt_tokens(inp)}/{fmt_tokens(out_tok)}"
    # cost prefers the backfilled list-price; falls back to cron.log when
    # the claude session log isn't available (only the latest cycle).
    # FIX-116: use the model's native currency symbol.
    cur = cy.get("cost_currency", "USD")
    symbol = "¥" if cur == "CNY" else "$"
    if cy.get("cost_list") is not None:
        cost = f"{symbol}{cy['cost_list']:.2f}"
    elif cr:
        cost = f"{symbol}{cr.get('cost', 0):.2f}"
    else:
        cost = "—"
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

    model_label = fmt_model(cy.get("model"))
    # FIX-119: fall back to cy["agent"] (from agent_used event) when model
    # is unknown — non-claude agents (pi, deepseek, kimi) don't expose model
    # info in stream-json, leaving a "—" or "?" on the dashboard.
    # FIX-121: map agent → its configured primary model so the column shows
    # the actual model name (e.g. "deepseek-v4-pro") consistently with
    # claude's "opus-4-7", not the bare agent name ("pi").
    if model_label in ("—", "?") and cy.get("agent"):
        model_label = _AGENT_PRIMARY_MODEL.get(cy["agent"], cy["agent"])
    # Auto-hide model column on narrow screens — keeps the dashboard readable
    # when terminal is < 100 cols (cost / story IDs are higher-priority).
    show_model = COLS >= 100
    model_seg = c("muted", pad(model_label, 11)) + " " if show_model else ""
    # US-VIEW-011: PR landing marker after the story id(s).
    #   merged → "#NN ✓" green
    #   closed → "#NN ↩" amber (paired with ⊘ glyph above)
    #   open   → "#NN …" dim   (still landing; auto-merge or human pending)
    pr_marker = ""
    pr_num = cy.get("pr_num")
    if pr_num is not None and pr_outcome:
        mark_c, mark_sym = {
            "merged": ("green", "✓"),
            "closed": ("amber", "↩"),
            "open":   ("dim",   "…"),
        }.get(pr_outcome, ("dim", "…"))
        pr_marker = " " + c(mark_c, f"#{pr_num} {mark_sym}")
    # US-VIEW-014: pre-US-VIEW-014 events (no frozen cost_list_usd at
    # cycle_end) get a muted [legacy] suffix — the number is recomputed on
    # the fly and can shift with future price changes, unlike the frozen
    # values written by current loop-fmt.
    legacy_marker = " " + c("muted", "[legacy]") if cy.get("cost_list_legacy") else ""
    inner = (
        "  " + c(glyph_c, glyph, bold=True) + "  " +
        c(time_c, pad(time_str, 5), bold=(outcome == "fail")) + "   " +
        c("muted", pad(dur, 4, "r")) + "  " +
        c("muted", pad(tok, 26)) + "  " +
        model_seg +
        c("muted", pad(cost, 7, "r")) + "   " +
        c(sid_c, ids_str, bold=True) + pr_marker + legacy_marker
    )
    # Subtle red bg on failure rows so a fail can't be missed at a glance.
    if outcome == "fail" and USE_COLOR:
        # Every inner c(...) span ends with \033[0m which terminates the bg
        # too. Re-paint the bg after every internal reset so the wash spans
        # the whole row, not just the first colored cell. Then pad to full
        # width so the bg extends edge-to-edge before the final reset.
        line_pad = max(0, COLS - strw(inner))
        inner_padded = inner + " " * line_pad
        print(BG_FAIL + inner_padded.replace(RESET, RESET + BG_FAIL) + RESET)
        # Always emit the drill hint for fails — fail_detail is often missing
        # because not every fail path goes through the test / build stages.
        hint = " " * 8 + c("dim", "→ ") + c("amber", f"roll loop show {cy['label']}")
        if cy.get("fail_detail"):
            hint += c("muted", "   ") + c("dim", cy["fail_detail"])
        hint_pad = max(0, COLS - strw(hint))
        hint_padded = hint + " " * hint_pad
        print(BG_FAIL + hint_padded.replace(RESET, RESET + BG_FAIL) + RESET)
    else:
        print(inner)
        if outcome == "fail" and cy.get("fail_detail"):
            # NO_COLOR path: drill hint still useful for diagnosis.
            print(" " * 8 + "→ " + f"roll loop show {cy['label']}")
