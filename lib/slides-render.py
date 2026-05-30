#!/usr/bin/env python3
"""
US-DECK-002: deck.md -> HTML renderer.

Reads a `deck.md` file (YAML-ish frontmatter + per-slide sections), reads a
Mustache-style template, and writes a self-contained HTML document to stdout.

Zero new dependencies — Python stdlib only. The "YAML" frontmatter and
per-slide block parsers handle only the subset of YAML used by the deck.md
schema (scalar key/value pairs, `key: |` block literal bodies, and a
`evidence:` list of `- item` lines). Anything beyond that subset is out of
scope on purpose.

Usage:
    python3 slides-render.py <deck.md> <template.html> [out.html]

If no out path is given, the rendered HTML is written to stdout.

Exit codes:
    0   render succeeded
    1   deck.md missing or unreadable
    2   template missing or unreadable
    3   parse / render error

Supported Mustache subset (documented for users):

    {{var}}                    HTML-escaped substitution
    {{{var}}}                  Raw substitution (no escape)
    {{#section}}...{{/section}}
                               If `section` is a list, render the body once
                               per item with the item dict pushed onto the
                               context stack. If `section` is truthy non-list,
                               render the body once with the same context.
    {{^section}}...{{/section}}
                               Inverted section — render the body iff
                               `section` is missing, falsy, or an empty list.

    Explicitly NOT supported: partials ({{>name}}), lambdas, set delimiters
    ({{=<% %>=}}), and triple-mustache with HTML pass-through inside sections
    (use {{{var}}} on simple keys only).
"""

from __future__ import annotations

import html as _html
import re
import sys
from pathlib import Path


# ──────────────────────────── deck.md parser ────────────────────────────────


def parse_frontmatter(src: str) -> tuple[dict, str]:
    """
    Split a deck.md source into (frontmatter dict, body text).

    The frontmatter is delimited by a leading `---` line and a trailing `---`
    line. Inside, each non-blank line is a `key: value` pair. Quoted values
    have their wrapping quotes stripped. Integer-looking values are coerced
    to int.
    """
    lines = src.splitlines()
    if not lines or lines[0].strip() != "---":
        raise ValueError("deck.md must start with a '---' frontmatter delimiter")
    end = None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end = i
            break
    if end is None:
        raise ValueError("deck.md frontmatter missing closing '---' delimiter")

    fm: dict = {}
    for raw in lines[1:end]:
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        if ":" not in raw:
            raise ValueError(f"frontmatter line not a key:value pair: {raw!r}")
        key, _, val = raw.partition(":")
        fm[key.strip()] = _coerce_scalar(val.strip())

    body = "\n".join(lines[end + 1 :])
    return fm, body


def _coerce_scalar(v: str):
    """Strip wrapping quotes; coerce int-looking values to int."""
    if len(v) >= 2 and v[0] == v[-1] and v[0] in ("'", '"'):
        return v[1:-1]
    if v.lower() == "true":
        return True
    if v.lower() == "false":
        return False
    try:
        return int(v)
    except ValueError:
        pass
    return v


# Keys whose `- item` children are always flat scalar strings, never coerced
# into mappings even when an item contains a colon (e.g. `evidence:` citations
# like `- TODO: see README.md:1`).
_SCALAR_LIST_KEYS = ("evidence",)


# A slide section starts at a line matching `^## Slide \d+` and continues
# until the next such line or EOF.
_SLIDE_HEADER_RE = re.compile(r"^##\s+Slide\s+(\d+)\s*$")


def parse_slides(body: str) -> list[dict]:
    """
    Walk the body and split it into slide dicts.

    Each slide dict has keys: number (int), title_en, title_zh, body_en,
    body_zh, evidence (list[str]). Missing keys are left absent so that
    validation can report them.
    """
    lines = body.splitlines()
    slides: list[dict] = []
    cur: dict | None = None
    cur_lines: list[str] = []
    for line in lines:
        m = _SLIDE_HEADER_RE.match(line)
        if m:
            if cur is not None:
                _populate_slide(cur, cur_lines)
                slides.append(cur)
            cur = {"number": int(m.group(1))}
            cur_lines = []
        else:
            if cur is not None:
                cur_lines.append(line)
    if cur is not None:
        _populate_slide(cur, cur_lines)
        slides.append(cur)
    return slides


def _populate_slide(slide: dict, content_lines: list[str]) -> None:
    """
    Parse the lines following a `## Slide N` header into the slide dict.

    Grammar (subset):
        key: "value"                        -> scalar
        key: |                              -> block literal, takes indented
          line one                             lines until the indent drops.
          line two
        evidence:                           -> list, takes `- item` lines
          - one.md:1
          - two.md:7
    """
    i = 0
    n = len(content_lines)
    while i < n:
        raw = content_lines[i]
        stripped = raw.strip()
        if not stripped:
            i += 1
            continue
        if ":" not in raw:
            i += 1
            continue
        key, _, val = raw.partition(":")
        key = key.strip()
        val = val.strip()

        if val == "|":
            # Block literal: gather lines until the indent drops below the
            # indent of the first non-blank line. Strip exactly that common
            # indent from every line so the body markdown starts at column 0.
            block: list[str] = []
            common_indent: int | None = None
            i += 1
            while i < n:
                bl = content_lines[i]
                if bl.strip() == "":
                    block.append("")
                    i += 1
                    continue
                indent = len(bl) - len(bl.lstrip(" "))
                if common_indent is None:
                    if indent == 0:
                        # No indent at all → block literal is empty.
                        break
                    common_indent = indent
                elif indent < common_indent:
                    break
                block.append(bl[common_indent:])
                i += 1
            while block and block[-1] == "":
                block.pop()
            slide[key] = "\n".join(block) + "\n" if block else ""
        elif val == "":
            # A bare `key:` introduces an indented child block, which may be:
            #   - a list of scalars      (`- one.md:1`)        -> list[str]
            #   - a list of mappings     (`- title_en: "..."`) -> list[dict]
            #   - a nested mapping       (`  left_title_en: …`) -> dict
            # or, if no indented child follows, an empty scalar.
            key_indent = len(raw) - len(raw.lstrip(" "))
            block, j = _collect_indented_block(content_lines, i + 1, key_indent)
            if block:
                # `evidence` is always a flat list of free-form citation
                # strings (e.g. `- TODO: see README.md:1`), so it must never be
                # coerced into a mapping by the generic block parser.
                if key in _SCALAR_LIST_KEYS:
                    slide[key] = _parse_scalar_list(block)
                else:
                    slide[key] = _parse_block(block)
                i = j
            else:
                slide[key] = ""
                i += 1
        else:
            slide[key] = _coerce_scalar(val)
            i += 1


def _collect_indented_block(
    lines: list[str], start: int, parent_indent: int
) -> tuple[list[str], int]:
    """
    Gather lines that belong to the indented child block of a `key:` at
    `parent_indent`. A line belongs to the block if it is blank or indented
    strictly deeper than the parent key. Returns (block_lines, next_index).

    Trailing blank lines are dropped so an all-blank block reads as empty.
    """
    block: list[str] = []
    j = start
    n = len(lines)
    while j < n:
        bl = lines[j]
        if bl.strip() == "":
            block.append("")
            j += 1
            continue
        indent = len(bl) - len(bl.lstrip(" "))
        if indent <= parent_indent:
            break
        block.append(bl)
        j += 1
    while block and block[-1] == "":
        block.pop()
    return block, j


def _parse_block(block: list[str]):
    """
    Parse an indented YAML-subset block into a list or a dict.

    - If the first non-blank line starts with `- `, the block is a sequence.
      Each `- ` opens a new item; a scalar follows `- ` directly (list of
      scalars) or a `key: value` does (list of mappings, with subsequent
      deeper-indented `key: value` lines folded into the same item).
    - Otherwise the block is a mapping of `key: value` / `key:` (nested)
      entries.

    Scalars are coerced via `_coerce_scalar`. Nested `key:` with no inline
    value recurse into another block (supports `compare`'s `left_items:`).
    """
    # Find the indentation of the block's own top level (first non-blank line).
    first = next((b for b in block if b.strip() != ""), "")
    base_indent = len(first) - len(first.lstrip(" "))

    if first.lstrip().startswith("- "):
        return _parse_sequence(block, base_indent)
    return _parse_mapping(block, base_indent)


def _parse_sequence(block: list[str], base_indent: int) -> list:
    """Parse a `- ...` sequence at `base_indent` into list[str] | list[dict]."""
    items: list = []
    i = 0
    n = len(block)
    while i < n:
        line = block[i]
        if line.strip() == "":
            i += 1
            continue
        stripped = line.lstrip()
        # Only treat a `- ` at the sequence's own indent as an item start.
        indent = len(line) - len(stripped)
        if indent == base_indent and stripped.startswith("- "):
            # Strip the dash and ALL following spaces; `content_col` is the
            # column where the item's first key actually begins, which equals
            # the indent of the item's continuation lines in well-formed YAML.
            after_dash = stripped[1:]
            rest = after_dash.lstrip(" ")
            content_col = indent + 1 + (len(after_dash) - len(rest))
            if ":" in rest and not _looks_like_scalar(rest):
                # List of mappings. Re-indent the inline key to `content_col`
                # so the sub-block has one consistent base indent regardless of
                # how the author spaced the `- ` (fixes hardcoded-indent
                # mis-parse).
                sub = [(" " * content_col) + rest]
                i += 1
                while i < n:
                    bl = block[i]
                    if bl.strip() == "":
                        sub.append("")
                        i += 1
                        continue
                    bi = len(bl) - len(bl.lstrip(" "))
                    if bi <= base_indent:
                        break
                    sub.append(bl)
                    i += 1
                items.append(_parse_mapping(sub, content_col))
            else:
                items.append(_coerce_scalar(rest.strip()))
                i += 1
        else:
            # Defensive: ignore stray lines that don't open an item.
            i += 1
    return items


def _parse_mapping(block: list[str], base_indent: int | None = None) -> dict:
    """Parse `key: value` / `key:` (nested / block-literal) lines into a dict.

    `base_indent` defaults to the indent of the block's first non-blank line so
    callers need not compute it; only top-level keys at that indent are read,
    deeper lines are folded into the value of the key they belong to.
    """
    out: dict = {}
    i = 0
    n = len(block)
    if base_indent is None:
        first = next((b for b in block if b.strip() != ""), "")
        base_indent = len(first) - len(first.lstrip(" "))
    while i < n:
        line = block[i]
        if line.strip() == "" or ":" not in line:
            i += 1
            continue
        indent = len(line) - len(line.lstrip(" "))
        if indent != base_indent:
            # Belongs to a deeper structure handled by recursion; skip.
            i += 1
            continue
        key, _, val = line.partition(":")
        key = key.strip()
        val = val.strip()
        if val == "|":
            block_lines, j = _collect_indented_block(block, i + 1, base_indent)
            out[key] = _dedent_block_literal(block_lines)
            i = j
        elif val == "":
            child, j = _collect_indented_block(block, i + 1, base_indent)
            if child:
                if key in _SCALAR_LIST_KEYS:
                    out[key] = _parse_scalar_list(child)
                else:
                    out[key] = _parse_block(child)
                i = j
            else:
                out[key] = ""
                i += 1
        else:
            out[key] = _coerce_scalar(val)
            i += 1
    return out


def _dedent_block_literal(block_lines: list[str]) -> str:
    """Strip the common leading indent of a `key: |` block literal and join the
    lines, matching the top-level block-literal handling in `_populate_slide`."""
    out: list[str] = []
    common_indent: int | None = None
    for bl in block_lines:
        if bl.strip() == "":
            out.append("")
            continue
        indent = len(bl) - len(bl.lstrip(" "))
        if common_indent is None:
            common_indent = indent
        elif indent < common_indent:
            common_indent = indent
    if common_indent is None:
        return ""
    for bl in block_lines:
        out.append(bl[common_indent:] if bl.strip() != "" else "")
    while out and out[-1] == "":
        out.pop()
    return "\n".join(out) + "\n" if out else ""


def _parse_scalar_list(block: list[str]) -> list:
    """Parse a `- item` sequence as a flat list of scalar strings, regardless of
    whether an item contains a colon (used for `evidence:` citations)."""
    items: list = []
    for line in block:
        s = line.strip()
        if s.startswith("- "):
            items.append(_coerce_scalar(s[2:].strip()))
    return items


def _looks_like_scalar(rest: str) -> bool:
    """A `- ` item is a scalar (not a mapping) when the text before the first
    colon looks like a value rather than a bare key — e.g. a path `README.md:42`
    where the colon is part of the value. Heuristic: it's a mapping only when
    the segment before the colon is a bare identifier (word chars / underscore)
    and is immediately followed by a space or end-of-string."""
    head, sep, tail = rest.partition(":")
    if not sep:
        return True
    head = head.strip()
    if not head or not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", head):
        return True
    # `key:value` with no space is treated as a scalar (e.g. `README.md:42`
    # never reaches here since `.` breaks the identifier rule, but a bare
    # `word:7` would — require a space after the colon for a mapping).
    if tail and not tail.startswith(" ") and not tail == "":
        return True
    return False


# ─────────────────────────── Mustache subset ─────────────────────────────────


# Match either {{{raw}}} or {{tag}} (which may be #section, ^inverted, /close).
# {{{...}}} must be tried first because of greedy match.
_MU_RE = re.compile(r"\{\{\{(\w+)\}\}\}|\{\{([#^/]?)\s*(\w+)\s*\}\}")


def mustache(template: str, context: dict) -> str:
    """
    Render a Mustache-subset template against `context`.

    Implementation is a simple stack-based parser: scan tokens left to right;
    keep a "section stack" of (kind, key, sub_template_start) frames. When a
    closing tag matches the top frame, render the captured sub-template once
    per item (for `#`) or once if falsy (for `^`).
    """
    out: list[str] = []
    pos = 0
    # We'll walk the template; when we see {{#x}} or {{^x}} we collect tokens
    # until the matching {{/x}}, accounting for nested same-name sections.
    stack: list[tuple[str, str, int]] = []  # (kind, key, start_pos_in_out)
    # We need to re-render section bodies with possibly multiple contexts, so
    # we capture the raw substring between {{#x}} and {{/x}} and recurse.
    def render_chunk(chunk: str, ctx_stack: list[dict]) -> str:
        buf: list[str] = []
        i = 0
        while i < len(chunk):
            m = _MU_RE.search(chunk, i)
            if not m:
                buf.append(chunk[i:])
                break
            buf.append(chunk[i : m.start()])
            raw_key = m.group(1)
            sigil = m.group(2)
            tag_key = m.group(3)
            if raw_key:
                # {{{raw}}}
                buf.append(str(_lookup(ctx_stack, raw_key)))
                i = m.end()
                continue
            if sigil == "":
                # {{var}} escaped
                buf.append(_html.escape(str(_lookup(ctx_stack, tag_key)), quote=True))
                i = m.end()
                continue
            if sigil == "#" or sigil == "^":
                # Find matching close.
                close_idx = _find_close(chunk, m.end(), tag_key)
                inner = chunk[m.end() : close_idx]
                val = _lookup(ctx_stack, tag_key)
                if sigil == "#":
                    if isinstance(val, list):
                        for item in val:
                            sub_ctx = item if isinstance(item, dict) else {".": item}
                            buf.append(render_chunk(inner, ctx_stack + [sub_ctx]))
                    elif val:
                        sub_ctx = val if isinstance(val, dict) else {}
                        buf.append(render_chunk(inner, ctx_stack + [sub_ctx]))
                    # else: render nothing
                else:  # ^
                    is_empty_list = isinstance(val, list) and len(val) == 0
                    if (not val) or is_empty_list:
                        buf.append(render_chunk(inner, ctx_stack))
                # Skip past the closing tag.
                close_end = chunk.find("}}", close_idx) + 2
                i = close_end
                continue
            if sigil == "/":
                # Stray close — treat as literal (shouldn't happen with balanced templates).
                buf.append(m.group(0))
                i = m.end()
                continue
        return "".join(buf)

    return render_chunk(template, [context])


def _lookup(ctx_stack: list[dict], key: str):
    """Walk the context stack from innermost to outermost; return '' if not
    found so missing keys render as empty strings (matching Mustache spec)."""
    for ctx in reversed(ctx_stack):
        if isinstance(ctx, dict) and key in ctx:
            return ctx[key]
    return ""


def _find_close(chunk: str, start: int, key: str) -> int:
    """
    Locate the start index of the matching {{/key}} closer, supporting nested
    sections of the same name. Returns the index of the `{` in `{{/key}}`.
    """
    depth = 1
    i = start
    while i < len(chunk):
        m = _MU_RE.search(chunk, i)
        if not m:
            break
        if m.group(1):  # {{{raw}}} — skip
            i = m.end()
            continue
        sigil = m.group(2)
        tag_key = m.group(3)
        if (sigil == "#" or sigil == "^") and tag_key == key:
            depth += 1
        elif sigil == "/" and tag_key == key:
            depth -= 1
            if depth == 0:
                return m.start()
        i = m.end()
    raise ValueError(f"unclosed Mustache section: {{{{#{key}}}}}")


# ──────────────────────── minimal markdown -> HTML ───────────────────────────


def render_markdown(src: str) -> str:
    """
    Render a small subset of markdown to HTML.

    First tries the optional `markdown` library if installed; falls back to a
    minimal pure-stdlib renderer supporting headings, bullet lists, paragraphs,
    inline **bold**, *italic*, `code`, and [text](url) links.
    """
    try:
        import markdown as _md  # type: ignore

        return _md.markdown(src, extensions=[])
    except Exception:
        return _minimal_markdown(src)


def _minimal_markdown(src: str) -> str:
    lines = src.splitlines()
    out: list[str] = []
    in_list = False
    para: list[str] = []

    def flush_para() -> None:
        nonlocal para
        if para:
            text = " ".join(p.strip() for p in para if p.strip())
            if text:
                out.append("<p>" + _inline(text) + "</p>")
            para = []

    def flush_list() -> None:
        nonlocal in_list
        if in_list:
            out.append("</ul>")
            in_list = False

    for raw in lines:
        line = raw.rstrip()
        if not line.strip():
            flush_para()
            flush_list()
            continue
        # Heading
        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            flush_para()
            flush_list()
            level = len(m.group(1))
            out.append(f"<h{level}>{_inline(m.group(2))}</h{level}>")
            continue
        # Bullet list
        m = re.match(r"^[-*]\s+(.*)$", line)
        if m:
            flush_para()
            if not in_list:
                out.append("<ul>")
                in_list = True
            out.append(f"<li>{_inline(m.group(1))}</li>")
            continue
        # Otherwise accumulate paragraph
        flush_list()
        para.append(line)

    flush_para()
    flush_list()
    return "\n".join(out)


def _inline(text: str) -> str:
    """Inline markdown: bold, italic, code, links. Order matters: code first
    (to protect contents from other rules), then links, then bold, then italic.
    """
    # Code spans: `...` (no HTML escape inside, but escape special chars).
    def code_sub(m):
        return "<code>" + _html.escape(m.group(1)) + "</code>"

    text = re.sub(r"`([^`]+)`", code_sub, text)
    # Links: [text](url)
    text = re.sub(
        r"\[([^\]]+)\]\(([^)]+)\)",
        lambda m: f'<a href="{_html.escape(m.group(2), quote=True)}">{m.group(1)}</a>',
        text,
    )
    # Bold: **x**  (greedy-safe via non-greedy)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    # Italic: *x*  (after bold so we don't eat the inner)
    text = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<em>\1</em>", text)
    return text


# ───────────────────────────── render_deck ──────────────────────────────────


def render_deck(deck_path: Path, template_path: Path) -> str:
    """
    High-level entry point — read deck.md + template, return rendered HTML.
    """
    src = deck_path.read_text(encoding="utf-8")
    fm, body = parse_frontmatter(src)
    slides = parse_slides(body)

    # Pre-render body_en / body_zh markdown into HTML strings so the template
    # can drop them in via {{{body_en_html}}}.
    for slide in slides:
        slide["body_en_html"] = render_markdown(slide.get("body_en", ""))
        slide["body_zh_html"] = render_markdown(slide.get("body_zh", ""))
        # Provide an `evidence` flag for inverted-section use in templates.
        if "evidence" not in slide:
            slide["evidence"] = []

    context: dict = dict(fm)
    context["slides"] = slides
    # Convenience: an `empty` key that's always false-ish — templates can
    # use {{^empty}}...{{/empty}} as an "always render" wrapper if needed.
    context.setdefault("empty", [])

    template = template_path.read_text(encoding="utf-8")
    return mustache(template, context)


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(
            "usage: slides-render.py <deck.md> <template.html> [out.html]\n"
            "用法: slides-render.py <deck.md> <template.html> [out.html]",
            file=sys.stderr,
        )
        return 1

    deck = Path(argv[1])
    tpl = Path(argv[2])
    out_path = Path(argv[3]) if len(argv) >= 4 else None

    if not deck.is_file():
        print(f"[slides-render] deck not found: {deck}", file=sys.stderr)
        print(f"[slides-render] 未找到 deck 文件：{deck}", file=sys.stderr)
        return 1
    if not tpl.is_file():
        print(f"[slides-render] template not found: {tpl}", file=sys.stderr)
        print(f"[slides-render] 未找到模板文件：{tpl}", file=sys.stderr)
        return 2

    try:
        html_out = render_deck(deck, tpl)
    except (ValueError, KeyError) as e:
        print(f"[slides-render] render error: {e}", file=sys.stderr)
        print(f"[slides-render] 渲染错误：{e}", file=sys.stderr)
        return 3

    if out_path:
        out_path.write_text(html_out, encoding="utf-8")
    else:
        sys.stdout.write(html_out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
