# Roll — 幻灯片

> 把一个主题字符串变成一份可分享的 18 张双语 HTML 幻灯片。
> 流程刻意分两层：AI 写 `deck.md`，确定性的 bash 步骤把它渲染成 HTML。
> 你随时可以手动改 `deck.md` 再重新渲染。

## What & Why（是什么 & 为什么）

`roll slides` 是 Roll 的幻灯片生成器。存在的理由：

- 从零手写 HTML deck 太慢；用临时 prompt 让 AI 直接写 HTML 又难以保持视觉一致、难以复现。
- 一份开源项目的 deck 通常**骨架相同**——封面、问题、方案、演示、证据、号召行动——但**内容**因主题而变。
- 我们希望**内容**来自项目本身的代码、README、backlog，而不是 LLM 当天臆想的东西。

所以管线被拆成：

| 层级 | 工具 | 作用 |
|------|------|------|
| 创作 | `roll slides new` + `roll-deck` skill | 读你的仓库，写一份含 18 张双语 slide 和 evidence 引用的 `deck.md`。 |
| 渲染 | `roll slides build`（Python，无 AI） | 用 schema 校验 `deck.md`，套 Mustache 风格模板，输出自包含 `.html`。 |
| 浏览 | `roll slides list` / `roll slides preview` | 列出已有 deck；用浏览器打开任一份。 |

这层拆分是刻意的。bash 一侧可复现——同样的 `deck.md` 和模板，每次都得到一样的 HTML。AI 一侧接受一定的不确定性，换取速度。

## 快速上手

从主题到可分享 HTML，四步搞定。

### 1. New —— 生成 `deck.md`

```bash
roll slides new "Introducing Roll Loop"
```

会通过你选定的 agent（如果没选，先 `roll agent use <name>`）加载 `roll-deck` skill。Agent 会：

1. 阅读 `README.md`、`AGENTS.md`、`.roll/backlog.md`、`.roll/features/`。
2. 基于读到的内容打 18 张 slide 的提纲。
3. 只写一个文件：`.roll/slides/<slug>/deck.md`。

`<slug>` 由主题派生（kebab-case，ASCII）。

如果主题含糊，skill 允许**一轮**澄清问答再开始写。无法取证的 slide 会被打上 `⚠️ unverified` 标签。

### 2. Review —— 审 `deck.md`

在编辑器里打开 `.roll/slides/<slug>/deck.md`。这是人工质量门。要确认：

- 每张 slide 是否说出了具体的、项目相关的内容？
- 证据引用是不是真实存在的文件路径和行号？
- 被打 `⚠️ unverified` 的 slide，你能不能手动补上？

不满意的地方直接改。这是纯文本文件——标题、正文、证据都可见可编辑。

### 3. Build —— 渲染成 HTML

```bash
roll slides build <slug>
```

纯 bash + Python，无 AI 介入。它会：

1. 用 schema 校验 `deck.md`（`lib/slides-validate.py`）。
2. 解析 frontmatter 指定的模板（默认 `introduction-v3`）。
3. 渲染到 `.roll/slides/<slug>.html`（`lib/slides-render.py`）。
4. 如果 `.roll/.gitignore` 没有 `slides/*.html`，自动加上。
5. 用浏览器打开（除非传 `--no-open`）。

校验失败会逐行列出问题——改 `deck.md` 再重跑即可。

### 4. Share —— 列表、预览或发布

```bash
roll slides list             # 列出 .roll/slides/ 下所有 deck 的表格
roll slides preview <slug>   # 用浏览器打开 .roll/slides/<slug>.html
```

要把 deck 发布到公开站点，参考下面的 [输出位置](#输出位置) 章节——默认 HTML 是 gitignored，只留在本地。

## `deck.md` 格式参考

`deck.md` 有两部分：YAML 风格的 frontmatter，加上每张 slide 的 `## Slide N` 段。

### Frontmatter

必需字段（由 `slides-validate.py` 校验）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `template` | string | 模板名，如 `introduction-v3`。 |
| `slug` | string | kebab-case 标识，要和目录名一致。 |
| `title_en` | string | 英文 deck 标题。 |
| `title_zh` | string | 中文 deck 标题。 |
| `total_slides` | int | 必须等于 `## Slide N` 段的实际数量。 |
| `created` | string | ISO 日期，如 `2026-05-21`。 |

示例：

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

### Slide 段

每张 slide 由 `## Slide N` 头部加四个必需键和一个 evidence 列表组成：

```markdown
## Slide 1
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

每张 slide 必需键：`title_en`、`title_zh`、`body_en`、`body_zh`。`evidence` 是 `<path>:<line>` 引用列表——每 3 张 slide 至少 1 条（详见 [Grounding](#grounding-与-evidence-约定)）。

### 支持的 Mustache 占位符

`slides-render.py` 仅实现一个小的 Mustache 子集供模板层使用。自定义模板（Phase 2）可用：

| 占位符 | 含义 |
|--------|------|
| `{{var}}` | 从当前上下文取值，HTML 转义后插入。 |
| `{{{var}}}` | 原样替换（不转义）。用于已渲染的 HTML。 |
| `{{#section}} ... {{/section}}` | 列表迭代；若值为真则渲染一次。 |
| `{{^section}} ... {{/section}}` | 反向段——值缺失或为假时渲染。 |

**故意不支持**的：partials（`{{>name}}`）、lambda、自定义定界符（`{{=<% %>=}}`）、点路径查找（`{{a.b}}`）。

渲染上下文暴露 frontmatter 标量（`title_en`、`title_zh`、`total_slides` 等）和 `slides` 列表。每张 slide 项暴露 `number`、`title_en`、`title_zh`、`body_en`、`body_zh`、`body_en_html`、`body_zh_html`、`evidence`。

## Grounding 与 evidence 约定

讲项目的 deck 必须**引用项目本身**。约定：

- **阈值**：整份 deck 的 evidence 总数不少于 `ceil(total_slides / 3)`——即**平均每 3 张 slide 至少 1 条 evidence**。18 张 deck 即 ≥ 6 条。
- **格式**：`<path>:<line>`（如 `bin/roll:3127`），路径相对仓库根。
- **覆盖**：证据要分散，不要一股脑堆在某一张上。聚集意味着其余 slide 无 grounding。
- **无法取证的论断**：实在没法引用时，在 body 前加 `⚠️ unverified` 和一行原因。校验仍会通过，但读者知道该重点审视哪些 slide。

`roll slides build` 会先跑校验。低于 grounding 阈值时构建中止，输出 `⚠️ grounding below threshold`。修法是补 evidence 或删掉空话 slide——不要绕过校验。

## 输出位置

默认情况下，构建产物**只留在本地**：

```
.roll/slides/<slug>/deck.md        ← 源文件，是否纳入 git 看项目策略（通常也忽略）
.roll/slides/<slug>.html           ← 渲染产物，gitignored
.roll/.gitignore                   ← 自动追加 slides/*.html
```

大部分 Roll 项目里 `.roll/` 本身就在 `.gitignore`。`.roll/.gitignore` 这一行是"双保险"——即便有项目把 `.roll/` 纳入跟踪，渲染出来的 HTML 仍然不会被提交。

### 把 deck 发布到公开站点

要把 deck 放到对外文档站（如 GitHub Pages）：

1. 确定公开路径，如 `site/slides/<slug>.html`。
2. 拷贝渲染产物：

   ```bash
   mkdir -p site/slides
   cp .roll/slides/<slug>.html site/slides/<slug>.html
   ```

3. 强制添加——根 `.gitignore` 可能会匹配——并提交：

   ```bash
   git add -f site/slides/<slug>.html
   git commit -m "Story X: publish <slug> deck"
   ```

4. 可选：在站点首页 / README 里加链接。

把源 `deck.md` 留在 `.roll/slides/<slug>/` 下，方便后续 `roll slides build <slug>` 原地重渲染。**不要**只 commit HTML 然后手改它——改 `deck.md` 再重渲染。

## 常见陷阱

### AI 内容浅尝辄止

症状：deck 读起来像通用介绍，bullet 是"Roll is fast"这种，没有项目特有的例子。

纠偏：

- **直接改 `deck.md`**。纯文本文件，重写某张 slide 的 `body_en` / `body_zh` 让它具体起来。再跑 `roll slides build <slug>` 重渲染。
- **先加 evidence 再写正文**。一旦被迫引用真实文件和行号，slide 内容自然就具体了。
- **用更尖锐的主题重新生成**。`roll slides new "How TCR keeps Roll's bin/roll honest"` 会比 `roll slides new "Roll"` 好很多。

### 校验失败：`total_slides mismatch`

症状：frontmatter 写 `total_slides: 18`，但 `## Slide N` 段只有 17 个（或反之）。

纠偏：数一下 `## Slide` 头并改 frontmatter。`grep -c '^## Slide ' .roll/slides/<slug>/deck.md` 可以确认数量。

### 校验失败：`missing required frontmatter field`

症状：校验器点名某个字段，如 `created` 或 `slug`。

纠偏：打开 `deck.md`，加上合适的值保存，重跑 `roll slides build`。六个必需字段见上面的 [Frontmatter](#frontmatter)。

### 校验失败：grounding 阈值不足

症状：`⚠️ grounding below threshold: 3 evidence citation(s) for 18 slides (need >= 6)`。

纠偏：给引用不足的 slide 加 `evidence:` 行。目标是每 3 张连续 slide 至少 1 条引用。若某条论断实在无法引用，把那张 slide 打成 `⚠️ unverified` 并降低 deck 整体的论断密度。

### `roll slides build` 浏览器没打开 / 打开错的

症状：构建成功，但浏览器没起来（或打开了奇怪的东西）。

纠偏：传 `--no-open` 抑制自动打开，再用 `roll slides preview <slug>` 显式打开。Linux 用 `xdg-open`，macOS 用 `open`。在 shell rc 里设 `ROLL_SLIDES_NO_OPEN=1` 可以全局禁用自动打开。

### 重新 `roll slides new` 会覆盖现有 deck

症状：再来一次 `roll slides new "<同样的主题>"`，要覆盖你已经手动改过的 `deck.md`。

纠偏：skill 被要求**在覆盖前征求同意**。若你点了同意，原编辑就丢了。要么先改名（`mv .roll/slides/<slug> .roll/slides/<slug>-v2`），要么直接编辑现有 `deck.md` 而不要重新生成。

## 相关链接

- [overview.md](overview.md) —— Roll 是什么、三层模型。
- [skills.md](skills.md) —— 按任务选择合适的 skill。
- `skills/roll-deck/SKILL.md` —— 创作层 skill 的硬约束。
- `lib/slides-render.py` —— Mustache 子集 + markdown 子集参考。
- `lib/slides-validate.py` —— schema 与 grounding 规则。
