# Roll — 测试工作流

Roll 在整个交付过程中强制执行测试优先原则：

- **TCR**（Test && Commit || Revert）— 每个微步骤通过测试后才提交。
- **E2E Deposit** — 每个完成的 Story 留下一个 E2E 测试，覆盖其核心用户路径。
- **CI E2E Gate** — Deposit 的 E2E 在每次推送时运行，失败则阻止合并。
- **proof-of-pass** — pre-commit hook 物理拦截未经测试的提交。

## E2E Deposit

TCR 微步骤通过后，`$roll-build` Phase 5.5 自动 Deposit E2E 测试：

1. 检测项目已有的 E2E 基础设施（框架、目录、命名规范）。
2. 编写一个覆盖 Story 关键用户路径的 E2E 测试。
3. 运行它——若红则通过 TCR 修复。
4. 提交：`tcr: e2e deposit for <story-id>`。

Deposit 的测试成为持久的回归守门，CI 和 `$roll-sentinel` 可重放以对抗生产环境。

## Pre-commit Hook（proof-of-pass）

Roll 的 pre-commit hook 要求：测试必须在 **60 秒内**、**与当前暂存树完全匹配**的情况下通过：

```bash
# 测试运行器写入：
# .roll/last-test-pass  ← 时间戳 + 树哈希

# 提交时 hook 检查：
# - 距离上次测试通过 < 60 s
# - 树哈希与当前暂存树匹配
```

使用 TCR（roll-build 的默认节奏）时此过程自动完成。

## CI E2E Gate

模板 CI 工作流（`.github/workflows/ci.yml`）将 E2E 测试作为独立任务，必须通过才能合并。失败时：

1. 查看失败测试名——对应一个 Story ID。
2. 在本地复现。
3. 在 `BACKLOG.md` 开 `FIX-XXX` 条目，或直接用 `$roll-fix` 修复。

## 失败分诊

`$roll-.qa` 为测试金字塔每层提供结构化诊断指引：

| 层级 | 运行命令 | 分诊入口 |
|------|----------|----------|
| 单元测试 | `bats tests/unit/` | 失败测试文件 → 函数名 |
| 集成测试 | `bats tests/integration/` | Setup/Teardown、真实进程 |
| E2E | `<项目 E2E 命令>` | 用户路径、环境 |
| Smoke | `roll doctor` | 工具链健康 |

## 另见

- [loop.md](loop.md) — loop 如何在每个 Story 中强制 TCR 纪律
- [skills.md](skills.md) — `$roll-build`（交付 + Deposit E2E）
