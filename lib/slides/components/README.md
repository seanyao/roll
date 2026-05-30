# Slide Components Library

Reusable Mustache partials for slide layouts. Each partial is a self-contained
HTML fragment consumed by `lib/slides-render.py`. Partials use CSS classes from
the introduction-v3 template and require no additional stylesheets.

## Layout Reference

| Layout      | Partial File       | Use When                                   | Avoid When                          |
|-------------|--------------------|--------------------------------------------|-------------------------------------|
| `plain`     | `plain.html`       | Free-form text, no structure needed        | Data has compare / flow / timeline  |
| `cards-2`   | `cards-2.html`     | 2 parallel concepts, side-by-side feature  | 3+ items (use cards-3/cards-4)      |
| `cards-3`   | `cards-3.html`     | 3 pillars, triple option, 3-step summary   | 2 items (use cards-2)               |
| `cards-4`   | `cards-4.html`     | 4 quadrants, pricing tiers, team roles     | <4 items (too sparse)               |
| `compare`   | `compare.html`     | Before/after, problem/solution, old/new    | Unrelated items (use cards)         |
| `pipeline`  | `pipeline.html`    | Sequential flow, CI/CD, process steps      | Unordered items (use cards)         |
| `timeline`  | `timeline.html`    | Chronological events, history, roadmap     | Single event (use highlight)        |
| `quote`     | `quote.html`       | Testimonial, key takeaway, memorable line  | Multi-paragraph prose (use plain)   |
| `highlight` | `highlight.html`   | Callout, warning, important note           | Normal body text (use plain)        |

## Field Tables

### cards-2 / cards-3 / cards-4

| Variable        | Required | Type   | Description                     |
|-----------------|----------|--------|---------------------------------|
| `cards`         | yes      | array  | Array of card objects           |
| `cards[].title_en` | yes   | string | Card title (English)            |
| `cards[].title_zh` | yes   | string | Card title (Chinese)            |
| `cards[].body_en`  | yes   | string | Card body HTML (English, raw)   |
| `cards[].body_zh`  | yes   | string | Card body HTML (Chinese, raw)   |
| `accent_color`  | no       | string | Unused — reserved for future    |

### compare

| Variable             | Required | Type   | Description                     |
|----------------------|----------|--------|---------------------------------|
| `left_title_en`      | yes      | string | Left column heading (EN)        |
| `left_title_zh`      | yes      | string | Left column heading (ZH)        |
| `right_title_en`     | yes      | string | Right column heading (EN)       |
| `right_title_zh`     | yes      | string | Right column heading (ZH)       |
| `left_items`         | yes      | array  | Left column items               |
| `left_items[].text_en` | yes    | string | Item text (EN)                  |
| `left_items[].text_zh` | yes    | string | Item text (ZH)                  |
| `right_items`        | yes      | array  | Right column items              |
| `right_items[].text_en` | yes   | string | Item text (EN)                  |
| `right_items[].text_zh` | yes   | string | Item text (ZH)                  |

### pipeline

| Variable            | Required | Type   | Description                     |
|---------------------|----------|--------|---------------------------------|
| `stages`            | yes      | array  | Pipeline stages in order        |
| `stages[].title_en` | yes      | string | Stage title (EN)                |
| `stages[].title_zh` | yes      | string | Stage title (ZH)                |
| `stages[].desc_en`  | yes      | string | Stage description (EN)          |
| `stages[].desc_zh`  | yes      | string | Stage description (ZH)          |
| `stages[].css_class` | yes     | string | CSS class: `pipe-idea`, `pipe-backlog`, `pipe-build`, `pipe-verify`, or `pipe-release` |

### timeline

| Variable            | Required | Type   | Description                     |
|---------------------|----------|--------|---------------------------------|
| `items`             | yes      | array  | Timeline entries (chronological)|
| `items[].title_en`  | yes      | string | Entry title (EN)                |
| `items[].title_zh`  | yes      | string | Entry title (ZH)                |
| `items[].body_en`   | yes      | string | Entry body HTML (EN, raw)       |
| `items[].body_zh`   | yes      | string | Entry body HTML (ZH, raw)       |

### quote

| Variable  | Required | Type   | Description                     |
|-----------|----------|--------|---------------------------------|
| `text_en` | yes      | string | Quote text (EN)                 |
| `text_zh` | yes      | string | Quote text (ZH)                 |

### highlight

| Variable  | Required | Type   | Description                     |
|-----------|----------|--------|---------------------------------|
| `body_en` | yes      | string | Body HTML (EN, raw)             |
| `body_zh` | yes      | string | Body HTML (ZH, raw)             |

### plain

| Variable  | Required | Type   | Description                     |
|-----------|----------|--------|---------------------------------|
| `body_en` | yes      | string | Body HTML (EN, raw)             |
| `body_zh` | yes      | string | Body HTML (ZH, raw)             |

## CSS Classes

Every class name in these partials is copied verbatim from the introduction-v3
template (`lib/slides/templates/introduction-v3.html`). Do **not** introduce
new class names — the template's CSS is the single source of truth.

## Usage

Partials are consumed by `lib/slides-render.py` when a `deck.md` slide declares
a `layout` field. A slide that omits `layout` renders as `plain`.

For the user-facing walkthrough — per-layout `deck.md` examples, rendered
screenshots, and how `$roll-deck` picks a layout — see the Layouts section of
the slides guide: [`guide/en/slides.md`](../../../guide/en/slides.md#layouts)
([中文](../../../guide/zh/slides.md#layouts布局)). Field names in this file,
that guide, and `skills/roll-deck/SKILL.md` are kept in sync — change one,
change all three.

```markdown
### Slide 3: Architecture Overview

layout: cards-3
title_en: Three Layers
title_zh: 三层架构

body_en: |
  1. {{#cards}}...{{/cards}}
body_zh: |
  1. {{#cards}}...{{/cards}}
```

The renderer inlines the partial's HTML into the template and resolves
Mustache variables and sections from the slide context.
