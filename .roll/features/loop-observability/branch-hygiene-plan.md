# Branch Hygiene — Technical Plan

> US-AUTO-040 统一临时分支清理：弥补 `loop/cycle-*` 远程分支的 GC 盲区。

## Problem

### Current State

Loop 每轮产生两类临时远程分支，各自有清理路径，但 `loop/cycle-*` 路径有结构性漏洞：

| 分支模式 | 清理机制 | 状态 | 漏洞 |
|----------|----------|------|------|
| `claude/*` | 快照对比 + `push --delete`（每次 cycle 无条件执行） | ✅ US-AUTO-038 | 无 |
| `loop/cycle-*` | PR auto-merge `--delete-branch` | ⚠️ US-AUTO-033 | 单点故障：claude 异常退出 / `gh` 不可用 / `gh pr create` 失败 / auto-merge 永不触发 — 任一断点导致分支永久残留 |

### Evidence

截至 2026-05-14，remote 已积累 **16 条** `loop/cycle-*` 僵尸分支：
- 12 条已合入 main（`ahead_of_main=0`），但 `--delete-branch` 未生效
- 4 条未合入 main（`ahead_of_main>0`），PR 从未创建

### Root Cause

清理和发布耦合在内联流程中。`claude/*` 有独立 GC 通路，`loop/cycle-*` 没有。

## Design

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│           inner.sh — Post-claude cleanup order           │
├─────────────────────────────────────────────────────────┤
│  1. _claude_cleanup_new_branches    (claude/* snapshot)  │
│  2. _claude_cleanup_stale_worktrees (local .claude/wt)  │
│  3. PR publish                (loop/cycle-* → auto-merge)│
│  4. _loop_cleanup_stale_cycle_branches  ← NEW           │
│     (loop/cycle-* merged-to-main → push --delete)       │
└─────────────────────────────────────────────────────────┘
```

新增的 Step 4 是 Step 3 的**兜底 GC**：不替代 PR 发布路径，只回收 PR 路径未能删除的分支。

### New Function: `_loop_cleanup_stale_cycle_branches`

```bash
# _loop_cleanup_stale_cycle_branches [project_path]
#   Scan remote `loop/cycle-*` branches. For each that has been fully
#   merged to main (merge-base --is-ancestor), delete the remote ref.
#   Skips branches still ahead of main (active/abandoned but not merged).
#   Silent on non-GitHub remote / unreachable / no matches.
_loop_cleanup_stale_cycle_branches() {
  local project_path="${1:-.}"
  local url; url=$(git -C "$project_path" remote get-url origin 2>/dev/null)
  [[ "$url" == *github.com* ]] || return 0

  local branches
  branches=$(git -C "$project_path" ls-remote --heads origin 'refs/heads/loop/cycle-*' 2>/dev/null \
    | awk '{print $2}' | sed 's|^refs/heads/||')
  [ -z "$branches" ] && return 0

  while IFS= read -r branch; do
    [ -z "$branch" ] && continue
    if ! git -C "$project_path" merge-base --is-ancestor "$branch" origin/main 2>/dev/null; then
      # Branch has commits not in main OR unreachable — skip
      continue
    fi
    if git -C "$project_path" push origin --delete "$branch" 2>/dev/null; then
      echo "[loop] deleted stale cycle branch: $branch"
    fi
  done <<< "$branches"
  return 0
}
```

**Key design decisions:**

1. **Deterministic, not heuristic** — 用 `merge-base --is-ancestor` 精确判断，不依赖时间戳/age。US-AUTO-038 拒绝定期扫描的理由在此不成立。

2. **Defense-in-depth, not replacement** — 不替代 PR auto-merge 的 `--delete-branch`。PR 路径成功时分支已被删，`ls-remote` 返回空直接跳过。只有 PR 路径失败时才介入。

3. **Does NOT delete branches ahead of main** — 仅删除已合入的分支。未合入的分支可能仍有价值（待人工检查），保留不删。

4. **Runs unconditionally** — 在 `_exit` 检查之后、无论 claude 成功/失败都执行。与 `claude/*` 清理的设计哲学一致：清理与业务结果正交。

5. **Idempotent** — 多次运行无害。已删分支直接跳过。

### Placement in inner.sh Template

在现有清理调用之后、PR 发布逻辑之后插入（`_write_loop_runner_script` 函数内）：

```bash
# After: _claude_cleanup_stale_worktrees ...
# After: PR publish + _worktree_cleanup block ends

# US-AUTO-040:兜底 GC — 回收 PR 发布路径未删除的 loop/cycle-* 远程分支。
# 只删已合入 main 的分支；未合入的保留不删（可能待人工检查）。
_loop_cleanup_stale_cycle_branches "${project_path}" || true
```

## Files Changed

| File | Change |
|------|--------|
| `bin/roll` | Add `_loop_cleanup_stale_cycle_branches` (~20 lines) |
| `bin/roll` | Wire call into `_write_loop_runner_script` template (~3 lines) |
| `tests/unit/roll_loop_cleanup.bats` | Add 4 test cases |
| `docs/features/autonomous-evolution.md` | Update US-AUTO-038 Non-goals: remove "loop/* 不在此范围" |

## Test Cases

```bats
# US-AUTO-040: _loop_cleanup_stale_cycle_branches

@test "_loop_cleanup_stale_cycle_branches: deletes merged loop/cycle-* branch" {
  # Setup: create loop/cycle-* remote branch merged to main
  # Expect: push --delete called once, branch name matches
}

@test "_loop_cleanup_stale_cycle_branches: skips branch ahead of main" {
  # Setup: create loop/cycle-* remote branch with commits not in main
  # Expect: push --delete never called
}

@test "_loop_cleanup_stale_cycle_branches: skips non-GitHub remote" {
  # Setup: origin is gitlab / local path
  # Expect: returns 0, no push attempt
}

@test "_loop_cleanup_stale_cycle_branches: wired into inner.sh post-publish" {
  # Verify template contains the function call after PR publish block
}

@test "_loop_cleanup_stale_cycle_branches: idempotent — delete failure silent" {
  # Setup: branch already deleted
  # Expect: returns 0, no error
}
```

## Scope Boundary

**In scope:**
- 远程 `loop/cycle-*` 分支（已合入 main 的）
- 在 inner.sh 每次 cycle 结尾执行

**Out of scope:**
- 未合入 main 的 `loop/cycle-*` 分支（可能含有效工作，不自动删）
- `claude/*` 分支（已有 US-AUTO-038 的快照机制）
- 本地 worktree 清理（已有 REFACTOR-011）
- GitHub PR 清理（已有 `--delete-branch` + GitHub 自身 GC）
- 历史积累的 16 条僵尸分支（一次性手动清理）

## Rollback

移除 `_write_loop_runner_script` 中的调用行，删除函数定义。不影响任何业务逻辑。
