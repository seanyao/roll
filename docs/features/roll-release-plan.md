# Release Script AI Call Optimization — Design Plan

**US**: [US-REL-002](roll-release.md#us-rel-002)
**Created**: 2026-05-17

## Problem

`scripts/release.sh` 每次发版触发 3 次串行 `claude -p` 调用，每次冷启动一个新的 AI 进程：
1. changelog 同步 — 喂 SKILL.md (16KB) + AI 自读 BACKLOG (36KB)
2. release notes 生成 — 喂 SKILL.md (16KB) + changelog 段
3. features.md 重写 — 喂 SKILL.md (16KB) + **BACKLOG 全文内联 (36KB)** + features.md (6.5KB)

总上下文 ~90KB，3 次串行等待。最大浪费：step 3 把 36KB BACKLOG 全文塞进 prompt，实际只需 ~2KB 的结构摘要。

## Design

### 1. 合并 changelog + release notes（3 calls → 2 calls）

两个任务输入相同（BACKLOG 状态），只是输出格式不同。合并为一次 `claude -p`：

```
【任务 1】按 Section 3–6 规则将 BACKLOG 已完成 Story 写入 CHANGELOG.md ## Unreleased
【任务 2】按 Section 7 规则将条目分组，写入 release_notes.txt

一次读取 BACKLOG，两个输出都完成后再退出。
```

实现：合并 `_run_changelog_skill` 和 `_run_release_notes_skill` 为一个函数。

### 2. BACKLOG 结构提取（36KB → ~2KB）

新增 `_backlog_summary()` helper，在 shell 侧预处理：

```bash
_backlog_summary() {
  awk '
    /^## Epic:/   { epic=$0; next }
    /^### Feature:/ { feat=$0; next }
    /^\| \[/ {
      split($0, a, "|")
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", a[2])
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", a[3])
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", a[4])
      print epic " > " feat " > " a[2] " — " a[3] " [" a[4] "]"
    }
  ' BACKLOG.md
}
```

输出示例：
```
## Epic: Release Management > ### Feature: roll-release > [US-REL-001](...) — one-command publish flow [✅ Done]
```

替换 `backlog_content=$(<BACKLOG.md)` 为 `backlog_content=$(_backlog_summary)`。

### 3. SKILL.md 按 Section 裁剪

新增 `_skill_section()` helper，按 `## N.` 标记提取：

```bash
_skill_section() {
  local start="$1" end="$2" file="$3"
  awk "/^## ${start}\./{found=1; next} found && /^## ${end}\./{exit} found{print}" "$file"
}
```

| 调用 | 当前 | 改为 |
|---|---|---|
| changelog+relnotes | 全量 16KB | Section 3–7 (~10KB) |
| features.md | 全量 16KB | Section 8 (~3KB) |

### 4. 失败安全

- `_backlog_summary` 解析失败或输出为空 → fallback 到原文 `$(<BACKLOG.md)`
- 合并后的 changelog+relnotes 调用任一产物为空 → 分别回退到独立调用
- features.md 输出与当前文件无变化 → 跳过 stage（现有逻辑保留）

## Impact

| 指标 | 改前 | 改后 | 
|---|---|---|
| AI 调用次数 | 3 | 2 |
| 总 prompt 大小 | ~90KB | ~22KB (-75%) |
| BACKLOG 载荷 | 36KB 全文 | ~2KB 摘要 (-94%) |

## Non-Goals

- 不改 SKILL.md 内容
- 不改 `_agent_argv` / `_agent_bypass_claude_perms` 签名
- CHANGELOG.md / release_notes.txt / features.md 最终输出不变
