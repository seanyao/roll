# roll loop — 自主 BACKLOG 执行器

`roll loop` 负责调度和管理 BACKLOG 故事的自主执行。
开启后，loop 每小时（在活跃窗口内）醒来，摘取最高优先级的待办故事，
通过 TCR 微提交完成代码交付。

## 工作原理

1. 读取 `BACKLOG.md`，摘取优先级最高的 `📋 Todo` 条目。
2. 将其标记为 `🔨 In Progress` 并提交。
3. 调用 `$roll-build <story-id>` 或 `$roll-fix <bug-id>`。
4. 成功后：标记为 `✅ Done`，提交，追加一条记录到 `runs.jsonl`。
5. 失败后：回退为 `📋 Todo`，写入 `ALERT.md` 告警。

Loop 在名为 **`roll-loop-<project-slug>`** 的 **tmux session** 里运行。
未静音时，终端窗口会自动弹出，你可以实时旁观 AI 干活。

## 调度配置

Loop 通过 **launchd**（macOS）调度，默认每小时 `:05` 触发。

```
活跃窗口：上午 10 点 — 下午 6 点（可配置）
```

活跃窗口之外，loop 静默退出，不执行任何操作。
在 `~/.roll/config.yaml` 中配置：

```yaml
loop:
  active_start: 10    # 24 小时制，小时
  active_end: 18
  loop_minute: 5      # 每小时第几分钟触发
  primary_agent: claude
  fallback_agent: deepseek
```

## 子命令参考

```bash
roll loop on          # 安装 launchd 调度器（loop + dream + brief 三个服务）
roll loop off         # 卸载 launchd 调度器

roll loop now         # 立即执行一次循环（与 launchd 触发的流程完全一致）
roll loop test        # 快速冒烟测试：验证 tmux/弹窗/流式输出链路是否正常

roll loop status      # 显示调度器状态和当前 loop 状态
roll loop monitor     # 实时监控台：launchd 状态、队列、最近执行历史

roll loop runs        # 显示最近 10 次运行摘要（故事 ID、tcr 提交数、耗时）
roll loop runs 20     # 显示最近 20 次
roll loop runs --all  # 显示本机所有项目的运行历史

roll loop attach      # 接入正在运行的 loop tmux session（Ctrl-B D 离开）
roll loop mute        # 关闭自动弹窗（loop 继续在 tmux 里跑）
roll loop unmute      # 重新开启自动弹窗

roll loop pause       # 暂停调度（保留 plist，跳过执行）
roll loop resume      # 暂停后恢复调度

roll loop reset       # 清除 loop 状态（下次触发时重新开始）
```

## Status Dashboard（状态仪表盘）

`roll loop status` 输出一个紧凑的仪表盘，包含每个 cycle 的行记录和每日汇总。

### Token 列

每条 cycle 行的 token 用量以 4 分量格式显示：

```
·  19:18    13m    164/498.2K↑ 12.7M↓/63.3K   opus-4-7   $11.07   US-VIEW-012
             ↑      in   cw↑     cr↓    out
```

| 分量 | 含义 |
|------|------|
| `164`（第一个 `/` 之前） | Base input tokens（基础输入） |
| `498.2K↑` | Cache write tokens（缓存写入，按写入费率计费） |
| `12.7M↓` | Cache read tokens（缓存读取，费率远低于写入） |
| `63.3K`（最后一个 `/` 之后） | Output tokens（输出） |

没有 cache 数据的旧 cycle 或非 Opus 模型，列退化为两段式 `in/out` 格式。

### 汇总行

cycle 列表下方是每日四分量总计：

```
input tokens       164
cache writes    498.2K
cache reads      12.7M
output tokens    63.3K
```

通过这四行，你可以验证 cycle 行显示的费用（如 `$11.07`）与 Anthropic 账单是否吻合——
上面这个例子里，86% 的费用来自 cache。

## 可见性（tmux + 弹窗）

每次 loop 运行都在一个独立的 tmux session 里。
未静音时，终端窗口自动弹出，你可以全程旁观。

```bash
roll loop attach      # 随时接入运行中的 session
# Ctrl-B D            # 离开（loop 继续运行，不受影响）

roll loop mute        # 🔇 关闭弹窗（静音文件：~/.shared/roll/mute）
roll loop unmute      # 🔔 重新开启弹窗
```

`mute` 文件对所有项目、所有自主活动（loop + peer review）共享生效。
一个开关控制全部。

## 并发安全

Loop 有两层保护：

- **LOCK 文件**（`~/.shared/roll/loop/.LOCK-<slug>`）：同一个项目同一时间只有一个 loop 实例运行。
  如果 loop 已在运行，新的触发直接退出，不重复执行。
- **🔨 In Progress 状态**：正在被人工或其他 Agent 执行的故事，loop 会跳过，不抢占。

你随时可以运行 `$roll-build US-XXX` 手动接管某个故事；
loop 看到 `🔨 In Progress` 标记就会自动跳过。

## 失败处理

| 场景 | 处理方式 |
|------|---------|
| API 错误 | 最多重试 3 次，每次等待 30 秒 |
| 主 Agent 失败 | 切换到备用 Agent |
| 两个 Agent 都失败 | 暂停 loop，写 ALERT.md |
| TCR 提交数为 0 | 故事回退为 📋 Todo，写 ALERT.md |

ALERT 条目会在下次 `roll loop monitor` 和 `roll-brief` 输出中显示。

## PR 收件箱与评审

每轮 loop 会在领取新故事前先处理未合入的 PR。

**评审命令：**

```bash
roll review-pr <number>   # 使用项目配置的 agent 对 PR 进行 AI 评审
```

命令通过 `gh` 获取 PR 标题、正文和 diff，渲染评审 prompt，路由到
`_project_agent()` 返回的 agent（Claude、Kimi、DeepSeek 等）。
agent 输出结构化结论：

| 结论 | 动作 |
|------|------|
| `APPROVE` | `gh pr review --approve` |
| `REQUEST_CHANGES` | `gh pr review --request-changes` 附带原因 |
| `UNCERTAIN` | 写 ALERT — 人工决定 |

**跳过评审：** 在 PR body 中任意位置加入 `[skip-ai-review]` 即可自动批准，
不调用 agent。

**loop 如何使用：** `_loop_pr_inbox` 对每个 open PR 分类，将 `eligible`
PR 路由到 `_loop_pr_review_external`，后者调用 `roll review-pr`。
loop 自身的 PR（`loop/*` 分支）被跳过，避免 same-source bias。

**Stale PR 自动 rebase：** 被分类为 `stale`（CI 失败或分支落后/冲突）的 PR
会通过 `_loop_pr_rebase_stale` 自动 rebase 到 `origin/main`。断路器限制
24 小时内最多 rebase 3 次，超过后写 ALERT。Fork PR 因无写权限直接跳过并写 ALERT。

**Bot 评审检测：** 如果 GitHub Actions bot 已经评审过 PR
（例如通过可选的 GHA 工作流），`_loop_pr_inbox` 会让步：
- Bot `APPROVED` → 跳过，让 auto-merge 自行推进
- Bot `CHANGES_REQUESTED` → 写 ALERT（loop PR 被 GHA reviewer 打回）

### 可选：事件驱动 PR 评审（GHA）

默认情况下，`_loop_pr_inbox` 在每轮 loop 中评审 eligible PR（最多延迟约 1 小时）。
如果希望 GitHub 仓库的 PR 秒级得到反馈，安装事件驱动工作流：

```bash
cp templates/workflows/pr-review-event.yml .github/workflows/
```

此工作流在 PR 打开/更新时自动触发 `roll review-pr`。Fork PR 和
body 中包含 `[skip-ai-review]` 的 PR 会被自动跳过。模板只需要一个
API key secret — 你配置的 agent 对应的那个。

两种模式共存：GHA 工作流提供即时反馈，`_loop_pr_inbox` 作为安全网兜底。

## Session 清理

每轮 loop 结束时，会自动清理本地残留的 worktree：

- `.claude/worktrees/` 下，分支已完全合入 `main` 的目录会被删除
  （`git worktree remove --force` + `git branch -D`）。
- 随后执行 `git worktree prune` 清理元数据。

这样可以保持 `git worktree list` 干净，防止 `.claude/worktrees/` 随时间积累。
分支仍领先于 `main` 的活跃 worktree 不受影响。

## 状态文件

| 文件 | 内容 |
|------|------|
| `~/.shared/roll/loop/state.yaml` | 当前/最近一次运行：状态、故事 ID、Agent、run_id |
| `~/.shared/roll/loop/runs.jsonl` | 只追加的运行历史（每次循环一行 JSON） |
| `~/.shared/roll/loop/ALERT.md` | 累积的告警（失败、TCR 违规）|
| `~/.shared/roll/loop/PAUSE-<slug>` | 暂停标记（由 `roll loop pause` 创建）|
| `~/.shared/roll/mute` | 静音标记（跨项目共享）|
