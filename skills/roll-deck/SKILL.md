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

## Inputs

- `<topic>`: a free-text topic string (required).
- `<template>`: template name, default `introduction-v3`.
- `<slug>`: kebab-case slug derived from the topic by the CLI; you receive it.

## Workflow

### 1. Read the project  阅读项目

Read in this order, skipping files that don't exist:

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

- `title_en` — short English title (≤ 8 words).
- `title_zh` — short Chinese title (≤ 16 chars).
- `body_en` — markdown body, concise, ≤ 200 words.
- `body_zh` — Chinese body, concise, ≤ 200 chars.
- `evidence` — list of `<path>:<line>` references that ground the claim.

**Grounding threshold**: every 3 consecutive slides MUST contain at least 1 evidence citation. If you cannot ground a slide, label it `⚠️ unverified` in the body and explain why in one line.
**Grounding 阈值**：每 3 张 slide 至少 1 条 evidence。无法取证时打 `⚠️ unverified` 并一行说明。

Bilingual rule: English and Chinese MUST be on separate lines in the rendered body — never inline on the same line.

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
---

## Slide 1
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

`total_slides` MUST match the number of `## Slide N` blocks. The validator (run by `roll slides build`) will reject mismatches.

### 5. Prompt the user  提示用户

After writing, print a single bilingual block:

```
deck.md written → .roll/slides/<slug>/deck.md
deck.md 已写入 → .roll/slides/<slug>/deck.md

Next:  roll slides build <slug>
下一步：roll slides build <slug>
```

Do not run `roll slides build` yourself — that is a deliberate human gate.

## Output format expectations

- One file written: `.roll/slides/<slug>/deck.md`.
- Final agent message ends with the bilingual "Next" hint above.
- No HTML, no edits to any other file.

## Rules

- Honour the hard constraints above. The CLI will trust you not to scribble outside the deck file.
- If `.roll/` does not exist, create it first (with `mkdir -p .roll/slides/<slug>`).
- If the project has no `README.md` or `AGENTS.md`, proceed using what is available and flag affected slides as `⚠️ unverified`.
- Keep slides terse — this is a deck, not a doc.
