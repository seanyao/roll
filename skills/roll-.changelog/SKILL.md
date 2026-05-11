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

**写法约束：**

1. **一行，30 字以内**。超了就是太啰嗦。
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

### 6. Commit Update

```bash
git add CHANGELOG.md
git commit -m "docs: update changelog for release $(date +%Y.%m.%d)"
git push
```

## Integration

After successful deploy in `$roll-build` / `$roll-fix`:

```markdown
**Post-Deploy:**
- `$roll-.changelog` - Sync external changelog
```
