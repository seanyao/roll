---
hidden: true
name: roll-.changelog
license: MIT
allowed-tools: "Read, Edit, Write, Bash(git:*)"
description: After build completion, extracts completed Stories from BACKLOG.md to generate CHANGELOG.md. Auto-triggered after successful deploy, keeping the external changelog in sync with the internal backlog.
---

# WK Generate Changelog

After successful Build & Deploy, extracts completed Stories from BACKLOG.md to generate a user-friendly `CHANGELOG.md`.

## When Triggered

- **Auto-triggered**: After successful deploy of `$roll-build` or `$roll-fix`
- **Manual trigger**: When user requests "update changelog" or "generate release notes"

## When Not to Use

- Generating commit messages or PR descriptions — this skill only runs post-deploy
- Recording dev diary / moments (use `$roll-notes`)
- Bumping package version (use `$roll-release`)

## Workflow

### 1. Check CHANGELOG.md

```
CHANGELOG.md exists?
    ├── Yes → Append mode (add current deploy's changes)
    └── No  → Create mode (backfill all historical completed Stories)
```

### 2. Read BACKLOG.md

```
Append mode:
  Extract only the Story/Fix just deployed in this session.

Create mode:
  Extract ALL Stories and Fixes with status ✅ Done.
  Read each Story's docs/features/<feature>.md for Completed date.
  Group entries by completion date, reverse chronological order.
```

### 3. Filter for External Content

CHANGELOG 是给**使用者**看的，不是给维护者看的。一句话讲清"用户能做什么 / 不再被什么坑"，能不写就不写。

**BACKLOG 描述写好了，CHANGELOG 就是复制 + 过滤，不是重写。**
如果 BACKLOG 描述已经是人话、一句话、说用户价值，直接用它（去掉 `depends-on:` / `manual-only:` 等功能性标签）。
只有 BACKLOG 描述包含实现细节或技术黑话时，才需要改写。

**FIX 条目的 filter 规则**：BACKLOG 的 FIX 描述通常是 `<用户症状> — <修复手段>` 结构。
CHANGELOG 只取破折号前的用户症状，丢弃破折号后的修复手段。
例：`roll update 后 loop 状态误报 off — reload 改用 bootout+bootstrap` → CHANGELOG 只写 `roll update 后 loop 状态不再误报 off`。

**完全跳过（不写入 CHANGELOG）：**
- 测试基建（teardown 清理、test isolation、bats helper、CI 时序）
- prompt / SKILL.md 内部契约（schema 锁定、enum 强制、contract test）
- 内部重构（提取函数、变量改名、目录调整）
- 只有开发者会遇到的 bug（release.sh 自身逻辑、TCR 节奏调整）
- 任何"用户体验不变"的改动

判断准则：**如果用户读了这条记录，他不会改变使用方式，就别写。**

**保留：**
- 用户能直接调用的新功能 / 新命令
- 用户实际遇到过的 bug 修复
- 看得见的体验变化（布局、文案、速度、可见性）
- 影响安装、升级、配置的改动

**写法约束（BACKLOG 描述不符合时才介入改写）：**

1. **一行**。超了就是太啰嗦。
2. **不写实现细节**：禁止文件路径、函数名、字段列表、命令参数、配置键名。
3. **不写数字细节**："3 个服务"、"60+ ghost" 这种内部状态不写。
4. **说人话**：避免 "幂等"、"trap"、"epoch" 等技术黑话；说"做两次效果一样"、"异常退出也会清理"、"启动时间"。
5. **句式**：`功能名 — 用户能做什么 / 解决了什么麻烦`。

**语言：中文。**

具体对比（都是真实的 roll 改动）：

❌ 全是实现细节：
```
- **Added**: `roll loop runs` 每次 loop 运行的快速可见性 — 单次 loop 结束追加一行 JSON 到 `~/.shared/roll/loop/runs.jsonl`（含 ts/project/run_id/status/built/skipped/alerts/tcr_count/duration_sec），新命令 `roll loop runs [N] [--all]` 倒序显示最近 N 次（默认 10）。
```

✅ 讲价值：
```
- **Added**: `roll loop runs` — 随时查看 loop 最近几次都跑了什么
```

❌ 内部信息扎堆：
```
- **Fixed**: 集成测试 launchd ghost 泄漏 — `integration_teardown` 在删除 TEST_TMP 之前，先 `launchctl bootout` 该沙箱里被 `roll loop on` 注册到 user gui domain 的所有 `com.roll.*` 服务。
```

✅ **直接跳过**：测试基建修复，用户感知不到。

❌ 参数列表+黑话：
```
- **Added**: Loop 并发安全 — runner script 启动时写入 per-project LOCK 文件并检测重入；活跃 PID 已存在则跳过本次，残留死 LOCK 自动清理；正常/异常退出均通过 trap 清掉 LOCK。
```

✅ 用户视角：
```
- **Fixed**: 多个 loop 实例不会再互相打架（重复触发自动跳过）
```

❌ 说机制不说现象（Fix 类最常犯）：
```
- **Fixed**: `roll loop runs` 过滤条件从完整路径改为 slug，历史记录不再因路径不匹配而消失
- **Fixed**: `roll-loop` skill 写入 `runs.jsonl` 时 project slug 计算方式明确，避免写成 bare basename
```

✅ 直接说用户看到了什么：
```
- **Fixed**: `roll loop runs` 不再报"当前项目尚无运行记录"，历史记录正常显示
```

Fix 类句式参考：`<命令/功能> 不再 <之前的坏现象>`，或 `<命令/功能> 现在 <正常表现>`。内部有几个 bug 导致这一个现象，合并成一条。

### 4. Section Header — Always `## Unreleased`

**⚠️ do NOT guess version numbers.** Only `scripts/release.sh` assigns concrete
versions, and it only does so at the moment of a real release. Until then,
every new bullet goes under `## Unreleased` at the top of CHANGELOG.md.

```
## Unreleased
- **Added**: ...new entries here...
- **Fixed**: ...
```

When `release.sh` runs, it renames `## Unreleased` to `## v{N}` (where N is
computed from git tags) — that's the single moment a version label gets
assigned.

Do NOT read `package.json` version, do NOT call `git describe`, do NOT invent
version numbers like `v2026.511.8`. Just write to `## Unreleased`.

### 5.3 Style Anchors — In-Context Few-Shot

Before drafting bullets, pull the most recent 3 published versions' bullets as
in-context examples so the agent doesn't write from a blank slate (the blank
slate is where the technical-jargon habit comes from — the agent is fresh
from writing function names and just copies them over).

```bash
_changelog_style_anchors CHANGELOG.md
```

Output is the concatenated bullet lines from the last 3 `## v...` sections,
capped at 1500 characters. Use them as a style reference when drafting — pay
attention to length, voice ("不再被…坑" / "现在 …"), and absence of internal
names.

### 5.4 Mechanical Lint — Hard Gate

After drafting bullets, run each through the mechanical linter. Any non-empty
output means the bullet violates at least one blacklist rule and must be
rewritten.

```bash
for bullet in "${draft_bullets[@]}"; do
  violations=$(_changelog_lint_bullet "$bullet")
  [ -n "$violations" ] && needs_rewrite+=("$bullet :: $violations")
done
```

Violation tags emitted by `_changelog_lint_bullet`:

| Tag | Trigger | Why it's noise to users |
|---|---|---|
| `backtick-identifier` | `…` contains `_` or `()` | Internal symbol names mean nothing to users |
| `file-suffix` | `.md/.sh/.yml/.ts/.bats` outside backticks | File paths are maintainer concern |
| `internal-word` | Phase N / Step N / Helper / Schema / Fixture / Refactor | Workflow/design vocabulary, not user-facing |
| `over-length` | > 50 visible chars | Too long = probably explaining implementation |
| `path-fragment` | `docs/` / `bin/` / `tests/` / `scripts/` outside backticks | Source-tree layout is maintainer concern |

**Rewrite loop (max 2 rounds)**:
1. Show the agent the violation list + original bullet → request rewrite
2. Re-lint the rewrite
3. If still violating after 2 rewrites → **keep the bullet but prefix `⚠️ `** so
   the human reviewer can spot it, AND append a line to
   `~/.shared/roll/loop/ALERT.md` describing what couldn't be fixed.
   Never block the whole release on style — let the human take the wheel.

### 5.5 Self-Audit — Stage Gate

The mechanical linter in Step 5.4 catches **blacklist** patterns; the audit
gate in this step is a **whitelist** of 5 boolean checks that the bullet must
satisfy before it can be staged. Stricter (30-char cap vs 50) and shape-aware
(requires the user-facing `—` or `不再`/`现在` sentence pattern).

```bash
accepted=$(_changelog_audit_gate "$draft1" "$rewrite1" "$rewrite2")
# Exit 0: stdout = first clean candidate
# Exit 1: stdout = ⚠️-prefixed last candidate; ALERT was written
```

5 boolean checks evaluated by `_changelog_audit_bullet`:

| Tag | Trigger |
|---|---|
| `over-length-30` | visible chars > 30 (bypassed if bullet has a backticked user command) |
| `internal-id` | backtick content contains `_` or `()` |
| `path-or-suffix` | `.md/.sh/.yml/.ts/.bats` or `docs/bin/tests/scripts/` outside backticks |
| `phase-step` | `Phase N` or `Step N` |
| `bad-shape` | none of `—`, `不再`, `现在` present |

**3-round retry envelope**:
1. Round 1 = original draft; if pass → stage immediately
2. Round 2 = rewrite based on violations from round 1
3. Round 3 = second rewrite if round 2 also failed
4. All 3 failed → keep last candidate prefixed with `⚠️ `, append ALERT to
   `~/.shared/roll/loop/ALERT.md`. **Never block the stage** — let the human
   reviewer take the wheel. The loop must keep moving.

**Audit log**: every round (pass or fail) appends one JSONL line to
`~/.shared/roll/loop/changelog-audit.jsonl`:

```json
{"ts":"2026-05-13T13:50:00Z","verdict":"fail","round":1,"bullet":"...","reasons":["over-length-30","bad-shape"]}
```

Useful when reviewing whether the agent actually iterated or just rubber-stamped
its own first draft. Set `ROLL_CHANGELOG_AUDIT_LOG` to redirect (tests only).

### 5. Generate CHANGELOG.md

**Create mode** (first time, no CHANGELOG.md yet):
```markdown
# Changelog

## Unreleased
- **Added**: ...current deploy's entries...

## 2026.05.10
- **Added**: ...historical entries from completed Stories before today...
```

**Append mode** (most common — CHANGELOG.md exists):

1. Find `## Unreleased` heading at the top of CHANGELOG.md.
2. If it exists → append new bullets under it (do NOT create a new section).
3. If it doesn't exist → insert a fresh `## Unreleased` at the very top (right after the `# Changelog` title) with the new bullets.

```markdown
# Changelog

## Unreleased
- **Added**: ...just-deployed entry appended here...
- **Fixed**: ...another just-deployed entry...

## v2026.05.07      ← previous releases left untouched
- ...
```

**Ordering**: Unreleased always at top. Below it, released versions in reverse chronological order.

### 6. Stage Update

**Normal path (called from `$roll-build` or `$roll-fix`)**: stage only — the
caller's completion commit will pick up CHANGELOG.md.

```bash
git add CHANGELOG.md
```

**Standalone / manual path** (called outside a roll-build session): stage and commit.

```bash
git add CHANGELOG.md
git commit -m "chore: sync changelog"
git push
```

## Integration

After successful deploy in `$roll-build` / `$roll-fix`:

```markdown
**Post-Deploy:**
- `$roll-.changelog` - Sync external changelog
```

---

## 7. Release Notes 生成模式（GitHub Release 正文）

`CHANGELOG.md` 里的 `## Unreleased` 条目是**原始数据**，每条对应一个故事或修复。
发版时（`release.sh` 打 tag 前，或手动 `roll release notes`），把这些散装 bullet 整理成**给人读的 Release 正文**。

这是两个不同的产物：
- `CHANGELOG.md` — 机器写、给 `roll update` 之后展示用，条目可以多
- GitHub Release 正文 — 给用户 / 关注者读，要分组、要有温度、要简洁

### 7.1 何时触发

- `release.sh` 在 commit 之前调用本 skill 并传入 `--release-notes` flag
- 或用户手动说"帮我整理 Release Notes"

### 7.2 分组规则

把当前版本的 bullet 按**用户感知**归入以下分组，每组最多 5 条，超出的合并：

| 分组标题 | 归入条件 |
|---|---|
| 自动化流水线 | PR 自动化、Auto-merge、CI 触发、分支管理 |
| 可见性 | Dashboard、弹窗、实时输出、状态显示 |
| 稳定性 | 崩溃修复、并发问题、状态误报 |
| 工程和测试 | CI 速度、测试并行、文档工作流 |
| 新功能 | 全新命令或用户可感知的新能力 |

分组顺序：**影响日常使用的放前面**，纯工程改进放后面。
分组少于 2 条时可以合并到相邻组，不强制保留空组。

### 7.3 合并相似条目

同一功能点的多个 bullet（如"开 PR"和"Auto-merge"都在描述同一条流水线）合并为一条，用一句话说清楚整体效果，不要列两条。

判断标准：**用户感知到的是同一件事，就合并。**

### 7.4 归因标签

在每条末尾加标签，说明是谁做的：

| 标签 | 归因依据 |
|---|---|
| `[loop]` | 对应 `US-AUTO-*` / `FIX-*` / `US-CL-*` 故事，由 Loop 自动执行 |
| `[dream]` | 对应 `REFACTOR-*` 故事，由 Dream 夜间扫描发现并推入 Backlog |
| （无标签） | 人工提交，或无法确定来源 |

### 7.5 措辞原则

- 用**第二人称**（"你不需要盯着"、"你可以随时查看"）
- **主语是用户的感受**，不是系统的行为（"不再误报" > "修复了误报逻辑"）
- **故意模糊实现细节**：不写函数名、文件名、Phase 编号
- **有温度**：可以用"真的很急"、"不再越来越乱"这样口语化的表达
- 每条一行，简洁优先

### 7.6 输出格式

```markdown
## <分组标题>

- <条目> `[loop]`
- <条目> `[dream]`
- <条目>

## <分组标题>

- ...
```

不需要 `**Added**` / `**Fixed**` 前缀，分组标题已经承担了语义分类的职责。

## 8. features.md 重写模式（产品 SOT）

US-DOC-008 — `scripts/release.sh` 在 changelog/release-notes 生成完后会再
调一次本 skill，请求"整体重写 `docs/features.md`"。这次调用的语义和上面
两种完全不同：**不是基于本版 Story 增量**，而是基于**项目整体当前状态**。

### 8.1 何时触发

release.sh 完成 changelog/release-notes 写盘后，喂一段以
`## 当前任务：重写 docs/features.md（Section 8）` 开头的 prompt。

### 8.2 输入

prompt 会包含：
- 当前 `docs/features.md`（可能为空，可能上一版本的）
- 当前 `BACKLOG.md` 全文（Epic / Feature 分组结构）
- 当前 `docs/features/` 目录清单
- 当前版本号

### 8.3 输出契约

把整个 `docs/features.md` 写出来。结构固定为三段：

```
# Roll — Features

> 说明段（保留原文）

---

## ✨ Core Highlights

- **<Feature 名>** — 1 句话产品级描述
- **<Feature 名>** — 1 句话产品级描述
- ...（3-5 条）

---

## Features by Epic

### <Epic 名>
- [<Feature 名>](docs/features/<file>.md) — 1 句话描述
- <Feature 名> — 1 句话描述（缺 deep doc 时不加链接）

### <Epic 名>
- ...

---

## 维护说明（保留原文）
```

### 8.4 规则

- **Catalog 必须列出 BACKLOG 中所有 `### Feature:` 出现的 Feature 名**
  （即使没有 deep doc 也要列）
- Feature 名跟 `docs/features/<file>.md` 文件名一致时，加链接到该 md
- 没有对应 deep doc 的 Feature，**只写 plain text 不加链接**
- 描述写 1 句话 **产品视角**：用户能用它做什么，避免实现细节
- 分组用 BACKLOG 的 Epic 名，原序，不重排
- Core Highlights 从所有 Features 里挑 3-5 个最能代表产品定位的，
  描述用 bold 标 Feature 名后接说明；不照搬 catalog 文案
- **不**写 "Recent Activity" 类区块——features.md 是 SOT，全量当下状态
- **不**写版本号、不引用 changelog 条目
- 说明段（顶部 quote）和维护说明（尾部）原文保留，不要重新生成措辞

### 8.5 失败安全

如果 prompt 信息不足（BACKLOG 解析失败等），**不要部分写入** —— 输出原
文件内容即可。release.sh 会捕获 stdout 后比较：内容未变就不 stage。

