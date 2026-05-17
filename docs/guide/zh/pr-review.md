# Roll — PR 评审

Roll 处理完整的 PR 生命周期——从开 PR 到合入——大多数情况无需人工干预。

## 手动评审

```bash
roll review-pr <number>   # AI 评审指定 PR
```

通过 `gh cli` 获取 PR 标题、描述和 diff，路由到项目配置的 AI Agent，输出结构化决议：

| 决议 | 操作 |
|------|------|
| `APPROVE` | `gh pr review --approve` |
| `REQUEST_CHANGES` | `gh pr review --request-changes` 并附理由 |
| `UNCERTAIN` | 写入 ALERT——由人决定 |

## Loop PR Inbox

每轮 loop cycle 在认领新故事前先处理开放 PR：

| PR 分类 | Loop 操作 |
|---|---|
| Loop 自己开的（`loop/*` 分支） | 跳过——不自我评审 |
| Bot 已 Approve | 跳过——等 auto-merge |
| Bot 要求修改 | 写 ALERT——等作者推修复 |
| Stale（CI 红 / 落后 main） | 自动 rebase 到 `main` |
| 外部 PR / 干净状态 | 调用 `roll review-pr` |

**Stale PR 熔断器**：若 rebase 在 24 小时内失败 3 次，loop 停止重试并写 ALERT，由人接手。

## Auto-merge

Loop 自己开的 PR（`loop/*`）以 `--auto --squash --delete-branch` 创建。GitHub 在所有必需检查通过后自动合入，无需手动 `git merge`。

## 可选：事件驱动评审（GitHub Actions）

如需秒级反馈（而非等待 loop 下一轮调度，最多约 1 小时）：

```bash
cp templates/workflows/pr-review-event.yml .github/workflows/
```

此工作流在每次 PR 打开或更新时触发 `roll review-pr`。Fork PR 和正文含 `[skip-ai-review]` 的 PR 自动跳过。两种模式共存——GHA 提供即时反馈，loop 作为兜底。

## 跳过 AI 评审

在 PR 正文任意位置加 `[skip-ai-review]` 即可不调用 Agent，直接 Auto-approve。适用于机械性 PR（依赖升级、生成内容）。

## 另见

- [loop.md](loop.md) — loop PR inbox 详情和 stale rebase 处理
- [ai-agents.md](ai-agents.md) — 哪个 Agent 负责评审
