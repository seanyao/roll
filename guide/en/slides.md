# Roll — Slides

> Turn a topic string into a bilingual 18-slide HTML deck you can share.
> Two layers, by design: an AI authors `deck.md`; a deterministic bash step
> renders it to HTML. You can always edit the `deck.md` by hand and re-render.

## What & Why

`roll slides` is Roll's slide-deck generator. It exists because:

- Hand-crafting an HTML deck from scratch is slow, and ad-hoc AI prompts
  produce decks that are visually inconsistent and hard to regenerate.
- A deck for an open-source project usually has the **same skeleton** —
  cover, problem, solution, demo, evidence, call to action — but the
  *content* changes per topic.
- We want the **content** to be grounded in the project's own code, README,
  and backlog — not in whatever an LLM invented today.

So the pipeline is split:

| Layer | Tool | What it does |
|-------|------|--------------|
| Authoring | `roll slides new` + `roll-deck` skill | Reads your repo, writes one `deck.md` with 18 bilingual slides + evidence citations. |
| Rendering | `roll slides build` (Python, no AI) | Validates `deck.md` against the schema, applies a Mustache-style template, writes a self-contained `.html` file. |
| Browsing | `roll slides list` / `roll slides preview` | List existing decks; open one in the browser. |

The split is deliberate. The bash side is reproducible — given the same
`deck.md` and template, you get the same HTML every time. The AI side is
where you accept some non-determinism in exchange for speed.

## Quick Start

Three steps from topic to browser-ready HTML.

### 1. New — one command to HTML

```bash
roll slides new "Introducing Roll Loop"
```

This shells out to your selected agent (`roll agent use <name>` if you
haven't picked one) with the `roll-deck` skill loaded. The agent:

1. Reads `README.md`, `AGENTS.md`, `.roll/backlog.md`, `.roll/features/`.
2. Drafts an 18-slide outline grounded in what it found.
3. Writes exactly one file: `.roll/slides/<slug>/deck.md`.

`<slug>` is derived from your topic (kebab-cased, ASCII).

**By default, `new` auto-builds and opens the HTML** — you go from
topic to browser in one command. After the agent finishes generating
`deck.md`, the pipeline continues automatically:

```text
✓ generating     (elapsed: 2m 14s)
✓ validating     (elapsed: 0m  1s)
✓ rendering      (elapsed: 0m  2s)
✓ opening        (elapsed: 0m  0s)

Opened in browser: .roll/slides/roll-loop-intro.html
```

Use `--no-build` to stop after `deck.md` generation:

```bash
roll slides new "My Draft" --no-build   # deck.md only, no HTML
roll slides build my-draft               # build later by hand
```

If the topic is vague, the skill is allowed **one** clarifying round
before it writes. If it can't ground a slide, it tags the body with
`⚠️ unverified`.

### 2. Review — read the `deck.md`

Open `.roll/slides/<slug>/deck.md` in your editor. This is the human gate.
Things to check:

- Does each slide say something concrete and project-specific?
- Are the evidence citations real file paths and line numbers?
- Are the `⚠️ unverified` slides ones you can fix manually?

Edit anything you don't like. The file is plain text — title, body,
evidence are all visible and editable. Re-run `roll slides build <slug>`
to re-render after edits.

### 3. Share — list, preview, templates, delete

```bash
roll slides list             # table of every deck (built / stale / failed / unbuilt)
roll slides preview <slug>   # open .roll/slides/<slug>.html in browser
roll slides templates        # list available templates (built-in + project overrides)
roll slides delete <slug>    # remove a deck (dir + HTML), with confirmation
```

To publish a deck publicly, see [Output location](#output-location)
below — by default the HTML is gitignored and stays local.

## `deck.md` Format Reference

A `deck.md` has two parts: a YAML-ish frontmatter block, then one
`## Slide N` section per slide.

### Frontmatter

Required fields (all checked by `slides-validate.py`):

| Field | Type | Notes |
|-------|------|-------|
| `template` | string | Template name, e.g. `introduction-v3`. |
| `slug` | string | Kebab-case ID matching the directory name. |
| `title_en` | string | English deck title. |
| `title_zh` | string | Chinese deck title. |
| `total_slides` | int | Must match the number of `## Slide N` blocks. |
| `created` | string | ISO date, e.g. `2026-05-21`. |

Example:

```markdown
---
template: introduction-v3
slug: roll-loop-intro
title_en: "Introducing Roll Loop"
title_zh: "认识 Roll Loop"
total_slides: 18
created: 2026-05-21
---
```

### Slide section

Each slide is a `## Slide N` header followed by a `layout` declaration,
the layout's content keys, and an evidence list:

```markdown
## Slide 1
layout: plain
title_en: "Why autonomy"
title_zh: "为什么要自主"
body_en: |
  Roll Loop reads the backlog on a schedule and ships items via
  the same git + CI flow you already trust.
body_zh: |
  Roll Loop 会按计划读取 backlog，并通过你既有的 git + CI 流程交付。
evidence:
  - README.md:33
  - guide/en/loop.md:12
```

Every slide declares `layout:` (default `plain`) plus `title_en` /
`title_zh`. The remaining keys depend on the layout — `plain` and
`highlight` use `body_en` / `body_zh`; richer layouts use structured
fields like `cards`, `left_items`, `stages`, or `items`. See
[Layouts](#layouts) for the full per-layout field reference.

`evidence` is a list of `<path>:<line>` references — at least one
citation is expected per three slides (see [Grounding](#grounding--evidence-convention)).

### Supported Mustache placeholders

`slides-render.py` ships a small Mustache subset for the template
layer. Custom templates (Phase 2) may use:

| Placeholder | Meaning |
|-------------|---------|
| `{{var}}` | HTML-escaped substitution from the current context. |
| `{{{var}}}` | Raw substitution (no escape). Use for pre-rendered HTML. |
| `{{#section}} ... {{/section}}` | Iterate a list, or render once if truthy. |
| `{{^section}} ... {{/section}}` | Inverted — render if absent or falsy. |

**Not supported on purpose**: partials (`{{>name}}`), lambdas, set
delimiters (`{{=<% %>=}}`), and dotted lookup (`{{a.b}}`).

The render context exposes the frontmatter scalars (`title_en`,
`title_zh`, `total_slides`, …) and a `slides` list. Each slide item
exposes `number`, `layout`, `title_en`, `title_zh`, `evidence`, plus
the structured fields its layout declares (e.g. `body_en_html` /
`body_zh_html` for `plain` / `highlight`, or `cards` / `stages` /
`items` for the richer layouts — see [Layouts](#layouts)).

## Layouts

Every slide declares a `layout`. The layout decides what the slide
*looks like* — a plain paragraph, two red/green columns, a horizontal
pipeline, a vertical timeline, side-by-side cards, a pulled quote, or a
single callout. Pick the layout from the **shape of your content**, not
to look fancy: if the content is genuinely one block of prose, `plain`
is the correct choice.

`layout` is validated against a fixed whitelist. An unknown name (or a
layout missing its required fields) fails the build with a clear
message telling you what to fix. Omitting `layout` is the same as
`plain` — Phase 1 decks keep working unchanged.

| Layout | Use it for | Don't use it for |
|--------|-----------|------------------|
| `plain` | Ordinary prose, explanation, a plain list | Data that is really a comparison / flow / timeline |
| `cards-2` | 2 parallel concepts, side-by-side | 3+ items (use `cards-3` / `cards-4`) |
| `cards-3` | 3 pillars, triple option, 3-step summary | 2 items (use `cards-2`) |
| `cards-4` | 4 quadrants, pricing tiers, team roles | Fewer than 4 items (too sparse) |
| `compare` | Before/after, old vs new, problem/solution | Unrelated items (use `cards`) |
| `pipeline` | Sequential flow, CI/CD, ordered process steps | Unordered items (use `cards`) |
| `timeline` | Chronological events, history, roadmap | A single event (use `highlight`) |
| `quote` | A testimonial, a memorable line, user's own words | Multi-paragraph prose (use `plain`) |
| `highlight` | The one key takeaway / one-line conclusion | Normal body text (use `plain`) |

Field names below match `lib/slides/components/README.md` and the
`roll-deck` skill's selection playbook verbatim — copy them exactly.

### `plain`

Free-form prose. Keys: `body_en`, `body_zh`.

```markdown
## Slide 9
layout: plain
title_en: "Plain Prose"
title_zh: "普通段落"
body_en: |
  When the content is genuinely one block of prose, plain is the
  correct choice — not a failure.
body_zh: |
  内容真就是一段话时，plain 是正确答案，不是偷懒。
evidence:
  - README.md:1
```

![plain layout](assets/layouts/plain.png)

### `highlight`

A single callout / one-line conclusion. Keys: `body_en`, `body_zh`.

```markdown
## Slide 6
layout: highlight
title_en: "Key Takeaway"
title_zh: "关键结论"
body_en: |
  One command takes a topic to a shareable HTML deck.
body_zh: |
  一条命令把主题变成可分享的 HTML 演示。
evidence:
  - README.md:1
```

![highlight layout](assets/layouts/highlight.png)

### `quote`

A pulled quote with attribution. Keys: `text_en`, `text_zh`.

```markdown
## Slide 5
layout: quote
title_en: "What Users Say"
title_zh: "用户原话"
text_en: "Roll turned a 3-minute black screen into a deck I can share."
text_zh: "Roll 把 3 分钟的黑屏变成了我能分享的演示。"
evidence:
  - README.md:1
```

![quote layout](assets/layouts/quote.png)

### `cards-2` / `cards-3` / `cards-4`

2, 3, or 4 parallel concepts with no internal order. Key: `cards`, an
array where each item has `title_en`, `title_zh`, `body_en`, `body_zh`.

```markdown
## Slide 7
layout: cards-3
title_en: "Three Pillars"
title_zh: "三大支柱"
cards:
  - title_en: "Skills"
    title_zh: "技能"
    body_en: "Composable AI workflows."
    body_zh: "可组合的 AI 工作流。"
  - title_en: "Loop"
    title_zh: "循环"
    body_en: "Autonomous backlog executor."
    body_zh: "自主 backlog 执行器。"
  - title_en: "TCR"
    title_zh: "TCR"
    body_en: "Test, commit, or revert."
    body_zh: "测试、提交或回滚。"
evidence:
  - README.md:1
```

`cards-2` and `cards-4` take the same `cards` array with 2 or 4 items.

![cards-2 layout](assets/layouts/cards-2.png)

![cards-3 layout](assets/layouts/cards-3.png)

![cards-4 layout](assets/layouts/cards-4.png)

### `compare`

Two columns: left (e.g. "before") vs right (e.g. "after"). Keys:
`left_title_en` / `left_title_zh` / `right_title_en` / `right_title_zh`,
plus `left_items` and `right_items` — arrays where each item has
`text_en` / `text_zh`.

```markdown
## Slide 2
layout: compare
title_en: "Before vs After"
title_zh: "前后对比"
left_title_en: "Before"
left_title_zh: "之前"
right_title_en: "After"
right_title_zh: "之后"
left_items:
  - text_en: "Manual steps"
    text_zh: "手动步骤"
right_items:
  - text_en: "Automated"
    text_zh: "自动化"
evidence:
  - README.md:1
```

![compare layout](assets/layouts/compare.png)

### `pipeline`

A horizontal, ordered sequence of stages. Key: `stages`, an array where
each item has `title_en`, `title_zh`, `desc_en`, `desc_zh`, and an
optional `css_class` (`pipe-idea`, `pipe-backlog`, `pipe-build`,
`pipe-verify`, or `pipe-release`).

```markdown
## Slide 3
layout: pipeline
title_en: "Build Pipeline"
title_zh: "构建流水线"
stages:
  - title_en: "Stage"
    title_zh: "暂存"
    desc_en: "git add -A"
    desc_zh: "git add -A"
  - title_en: "Test"
    title_zh: "测试"
    desc_en: "roll test"
    desc_zh: "roll test"
evidence:
  - README.md:1
```

![pipeline layout](assets/layouts/pipeline.png)

### `timeline`

A vertical, chronological list of events. Key: `items`, an array where
each item has `title_en`, `title_zh`, `body_en`, `body_zh`.

```markdown
## Slide 4
layout: timeline
title_en: "Project Evolution"
title_zh: "项目演进"
items:
  - title_en: "Phase 1"
    title_zh: "阶段一"
    body_en: "Generate and render."
    body_zh: "生成与渲染。"
  - title_en: "Phase 2"
    title_zh: "阶段二"
    body_en: "Visual richness."
    body_zh: "视觉富度。"
evidence:
  - README.md:1
```

![timeline layout](assets/layouts/timeline.png)

### How `$roll-deck` picks a layout

When you run `roll slides new "<topic>"`, the `roll-deck` skill chooses
a layout per slide from the **shape of the content** — before/after
goes to `compare`, multi-step flows to `pipeline`, time series to
`timeline`, parallel concepts to `cards-N`, attributed lines to
`quote`, a one-line conclusion to `highlight`, and everything else to
`plain`. The same decision matrix lives in `skills/roll-deck/SKILL.md`
("Layout Selection Playbook"); this doc and that playbook are kept in
sync. You can always override the AI's choice by editing `layout:` in
`deck.md` and re-running `roll slides build <slug>`.

## Grounding & Evidence Convention

A deck about your project should *cite your project*. The convention:

- **Threshold**: across the whole deck, citations must be at least
  `ceil(total_slides / 3)` — i.e. **one evidence citation per three
  slides** on average. For an 18-slide deck that's ≥ 6 citations.
- **Format**: `<path>:<line>` (e.g. `bin/roll:3127`). Paths are
  relative to the repo root.
- **Coverage**: try to spread citations rather than dump them all on
  one slide. A clump means the rest is ungrounded.
- **Unverifiable claims**: if you genuinely can't cite something,
  prefix the body with `⚠️ unverified` and a one-line reason. The
  validator will still pass, but the reader knows what to scrutinise.

`roll slides build` runs the validator first. If the deck is below the
grounding threshold, the build aborts with a `⚠️ grounding below
threshold` message. Fix it by adding citations or removing fluff
slides — don't disable the check.

## Output Location

By default, build artefacts stay **local**:

```
.roll/slides/<slug>/deck.md        ← source, tracked? up to you (usually ignored too)
.roll/slides/<slug>.html           ← rendered artefact, gitignored
.roll/.gitignore                   ← auto-extended with `slides/*.html`
```

`.roll/` is on `.gitignore` by default for most Roll projects. The
`.roll/.gitignore` line is a belt-and-braces safety net: even if a
project starts tracking `.roll/`, the rendered HTML stays out.

### Promoting a deck to the public site

If you want a deck on your public docs site (e.g. served by
GitHub Pages):

1. Decide on a public path, e.g. `site/slides/<slug>.html`.
2. Copy the rendered artefact:

   ```bash
   mkdir -p site/slides
   cp .roll/slides/<slug>.html site/slides/<slug>.html
   ```

3. Force-add — the global `.gitignore` may match — and commit:

   ```bash
   git add -f site/slides/<slug>.html
   git commit -m "Story X: publish <slug> deck"
   ```

4. Optional: link from your site index / README.

Keep the source `deck.md` under `.roll/slides/<slug>/` so a future
`roll slides build <slug>` can re-render in place. Don't commit the
HTML and then edit it by hand — re-render from `deck.md` instead.

## `list` — Four-State Overview

`roll slides list` shows every deck under `.roll/slides/` with a
four-state status:

| Icon | State | Meaning |
|------|-------|---------|
| `✓` | **built** | `<slug>.html` exists and no recent failure recorded. Ready to share. |
| `≈` | **stale** | `<slug>.html` exists but `deck.md` was modified after the last build. Re-run `build`. |
| `⚠` | **failed** | The last `build` failed. A `.last-build.err` file was written with details. See `roll slides logs <slug>`. |
| `✗` | **unbuilt** | No HTML, no error file. `deck.md` exists but hasn't been built yet. |

## Failure Recovery

When `build` fails, the error message includes a recovery path
specific to the failure type. You don't need to read source code or
search issues.

### Template missing

```text
[FAIL] Template "custom-dark" not found

Available templates (built-in):
  introduction-v3    lib/slides/templates/introduction-v3.html

See also: roll slides templates
```

Fix: check the template name in your `deck.md` frontmatter matches
one of the available templates. Run `roll slides templates` to see all
options, including any project-level overrides you've installed.

### Validation failed

```text
[FAIL] Validation failed
  deck.md:42 — required field "title_zh" missing
  deck.md:67 — frontmatter: total_slides=18 but found 19 ## Slide blocks
```

Fix: the error points to exact lines. Open `deck.md` at the indicated
line number, fix the issue, re-run `roll slides build <slug>`.

### Renderer crashed

```text
[FAIL] Renderer crashed

See: roll slides logs <slug>
Last 5 lines of traceback:
  File ".../slides-render.py", line 312, in _render_slide
    raise ValueError(f"Unknown layout: {layout}")
```

Fix: run `roll slides logs <slug>` to see the full error log, then
either fix `deck.md` or report the issue with the log output attached.

## Custom Templates

You can override Roll's built-in slide templates per project without
forking or modifying the Roll installation.

### How it works

Place a `.html` file with the **same name** as a built-in template
under `.roll/slides/templates/`. When `build` resolves a template, it
checks in order:

1. `.roll/slides/templates/<name>.html` — your project override
2. `${ROLL_PKG_DIR}/lib/slides/templates/<name>.html` — Roll's built-in
3. Neither → template-not-found error (see [Failure Recovery](#failure-recovery))

### Example

```bash
# Copy the built-in template as a starting point
mkdir -p .roll/slides/templates
cp "$(roll slides templates | grep introduction-v3 | awk '{print $NF}')" \
   .roll/slides/templates/introduction-v3.html

# Edit colors, fonts, layout — same Mustache placeholders
# Roll will pick up your version on the next build
roll slides build my-deck
```

### Placeholder contract

Your custom template must support the same Mustache placeholders the
built-in template expects. The minimum set:

| Placeholder | Meaning |
|-------------|---------|
| `{{title_en}}` / `{{title_zh}}` | Deck-level title |
| `{{#slides}} ... {{/slides}}` | Slide iteration block |
| `{{number}}` | Slide number inside iteration |
| `{{title_en}}` / `{{title_zh}}` | Slide-level title (inside iteration) |
| `{{{body_en_html}}}` / `{{{body_zh_html}}}` | Rendered slide body |

See the [Supported Mustache placeholders](#supported-mustache-placeholders)
section for the full reference.

Run `roll slides templates` to see what's available and where each
template comes from (built-in vs. project override).

## New Commands (Phase 1.5)

### `roll slides logs <slug>`

Print the last build failure log for a deck:

```bash
roll slides logs my-deck
# → Shows .roll/slides/my-deck/.last-build.err contents
# → "No failure log for this deck" if never failed
```

### `roll slides templates`

List every available template, its source, and path:

```bash
roll slides templates
# TEMPLATE             SOURCE    PATH
# introduction-v3      builtin   /opt/roll/lib/slides/templates/introduction-v3.html
# pitch                builtin   /opt/roll/lib/slides/templates/pitch.html
# introduction-v3      project   .roll/slides/templates/introduction-v3.html
```

### `roll slides delete <slug>`

Remove a deck — its directory and HTML file:

```bash
roll slides delete my-deck          # asks for confirmation (y/N)
roll slides delete my-deck --force  # skip confirmation (CI/scripts)
```

## Common Pitfalls

### AI generated content that's superficial

Symptom: the deck reads like a generic intro, with bullet points like
"Roll is fast" and no project-specific examples.

Fix:

- **Edit `deck.md` directly.** It's plain text; rewrite a slide's
  `body_en` / `body_zh` to be concrete. Re-run `roll slides build
  <slug>` to re-render.
- **Add evidence first, then write the body.** If you're forced to
  cite a real file and line, the slide body tends to follow.
- **Regenerate with a sharper topic.** `roll slides new "How TCR
  keeps Roll's bin/roll honest"` will outperform `roll slides new
  "Roll"`.

### Validation fails: `total_slides mismatch`

Symptom: `total_slides: 18` in frontmatter but only 17 `## Slide N`
blocks (or vice versa).

Fix: count your `## Slide` headers and adjust the frontmatter.
`grep -c '^## Slide ' .roll/slides/<slug>/deck.md`.

### Validation fails: `missing required frontmatter field`

Symptom: validator names a field like `created` or `slug`.

Fix: open `deck.md`, add the field with a sensible value, save, rerun
`roll slides build`. All six required fields are listed under
[Frontmatter](#frontmatter) above.

### Validation fails: grounding threshold

Symptom: `⚠️ grounding below threshold: 3 evidence citation(s) for 18
slides (need >= 6)`.

Fix: add `evidence:` lines to under-cited slides. Aim for at least one
citation per three consecutive slides. If a claim genuinely can't be
cited, label the slide `⚠️ unverified` and reduce the deck's claim
density.

### `roll slides build` opens the wrong browser / no browser

Symptom: build succeeds, but the browser doesn't open (or opens
something unexpected).

Fix: pass `--no-open` to suppress the auto-open, then use `roll slides
preview <slug>` explicitly. On Linux the opener is `xdg-open`; on
macOS it's `open`. Set `ROLL_SLIDES_NO_OPEN=1` in your shell rc to
disable auto-open globally.

### Re-running `roll slides new` overwrites work

Symptom: the second `roll slides new "<same topic>"` is about to
overwrite a `deck.md` you've already edited.

Fix: the skill is required to ask before overwriting. If you say yes,
your edits are gone. Either rename your slug first (`mv
.roll/slides/<slug> .roll/slides/<slug>-v2`), or just edit the
existing `deck.md` instead of regenerating.

## See Also

- [overview.md](overview.md) — what Roll is and the three-layer model.
- [skills.md](skills.md) — picking the right skill for a task.
- `skills/roll-deck/SKILL.md` — the authoring skill's hard constraints.
- `lib/slides-render.py` — Mustache subset + markdown subset reference.
- `lib/slides-validate.py` — schema + grounding rules.
