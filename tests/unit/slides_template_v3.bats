#!/usr/bin/env bats
# US-DECK-001: Verify the v3 introduction template + sample deck.md fixture
# together reproduce the visible content of site/slides/roll-introduction-v3.html.
#
# This story is independent of US-DECK-002. To validate the fixture without
# depending on lib/slides-render.py (which DECK-002 owns), this test embeds
# a minimal Mustache + YAML-frontmatter renderer in Python and runs it against
# the fixture. DECK-003 will re-run the same fixture against the real
# lib/slides-render.py as its acceptance test.
#
# Golden-master semantics: per the feature spec, "整体内容完全相同 (allow trim
# / 换行风格小差异)". We compare the normalized visible text per language —
# extracting the EN content from <span class="lang-en"> / <div class="lang-en">
# in the original (interleaved) and the rendered (block-level) HTML, then the
# ZH content. Whitespace is collapsed before diff.

load helpers

setup() {
  unit_setup
  TEMPLATE="${BATS_TEST_DIRNAME}/../../lib/slides/templates/introduction-v3.html"
  FIXTURE="${BATS_TEST_DIRNAME}/../fixtures/decks/sample-introduction-v3.deck.md"
  ORIGINAL="${BATS_TEST_DIRNAME}/../../site/slides/roll-introduction-v3.html"
  RENDERER="${TEST_TMP}/render.py"
  EXTRACTOR="${TEST_TMP}/extract.py"
  cat > "$RENDERER" <<'PY'
#!/usr/bin/env python3
# Minimal inline renderer for US-DECK-001 fixture validation.
# Supports the documented Mustache subset: {{var}}, {{{var}}},
# {{#section}}...{{/section}}, {{^section}}...{{/section}}.
# Reads deck.md (YAML frontmatter + slide sections), renders against a template.
import re, sys

def parse_deck(text):
    # Split frontmatter (between --- lines) from body.
    m = re.match(r'^---\n(.*?)\n---\n(.*)$', text, re.DOTALL)
    if not m:
        raise SystemExit("deck.md: missing YAML frontmatter")
    fm_raw, body = m.group(1), m.group(2)
    # Very small YAML subset: key: value (quoted or bare).
    meta = {}
    for line in fm_raw.splitlines():
        if not line.strip() or line.startswith('#'):
            continue
        if ':' not in line:
            continue
        k, v = line.split(':', 1)
        v = v.strip()
        if v.startswith('"') and v.endswith('"'):
            v = v[1:-1]
        meta[k.strip()] = v
    # Slides: each starts with "## Slide N" header.
    slides = []
    cur = None
    pending_key = None
    pending_lines = []
    def flush_pending():
        nonlocal pending_key, pending_lines, cur
        if pending_key and cur is not None:
            # Strip leading 2-space indent of YAML block scalar.
            text = '\n'.join(l[2:] if l.startswith('  ') else l for l in pending_lines)
            cur[pending_key] = text.rstrip('\n')
        pending_key = None
        pending_lines = []
    for line in body.splitlines():
        if line.startswith('## Slide '):
            flush_pending()
            if cur is not None:
                slides.append(cur)
            cur = {'number': line[len('## Slide '):].strip()}
            continue
        if cur is None:
            continue
        # Block scalar continuation: indented under "key: |"
        if pending_key is not None:
            if line.startswith('  ') or line == '':
                pending_lines.append(line)
                continue
            flush_pending()
        m2 = re.match(r'^(\w+):\s*(.*)$', line)
        if m2:
            key, val = m2.group(1), m2.group(2)
            if val.strip() == '|':
                pending_key = key
                pending_lines = []
            else:
                v = val.strip()
                if v.startswith('"') and v.endswith('"'):
                    v = v[1:-1]
                cur[key] = v
    flush_pending()
    if cur is not None:
        slides.append(cur)
    return meta, slides

def truthy(v):
    if v is None: return False
    if isinstance(v, bool): return v
    if isinstance(v, str):
        return v.strip().lower() in ('true', '1', 'yes')
    return bool(v)

def render(tmpl, ctx):
    # Sections / inverted sections first (supports single-level nesting via list of slides).
    def replace_section(text, tag, body, inverted):
        if tag == 'slides':
            slides = ctx.get('slides', [])
            if inverted:
                return '' if slides else body
            out = []
            for s in slides:
                # Build per-slide context = global + slide fields.
                local = dict(ctx)
                local.update(s)
                out.append(render_simple(body, local))
            return ''.join(out)
        # Boolean per-slide flag like {{#is_cover}}.
        val = ctx.get(tag)
        present = truthy(val) if not isinstance(val, list) else bool(val)
        if inverted:
            return body if not present else ''
        else:
            return body if present else ''
    # Process sections iteratively from inside-out (handle nested simple booleans).
    pat = re.compile(r'\{\{([#^])(\w+)\}\}(.*?)\{\{/\2\}\}', re.DOTALL)
    while True:
        m = pat.search(tmpl)
        if not m: break
        kind, tag, body = m.group(1), m.group(2), m.group(3)
        replacement = replace_section(tmpl[m.start():m.end()], tag, body, kind == '^') if False else None
        # Simpler: use captured info.
        replacement = ''
        if tag == 'slides':
            slides = ctx.get('slides', [])
            if kind == '^':
                replacement = '' if slides else body
            else:
                out = []
                for s in slides:
                    local = dict(ctx)
                    local.update(s)
                    out.append(render(body, local))  # recursive: allows nested sections per slide
                replacement = ''.join(out)
        else:
            val = ctx.get(tag)
            present = truthy(val)
            if kind == '^':
                replacement = body if not present else ''
            else:
                replacement = body if present else ''
        tmpl = tmpl[:m.start()] + replacement + tmpl[m.end():]
    return render_simple(tmpl, ctx)

def html_escape(s):
    return (s.replace('&', '&amp;').replace('<', '&lt;')
             .replace('>', '&gt;').replace('"', '&quot;'))

def render_simple(text, ctx):
    # Raw {{{var}}} (no escape) — process first to avoid {{var}} regex consuming inner braces.
    def repl_raw(m):
        return str(ctx.get(m.group(1), ''))
    text = re.sub(r'\{\{\{(\w+)\}\}\}', repl_raw, text)
    def repl_var(m):
        v = ctx.get(m.group(1), '')
        return html_escape(str(v))
    text = re.sub(r'\{\{(\w+)\}\}', repl_var, text)
    return text

def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: render.py <deck.md> <template.html>")
    with open(sys.argv[1], encoding='utf-8') as f:
        deck = f.read()
    with open(sys.argv[2], encoding='utf-8') as f:
        tmpl = f.read()
    meta, slides = parse_deck(deck)
    # US-DECK-018: the slide loop now consumes {{{slide_inner_html}}} instead of
    # {{{body_en}}} / {{{body_zh}}} directly. For these plain/cover sample slides
    # the inner HTML is the plain layout body block — reproduce it here so the
    # golden-master content match still exercises the real template loop.
    plain = (
        '<div class="lang-en">\n{body_en}\n</div>\n'
        '<div class="lang-zh">\n{body_zh}\n</div>'
    )
    # Decorate each slide with number_padded; ensure cover flag honored.
    for s in slides:
        try:
            n = int(s.get('number', '0'))
        except ValueError:
            n = 0
        s['number_padded'] = f"{n:02d}"
        s['slide_inner_html'] = plain.format(
            body_en=s.get('body_en', ''), body_zh=s.get('body_zh', '')
        )
    ctx = dict(meta)
    ctx['slides'] = slides
    sys.stdout.write(render(tmpl, ctx))

if __name__ == '__main__':
    main()
PY

  cat > "$EXTRACTOR" <<'PY'
#!/usr/bin/env python3
# Extract per-language visible text from an HTML file.
# Both the original (interleaved <span class="lang-en">/<span class="lang-zh">
# inline) and rendered (block-level <div class="lang-en">/<div class="lang-zh">)
# layouts are normalized to a single string per language.
#
# Strategy: walk the HTML treating <span|div class="lang-en"|lang-zh"> as
# explicit language boundaries; everything else is shared (rendered in both).
# Strip tags, collapse whitespace, output:
#   ---EN---
#   <text>
#   ---ZH---
#   <text>
import re, sys
from html.parser import HTMLParser

class Extractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.lang_stack = []  # 'en' | 'zh' | 'shared'
        self.out_en = []
        self.out_zh = []
        # Tags whose content should be ignored entirely (style/script).
        self.skip_depth = 0

    def _current_lang(self):
        for lang in reversed(self.lang_stack):
            if lang in ('en', 'zh'):
                return lang
        return 'shared'

    def handle_starttag(self, tag, attrs):
        if tag in ('style', 'script'):
            self.skip_depth += 1
            self.lang_stack.append('skip')
            return
        if tag in ('br',):
            # Treat <br> as a space in current language.
            self._emit(' ')
            return
        classes = ''
        for k, v in attrs:
            if k == 'class':
                classes = v or ''
        if 'lang-en' in classes.split():
            self.lang_stack.append('en')
        elif 'lang-zh' in classes.split():
            self.lang_stack.append('zh')
        else:
            self.lang_stack.append('shared')

    def handle_startendtag(self, tag, attrs):
        if tag == 'br':
            self._emit(' ')
        # ignore self-closing otherwise

    def handle_endtag(self, tag):
        if tag in ('style', 'script'):
            self.skip_depth -= 1
            if self.lang_stack and self.lang_stack[-1] == 'skip':
                self.lang_stack.pop()
            return
        if tag == 'br':
            return
        if self.lang_stack:
            self.lang_stack.pop()

    def handle_data(self, data):
        if self.skip_depth > 0:
            return
        self._emit(data)

    def _emit(self, text):
        lang = self._current_lang()
        if lang == 'shared':
            self.out_en.append(text)
            self.out_zh.append(text)
        elif lang == 'en':
            self.out_en.append(text)
        elif lang == 'zh':
            self.out_zh.append(text)

def normalize(parts):
    s = ''.join(parts)
    # Collapse whitespace.
    s = re.sub(r'\s+', ' ', s).strip()
    return s

def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: extract.py <file.html>")
    with open(sys.argv[1], encoding='utf-8') as f:
        html = f.read()
    ex = Extractor()
    ex.feed(html)
    print('---EN---')
    print(normalize(ex.out_en))
    print('---ZH---')
    print(normalize(ex.out_zh))

if __name__ == '__main__':
    main()
PY
}

teardown() { unit_teardown; }

@test "US-DECK-001: template file exists with Mustache placeholders" {
  [ -f "$TEMPLATE" ]
  # Must contain the documented placeholder set.
  grep -q '{{title_en}}' "$TEMPLATE"
  grep -q '{{title_zh}}' "$TEMPLATE"
  grep -q '{{total_slides}}' "$TEMPLATE"
  grep -q '{{#slides}}' "$TEMPLATE"
  grep -q '{{/slides}}' "$TEMPLATE"
  grep -q '{{number}}' "$TEMPLATE"
  # US-DECK-018: the slide loop now injects the layout-routed partial output via
  # {{{slide_inner_html}}}; per-slide body_en/body_zh live in the plain partial.
  grep -q '{{{slide_inner_html}}}' "$TEMPLATE"
}

@test "US-DECK-001: fixture deck.md exists with frontmatter and 19 slide sections (cover + 18)" {
  [ -f "$FIXTURE" ]
  # YAML frontmatter must declare core fields.
  grep -q '^template: introduction-v3' "$FIXTURE"
  grep -q '^title_en:' "$FIXTURE"
  grep -q '^title_zh:' "$FIXTURE"
  grep -q '^total_slides: 18' "$FIXTURE"
  # Cover + 18 numbered slides = 19 "## Slide N" headers (0..18).
  run grep -c '^## Slide ' "$FIXTURE"
  [ "$status" -eq 0 ]
  [ "$output" -eq 19 ]
}

@test "US-DECK-001: rendered HTML EN content matches original EN content" {
  rendered="${TEST_TMP}/rendered.html"
  python3 "$RENDERER" "$FIXTURE" "$TEMPLATE" > "$rendered"
  [ -s "$rendered" ]
  python3 "$EXTRACTOR" "$rendered" > "${TEST_TMP}/rendered.txt"
  python3 "$EXTRACTOR" "$ORIGINAL" > "${TEST_TMP}/original.txt"

  # Pull EN section (between ---EN--- and ---ZH---).
  awk '/^---EN---$/{flag=1;next}/^---ZH---$/{flag=0}flag' "${TEST_TMP}/rendered.txt" > "${TEST_TMP}/rendered.en"
  awk '/^---EN---$/{flag=1;next}/^---ZH---$/{flag=0}flag' "${TEST_TMP}/original.txt" > "${TEST_TMP}/original.en"

  if ! diff -u "${TEST_TMP}/original.en" "${TEST_TMP}/rendered.en"; then
    echo "EN content drift between original v3 HTML and rendered template+fixture." >&2
    return 1
  fi
}

@test "US-DECK-001: rendered HTML ZH content matches original ZH content" {
  rendered="${TEST_TMP}/rendered.html"
  python3 "$RENDERER" "$FIXTURE" "$TEMPLATE" > "$rendered"
  python3 "$EXTRACTOR" "$rendered" > "${TEST_TMP}/rendered.txt"
  python3 "$EXTRACTOR" "$ORIGINAL" > "${TEST_TMP}/original.txt"

  awk '/^---ZH---$/{flag=1;next}flag' "${TEST_TMP}/rendered.txt" > "${TEST_TMP}/rendered.zh"
  awk '/^---ZH---$/{flag=1;next}flag' "${TEST_TMP}/original.txt" > "${TEST_TMP}/original.zh"

  if ! diff -u "${TEST_TMP}/original.zh" "${TEST_TMP}/rendered.zh"; then
    echo "ZH content drift between original v3 HTML and rendered template+fixture." >&2
    return 1
  fi
}

@test "US-DECK-001: rendered HTML preserves theme + lang switcher controls" {
  rendered="${TEST_TMP}/rendered.html"
  python3 "$RENDERER" "$FIXTURE" "$TEMPLATE" > "$rendered"
  # The v3 visual layer must survive intact.
  grep -q 'id="btn-theme"' "$rendered"
  grep -q 'id="btn-lang"' "$rendered"
  grep -q 'function toggleTheme' "$rendered"
  grep -q 'function toggleLang' "$rendered"
  grep -q '@keyframes fadeUp' "$rendered"
  grep -q '\[data-lang="en"\] .lang-zh' "$rendered"
  # Slide-number range covers 01/18 .. 18/18 (cover has none).
  grep -q '01 / 18' "$rendered"
  grep -q '18 / 18' "$rendered"
  ! grep -q '00 / 18' "$rendered"
}
