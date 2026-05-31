#!/usr/bin/env python3
"""roll-peer — v2 terminal view for `roll peer` (US-VIEW-009).

Renders a cross-agent review log as a turn-based ROUND transcript:
eyebrow + subject + proposer/reviewer overview + ROUND N sections
(each carrying agent turns with weight chips) + final VERDICT line
+ artifact path / next-step hint.

NO_COLOR=1 falls through to glyph + weight + spacing only.
"""
from __future__ import annotations

import argparse
import os
import sys

_LIB_DIR = os.path.dirname(os.path.realpath(__file__))
if _LIB_DIR not in sys.path:
    sys.path.insert(0, _LIB_DIR)
import roll_render
from roll_render import c, row, COLS

# ════════════════════════════════════════════════════════════════════════════
# Agent palette — each agent gets a stable color so reviewer/proposer pairs
# read at a glance across rounds. Unknown agents fall back to fg.
# ════════════════════════════════════════════════════════════════════════════

_AGENT_COLOR = {
    "claude":   "blue",
    "codex":    "pink",
    "kimi":     "amber",
    "deepseek": "green",
    "agy":      "purple",   # Antigravity (formerly Gemini CLI)
    "pi":       "yellow",
    "opencode": "muted",
    "trae":     "fg",
}

# Weight chip — (glyph, color, label) per turn.weight
_WEIGHTS = {
    "concern": ("●", "amber", "concern"),
    "nit":     ("○", "dim",   "nit"),
    "ack":     ("✓", "green", "ack"),
    "block":   ("✗", "red",   "block"),
}


def _agent_c(name: str) -> str:
    return _AGENT_COLOR.get(name.lower(), "fg")


# ════════════════════════════════════════════════════════════════════════════
# Fixture data (test-only; opt in via ROLL_RENDER_FIXTURE=1)
# Illustrative cross-agent review: claude proposes, codex reviews
# ════════════════════════════════════════════════════════════════════════════

_FIXTURE_SUBJECT = {
    "story":     "US-AUTH-014",
    "title":     "Session refresh fallback when refresh-token API 5xx",
    "pr":        "#412",
    "diff_stat": "+184 −37 · 6 files",
    "trigger":   "complexity=large",
    "proposer":  "claude",
    "reviewer":  "codex",
}

_FIXTURE_ROUNDS = [
    {
        "n": 1,
        "hint": "first pass — proposer ships, reviewer probes",
        "turns": [
            ("claude", "concern",
             "Refresh path swallows 503 silently — caller sees a stale session "
             "without any signal that re-auth is needed."),
            ("codex",  "nit",
             "Naming: `tryRefresh` reads as best-effort, but the retry budget "
             "actually escalates. Suggest `refreshWithBackoff`."),
            ("codex",  "block",
             "Backoff jitter uses Math.random — flakes integration tests. "
             "Inject the rng so tests can pin it."),
        ],
    },
    {
        "n": 2,
        "hint": "proposer revises, reviewer signs off",
        "turns": [
            ("claude", "ack",
             "Renamed to `refreshWithBackoff`; threaded `rng` through the "
             "config object. Added a test that pins seed 42."),
            ("codex",  "ack",
             "Looks right — retries fire 3× with jitter, surfaces 503 to "
             "caller after budget exhausted. Approving."),
        ],
    },
]

_FIXTURE_VERDICT = {
    "outcome": "approved",
    "reason":  "2 rounds · 5 turns · all blocks resolved",
}

_FIXTURE_ARTIFACT = ".roll/peer/logs/20260519_213700_claude_codex.md"
_FIXTURE_NEXT = [
    ("Continue execution",   "claude resumes work on US-AUTH-014"),
    ("Inspect log",          "open the artifact above to replay the transcript"),
]


# ════════════════════════════════════════════════════════════════════════════
# Render primitives
# ════════════════════════════════════════════════════════════════════════════

def _divider(char: str = "─") -> None:
    print(c("dim", char * min(COLS, 80)))


def _eyebrow(trigger: str) -> None:
    left = ("  " + c("blue", "PEER", bold=True) +
            c("dim", "  ·  ") +
            c("dim", "roll peer · cross-agent review"))
    right = c("purple", trigger, bold=True) + "  "
    print(row(left, right))


def _subject(subj: dict) -> None:
    story = c("blue", subj["story"], bold=True)
    title = c("fg",   subj["title"])
    pr    = c("amber", subj["pr"], bold=True)
    diff  = c("muted", subj["diff_stat"])
    line  = "  " + story + c("muted", "  ·  ") + title
    print(line)
    print("  " + pr + c("muted", "   ") + diff)


def _pair_overview(subj: dict) -> None:
    p_name = subj["proposer"]
    r_name = subj["reviewer"]
    p_c = _agent_c(p_name)
    r_c = _agent_c(r_name)
    proposer = c("dim", "proposer ") + c(p_c, p_name, bold=True)
    reviewer = c("dim", "reviewer ") + c(r_c, r_name, bold=True)
    sep = c("muted", "  →  ")
    print("  " + proposer + sep + reviewer)


def _round_header(n: int, hint: str) -> None:
    label = c("pink", f"ROUND {n}", bold=True)
    print()
    print("  " + label + c("muted", "  ·  ") + c("dim", hint))


def _weight_chip(weight: str) -> str:
    glyph, color, label = _WEIGHTS.get(weight, ("·", "muted", weight))
    return c(color, glyph + " " + label, bold=(weight in ("ack", "block")))


def _turn(agent: str, weight: str, body: str) -> None:
    agent_c = _agent_c(agent)
    name = c(agent_c, agent, bold=True)
    chip = _weight_chip(weight)
    # First line: agent  chip
    print("    " + name + c("muted", "  ") + chip)
    # Body wrapped with hanging indent so long sentences stay readable.
    _print_wrapped(body, indent=6, width=min(COLS, 80))


def _print_wrapped(s: str, *, indent: int, width: int) -> None:
    avail = max(20, width - indent)
    line = ""
    pad = " " * indent
    for word in s.split():
        if line and len(line) + 1 + len(word) > avail:
            print(pad + c("dim", line))
            line = word
        else:
            line = (line + " " + word) if line else word
    if line:
        print(pad + c("dim", line))


def _verdict(v: dict) -> None:
    outcome = v["outcome"]
    if outcome == "approved":
        glyph, color, label = "✓", "green", "approved"
    else:
        glyph, color, label = "✗", "red", "changes requested"
    head = c(color, f"{glyph} VERDICT", bold=True) + c("muted", "  ·  ") + c(color, label)
    print()
    print("  " + head)
    print("  " + c("dim", v["reason"]))


def _footer(artifact: str, next_steps: list) -> None:
    print()
    print("  " + c("dim", "artifact ") + c("muted", artifact))
    print()
    print("  " + c("pink", "NEXT", bold=True) + c("dim", "  ·  下一步"))
    for i, (label, hint) in enumerate(next_steps, start=1):
        num = c("dim", f"  {i}.")
        print(f"{num} {c('fg', label, bold=True)}")
        print("     " + c("dim", hint))
    _divider("═")


# ════════════════════════════════════════════════════════════════════════════
# Top-level render
# ════════════════════════════════════════════════════════════════════════════

def render_fixture() -> None:
    _eyebrow(_FIXTURE_SUBJECT["trigger"])
    _divider()
    print()
    _subject(_FIXTURE_SUBJECT)
    print()
    _pair_overview(_FIXTURE_SUBJECT)
    for rd in _FIXTURE_ROUNDS:
        _round_header(rd["n"], rd["hint"])
        for agent, weight, body in rd["turns"]:
            _turn(agent, weight, body)
    _verdict(_FIXTURE_VERDICT)
    _footer(_FIXTURE_ARTIFACT, _FIXTURE_NEXT)


# ════════════════════════════════════════════════════════════════════════════
# Entry point
# ════════════════════════════════════════════════════════════════════════════

def main() -> None:
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("--no-color", dest="no_color", action="store_true")
    ap.add_argument("--en",       action="store_true")
    ap.add_argument("--zh",       action="store_true")
    args, _ = ap.parse_known_args()

    if args.no_color or os.environ.get("NO_COLOR") or not sys.stdout.isatty():
        roll_render.USE_COLOR = False

    # FIX-076: this standalone entrypoint only knows how to render the fixture
    # transcript (for UI tests). Real peer review is orchestrated by bin/roll
    # and never invokes this main(). Require an explicit opt-in so a stray
    # `python3 lib/roll-peer.py` invocation can't masquerade as live output.
    if not os.environ.get("ROLL_RENDER_FIXTURE"):
        print("Error: lib/roll-peer.py only renders fixture data; "
              "set ROLL_RENDER_FIXTURE=1 to use it (test-only).",
              file=sys.stderr)
        sys.exit(2)

    render_fixture()


if __name__ == "__main__":
    main()
