#!/usr/bin/env python3
"""
US-DECK-002: deck.md schema + grounding validator.

Reads a `deck.md` file, parses it with the same parser used by the renderer
(`lib/slides-render.py`), and verifies:

  1. Required frontmatter fields are present:
       template, slug, title_en, title_zh, total_slides, created
  2. frontmatter.total_slides matches the actual `## Slide N` section count.
  3. Each slide has non-empty title_en / title_zh / body_en / body_zh.
  4. Grounding threshold: at least ceil(N/3) evidence citations across all
     slides (i.e. >= 1 per 3 slides). If the deck has fewer, the validator
     exits non-zero with a ⚠️ grounding warning so callers (e.g.
     `roll slides build`) can flag it.

Usage:
    python3 slides-validate.py <deck.md>

Exit codes:
    0   valid (schema OK + grounding threshold met)
    1   schema error (missing field, mismatch, missing slide body, etc.)
    2   grounding warning (schema OK but evidence below threshold)
    3   file not found / unreadable / parse error

Error messages are written to stderr in English + Chinese (Roll bilingual
convention).
"""

from __future__ import annotations

import importlib.util
import math
import sys
from pathlib import Path


REQUIRED_FRONTMATTER = (
    "template",
    "slug",
    "title_en",
    "title_zh",
    "total_slides",
    "created",
)
REQUIRED_SLIDE_KEYS = ("title_en", "title_zh", "body_en", "body_zh")


def _load_renderer():
    """Import lib/slides-render.py as a module (hyphenated filename, so we
    can't `import slides_render` directly)."""
    here = Path(__file__).resolve().parent
    spec = importlib.util.spec_from_file_location(
        "slides_render", str(here / "slides-render.py")
    )
    if spec is None or spec.loader is None:
        raise ImportError("could not load slides-render.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def err(msg_en: str, msg_zh: str = "") -> None:
    print(f"[slides-validate] {msg_en}", file=sys.stderr)
    if msg_zh:
        print(f"[slides-validate] {msg_zh}", file=sys.stderr)


def validate_frontmatter(fm: dict) -> list[str]:
    errors: list[str] = []
    for key in REQUIRED_FRONTMATTER:
        if key not in fm or fm[key] == "" or fm[key] is None:
            errors.append(f"missing required frontmatter field: {key}")
    if "total_slides" in fm and not isinstance(fm["total_slides"], int):
        errors.append(
            f"total_slides must be an integer, got "
            f"{type(fm['total_slides']).__name__}: {fm['total_slides']!r}"
        )
    return errors


def validate_slides(fm: dict, slides: list[dict]) -> list[str]:
    errors: list[str] = []
    actual = len(slides)
    declared = fm.get("total_slides")
    if isinstance(declared, int) and declared != actual:
        errors.append(
            f"total_slides mismatch: frontmatter declares {declared} but "
            f"found {actual} `## Slide N` sections"
        )
    for slide in slides:
        n = slide.get("number", "?")
        for key in REQUIRED_SLIDE_KEYS:
            v = slide.get(key)
            if v is None or (isinstance(v, str) and v.strip() == ""):
                errors.append(f"slide {n}: missing or empty {key}")
    return errors


def evaluate_grounding(slides: list[dict]) -> tuple[int, int, bool]:
    """
    Return (citations, threshold, meets_threshold).

    The threshold is `ceil(len(slides) / 3)` — i.e. at least one evidence
    citation per three slides. An empty deck trivially meets the threshold
    (threshold = 0).
    """
    citations = 0
    for slide in slides:
        ev = slide.get("evidence")
        if isinstance(ev, list):
            citations += len(ev)
    threshold = math.ceil(len(slides) / 3) if slides else 0
    return citations, threshold, citations >= threshold


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        err(
            "usage: slides-validate.py <deck.md>",
            "用法: slides-validate.py <deck.md>",
        )
        return 3

    path = Path(argv[1])
    if not path.is_file():
        err(f"deck file not found: {path}", f"未找到 deck 文件：{path}")
        return 3

    try:
        renderer = _load_renderer()
    except Exception as e:
        err(f"could not load renderer module: {e}")
        return 3

    try:
        src = path.read_text(encoding="utf-8")
        fm, body = renderer.parse_frontmatter(src)
        slides = renderer.parse_slides(body)
    except (ValueError, OSError) as e:
        err(f"failed to parse deck.md: {e}", "解析 deck.md 失败")
        return 3

    schema_errors: list[str] = []
    schema_errors += validate_frontmatter(fm)
    schema_errors += validate_slides(fm, slides)

    if schema_errors:
        for e in schema_errors:
            err(e)
        return 1

    citations, threshold, ok = evaluate_grounding(slides)
    if not ok:
        err(
            f"⚠️ grounding below threshold: {citations} evidence citation(s) "
            f"for {len(slides)} slides (need >= {threshold}). "
            f"Each slide group of 3 must include at least one evidence entry.",
            f"⚠️ 证据引用不足：{len(slides)} 张幻灯片仅有 {citations} 条 evidence，"
            f"至少需要 {threshold} 条（每 3 张 ≥ 1 条）。",
        )
        return 2

    # Valid — silent success.
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
