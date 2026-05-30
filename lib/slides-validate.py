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

# Every slide must always carry a bilingual title.
REQUIRED_TITLE_KEYS = ("title_en", "title_zh")

# ── Layout schema (US-DECK-017) ──────────────────────────────────────────────
#
# The default layout (and the implicit layout for slides with no `layout:`
# field) is `plain`, which keeps the Phase 1.5 `body_en` / `body_zh` contract.
# Every other layout declares its required fields so the validator can flag a
# missing field with a concrete line number + an example snippet.
#
# Field contracts mirror the Mustache partials shipped by US-DECK-016 in
# lib/slides/components/<layout>.html — keep the two in sync.

DEFAULT_LAYOUT = "plain"

# scalar required fields per layout (besides the always-required title_en/zh).
_LAYOUT_SCALAR_FIELDS = {
    "plain": ("body_en", "body_zh"),
    "cards-2": (),
    "cards-3": (),
    "cards-4": (),
    "compare": (
        "left_title_en",
        "left_title_zh",
        "right_title_en",
        "right_title_zh",
    ),
    "pipeline": (),
    "timeline": (),
    "quote": ("text_en", "text_zh"),
    "highlight": ("body_en", "body_zh"),
}

# list-of-mapping required fields: layout -> (list_key, (item_field, ...)).
_LAYOUT_LIST_FIELDS = {
    "cards-2": ("cards", ("title_en", "title_zh", "body_en", "body_zh")),
    "cards-3": ("cards", ("title_en", "title_zh", "body_en", "body_zh")),
    "cards-4": ("cards", ("title_en", "title_zh", "body_en", "body_zh")),
    "pipeline": ("stages", ("title_en", "title_zh", "desc_en", "desc_zh")),
    "timeline": ("items", ("title_en", "title_zh", "body_en", "body_zh")),
    "compare": ("left_items", ("text_en", "text_zh")),
}
# compare also requires a right_items list with the same item shape.
_LAYOUT_EXTRA_LISTS = {
    "compare": (("right_items", ("text_en", "text_zh")),),
}

LAYOUT_WHITELIST = tuple(_LAYOUT_SCALAR_FIELDS.keys())

# Minimal example snippet per layout, shown when a required field is missing.
_LAYOUT_EXAMPLES = {
    "cards-2": 'cards:\n  - title_en: "..."\n    title_zh: "..."\n    '
    'body_en: "..."\n    body_zh: "..."',
    "cards-3": 'cards:\n  - title_en: "..."\n    title_zh: "..."\n    '
    'body_en: "..."\n    body_zh: "..."',
    "cards-4": 'cards:\n  - title_en: "..."\n    title_zh: "..."\n    '
    'body_en: "..."\n    body_zh: "..."',
    "compare": 'left_title_en: "..."\nleft_title_zh: "..."\n'
    'right_title_en: "..."\nright_title_zh: "..."\n'
    'left_items:\n  - text_en: "..."\n    text_zh: "..."\n'
    'right_items:\n  - text_en: "..."\n    text_zh: "..."',
    "pipeline": 'stages:\n  - title_en: "..."\n    title_zh: "..."\n    '
    'desc_en: "..."\n    desc_zh: "..."',
    "timeline": 'items:\n  - title_en: "..."\n    title_zh: "..."\n    '
    'body_en: "..."\n    body_zh: "..."',
    "quote": 'text_en: "..."\ntext_zh: "..."',
    "highlight": 'body_en: |\n  ...\nbody_zh: |\n  ...',
    "plain": 'body_en: |\n  ...\nbody_zh: |\n  ...',
}


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


def _slide_header_lines(src: str) -> dict:
    """Map slide number -> 1-based source line of its `## Slide N` header."""
    import re

    header_re = re.compile(r"^##\s+Slide\s+(\d+)\s*$")
    out: dict = {}
    for idx, line in enumerate(src.splitlines(), start=1):
        m = header_re.match(line)
        if m:
            out[int(m.group(1))] = idx
    return out


def slide_layout(slide: dict) -> str:
    """Return a slide's declared layout, defaulting to `plain` when absent."""
    layout = slide.get("layout")
    if not layout:
        return DEFAULT_LAYOUT
    return str(layout)


def _is_empty(v) -> bool:
    return v is None or (isinstance(v, str) and v.strip() == "")


def validate_slides(fm: dict, slides: list[dict], line_of: dict | None = None) -> list[str]:
    errors: list[str] = []
    line_of = line_of or {}
    actual = len(slides)
    declared = fm.get("total_slides")
    if isinstance(declared, int) and declared != actual:
        errors.append(
            f"total_slides mismatch: frontmatter declares {declared} but "
            f"found {actual} `## Slide N` sections"
        )
    for slide in slides:
        errors += validate_slide_layout(slide, line_of)
    return errors


def validate_slide_layout(slide: dict, line_of: dict | None = None) -> list[str]:
    """
    Validate a single slide's required fields for its declared layout.

    - Title fields are always required.
    - A missing `layout:` is treated as `plain` (no error — backward compat).
    - An unknown layout name is rejected against the whitelist.
    - Per-layout scalar + list-of-mapping required fields are checked, with the
      concrete `deck.md:<line>` location (header line of the slide) and a field
      example for the layout.
    """
    line_of = line_of or {}
    errors: list[str] = []
    n = slide.get("number", "?")
    line = line_of.get(n)
    loc = f"deck.md:{line}" if line else f"slide {n}"

    # Title is always required regardless of layout.
    for key in REQUIRED_TITLE_KEYS:
        if _is_empty(slide.get(key)):
            errors.append(f"slide {n} ({loc}): missing or empty {key}")

    layout = slide_layout(slide)
    if layout not in LAYOUT_WHITELIST:
        errors.append(
            f"slide {n} ({loc}): unknown layout {layout!r}; "
            f"allowed: {', '.join(LAYOUT_WHITELIST)}"
        )
        return errors

    example = _LAYOUT_EXAMPLES.get(layout, "")

    def missing(field: str) -> None:
        msg = f"slide {n} ({loc}): layout {layout!r} requires field {field!r}"
        if example:
            msg += f"\nHint: example for {layout}:\n{example}"
        errors.append(msg)

    # Scalar required fields.
    for field in _LAYOUT_SCALAR_FIELDS.get(layout, ()):
        if _is_empty(slide.get(field)):
            missing(field)

    # List-of-mapping required fields.
    list_specs: list = []
    if layout in _LAYOUT_LIST_FIELDS:
        list_specs.append(_LAYOUT_LIST_FIELDS[layout])
    list_specs += list(_LAYOUT_EXTRA_LISTS.get(layout, ()))
    for list_key, item_fields in list_specs:
        items = slide.get(list_key)
        if not isinstance(items, list) or not items:
            missing(list_key)
            continue
        for idx, item in enumerate(items, start=1):
            if not isinstance(item, dict):
                errors.append(
                    f"slide {n} ({loc}): {list_key}[{idx}] must be a mapping "
                    f"with {', '.join(item_fields)}"
                )
                continue
            for f in item_fields:
                if _is_empty(item.get(f)):
                    errors.append(
                        f"slide {n} ({loc}): {list_key}[{idx}] missing {f!r}"
                    )
    return errors


def lint_slide_layout(slide: dict) -> list[str]:
    """
    Non-fatal layout warnings (returned separately so the caller can print but
    not fail). Currently: declaring a rich layout while also carrying a stray
    `body_en` / `body_zh` that the layout will not consume (possible waste).
    """
    warnings: list[str] = []
    layout = slide_layout(slide)
    if layout in ("plain", "highlight"):
        return warnings  # these layouts legitimately consume body_en/zh
    n = slide.get("number", "?")
    for f in ("body_en", "body_zh"):
        if not _is_empty(slide.get(f)):
            warnings.append(
                f"slide {n}: layout {layout!r} does not use {f!r}; "
                f"the field will be ignored (possible waste)"
            )
    return warnings


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

    line_of = _slide_header_lines(src)

    schema_errors: list[str] = []
    schema_errors += validate_frontmatter(fm)
    schema_errors += validate_slides(fm, slides, line_of)

    if schema_errors:
        for e in schema_errors:
            err(e)
        return 1

    # Non-fatal layout lint warnings (e.g. a rich layout carrying a stray body
    # that it will not consume). These print but do not change the exit code.
    for slide in slides:
        for w in lint_slide_layout(slide):
            err(f"⚠️ {w}")

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
