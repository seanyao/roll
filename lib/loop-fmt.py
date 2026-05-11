#!/usr/bin/env python3
"""
loop-fmt.py — stream-json → human-readable formatter for roll loop tmux output.

Reads stream-json lines from stdin, emits colored, human-readable events.
Skips noise (system/init, hook_started, rate_limit_event) and abbreviates
tool results so the window stays readable.

Color codes: no external deps, plain ANSI.
"""

import sys
import json
import re
import textwrap

# ANSI colors
CYAN    = "\033[36m"
GREEN   = "\033[32m"
YELLOW  = "\033[33m"
RED     = "\033[31m"
GRAY    = "\033[90m"
BOLD    = "\033[1m"
RESET   = "\033[0m"
DIM     = "\033[2m"

SKIP_SUBTYPES = {"hook_started", "hook_response", "hook_stop_hook_execution",
                 "hook_stop_hook_active_hooks_ran"}

def trunc(s, n=120):
    s = str(s).replace("\n", " ").strip()
    return s[:n] + "…" if len(s) > n else s

def fmt_tool_input(name, inp):
    if not isinstance(inp, dict):
        return trunc(str(inp), 80)
    if name == "Bash":
        cmd = inp.get("command", "")
        # show first non-empty line
        lines = [l.strip() for l in cmd.splitlines() if l.strip()]
        return trunc(lines[0] if lines else cmd, 100)
    if name in ("Read", "Write", "Edit"):
        path = inp.get("file_path", inp.get("path", ""))
        extra = ""
        if name == "Edit":
            old = inp.get("old_string", "")
            extra = f"  ({trunc(old, 40)})"
        return f"{path}{extra}"
    if name in ("Glob", "Grep"):
        return trunc(inp.get("pattern", inp.get("query", str(inp))), 80)
    if name == "Skill":
        return inp.get("skill", "") + (" " + inp.get("args", "") if inp.get("args") else "")
    if name == "Agent":
        return trunc(inp.get("description", str(inp)), 80)
    return trunc(json.dumps(inp, ensure_ascii=False), 80)

def fmt_tool_result(content):
    if isinstance(content, list):
        parts = []
        for c in content:
            if isinstance(c, dict):
                t = c.get("type", "")
                if t == "text":
                    parts.append(c.get("text", ""))
                elif t == "image":
                    parts.append("[image]")
            else:
                parts.append(str(c))
        text = " ".join(parts)
    else:
        text = str(content) if content is not None else ""
    # strip ansi for length check
    clean = re.sub(r'\033\[[0-9;]*m', '', text)
    lines = [l for l in clean.splitlines() if l.strip()]
    if not lines:
        return "(empty)"
    # show first 3 lines, trim long lines
    out = []
    for l in lines[:3]:
        out.append("  " + trunc(l, 100))
    if len(lines) > 3:
        out.append(f"  {DIM}… ({len(lines)-3} more lines){RESET}")
    return "\n".join(out)

def process_line(line):
    line = line.rstrip()
    if not line:
        return
    try:
        ev = json.loads(line)
    except json.JSONDecodeError:
        # plain text passthrough
        print(line)
        return

    etype = ev.get("type", "")

    # ── system events ──────────────────────────────────────────────
    if etype == "system":
        subtype = ev.get("subtype", "")
        if subtype in SKIP_SUBTYPES:
            return
        if subtype == "init":
            model = ev.get("model", "")
            tools = ev.get("tools", [])
            tool_list = ", ".join(tools[:6])
            if len(tools) > 6:
                tool_list += f" +{len(tools)-6}"
            print(f"{DIM}[init] model={model}  tools={tool_list}{RESET}")
            return
        # unknown system — show raw briefly
        print(f"{DIM}[sys/{subtype}]{RESET}")
        return

    # ── rate limit ────────────────────────────────────────────────
    if etype == "rate_limit_event":
        return

    # ── assistant ────────────────────────────────────────────────
    if etype == "assistant":
        msg = ev.get("message", {})
        for blk in msg.get("content", []):
            btype = blk.get("type", "")
            if btype == "tool_use":
                name = blk.get("name", "?")
                inp  = blk.get("input", {})
                summary = fmt_tool_input(name, inp)
                print(f"{CYAN}→ {BOLD}{name}{RESET}{CYAN}: {summary}{RESET}")
            elif btype == "text":
                text = blk.get("text", "").strip()
                if text:
                    # wrap long text
                    for l in textwrap.wrap(text, 120):
                        print(f"{GREEN}{l}{RESET}")
            elif btype == "thinking":
                thought = blk.get("thinking", "").strip()
                if thought:
                    first = trunc(thought, 80)
                    print(f"{DIM}[thinking] {first}{RESET}")
        return

    # ── user (tool results) ───────────────────────────────────────
    if etype == "user":
        msg = ev.get("message", {})
        for blk in msg.get("content", []):
            if blk.get("type") == "tool_result":
                is_err = blk.get("is_error", False)
                content = blk.get("content", "")
                result_text = fmt_tool_result(content)
                prefix = f"{RED}  ✗{RESET}" if is_err else f"{GRAY}  ↩{RESET}"
                print(f"{prefix} {result_text}")
        return

    # ── result (final) ───────────────────────────────────────────
    if etype == "result":
        dur_ms   = ev.get("duration_ms", 0)
        cost_usd = ev.get("total_cost_usd", 0)
        turns    = ev.get("num_turns", "?")
        dur_s    = dur_ms / 1000
        cost_str = f"${cost_usd:.4f}" if cost_usd else ""
        subtype  = ev.get("subtype", "")
        if subtype == "error_max_turns":
            print(f"{RED}✗ max turns reached  {dur_s:.1f}s{RESET}")
        else:
            cost_part = f"  {YELLOW}{cost_str}{RESET}" if cost_str else ""
            print(f"\n{GREEN}{BOLD}✓ done{RESET}  {dur_s:.1f}s  {GRAY}{turns} turns{RESET}{cost_part}")
        return

    # ── fallback ────────────────────────────────────────────────
    print(f"{DIM}{trunc(line, 160)}{RESET}")


def main():
    for line in sys.stdin:
        process_line(line)
        sys.stdout.flush()


if __name__ == "__main__":
    main()
