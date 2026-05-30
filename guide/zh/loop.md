# roll loop — 自主 BACKLOG 执行器

`roll loop` 负责调度和管理 BACKLOG 故事的自主执行。
开启后，loop 按可配置的频次（在活跃窗口内）醒来，摘取最高优先级的待办故事，
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

Loop 通过 **launchd**（macOS）调度。默认每小时在一个根据项目路径推导出的分钟触发
（不同项目自动错开，避免碰撞）。

```
活跃窗口：上午 10 点 — 下午 6 点（在 ~/.roll/config.yaml 中配置）
```

活跃窗口之外，loop 静默退出，不执行任何操作。

### 项目级触发频次

在 `.roll/local.yaml` 中配置：

```yaml
loop_schedule:
  period_minutes: 30   # 1-1440（任意分钟间隔）
  offset_minute: 7     # 0–59（已废弃，仅向后兼容）
```

- `period_minutes` — loop 触发间隔。任意值 1–1440。
- `offset_minute` — （US-LOOP-032 起已废弃）不再影响触发时刻。
  保留用于向后兼容；loop 现在使用 `StartInterval = period × 60` 秒。

如果没有 `.roll/local.yaml` 或没有 `loop_schedule` 配置，Roll 回退到
`~/.roll/config.yaml` 中的全局 `loop_minute`，或者根据项目路径哈希推导
默认值。

**示例：**

```yaml
# .roll/local.yaml — 高频项目
loop_schedule:
  period_minutes: 45   # 每 45 分钟触发（不再限制为 60 的约数）
```

`roll loop status` 和 `roll loop on` 直接显示实际频次，一眼可确认生效。
非法值（如 `period_minutes: 0` 或 `1441`）会触发 ALERT 并回退到每小时默认值。

### 全局配置（向后兼容）

若所有项目使用同一个全局偏移，`~/.roll/config.yaml` 仍然有效：

```yaml
loop:
  active_start: 10    # 24 小时制，小时
  active_end: 18
  loop_minute: 5      # 每小时第几分钟触发（被 .roll/local.yaml 覆盖）
```

（agent 选择不再是全局配置项，改为项目本地的复杂度路由 `.roll/agents.yaml`。
见 [复杂度 agent 路由](#复杂度-agent-路由)。）

项目级 `.roll/local.yaml` `loop_schedule` 优先级高于 `loop_minute`。

## 子命令参考

```bash
roll loop on          # 安装 launchd 调度器（loop + dream + brief 三个服务）
roll loop off         # 卸载 launchd 调度器

roll loop now         # 立即执行一次循环（与 launchd 触发的流程完全一致）
roll loop test        # 快速冒烟测试：验证 tmux/弹窗/流式输出链路是否正常

roll loop status      # 显示调度器状态和当前 loop 状态
roll loop monitor     # 实时监控台：launchd 状态、队列、最近执行历史

roll loop runs        # 显示最近 10 次运行摘要（故事 ID、tcr 提交数、耗时、最慢阶段）
roll loop runs 20     # 显示最近 20 次
roll loop runs --all  # 显示本机所有项目的运行历史
roll loop runs --detail <cycle_id>  # 打印单个 cycle 的阶段耗时面板

roll loop story <ID>  # 按故事汇总：所有 cycle 数、耗时、token、费用、PR
roll loop story <ID> --json  # JSON 输出，方便脚本和仪表盘消费

roll loop eval        # 近 14 轮已评分 cycle 的结果评分趋势（客观）
roll loop eval 30     # 窗口放大到近 30 轮已评分 cycle
roll loop signals     # 把反复出现的低分模式暴露成改善信号
roll loop signals --streak 4  # 连续 4 轮低分才触发信号

roll loop attach      # 接入正在运行的 loop tmux session（Ctrl-B D 离开）
roll loop mute        # 关闭自动弹窗（loop 继续在 tmux 里跑）
roll loop unmute      # 重新开启自动弹窗

roll loop pause       # 暂停调度（保留 plist，跳过执行）
roll loop resume      # 暂停后恢复调度

roll loop reset       # 清除 loop 状态（下次触发时重新开始）

roll loop gc                  # 清理孤儿 slug、临时文件、过期备份（默认保留 30 天）
roll loop gc --dry-run        # 预览将被清理的内容，不实际删除
roll loop gc --keep-days 14   # 覆盖保留天数（也可用 .roll/local.yaml 中的 loop_gc.retention_days）
                              # 完整 gc 手册见 guide/zh/loop-data-layout.md

roll loop branches    # 列出 loop 相关分支（已合并临时分支、开放 PR 等）

roll loop events      # 显示最近 20 条 cycle 事件
roll loop events 50   # 显示最近 50 条

roll agent                           # 查看四个复杂度槽 + 在线状态
roll agent list                      # 查看本机已装的 agent
```

## 复杂度 agent 路由

Loop 每轮 cycle 只按一根轴选 agent —— **任务复杂度**。故事的 `est_min` 归到
三档之一，再由项目本地 `.roll/agents.yaml` 的四个槽映射到具体 agent。没有全局
`primary_agent`，不再选 agent×model（每个 agent 用自己的默认模型），也没有软偏好历史。

Loop routes each cycle along a single axis — task complexity. A story's est_min
is classified into one of three tiers, mapped to an agent via four slots in the
per-project .roll/agents.yaml. No global primary_agent, no agent×model
selection, no soft-preference history.

复杂度归档器（阈值固定，单一真源）：

```
est_min <= 8        → easy
8 < est_min <= 20   → default
est_min > 20        → hard
评不出 / 非法        → default
```

`.roll/agents.yaml` 的四个槽（schema v3）：

```yaml
schema: v3
easy:     { agent: kimi }
default:  { agent: kimi }
hard:     { agent: claude }
fallback: { agent: pi }
```

`agents.yaml` 是 per-machine 的 —— 它在 `.roll/.gitignore` 里，绝不进 git，
所以每台机器各管各的槽。某档的槽为空时路由回退到 `default` 槽；`default` 也空
则 WARN 并用首个已装 agent。

每轮 cycle 启动时 cron log 打印一行（`via <tier>` 是复杂度档，不是硬规则命中）：

```
[loop] story US-AGENT-007 routed to claude via hard est_min=24 → tier=hard
[loop] story FIX-127 routed to kimi via easy est_min=6 → tier=easy
```

查看与修改路由：

```
roll agent                           # 四个槽 + 在线状态 + 最近降级痕迹
roll agent set hard claude           # 改某一档
roll agent use kimi                  # 把 easy/default/hard 三档全锁成一个（fallback 不动）
```

### 机械 fallback

主 agent 解析出来后，loop 先探测它当前能不能跑（在 PATH + 一次 auth/网络探测）。
离线（没装 / 断 token / 断网）就切到 `fallback` 槽 agent，并在 `runs.jsonl` 记
`fallback_from: <原 agent>`；挂掉的 agent 写入不可用缓存（约 30 min）后续跳过。
`fallback` 也不可用时不无限顺试，写 ALERT 停下等人介入。

After a tier resolves to an agent, loop probes whether it is usable right now.
If offline, it swaps to the fallback slot agent and records fallback_from; the
downed agent is cached unavailable (~30 min). If the fallback is also down, loop
writes an ALERT and stops instead of looping forever.

### Agent 自降级（too_big 判定）

选定的 agent 在 `roll-build` / `roll-fix` SKILL 的 **Pre-flight self-check**
阶段自评。判定 too_big 时输出：

```yaml
verdict: too_big
reason: est_min=20 > pi.max=8
```

The self-downgrade flow then: invoke `roll-design --from-story <id>` to
re-split with `chain_depth + 1`, flip the parent story to 🚫 Hold, exit the
cycle cleanly. Next cycle picks up the first smaller sub-story.

链路最多自动拆 **2 次**。第三次会被 `StorySplitCapHit` ALERT 拦下，翻 🚫 Hold
等人工介入，避免无限套娃。

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

**按 agent 覆盖情况。** token/cost 抓取取决于按 agent 的 usage 插件。

| Agent | dashboard token/cost |
|-------|----------------------|
| Claude | ✅ 支持 |
| pi（DeepSeek） | ✅ 支持 |
| OpenAI（codex） | ✅ 支持 |
| Gemini | ✅ 支持 |
| Kimi | ✅ 支持 |
| Qwen | ✅ 支持 |
| OpenCode | ❌ 显示 `—/—` |

没有插件的 agent 退回 `—/—` 占位符。新增 agent 是一个小的按 agent 插件
（`lib/agent_usage/<agent>.py`），不会自动出现。五步走 howto 见
`lib/agent_usage/README.md`。

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

## 按故事汇总（Per-Story Rollup）

`roll loop status` 只显示滚动窗口（默认 3 天）。如果你想看**一个故事的全部生命周期**——
它跑过的所有 cycle，包括已经滚出 status 窗口的——用 `roll loop story`。

```bash
roll loop story US-LOOP-004           # 单故事紧凑面板
roll loop story us-loop-004           # 大小写不敏感
roll loop story US-LOOP-004 --days 90 # 扩大事件流回溯窗口
roll loop story US-LOOP-004 --json    # JSON 输出，给脚本/仪表盘消费
```

面板把你本来要跨多次 `status` 手动累加的总数一次给出：

```
── US-LOOP-004 · 把每轮 cycle 成本/token/耗时写进事件流 ──
  cycles    3  (✓ 2  ✗ 1  ⏵ 0)
  span      2026-05-18 14:22  →  2026-05-19 09:11
  duration  1h 47m   tokens  in 412k  out 18.3k  cache w 1.2M  r 7.8M
  cost      $4.92    model  claude-opus-4-7
  PRs       #128 ✓   #131 ✓   #134 ✗
  recent    20260518-142233-91  ✓  $2.10
            20260518-203045-12  ✗  $1.71
            20260519-091112-44  ✓  $1.11
```

**历史是怎么留下来的：** `bin/roll` 在 `events-<slug>.ndjson` 超过 10 MB 时轮转，
保留 `.1` … `.4` 四份归档。`roll loop status` 和 `roll loop story` 都会读 head
加全部轮转文件，cycle 一旦落盘就不会从汇总里消失。

**退出码：** 找到至少一个 cycle 返回 `0`；窗口内没有匹配的故事 ID 返回 `2`。
`--json` 形式遵守同样的退出码契约，脚本可以靠它判断"数据是否缺失"。

## Cycle 结果评分（Result Eval）

每轮 cycle 收尾时都会按一套固定的多维 rubric 给结果**客观打分**，且**不花额外
token**——分数完全从 loop 已有的 facts 算出（是否 merge、CI 结果、TCR 提交数、
耗时、ALERT、孤儿）。结果写进该轮 `runs.jsonl` 记录的 `result_eval` 块：

```json
{ "version": 1, "score": 8, "dims": { "outcome": 1.0, "correctness": 1.0,
  "scope_fidelity": 1.0, "quality": 1.0, "efficiency": 0.6, "cleanliness": 1.0 } }
```

> **结果评分不是 skill 自评。** skill 自评是 agent 对单次 skill 运行的**主观**复盘，
> 写在 `.roll/notes/*.md`；结果评分是这套从 facts 算出的**客观**每轮结果分。两者是
> 不同信号，在 dashboard 上分两行各自显示，绝不混为一谈。

### Rubric（六个维度）

每个维度打 `0.0`–`1.0`，facts 缺失时记 `unknown`。unknown 维度不计入汇总，剩余维度的
权重重新归一——所以缺一个 fact 绝不会被悄悄算成 `0`。

| 维度 | 权重 | 含义 | 何时为 1.0 |
|------|------|------|-----------|
| `outcome` | 3 | 这轮有没有 merge 进 `main`？ | 已 merge · `0.0` 未 merge |
| `correctness` | 2 | 产出 PR 的 CI 是不是绿？ | 绿 · `0.0` 红 |
| `scope_fidelity` | 2 | 有没有完成被路由到的那个故事？ | 完成 · `0.0` idle / 跑偏 |
| `quality` | 1 | 加了测试、没立刻返工？ | TCR ≥ 1 且无返工 FIX · `0.5` 有返工 · `0.0` 没测试 |
| `efficiency` | 1 | 耗时 vs 故事的 `est_min` 预算 | 在预算内 · 超出后逐档降分 |
| `cleanliness` | 1 | 无孤儿 worktree/分支、无 ALERT | 干净 · `0.0` 有孤儿 / 有 ALERT |

各维度汇总成一个 **1–10 的 cycle 分**：

```
weighted    = Σ(score_i × weight_i 取已知维度) / Σ(weight_i 取已知维度)
cycle_score = round(1 + weighted × 9)        # 0.0 → 1, 1.0 → 10
```

权重集中成 `lib/loop_result_eval.py` 里的常量——可调，但刻意不做成用户高频改的旋钮。

### 看趋势——`roll loop eval [N]`

`roll loop eval` 聚合近 `N` 轮已评分 cycle（默认 14）的 `result_eval`，输出均分 /
最低分 / 各维度命中率 / 趋势箭头。无 `result_eval` 的旧记录跳过；样本不足 3 个时提示
`(n/a) need 3`。

```
$ roll loop eval
Loop result-eval — last 14 cycles
循环结果评分 — 最近 14 轮

  mean   6.8 / 10   ↓
  min    4 / 10
  n      4

  dimension hit-rate / 各维度命中率
    outcome          75%
    correctness      67%
    scope_fidelity   75%
    quality          75%
    efficiency       50%
    cleanliness      100%
```

`roll loop status` dashboard 上也有一行结果评分小结，**与 skill 自评那行分开**显示，
两者绝不混淆：

```
result-eval: mean 6.8↓ / min 4 / out 75% ci 67% scope 75% qual 75% eff 50% clean 100% (last 14)
```

### 自进化信号——`roll loop signals`

当某个维度连续 `N` 轮（默认 3，`--streak` 可调）都是低分（`0.0`），loop 把它暴露成
一条**改善信号**：向 `.roll/signals/candidates.md` 追加一条**候选** backlog 草稿
（`IDEA` 或 `FIX`，标 `📋 待人确认`），并由 `roll-brief` 的改善信号段报出来。信号按
模式去重，同一个长期问题只提一次，不每轮重复刷。

信号只是提示。它绝不改真实 backlog、绝不激活故事、绝不改代码——只把"哪里在反复出问题"
推到面前，让人来决定。cycle 收尾钩子每轮跑一次检测，`roll loop signals` 则按需手动跑。

| 维度持续低分 | 暴露为 | 读法 |
|-------------|--------|------|
| `outcome` | FIX | cycle 反复 merge 不进 main |
| `correctness` | FIX | 产出 PR 反复挂 CI |
| `scope_fidelity` | IDEA | cycle 反复 idle 或跑偏 |
| `quality` | FIX | cycle 反复没有测试活动就落地 |
| `efficiency` | IDEA | cycle 反复超出 `est_min` 预算 |
| `cleanliness` | FIX | cycle 反复留孤儿 / 触发 ALERT |

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

- **LOCK 文件**（`<project>/.roll/loop/.LOCK-<slug>`）：同一个项目同一时间只有一个 loop 实例运行。
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
| HEAD CI 红 | 尝试自动热修（见下），用完次数后才写 ALERT |

ALERT 条目会在下次 `roll loop monitor` 和 `roll-brief` 输出中显示。

## CI 自愈（US-LOOP-046..050）

当 loop 检测到 HEAD CI 红时，不再立即写 ALERT 停工。
它会先尝试自己把 CI 修好再继续推进 backlog。

**工作流程：**

1. 每轮 cycle 扫 backlog 之前先执行 `roll loop precheck-ci`。
2. CI 绿 → 正常推进。
3. CI 红且允许热修：通过 `roll loop hotfix-head-context` 抓 CI 失败日志和最近 commit diff，调 `roll-fix` 修复，等 CI 变绿。超过 `ROLL_LOOP_HEAL_MAX`（默认 2）次还没修好则写 ALERT 停工。
4. CI 红且已用完热修次数或 `ROLL_LOOP_NO_HEAL=1`：写 ALERT（保留原有行为）。

自家 PR（`loop/*` 分支）在 cycle 结束后才转红（US-LOOP-049）也会被识别：分类为 `loop_self_ci_red`，路由到热修路径，不再静默跳过。

**环境变量：**

| 变量 | 默认值 | 作用 |
|------|--------|------|
| `ROLL_LOOP_NO_HEAL=1` | 未设置 | 关闭所有 CI 热修，恢复快速失败 |
| `ROLL_LOOP_HEAL_MAX` | `2` | 连续热修最大尝试次数，超过后写 ALERT |

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

## 阶段计时（Cycle phases）

每轮 cycle 在内部切成七个命名阶段。每个阶段进入时 emit `phase_start`，
退出时 emit `phase_end` 携带耗时和 ok/fail。耗时较长的阶段（claude、
PR 等合并）每 30–60s 还会 emit 一次 `phase_tick` 心跳，tmux 不再像卡死。

| # | 阶段 | 触发时机 | 典型耗时 |
|---|------|---------|---------|
| 1 | `startup` | env / lock / 心跳启动 | < 1 秒 |
| 2 | `preflight` | 同步 `.roll/` 元数据 + 清理已合并的临时分支 + 找回上轮孤儿 worktree | 0 – 30 秒 |
| 3 | `worktree_setup` | fetch origin + 建 worktree + 同步 meta | 2 – 10 秒 |
| 4 | `agent_invoke` | 调起 agent（最多三次重试） | 5 – 45 分钟 |
| 5 | `publish_push` | push 分支 + 建 PR（doc-only 直接合） | 5 – 30 秒 |
| 6 | `publish_wait_merge` | 轮询直到 PR 合并（doc-only 跳过） | 0 – 10 分钟 |
| 7 | `cleanup` | 落 PR 终态 + 拆 worktree | < 1 秒 |

Idle / failed / aborted cycle 只 emit 实际进入过的阶段。
cycle 收尾时 inner runner 在 stdout 打一份按耗时降序的面板：

```
─── Cycle 20260523-114502-12345 Phase Breakdown ───
  agent_invoke           723s  ( 96.2%)  ████████████████████
  publish_wait_merge       19s  (  2.5%)  █
  worktree_setup            4s  (  0.5%)
  publish_push              2s  (  0.3%)
  preflight                 2s  (  0.3%)
  cleanup                   1s  (  0.1%)
  startup                   1s  (  0.1%)
  ──────────────────────────────────────
  Total                   752s
```

各阶段耗时同步固化到 `runs.jsonl` 的顶层 `phases` 字段（详见
[状态文件](#状态文件)）。`roll loop runs` 在每条 built 行尾追加
`slowest=<阶段名> <占比>%`，跨多轮对比哪一步拖后腿一眼可见。
看完整面板：

```bash
roll loop runs --detail 20260523-114502-12345
```

## Cycle 日志存档

每轮 cycle 的完整 agent 输出都会归档到 `.roll/cycle-logs/<cycle-id>.log`，
ANSI 颜色码已剥离，可用 `less`、`cat` 或任何编辑器直接阅读。

- **按 cycle 归档**：每轮一个 `.log` 文件，保存在 `.roll/cycle-logs/`
- **ANSI 已剥离**：颜色码和控制字符已清除，干净纯文本
- **保留策略**：保留最近 50 轮，超出的自动轮转删除
- **静音模式也照存**：即使 `roll loop mute` 开启，日志仍然保存

```bash
roll loop log                # 查看最近一轮 cycle 的完整日志
roll loop log <cycle-id>     # 查看指定 cycle（如 20260525-231803-39799）
roll loop log <前缀>         # 前缀匹配（如 20260525 匹配 5 月 25 日所有 cycle）
```

Cycle 日志存放在 `.roll/`（项目元数据目录）内，且已被 gitignore，
不会污染你的代码仓库。

## 跨机器同步

如果你在多台机器上为同一个项目开启了 loop，Roll 可以把每台机器的 cycle
记录同步到一个共享的 git 仓库。每台机器只写自己的事件文件、互不冲突，dashboard
读取所有机器的记录合并显示——任一台机器都能看到完整的运行历史。

### 配置

在 `~/.roll/config.yaml` 中添加 `roll_records_remote` 字段：

```yaml
roll_records_remote: "git@github.com:you/roll-loop-records.git"
```

**强烈建议使用私有仓库。** Cycle 记录包含 prompt 文本、文件路径等可能敏感的
信息。请将 records 仓库按日志级别对待——私有、访问受控、不公开。

如果未配置 `roll_records_remote`，跨机器同步完全跳过——不会有任何记录离开
你的本机。

### 工作原理

- 每台机器首次运行时生成唯一的 machine-id（UUID v4），缓存在
  `~/.shared/roll/machine-id`。
- 每轮 cycle 完成后，向 records 仓库推送一个只追加的 `.ndjson` 文件：
  `<slug>/events/<machine-id>.ndjson`。每台机器只写自己的文件——不会产生
  merge 冲突。
- Dashboard 渲染前，Roll 在本地 clone（`~/.shared/roll/sync/`）执行
  `git pull --ff-only`，读取所有 `*.ndjson` 文件，按时间戳排序并
  以 `run_id` 去重后合并显示。
- Push 和 pull 都是后台 best-effort 操作——如果远端不可达，cycle 照常执行，
  dashboard 只显示本地数据。

### Dashboard 同步状态指示器

Dashboard 底部显示三种状态之一：

| 指示器 | 含义 |
|--------|------|
| `sync: ok (2m ago)` | 远端可达，记录已成功合并 |
| `sync: offline` | 远端不可达（网络问题、认证过期）——仅显示本地数据 |
| `sync: not configured` | 未设置 `roll_records_remote`——同步已关闭，此状态为预期 |

### Fork 注意事项

Roll 根据 `git remote get-url origin` 推导项目 slug。如果你将 `origin` 改为指向
fork，slug 会随之变化——原仓库和 fork 的记录会落到 records 仓库的不同目录中。
这是有意为之（不同仓库 = 不同身份），但如果你临时从 fork 工作，请注意 dashboard
不会显示上游仓库的 cycle 历史。

## Loop 元数据同步

每轮 cycle 启动时，roll 会自动从 `.roll/` 的 git 远端拉取最新的项目元数据
（backlog、约定、skill），再去扫描待办故事。

**工作机制**

1. 检测 `.roll/` 是否配置了 `origin` 远端。
   没有则静默跳过（对标准 roll 安装没有任何影响）。
2. 执行 `git fetch && git reset --hard origin/main`，超时 15 秒。
3. 成功：emit `meta_sync ok` 事件；cycle 用最新 backlog 继续。
4. 失败：emit `meta_sync stale` 事件；cycle 用本地现有 `.roll/` 兜底继续运行。

**连续 3 次失败**后 loop 会写 ALERT，提示检查 SSH key 或网络。

**手动同步**

```bash
git -C .roll fetch && git -C .roll reset --hard origin/main
```

**FAQ：loop 跑了一轮但 dashboard 显示 backlog 为空**

通常是 `.roll/` 没同步上：
- 换机器或重装系统后：需要手动把 roll-meta 克隆到 `.roll/` 并配置 origin 远端。
- 确认方法：`git -C .roll remote get-url origin` — 如果为空则不会触发同步。
- SSH Key 可能需要重新授权（`ssh -T git@github.com` 测试连通性）。

## 远程监控（Remote Monitoring）

Remote Monitoring — watch the loop from anywhere.

不在本机时，依然可以从手机或任意浏览器查看 loop —— backlog 进度、Dream 健康、CI 状
态 —— 无需本地 `roll` 命令。它分两层：**数据层**（本机把状态快照 push 到 roll-meta 仓
库）和 **prompt 层**（把巡检 prompt 粘贴进 Claude Code，读 roll-meta + GitHub API）。

### 配置 `roll_meta_dir`

在 `~/.roll/config.yaml` 里告诉 roll 你的 roll-meta 检出在哪：

```yaml
# ~/.roll/config.yaml
roll_meta_dir: ~/projects/roll-meta
```

`~` 会被展开。这个键是可选的——不配就什么都不变，也不会推快照。路径不存在时，roll 向
cron 日志打一条 WARNING 并跳过推送（绝不影响 cycle）。

### 自动 push 的工作原理

配好 `roll_meta_dir` 后，loop 在**每一次** cycle 结束后推一份新快照——包括没跑故事的
idle cycle，所以快照同时充当心跳。cycle runner 在 `cycle_end` 事件之后，于后台调用
`${roll_meta_dir}/ops/push-loop-status.sh`。脚本写出 `status/loop.md` 并提交 + push 到
roll-meta。输出写到 `~/.shared/roll/push-status.log`（1MB 轮转，保留 2 份）。

因为 loop 按固定节奏运行，`status/loop.md` 始终保持 **≤35min 新鲜**——巡检 prompt 总能
看到近期数据。推送是 best-effort：网络错误、git 冲突或 >60s 超时都记进
push-status.log，进程卡住会被 kill，cycle 继续。不设 ALERT，不重试。

### 手动 push

随时可以手动推一份快照：

```bash
bash .roll/ops/push-loop-status.sh .roll
```

（`.roll` 是你项目的 roll-meta 检出。）这也是在依赖自动 hook 前确认推送链路是否正常的
方法。

### 在手机或浏览器上巡检

打开 `.roll/prompts/remote-watch.md`，复制全文，粘贴进 Claude Code（网页、手机或远端
IDE）。该 prompt 首次执行做一次全量体检，之后每 15min 轮询一次，遇到「CI 连续两次失
败」或「`status/loop.md` 超过 60min 未更新」等条件立即告警。它只读——绝不修改
`seanyao/roll`。

### 排障：`status/loop.md` 不更新

若快照时间戳远早于 35 分钟：

1. 看 `~/.shared/roll/push-status.log`——它记录每次推送尝试以及任何超时或 git 错误。
2. 确认 `roll_meta_dir` 已配置且路径存在（`roll config get roll_meta_dir`）。
3. 确认 `${roll_meta_dir}/ops/push-loop-status.sh` 存在且可执行。
4. 跑一次上面的手动 push，观察是否报错。

## 状态文件

Since Phase 2.0, loop state lives inside the project at `<project>/.roll/loop/`.

自 Phase 2.0 起，项目的 loop 状态搬进了**项目目录** `<project>/.roll/loop/`。只有机
器级绑定文件（launchd runner、attach 脚本）和全局静音开关留在 `~/.shared/roll/`。完
整布局、迁移与 `roll loop gc` 见 [Loop 数据布局](loop-data-layout.md)。

| 文件 | 内容 |
|------|------|
| `<project>/.roll/loop/state-<slug>.yaml` | 当前/最近一次运行：状态、故事 ID、Agent、run_id |
| `<project>/.roll/loop/runs.jsonl` | 只追加的运行历史（每次循环一行 JSON）；每条记录带 `result_eval` 块（见 [Cycle 结果评分](#cycle-结果评分result-eval)） |
| `<project>/.roll/loop/events.ndjson` | 逐 cycle 事件流（phase_start/phase_end…） |
| `.roll/signals/candidates.md` | 自进化信号产出的候选 backlog 草稿（`📋 待人确认`，绝不自动激活） |
| `<project>/.roll/loop/ALERT-<slug>.md` | 累积的告警（失败、TCR 违规）|
| `<project>/.roll/loop/PAUSE-<slug>` | 暂停标记（由 `roll loop pause` 创建）|
| `~/.shared/roll/mute` | 全局静音标记（跨项目共享）|
