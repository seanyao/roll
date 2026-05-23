#!/usr/bin/env python3
"""FIX-113: changelog audit — list PRs merged to main since the latest
release tag that don't appear in CHANGELOG.md's ## Unreleased section.

Run before `release.sh` so missing entries surface BEFORE the AI rewrite
gets a chance to silently drop them.

Usage:
  python3 lib/changelog_audit.py                # report missing
  python3 lib/changelog_audit.py --since v2026.520.1
  python3 lib/changelog_audit.py --json         # machine-readable

Exit 0 always (read-only audit). Output:
  - "audit ok" + no missing list when CHANGELOG covers every merged PR
  - "audit found N PR(s) without a CHANGELOG entry:" + list otherwise
"""
from __future__ import annotations
import argparse, json, re, subprocess, sys
from pathlib import Path

PR_RE = re.compile(r"\(#(\d+)\)")
SQUASH_RE = re.compile(r"^([a-z0-9]{7,40})\s+(.*?)\s*\(#(\d+)\)\s*$")

# Heuristic: PR titles whose first token is one of these tags are usually
# user-visible (need CHANGELOG entry). Tags like "chore:", "docs:" still
# warrant a docs section entry; left to user judgement.
USER_VISIBLE_PATTERNS = (
    re.compile(r"\b(US-[A-Z0-9-]+-\d+)\b"),
    re.compile(r"\b(FIX-\d+)\b"),
    re.compile(r"\b(REFACTOR-\d+)\b"),
)

def _latest_tag() -> str:
    """Return the most recent v* tag, or empty string if none."""
    try:
        out = subprocess.check_output(
            ["git", "tag", "--list", "v*", "--sort=-creatordate"],
            text=True, stderr=subprocess.DEVNULL,
        ).strip()
        for line in out.splitlines():
            if line:
                return line
    except Exception:
        pass
    return ""

def _merged_prs_since(since: str):
    """Return list of (sha, subject, pr_number) for first-parent merges
    on main between <since> and HEAD."""
    cmd = ["git", "log", "--first-parent", "--oneline"]
    if since:
        cmd.append(f"{since}..HEAD")
    try:
        out = subprocess.check_output(cmd, text=True, stderr=subprocess.DEVNULL)
    except Exception:
        return []
    rows = []
    for line in out.splitlines():
        m = SQUASH_RE.match(line)
        if not m:
            # Older "Merge pull request #N from <branch>" format
            m2 = re.match(r"^([a-f0-9]{7,40})\s+Merge pull request #(\d+) from .*$", line)
            if m2:
                rows.append((m2.group(1), line.split(None, 1)[1], int(m2.group(2))))
                continue
            # Also look for parenthesized #N anywhere in subject
            m3 = re.match(r"^([a-f0-9]{7,40})\s+(.*)$", line)
            if m3:
                pr_match = PR_RE.search(m3.group(2))
                if pr_match:
                    rows.append((m3.group(1), m3.group(2), int(pr_match.group(1))))
            continue
        rows.append((m.group(1), m.group(2), int(m.group(3))))
    return rows

def _read_unreleased_section(changelog: Path) -> str:
    """Return the text of the ## Unreleased section (or empty string)."""
    if not changelog.exists():
        return ""
    text = changelog.read_text(errors="ignore")
    m = re.search(r"^## Unreleased\s*\n(.*?)(?=^## |\Z)", text, re.MULTILINE | re.DOTALL)
    return m.group(1) if m else ""

def _is_in_changelog(subject: str, unreleased_text: str) -> bool:
    """A PR is considered covered if any story id from its subject appears in
    the Unreleased section text."""
    for pat in USER_VISIBLE_PATTERNS:
        for m in pat.finditer(subject):
            sid = m.group(1)
            if sid in unreleased_text:
                return True
    # Fallback: PR number explicit mention
    pr_m = PR_RE.search(subject)
    if pr_m and f"#{pr_m.group(1)}" in unreleased_text:
        return True
    return False

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="", help="Compare against this tag (default: latest v* tag)")
    ap.add_argument("--changelog", default="CHANGELOG.md")
    ap.add_argument("--json", action="store_true", help="Machine-readable output")
    args = ap.parse_args()

    since = args.since or _latest_tag()
    prs = _merged_prs_since(since)
    cl = _read_unreleased_section(Path(args.changelog))

    missing = []
    skipped_internal = []
    for sha, subject, pr_n in prs:
        # Skip merges that are themselves releases
        if subject.startswith("[release]") or subject.startswith("[ release]"):
            continue
        if _is_in_changelog(subject, cl):
            continue
        # Heuristic: subjects that don't contain a story id and start with
        # internal-only tags (chore: backlog ..., chore: rebase, etc.) are
        # marked as "internal", less likely to need user-facing entry.
        is_user_visible = any(p.search(subject) for p in USER_VISIBLE_PATTERNS)
        if is_user_visible:
            missing.append({"pr": pr_n, "sha": sha, "subject": subject})
        else:
            skipped_internal.append({"pr": pr_n, "sha": sha, "subject": subject})

    if args.json:
        json.dump({
            "since": since,
            "total_prs": len(prs),
            "missing_user_visible": missing,
            "skipped_internal": skipped_internal,
        }, sys.stdout, indent=2, ensure_ascii=False)
        print()
        return 0

    print(f"changelog audit  since={since or '(no tag)'}  scanned {len(prs)} PR(s)")
    print()
    if not missing:
        print(f"  ✓ audit ok — every user-visible PR is mentioned in CHANGELOG.md Unreleased")
        if skipped_internal:
            print(f"  · {len(skipped_internal)} internal/infra PR(s) skipped from audit")
        return 0

    print(f"  ⚠ {len(missing)} user-visible PR(s) without a CHANGELOG entry:")
    for m in missing:
        print(f"    #{m['pr']}  {m['subject']}")
    print()
    print("  Add bullets under '## Unreleased' in CHANGELOG.md before release,")
    print("  or confirm these PRs are intentionally undocumented (rare).")
    if skipped_internal:
        print(f"  ({len(skipped_internal)} internal PR(s) skipped from audit)")
    return 0

if __name__ == "__main__":
    sys.exit(main())
