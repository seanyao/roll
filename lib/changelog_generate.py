#!/usr/bin/env python3
"""US-CL-006+007: changelog generate — deterministic draft generator.

Extracts ✅ Done stories from .roll/backlog.md, filters internal entries,
applies mechanical lint, and produces a draft ## Unreleased section.
Also detects merged PRs since the last release tag that lack a corresponding
Done story or CHANGELOG entry (gap detection).

Usage:
  python3 lib/changelog_generate.py           # output draft to stdout
  python3 lib/changelog_generate.py --write   # append to CHANGELOG.md
  python3 lib/changelog_generate.py --json    # machine-readable
"""
from __future__ import annotations
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

# ─── Filters ─────────────────────────────────────────────────────────────────
# Skip patterns: test infrastructure, internal contracts, dev-only changes.
# These mirror the filter rules in $roll-.changelog SKILL.md Section 3.
SKIP_PATTERNS = [
    re.compile(r"test\s+infrastructure|bats\s|fixture|teardown|isolation|CI\s+时序", re.I),
    re.compile(r"SKILL\.md|prompt\s+内部|schema\s+|contract\s+test|enum\s+强制", re.I),
    re.compile(r"内部重构|提取函数|变量改名|目录调整|死代码|消重", re.I),
    re.compile(r"发版脚本自身|release\.sh\s+逻辑|TCR\s+节奏|pre-commit|钩子", re.I),
    re.compile(r"仅开发者|只开发者|维护者可见|内部可见", re.I),
]

# Category detection (best-effort keyword matching)
CATEGORIES = [
    ("新功能", [r"新增", r"添加", r"支持", r"新命令", r"新功能", r"引入", r"上线"]),
    ("稳定性", [r"修复", r"崩溃", r"卡死", r"误报", r"泄漏", r"竞争", r"并发", r"死锁", r"幽灵"]),
    ("可见性", [r"显示", r"dashboard", r"状态", r"可见", r"查看", r"实时", r"弹窗", r"日志"]),
    ("自动化流水线", [r"PR\s", r"合并", r"auto-merge", r"loop\s", r"调度", r"launchd", r"定时"]),
    ("工程和测试", [r"测试", r"CI\s", r"重构", r"提取", r"优化", r"提速", r"并行"]),
]

CATEGORY_ORDER = ["新功能", "稳定性", "可见性", "自动化流水线", "工程和测试", "其他"]

# Changelog lint rules (inline copy of _changelog_lint_bullet for portability).
LINT_BACKTICK_ID = re.compile(r"`[^`]*(_|\(\))[^`]*`")
LINT_FILE_SUFFIX = re.compile(r"\.(md|sh|yml|ts|bats)([^A-Za-z0-9]|$)")
LINT_INTERNAL_WORD = re.compile(r"(Phase|Step)\s+[0-9]+|Helper|Schema|Fixture|Refactor")
LINT_PATH_FRAG = re.compile(r"(^|[^A-Za-z0-9_])(\.roll|docs|bin|tests|scripts)/")

# ─── Helpers ─────────────────────────────────────────────────────────────────


def _read_done_stories(backlog_path: Path) -> list[tuple[str, str, str]]:
    """Extract ✅ Done rows from backlog table.

    Returns list of (story_id, description, source_tag).
    """
    rows: list[tuple[str, str, str]] = []
    text = backlog_path.read_text(encoding="utf-8")
    for line in text.splitlines():
        if not line.startswith("|") or line.count("|") < 4:
            continue
        if "✅ Done" not in line:
            continue
        parts = line.split("|")
        if len(parts) < 4:
            continue
        # story id from first column
        id_m = re.search(r"\[([A-Z]+-[A-Z0-9-]+-\d+|FIX-\d+|REFACTOR-\d+)\]", parts[1])
        story_id = id_m.group(1) if id_m else ""
        desc = parts[2].strip()
        if not desc or desc.lower() == "description":
            continue
        # source tag: loop-executed stories get [loop]
        source = "loop" if re.search(r"US-AUTO|US-LOOP|FIX-|REFACTOR-", story_id) else ""
        rows.append((story_id, desc, source))
    return rows


def _is_internal(desc: str) -> bool:
    for pat in SKIP_PATTERNS:
        if pat.search(desc):
            return True
    return False


def _clean_description(desc: str) -> str:
    # Remove depends-on tags
    desc = re.sub(r"`?depends-on:[^`|]+`?", "", desc)
    # Remove markdown links — keep link text only
    desc = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", desc)
    # Collapse whitespace
    desc = re.sub(r"\s+", " ", desc).strip()
    # Remove leading em-dash / hyphen noise
    desc = re.sub(r"^[—\-]\s*", "", desc)
    return desc


def _detect_category(desc: str) -> str:
    for cat, patterns in CATEGORIES:
        for pat in patterns:
            if re.search(pat, desc, re.I):
                return cat
    return "其他"


def _already_in_changelog(story_id: str, desc: str, changelog_path: Path) -> bool:
    if not changelog_path.exists():
        return False
    text = changelog_path.read_text(encoding="utf-8")
    if story_id in text:
        return True
    # Also check by description text (cleaned, first 20 chars) to catch
    # entries that don't carry the story ID.
    desc_stub = desc[:20].strip()
    if desc_stub and desc_stub in text:
        return True
    return False


def _lint_bullet(bullet: str) -> list[str]:
    """Return list of violation tags (empty = clean)."""
    viols: list[str] = []
    stripped = re.sub(r"`[^`]*`", "", bullet)
    if LINT_BACKTICK_ID.search(bullet):
        viols.append("backtick-identifier")
    if LINT_FILE_SUFFIX.search(stripped):
        viols.append("file-suffix")
    if LINT_INTERNAL_WORD.search(bullet):
        viols.append("internal-word")
    # length: visible chars > 50
    vis_len = len(stripped.strip())
    if vis_len > 50:
        viols.append("over-length")
    if LINT_PATH_FRAG.search(stripped):
        viols.append("path-fragment")
    return viols


def _format_bullet(desc: str, source: str, story_id: str = "") -> str:
    """Render one clean changelog bullet (deterministic & idempotent, FIX-178):

        - <description>（<ID>） `[source]`

    The story id is appended at the END (never spliced into the sentence) so it
    is always traceable / audit-matchable without ever mangling the prose. The
    bold-headline polish in the project's voice is applied by a separate AI pass
    (configured agent) on top of this raw bullet — deterministic prose splitting
    on punctuation mangles parentheses/arrows, so it is intentionally avoided.
    """
    tag = f" `[{source}]`" if source else ""
    idref = f"（{story_id}）" if story_id and story_id not in desc else ""
    return f"- {desc}{idref}{tag}"


def _build_draft(groups: dict[str, list[tuple[str, str, str]]]) -> str:
    # FIX-178: emit clean styled bullets only — lint markers are a separate
    # concern (stderr summary in main), never inlined into the deliverable.
    lines = ["## Unreleased", ""]
    for cat in CATEGORY_ORDER:
        if cat not in groups:
            continue
        lines.append(f"### {cat}")
        lines.append("")
        for story_id, desc, source in groups[cat]:
            lines.append(_format_bullet(desc, source, story_id))
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def _write_to_changelog(draft: str, changelog_path: Path) -> None:
    """Merge draft into CHANGELOG.md, avoiding duplicates."""
    if changelog_path.exists():
        text = changelog_path.read_text(encoding="utf-8")
    else:
        text = "# Changelog\n\n"

    if "## Unreleased" not in text:
        # Insert right after the title
        text = text.rstrip("\n") + "\n\n" + draft
    else:
        # Extract existing Unreleased section, merge new bullets
        # Pattern: from ## Unreleased up to next ## or EOF
        m = re.search(r"^(## Unreleased\s*\n)(.*?)(?=\n## |\Z)", text, re.MULTILINE | re.DOTALL)
        if not m:
            text = text.rstrip("\n") + "\n\n" + draft
        else:
            existing = m.group(2)
            new_lines = draft.splitlines()[2:]  # drop "## Unreleased" and blank line
            merged = existing.rstrip("\n") + "\n"
            for line in new_lines:
                # Skip category headers already present
                if line.startswith("### ") and line in existing:
                    continue
                # Skip bullets already present
                bullet_core = re.sub(r"\s*\[loop\]\s*$", "", line).strip()
                if bullet_core and bullet_core not in existing:
                    merged += line + "\n"
            text = text[: m.start()] + "## Unreleased\n" + merged + text[m.end() :]

    changelog_path.write_text(text, encoding="utf-8")


# ─── US-CL-007: merged PR gap detection ──────────────────────────────────────


def _latest_release_tag() -> str | None:
    """Find the latest v* tag using git."""
    try:
        result = subprocess.run(
            ["git", "describe", "--tags", "--abbrev=0", "--match", "v*"],
            capture_output=True, text=True, check=True
        )
        return result.stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


def _commit_log_since_last_release() -> str | None:
    """Concatenated commit subjects since the last release tag (FIX-177).

    Used for release-aware unreleased detection: a ✅ Done story is unreleased
    iff its id appears here. Returns None when there is no release tag or git is
    unavailable, so the caller falls back to the CHANGELOG-text dedup.
    """
    tag = _latest_release_tag()
    if not tag:
        return None
    try:
        result = subprocess.run(
            ["git", "log", f"{tag}..HEAD", "--pretty=format:%s"],
            capture_output=True, text=True, check=True
        )
        return result.stdout
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


def _gh_available() -> bool:
    """Check whether the gh CLI is installed and on PATH."""
    try:
        result = subprocess.run(
            ["gh", "--version"],
            capture_output=True, text=True, timeout=5
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def _merged_prs_since_tag(tag: str) -> list[tuple[str, str, str]]:
    """Return list of (pr_number, title, commit_msg) for PRs merged since tag.

    PR numbers are extracted from commit messages (e.g. ``(#123)``).
    Titles are enriched via ``gh pr view`` when available.
    """
    try:
        result = subprocess.run(
            ["git", "log", f"{tag}..HEAD", "--pretty=format:%H %s"],
            capture_output=True, text=True, check=True
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        return []

    prs: list[tuple[str, str, str]] = []
    seen: set[str] = set()
    for line in result.stdout.strip().splitlines():
        if not line:
            continue
        parts = line.split(" ", 1)
        if len(parts) < 2:
            continue
        _commit_hash, subject = parts
        m = re.search(r"\(#(\d+)\)", subject)
        if not m:
            continue
        pr_num = m.group(1)
        if pr_num in seen:
            continue
        seen.add(pr_num)

        title = subject
        if _gh_available():
            try:
                gh_result = subprocess.run(
                    ["gh", "pr", "view", pr_num, "--json", "title"],
                    capture_output=True, text=True, timeout=10
                )
                if gh_result.returncode == 0:
                    gh_data = json.loads(gh_result.stdout)
                    title = gh_data.get("title", subject)
            except (json.JSONDecodeError, subprocess.TimeoutExpired):
                pass

        prs.append((pr_num, title, subject))
    return prs


def _pr_in_done_rows(pr_number: str, backlog_path: Path) -> bool:
    """Check whether the PR number appears in any ✅ Done row of the backlog."""
    text = backlog_path.read_text(encoding="utf-8")
    for line in text.splitlines():
        if "✅ Done" in line and f"#{pr_number}" in line:
            return True
    return False


def _pr_is_covered(
    pr_number: str,
    pr_title: str,
    commit_msg: str,
    done_story_ids: set[str],
    changelog_text: str,
) -> bool:
    """Check if a merged PR is already represented in backlog or changelog."""
    # By PR number in CHANGELOG
    if f"#{pr_number}" in changelog_text:
        return True
    # By story ID appearing in PR title / commit message
    for story_id in done_story_ids:
        if story_id and (story_id in pr_title or story_id in commit_msg):
            return True
    return False


def _uncarded_to_entries(uncarded: list[tuple[str, str]]) -> list[tuple[str, str, str, str]]:
    """FIX-179: convert uncarded merged PRs (pr_num, title) into draft entries
    (id, desc, source, category) so they fold into the categorized draft as
    normal bullets. The old behaviour emitted a separate '⚠️ 待确认 … 请确认'
    block — a maintainer prompt that must NEVER reach the published CHANGELOG
    (it leaked into v2.603.1). The "lacked a card" notice now goes to stderr.

    Uses the PR title as the description (stripped of conventional-commit
    prefixes and the leading id); the story/fix id when present, else PR#<n>.
    """
    entries: list[tuple[str, str, str, str]] = []
    for pr_num, title in uncarded:
        t = re.sub(
            r"^\s*(Fix|tcr|docs|chore|feat|refactor|perf|test|Story\s+\d+)\s*[:：]\s*",
            "", title, flags=re.I,
        )
        idm = re.search(r"\b(US-[A-Z]+-\d+|FIX-\d+|REFACTOR-\d+)\b", title)
        sid = idm.group(1) if idm else f"PR#{pr_num}"
        if idm:
            t = re.sub(r"\b" + re.escape(idm.group(1)) + r"\b\s*[:：]?\s*", "", t).strip()
        cleaned = _clean_description(t) or t.strip()
        cat = _detect_category(cleaned)
        src = "loop" if re.search(r"US-AUTO|US-LOOP|FIX-|REFACTOR-", sid) else ""
        entries.append((sid, cleaned, src, cat))
    return entries


# ─── Main ────────────────────────────────────────────────────────────────────


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Generate a draft ## Unreleased section from backlog ✅ Done stories."
    )
    ap.add_argument("--backlog", default=".roll/backlog.md", help="Path to backlog file")
    ap.add_argument("--changelog", default="CHANGELOG.md", help="Path to CHANGELOG.md")
    ap.add_argument("--write", action="store_true", help="Write draft to CHANGELOG.md")
    ap.add_argument("--json", action="store_true", help="Machine-readable output")
    args = ap.parse_args()

    backlog = Path(args.backlog)
    changelog = Path(args.changelog)

    if not backlog.exists():
        print("Error: backlog file not found", file=sys.stderr)
        return 1

    rows = _read_done_stories(backlog)

    # FIX-177: only draft stories that are actually UNRELEASED. The backlog holds
    # every ✅ Done story ever (500+), most already shipped in past versions; the
    # CHANGELOG only carries recent versions, so filtering by "already in
    # CHANGELOG text" let hundreds of long-released stories leak into the draft.
    # Release-aware rule: a story is unreleased iff its id is referenced by a
    # commit merged since the last release tag (git log <tag>..HEAD). Old stories
    # never appear there and are correctly excluded. Falls back to the
    # CHANGELOG-text filter when git/tag are unavailable (e.g. test sandboxes).
    since_tag_log = _commit_log_since_last_release()

    filtered: list[tuple[str, str, str, str]] = []
    for story_id, desc, source in rows:
        if since_tag_log is not None:
            # Release-aware: skip stories not named in any post-release commit.
            if not story_id or story_id not in since_tag_log:
                continue
        elif _already_in_changelog(story_id, desc, changelog):
            continue
        if _is_internal(desc):
            continue
        cleaned = _clean_description(desc)
        if not cleaned:
            continue
        cat = _detect_category(cleaned)
        filtered.append((story_id, cleaned, source, cat))

    # ── US-CL-007: gap detection ───────────────────────────────────────────
    uncarded: list[tuple[str, str]] = []
    tag = _latest_release_tag()
    if tag and _gh_available():
        merged_prs = _merged_prs_since_tag(tag)
        done_story_ids = {sid for sid, _desc, _src in rows}
        changelog_text = changelog.read_text(encoding="utf-8") if changelog.exists() else ""
        for pr_num, pr_title, commit_msg in merged_prs:
            if _pr_in_done_rows(pr_num, backlog):
                continue
            if _pr_is_covered(pr_num, pr_title, commit_msg, done_story_ids, changelog_text):
                continue
            uncarded.append((pr_num, pr_title))

    if args.json:
        payload = {
            "stories_found": len(rows),
            "stories_drafted": len(filtered),
            "draft": [
                {"id": sid, "desc": d, "category": c, "source": s}
                for sid, d, s, c in filtered
            ],
            "uncarded_merged": [
                {"pr": num, "title": title}
                for num, title in uncarded
            ],
        }
        json.dump(payload, sys.stdout, indent=2, ensure_ascii=False)
        print()
        return 0

    if not filtered and not uncarded:
        print("# No new ✅ Done stories found for CHANGELOG.")
        return 0

    # FIX-179: fold uncarded merged PRs INTO the categorized draft (complete
    # coverage) rather than a separate '请确认' warning block — that maintainer
    # prompt must never reach the published CHANGELOG. The "lacked a card"
    # notice goes to STDERR so the human still sees what to back-fill.
    all_entries: list[tuple[str, str, str, str]] = list(filtered) + _uncarded_to_entries(uncarded)
    if uncarded:
        pr_list = " ".join(f"#{p}" for p, _t in uncarded)
        print(
            f"note: {len(uncarded)} 个 merged PR 未建卡,已按 PR 标题并入草稿,建议补卡: {pr_list}",
            file=sys.stderr,
        )

    # FIX-178: style-lint warnings go to STDERR so the stdout draft stays clean
    # (no inline `# lint:` markers in the deliverable). The human still sees them.
    for story_id, desc, source, _cat in all_entries:
        viols = _lint_bullet(_format_bullet(desc, source, story_id))
        if viols:
            print(f"lint: {story_id or '?'}: {', '.join(viols)}", file=sys.stderr)

    groups: dict[str, list[tuple[str, str, str]]] = {}
    for story_id, desc, source, cat in all_entries:
        groups.setdefault(cat, []).append((story_id, desc, source))
    draft = _build_draft(groups)

    if args.write:
        _write_to_changelog(draft, changelog)
        print(f"Updated {changelog}")
    else:
        print(draft, end="")

    return 0


if __name__ == "__main__":
    sys.exit(main())
