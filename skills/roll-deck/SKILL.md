---
name: roll-deck
license: MIT
allowed-tools: "Read, Edit, Write, Glob, Grep, Bash(git:*)"
description: "Generate a bilingual 18-slide deck.md from a topic. Reads the current project (README, AGENTS.md, backlog, features), discusses outline with the user when needed, and writes one file: .roll/slides/<slug>/deck.md. Each slide carries title_en/title_zh + body_en/body_zh + evidence (file:line). HTML rendering is a separate bash step (roll slides build)."
---

# roll-deck

> Topic in, deck.md out. AI authoring layer of the slide-deck pipeline.
> 主题进，deck.md 出。幻灯片管线的 AI 创作层。

## Trigger

User invokes `roll-deck` from the CLI:

```
$roll-deck "Introducing Roll Loop"
$roll-deck "How TCR keeps us honest"
```

`roll slides new "<topic>"` shells out to the selected agent with this skill loaded.
`roll slides new "<topic>"` 会通过所选 agent 加载本 skill。

## When Not to Use

- Rendering an existing `deck.md` to HTML → use `roll slides build <slug>` (bash, no AI).
- Listing or previewing decks → use `roll slides list` / `roll slides preview <slug>`.
- Authoring backlog stories → use `$roll-design` / `$roll-idea`.

## Hard Constraints  硬约束

- **You may write exactly one file**: `.roll/slides/<slug>/deck.md`.
- You MUST NOT edit any other file: no README, no AGENTS.md, no backlog, no source code, no `.roll/slides/*.html`.
- HTML rendering is `roll slides build <slug>` — never produce HTML here.
- If `.roll/slides/<slug>/deck.md` already exists, ask the user before overwriting.
- **Layout must come from the whitelist**: `plain`, `cards-2`, `cards-3`, `cards-4`, `compare`, `pipeline`, `timeline`, `quote`, `highlight`. Inventing a layout name makes `roll slides build` fail with `Unknown layout`.
  **layout 必须从白名单选**：`plain` / `cards-2` / `cards-3` / `cards-4` / `compare` / `pipeline` / `timeline` / `quote` / `highlight`。自创 layout 名渲染会失败。

## Inputs

- `<topic>`: a free-text topic string (required).
- `<template>`: template name, default `introduction-v3`.
- `<slug>`: kebab-case slug derived from the topic by the CLI; you receive it.

## Workflow

### 1. Read the project  阅读项目

Read in this order, skipping files that don't exist:

0. `package.json` — **project identity**: extract `name`, `homepage`, `repository.url`, `author`. These are hard facts that MUST NOT be guessed or inferred from memory.
   `package.json` — **项目身份**: 提取 `name`、`homepage`、`repository.url`、`author`。这些是硬事实，禁止猜测。
1. `README.md` — top-level pitch and entry points.
2. `AGENTS.md` — communication style, conventions, where to look.
3. `.roll/backlog.md` — recently Done Stories and the top of the Todo queue.
4. `.roll/features/**/*.md` — feature specs relevant to the topic.
5. Targeted `Grep` for the topic keywords across the repo (≤ 30 hits).

Stop reading when you have enough to write 18 slides with concrete evidence.
拿到足够 18 张 slide 的证据就停。

### 2. Outline check  outline 校验

- If the topic is unambiguous and the project gives clear evidence (high confidence), proceed directly.
- If the topic is vague (multiple valid framings), restate the proposed 18-slide outline in 3–5 lines and ask the user to confirm or adjust before writing. Wait for confirmation.
- Never ask more than one round of questions — pick the strongest framing and proceed.

### 3. Generate 18 slides  生成 18 张 slide

Default count is `18` (or the count the template prescribes). Each slide MUST contain:

- `layout` — one of the whitelist layouts (see "Layout 选择手册" below). **You MUST declare `layout:` explicitly on every slide, before `evidence:`** — this forces a deliberate choice and stops every slide collapsing to `plain`.
- `title_en` — short English title (≤ 8 words).
- `title_zh` — short Chinese title (≤ 16 chars).
- `body_en` — markdown body, concise, ≤ 200 words.
- `body_zh` — Chinese body, concise, ≤ 200 chars.
- `evidence` — list of `<path>:<line>` references that ground the claim.

**Grounding rules** (two tiers):

- **Hard facts** (URLs, package names, version numbers, person names, quotes with attribution): MUST cite the source file and line (e.g. `package.json:2`, `README.md:15`). If no source can be found, mark the claim as `⚠️ unverified` — never guess.
- **Narrative / opinions**: every 3 consecutive slides MUST contain at least 1 evidence citation. If you cannot ground a slide, label it `⚠️ unverified` and explain why in one line.

**Grounding 规则**（两级）：

- **硬事实**（URL、包名、版本号、人名、带归属的引言）：MUST 引用源文件及行号（如 `package.json:2`）。找不到来源则标 `⚠️ unverified`——禁止猜测。
- **叙述/观点**：每 3 张 slide 至少 1 条 evidence。无法取证时打 `⚠️ unverified` 并一行说明。

Bilingual rule: English and Chinese MUST be on separate lines in the rendered body — never inline on the same line.

## Layout 选择手册  Layout Selection Playbook

Pick the layout from the **shape of the content**, not from a wish to look fancy.
按**内容形态**选 layout，而不是为了好看硬凑。

### Decision matrix  决策矩阵

| Content shape  内容形态 | Pick  推荐 layout | Anti-pattern  反例（不要用） |
|---|---|---|
| Before/after, old vs new, "what we did vs didn't"  前后对比 / 旧 vs 新 | `compare` | `cards-2` — loses the contrast semantics  缺失对比语义 |
| Multi-step process, pipeline, staged flow  多步骤流程 / 阶段流转 | `pipeline` | `cards-N` — order is invisible  看不出顺序 |
| Time series, evolution, changelog  时间序列 / 演进 / changelog | `timeline` | `pipeline` — pipeline = steps, timeline = time  pipeline 表步骤、timeline 表时间 |
| 2/3/4 parallel concepts, no internal order  2/3/4 个并列概念，无顺序 | `cards-2` / `cards-3` / `cards-4` | ≥5 items crammed in — split the slide  ≥5 项硬塞，请拆 slide |
| A line, a testimonial, the user's own words  引言 / 金句 / 用户原话 | `quote` | `highlight` — quote has attribution, highlight is a conclusion  quote 有归属，highlight 是结论 |
| The one key takeaway / one-line conclusion  关键结论 / 一句话总结 | `highlight` | `plain` — drowns in the paragraph  淹没在段落里 |
| Ordinary prose, explanation, plain list  普通段落 / 解释 / 列表 | `plain` | — |

**At most one layout per slide.** Do not stack layouts. And do not force a rich
component when the content is genuinely just a paragraph — **if the content is
really one block of prose, `plain` is the correct choice**, not a failure.
**每张 slide 最多 1 个 layout。** 不要为了用富组件硬凑；内容真就是一段话时，`plain` 是正确答案，不是偷懒。

### Worked examples  真实示例

Five examples, drawn from real `site/slides/roll-introduction-v5.html` slides.
五个示例，取自 v5 实际 slide。

**1. "TCR before vs after" → `compare`**
内容是"用 TCR 之前 vs 之后" → 选 `compare`：

```markdown
## Slide 4
layout: compare
title_en: "Why TCR"
title_zh: "为什么用 TCR"
left_title_en: "Before"
left_title_zh: "之前"
right_title_en: "After"
right_title_zh: "之后"
left_items:
  - text_en: "Broken commits land on main"
    text_zh: "坏提交直接进 main"
right_items:
  - text_en: "Every commit is green or reverted"
    text_zh: "每个提交要么绿要么回滚"
evidence:
  - AGENTS.md:42
```

**2. "The Roll loop pipeline" → `pipeline`**
内容是"idea → backlog → build → verify → release 流转" → 选 `pipeline`：

```markdown
## Slide 7
layout: pipeline
title_en: "The Roll Loop"
title_zh: "Roll 循环"
stages:
  - title_en: "Idea"
    title_zh: "想法"
    desc_en: "Capture in backlog"
    desc_zh: "落到 backlog"
    css_class: "pipe-idea"
  - title_en: "Build"
    title_zh: "构建"
    desc_en: "TCR micro-commits"
    desc_zh: "TCR 微提交"
    css_class: "pipe-build"
evidence:
  - skills/roll-loop/SKILL.md:1
```

**3. "How Roll grew over releases" → `timeline`**
内容是"v1 → v2 → 现在的演进" → 选 `timeline`：

```markdown
## Slide 12
layout: timeline
title_en: "How Roll Grew"
title_zh: "Roll 的演进"
items:
  - title_en: "First loop"
    title_zh: "第一版 loop"
    body_en: "Hourly cron executor."
    body_zh: "每小时 cron 执行器。"
evidence:
  - CHANGELOG.md:1
```

**4. "Three pillars of Roll" → `cards-3`**
内容是"三个并列支柱，无先后" → 选 `cards-3`：

```markdown
## Slide 5
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
    body_en: "Test && commit || revert."
    body_zh: "测试通过则提交，否则回滚。"
evidence:
  - README.md:1
```

**5. "Kimi's verdict" → `quote`**
内容是带归属的一句用户原话 → 选 `quote`：

```markdown
## Slide 16
layout: quote
title_en: "Peer Verdict"
title_zh: "评审结论"
text_en: "AGREE with refinement."
text_zh: "同意，附细化意见。"
evidence:
  - .roll/features/authoring/slide-deck-generator.md:919
```

Whitelist field names match `lib/slides/components/README.md` — copy them
verbatim (`left_items` / `right_items` / `stages[].css_class` / `text_en` …).
字段名以 `lib/slides/components/README.md` 为准，原样照抄。

## Known agent limitations  已知 agent 局限

The layout playbook is loadable by any agent (mechanism is agent-agnostic), but
whether the model actually *applies* the decision matrix scales with model
strength. Claude Opus / Sonnet are the most reliable. If an agent degrades to
"all `plain` placeholders" and ignores the matrix, note it here rather than
blocking — quality, not mechanism, is the variable.
layout 手册任何 agent 都读得到（机制 agnostic），但是否真按矩阵挑 layout 跟模型强度相关。Claude Opus / Sonnet 最稳；某 agent 退化成全 plain 时记到此处，不阻塞。

- (No degradations recorded yet.  暂无记录。)

### 4. Write deck.md  写文件

Write to `.roll/slides/<slug>/deck.md` with this structure:

```markdown
---
template: <template>
slug: <slug>
title_en: "<topic in English>"
title_zh: "<topic in Chinese>"
total_slides: 18
created: <YYYY-MM-DD>
pkg_name: "<from package.json name>"
repo_url: "<from package.json repository.url>"
site_url: "<from package.json homepage>"
author: "<from package.json author>"
---

## Slide 1
layout: plain
title_en: "..."
title_zh: "..."
body_en: |
  ...
body_zh: |
  ...
evidence:
  - README.md:12
  - .roll/backlog.md:34

## Slide 2
...
```

Every slide declares `layout:` first (see "Layout 选择手册"); rich layouts add
their own structured fields (e.g. `cards`, `left_items`, `stages`) in place of
`body_en` / `body_zh`.
每张 slide 先声明 `layout:`；富 layout 用各自的结构化字段取代 `body_en` / `body_zh`。

`total_slides` MUST match the number of `## Slide N` blocks. The validator (run by `roll slides build`) will reject mismatches.

Project identity fields (`pkg_name`, `repo_url`, `site_url`, `author`) are copied verbatim from `package.json` — never infer or guess these values. `roll slides build` injects them into the HTML template (cover, back cover, footer).
项目身份字段从 `package.json` 原样复制——禁止推测。`roll slides build` 会把它们注入 HTML 模板（封面、封底、页脚）。

### 5. Stop after writing  写完即停

Once `deck.md` is written, stop. Do not run `roll slides build` yourself — that
is a deliberate human gate. The CLI prints the bilingual "Next" hint after the
agent exits, so the agent should not duplicate it.

## Output format expectations

- One file written: `.roll/slides/<slug>/deck.md`.
- No HTML, no edits to any other file.
- No "Next" hint in the agent's final message (the CLI prints it).

## Rules

- Honour the hard constraints above. The CLI will trust you not to scribble outside the deck file.
- If `.roll/` does not exist, create it first (with `mkdir -p .roll/slides/<slug>`).
- If the project has no `README.md` or `AGENTS.md`, proceed using what is available and flag affected slides as `⚠️ unverified`.
- Keep slides terse — this is a deck, not a doc.
