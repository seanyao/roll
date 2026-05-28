#!/usr/bin/env python3
"""Test quality merge gate (US-QA-012).

Scan bats test files for rubric ❼ (inline external-tool behaviour) and ❽
(file outside this repo) violations. Loop's auto-merge runs this between
CI green and merge; non-zero exit holds the PR until either the test is
fixed or PR description carries `[skip-test-quality]` (US-QA-013).

Usage:
  test_quality_gate.py [--skip] <bats-file> [<bats-file> …]

Exit:
  0 — clean OR --skip flag set
  1 — one or more violations
  2 — usage error
"""
from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import List, Tuple


# ❼ — inline external-tool patterns. We flag when a single line contains
# TWO OR MORE of these distinct tool markers, which signals a hand-rolled
# pipeline duplicating what a project helper should own. A lone `grep -q`
# or `awk` (no pipe-chain) is fine.
INLINE_TOOL_PATTERNS = [
    re.compile(r"\bsed\s+[^|]*[s/]"),         # sed with substitution / address
    re.compile(r"\bawk\s+'"),                 # awk with script
    re.compile(r"\bgrep\s+-[a-zA-Z]*o"),       # grep -o / -oE (extraction)
    re.compile(r"\bfind\s+[^|]*-name"),         # find -name (path scanning)
    re.compile(r"\bcut\s+-f"),                # cut -f (column extraction)
    re.compile(r"\btr\s+-d"),                 # tr -d (char deletion)
]

# ❽ — paths outside this repo. We flag `~/.<name>` (dotfile dirs) and
# absolute system paths. `BATS_TMPDIR` is the sandbox marker and is fine.
OUTSIDE_PATTERNS = [
    re.compile(r"~/\.[A-Za-z]"),                # ~/.codex, ~/.kimi, ~/.roll, etc.
    re.compile(r"(?<![A-Za-z0-9])/etc/[A-Za-z]"),
    re.compile(r"(?<![A-Za-z0-9])/usr/[A-Za-z]"),
    re.compile(r"(?<![A-Za-z0-9])/var/[A-Za-z]"),
]
OUTSIDE_ALLOW = re.compile(r"BATS_TMPDIR")


def _scan_lines(text: str) -> List[Tuple[int, str, str]]:
    """Return list of (line_no, kind, snippet). kind is "❼" or "❽"."""
    findings: List[Tuple[int, str, str]] = []
    in_heredoc = False
    heredoc_terminator: str = ""
    lines = text.splitlines()
    for idx, raw_line in enumerate(lines, start=1):
        line = raw_line.rstrip("\n")
        stripped = line.lstrip()

        if in_heredoc:
            if line.strip() == heredoc_terminator:
                in_heredoc = False
            continue

        # Skip comments — comments can legitimately discuss sed/awk in prose.
        if stripped.startswith("#"):
            continue

        # Skip @test header lines — bats decorators carry the test name
        # which often quotes the patterns the test exercises (false positive).
        if stripped.startswith("@test "):
            continue

        # Explicit allow marker for lines that legitimately exercise the
        # gate itself (test fixture content), or for project doc-validation
        # awks that don't test production code.
        if "test-quality:allow" in line:
            continue

        # Heredoc start: << 'EOF' or <<EOF (optional quotes).
        # After the heredoc terminator on this line, subsequent lines are
        # data until the terminator appears alone on a line.
        m = re.search(r"<<\s*['\"]?([A-Z_]+)['\"]?", line)
        if m:
            heredoc_terminator = m.group(1)
            in_heredoc = True
            # Don't scan this declarator line further — the leading code
            # before "<<" might still contain tool patterns, but we'd be
            # double-flagging here vs the line that actually executes.
            continue

        # ❼: any inline extraction/parsing tool on this line flags. Each
        # pattern intentionally describes parsing intent (sed substitution,
        # awk script, grep -o / -oE, find -name, cut -f, tr -d) — single
        # grep -q without -o doesn't match and stays untouched.
        if any(pat.search(line) for pat in INLINE_TOOL_PATTERNS):
            findings.append((idx, "❼", line.strip()))

        # ❽: any outside-path hit unless BATS_TMPDIR appears (sandbox marker).
        if OUTSIDE_ALLOW.search(line):
            continue
        for pat in OUTSIDE_PATTERNS:
            if pat.search(line):
                findings.append((idx, "❽", line.strip()))
                break  # one ❽ finding per line is enough

    return findings


def scan_file(path: Path) -> List[Tuple[int, str, str]]:
    try:
        text = path.read_text(errors="ignore")
    except FileNotFoundError:
        return [(0, "?", f"file not found: {path}")]
    return _scan_lines(text)


def main() -> int:
    args = sys.argv[1:]
    skip = False
    files: List[str] = []
    for a in args:
        if a in ("--skip", "--skip-test-quality"):
            skip = True
        else:
            files.append(a)
    if not files:
        print("usage: test_quality_gate.py [--skip] <bats-file> [<bats-file> …]",
              file=sys.stderr)
        return 2
    if skip:
        return 0

    total = 0
    for f in files:
        findings = scan_file(Path(f))
        for line_no, kind, snippet in findings:
            print(f"{f}:{line_no}: {kind} {snippet}")
            total += 1
    return 1 if total > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
