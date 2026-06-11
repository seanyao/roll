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
活跃窗口：0–24（默认全天开启；用 `roll config loop-window 10-18` 收窄到上午 10 点 — 下午 6 点）
```

活跃窗口之外，loop 静默退出，不执行任何操作。默认 `0-24` 意味着任何时刻触发都会执行；只有显式收窄窗口后，窗口外的触发才会静默退出。

## 配置调度（Configuring the schedule）

不用再手工编辑 `~/.roll/config.yaml` 和 `.roll/local.yaml` 再祈祷 launchd plist 能 reload 上。改用 `roll config` 命令族：每次写入都落到正确的 yaml 文件，**并且**自动重生 runner、重 bootstrap launchd plist、立刻在 `roll loop status` 反映——没有手工 reload 这一步。

| 命令 | 设置的内容 |
|------|-----------|
| `roll config loop-window <start>-<end>` | loop 活跃窗口小时（`loop_active_start` + `loop_active_end`） |
| `roll config loop-schedule <period>[/<offset>]` | 触发间隔（`loop_schedule.period_minutes` + `offset_minute`） |
| `roll config dream-time <HH:MM>` | dream 每日触发时刻（`loop_dream_hour` + `loop_dream_minute`） |
| `roll config brief-time <HH:MM>` | brief 每日触发时刻（`loop_brief_hour` + `loop_brief_minute`） |

```bash
roll config loop-window 9-18        # 活跃 9 点 – 18 点；start < end，均在 [0,24]
roll config loop-schedule 30        # 每 30 分钟触发（period 在 [1,1440]）
roll config loop-schedule 30/7      # 每 30 分钟，偏移 :07（offset 在 [0, period-1]）
roll config dream-time 03:20        # dream 精确 03:20 触发；HH 在 [0,23]，MM 在 [0,59]
roll config brief-time 09:15        # brief 精确 09:15 触发
```

**读当前值（Reading the current value）。** 任何 facade 不带值跑一次，就打印当前生效组合和来源：

```bash
roll config loop-window             # loop-window: 0-24 (from default)
roll config dream-time              # dream-time: 03:20 (from ~/.roll/config.yaml)
```

**范围校验（Range validation）。** 超界或非数字输入会被拒绝，报中英双行错误并以退出码 2 退出——如 `roll config loop-window 9-25` 打印 `loop-window end must be <= 24` / `loop-window 结束时间必须 ≤ 24`。

**`--global` vs `--project`。** 写入默认 `--project`（`.roll/local.yaml`，仅当前项目）。加 `--global` 写 `~/.roll/config.yaml`，作为所有没有项目级覆盖的项目的默认值。

```bash
roll config dream-time 03:20             # 当前项目（.roll/local.yaml）
roll config dream-time 03:20 --global    # 所有项目（~/.roll/config.yaml）
```

**自动 reload（Auto-reload）。** 写完调度 key 后，`roll config` 自动重装 loop / pr / dream 的 launchd plist，下个窗口即生效。reload 失败时（如沙箱里）yaml 仍是真相——跑 `roll loop on` 手工补刀。完整 key 列表与范围见 `roll config --help`。

### 项目级触发频次

一行命令设触发间隔：

```bash
roll config loop-schedule 30        # 每 30 分钟（period 1–1440，任意间隔）
roll config loop-schedule 45        # 每 45 分钟（不再限制为 60 的约数）
```

这会向 `.roll/local.yaml` 写入 `loop_schedule` 块：

```yaml
loop_schedule:
  period_minutes: 30   # 1-1440（任意分钟间隔）
  offset_minute: 7     # 0–(period-1)（已废弃，仅向后兼容）
```

- `period_minutes` — loop 触发间隔。任意值 1–1440。
- `offset_minute` — （US-LOOP-032 起已废弃）不再影响触发时刻，保留用于向后兼容。

如果没有 `.roll/local.yaml` 或没有 `loop_schedule` 配置，Roll 回退到全局值
（用 `roll config loop-schedule … --global` 设置），或者根据项目路径哈希推导默认值。

`roll loop status` 和 `roll loop on` 直接显示实际频次，一眼可确认生效。
非法值（如 `period_minutes: 0` 或 `1441`）在写入时即被拒绝，退出码 2。

### 全局默认（向后兼容）

若所有项目使用同一个全局默认，用 `--global` 写入：

```bash
roll config loop-window 10-18 --global   # 所有项目的活跃窗口
roll config loop-schedule 60 --global    # 所有项目的默认间隔
```

（agent 选择不再是全局配置项，改为项目本地的复杂度路由 `.roll/agents.yaml`。
见 [复杂度 agent 路由](#复杂度-agent-路由)。）

项目级 `.roll/local.yaml` 始终优先于全局默认。

## 子命令参考

```bash
roll loop on          # 安装 launchd 调度器（loop + pr + dream 三个服务）
roll loop off         # 卸载 launchd 调度器

roll loop now         # 立即执行一次循环（与 launchd 触发的流程完全一致）
roll loop test        # 快速冒烟测试：验证 tmux/弹窗/流式输出链路是否正常

roll loop status      # 显示调度器状态和当前 loop 状态
roll loop go          # 手动运行 goal mode，默认覆盖全部 backlog，直到完成/暂停/触发护栏
roll loop go --epic <name>              # 将 goal 限定到一个 epic
roll loop go --cards US-1,FIX-2         # 将 goal 限定到指定卡片
roll loop go --budget 10                # goal 成本达到 $10 后保守停止
roll loop go --usage-threshold 0.85     # 5 小时或 7 天用量达到该比例后暂停
roll loop go --no-wait                  # 触发用量闸后直接暂停返回，不等窗口恢复
roll loop go --for 5h                   # 到时间盒后等当前 cycle 收尾再停
roll loop go --max-cycles 3             # 跑满指定 cycle 数后停止
roll loop go --review <auto|hetero|self|off>  # 设置完成前终审策略
roll loop goal        # 显示持久化 goal 状态、范围、终审模式、用量、限制和安全闸

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

tmux attach -t roll-loop-<project-slug>  # 接入正在运行的 loop tmux session
roll loop mute        # 关闭自动弹窗（loop 继续在 tmux 里跑）
roll loop unmute      # 重新开启自动弹窗

roll loop pause       # 暂停调度（保留 plist，跳过执行）
roll loop resume      # 暂停后恢复调度

roll loop reset       # 清除 loop 状态（下次触发时重新开始）

roll loop gc                  # 清理孤儿 slug、临时文件、过期备份（默认保留 30 天）
roll loop gc --dry-run        # 预览将被清理的内容，不实际删除
roll loop gc --keep-days 14   # 覆盖保留天数（也可用 .roll/local.yaml 中的 loop_gc.retention_days）
                              # 完整 gc 手册见 guide/zh/loop-data-layout.md

# loop 相关分支:`git ls-remote --heads origin 'loop/*'`(branches 子命令已退役)

roll loop events      # 显示最近 20 条 cycle 事件
roll loop events 50   # 显示最近 50 条

roll agent                           # 查看四个复杂度槽 + 在线状态
roll agent list                      # 查看本机已装的 agent
```

### Goal Mode 与定时模式

`roll loop go` 是手动 goal session，不是 launchd 定时 tick。运行期间 Roll 会持有
`.roll/loop/go.lock`；定时 tick 看到该锁就让路，记录 `goal:tick_skipped`，不会再启动
另一个 `roll loop run-once`。

goal mode 在 scheduler off 时也能运行，因为它自己启动会话，不依赖 launchd。loop 处于
paused 状态时不建议直接启动：`PAUSE-<slug>` 标记仍会在 cycle 边界生效，所以应先执行
`roll loop resume`，再启动 `roll loop go`。

### Goal Mode 安全闸

`roll loop go` 的安全闸只在 cycle 边界生效。`--budget <usd>` 使用有效成本账本；
达到预算时 goal 进入 `budget_limited`。缺失成本字段的 runs 行记为 unknown，不当作 0，
并按保守侧停止。用量闸检查 5 小时与 7 天窗口；默认 85% 暂停并等待窗口恢复，
`--no-wait` 则停下等 owner。`--for <duration>` 是墙钟时间盒：当前 cycle 收尾后，
goal 以 `timebox` 原因暂停。

每次安全闸触发都会记录 `goal:gate_tripped`，`roll loop goal` 会显示最近一次安全闸读数。

### `roll loop goal` 字段含义

`roll loop goal` 是 `.roll/loop/goal.yaml` 与最新 goal 事件的读取面。关键字段：

| 字段 | 含义 |
|------|------|
| `Status` | `active`、`paused`、`budget_limited` 或 `complete`。 |
| `Scope` | 全 backlog、单个 epic 或显式卡片列表。 |
| `Review` | 完成前终审策略：`auto`、`hetero`、`self` 或 `off`。 |
| `Usage` | goal 已跑 cycle 数、有效成本、unknown cost 行数。 |
| `Limits` | 显式传入的 `--budget`、`--max-cycles`、`--for` 限制。 |
| `Safety gate` | 最近一次预算、用量或时间盒闸及其读数。 |
| `Last decision` | goal 继续、暂停、预算限停或完成的原因。 |

`auto` 终审降级为同 provider review 时，状态视图会显示 `goal:review_degraded`
记录的降级原因。goal 暂不能完成时，`Last decision` 会带上未达成的真相裁定原因
或终审拒绝原因。

### Goal Mode 终审

`roll loop go` 将 goal 状态持久化在 `.roll/loop/goal.yaml`，并在 goal 进入
`complete` 前执行终审 gate。默认策略是 `--review auto`：Roll 优先选择与工作
agent 不同 provider 家族的 reviewer；如果本机只有同 provider 可用，会降级为 self
review，并记录 `goal:review_degraded` 事件。

终审使用与 `roll peer` 相同的结构化 adapter。`goal:final_review` 事件会记录
reviewer agent、provider、command family、verdict、findings、timeout/error 状态、
耗时，以及可用时的 transcript/evidence 路径。

当 completion 必须在缺少异构 reviewer 时 fail-closed，用 `--review hetero`。
允许同 provider 终审时，用 `--review self`。`--review off` 只应作为显式人工豁免：
Roll 会跳过终审 gate，但仍记录 `verdict: SKIPPED` 的 `goal:final_review` 事件。

## 复杂度 agent 路由

Loop 每轮 cycle 只按一根轴选 agent —— **任务复杂度**。故事的 `est_min` 归到
三档之一，再由项目本地 `.roll/agents.yaml` 的四个槽映射到具体 agent。没有全局
`primary_agent`，不再选 agent×model（每个 agent 用自己的默认模型）。复杂度档是
**硬约束**；在档内可有一个可选的软微调（按历史命中率重排同档候选，`ROLL_AGENT_NUDGE=0`
关闭），但它绝不把 agent 移出所属复杂度档。

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
所以每台机器各管各的槽。某档的槽为空时依次回落：`default` 槽 → `local.yaml`
的单 agent 默认（存在时）→ WARN 并用首个已装 agent。逐档选择只读
`agents.yaml`；`ROLL_LOOP_AGENT` 是路由的输出（供展示/dream 消费），不是选择输入。

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

**历史是怎么留下来的：** loop runner 在 `events-<slug>.ndjson` 超过 10 MB 时轮转，
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

## TerminalOutcome 词汇表

面向用户的 cycle 投影使用 TerminalOutcome，不再使用旧摘要文本。稳定词汇为：

`delivered`, `published_pending_merge`, `failed`, `blocked`,
`aborted_no_delivery`, `aborted_with_delivery`, `orphan_timeout`,
`idle_no_work`, `unknown`。

早期 `runs.jsonl` 可能含自由文本结果。dashboard、dossier、summary 渲染前
都先经 truth adapter 转换。

## 可见性（tmux + 弹窗）

每次 loop 运行都在一个独立的 tmux session 里。
未静音时，终端窗口自动弹出，你可以全程旁观。

```bash
tmux attach -t roll-loop-<project-slug>  # 随时接入运行中的 session
# Ctrl-B D            # 离开（loop 继续运行，不受影响）

roll loop mute        # 🔇 关闭弹窗（静音文件：~/.shared/roll/mute）
roll loop unmute      # 🔔 重新开启弹窗
```

`mute` 文件对所有项目、所有自主活动（loop + peer review）共享生效。
一个开关控制全部。

### 环境漂移与 session 生命周期

tmux session 是长寿命的，但 cycle 的**网络环境永远跟随调用方**，不吃 session 的
记忆：每次开 cycle 窗口时，代理族变量（`HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/
`NO_PROXY` 及小写）都从调用方重新注入。所以两次 cycle 之间本机代理开了又关，照常
工作——不会再出现"session 在代理时代创建、代理关了之后每个 agent 都 ~45 秒超时
`Connection error`"（FIX-230）。每个 cycle 还会把生效的代理变量记成一行 `env:`
进 `.roll/loop/cron.log`，环境型故障从日志直读。其它变量仍来自 `roll loop on`
时创建的 session；若你轮换了别的关键变量，`roll loop off && roll loop on`
可重建一个干净 session。

### Edit 折叠

当实时 tmux 流里出现 agent 连续 Edit 同一个文件时，Roll 不再把那条一模一样的
长路径在 N 行里复读（以前看起来像卡死）。现在它把相邻的同文件改动折叠成一行，
并原地刷新：

```text
✏ <basename> | <hint> ×N
```

- **触发条件** —— 相邻 ≥2 次针对同一 `file_path` 的 `Edit` / `Write`。路径只显示
  `os.path.basename(file_path)`，绝不显示全路径；单次 Edit 不带 `×N` 计数。
- **`<hint>`** —— 从改动输入里抽出的 ≤20 字特征，让你看到“在改什么”而不只是计数：
  - `replace_all=true` → 字面输出 `replace-all`。
  - 否则取 `new_string` 首行的首个非空 token，去掉前导空白与注释符
    （`#`、`//`、`/*`、`*`、`--`、`;`）。
  - 超过 20 字符的 token 截断为 `token[:20] + "…"`（按 unicode 字符计，中文 /
    emoji 不会被按字节截断）。
  - `new_string` 为空 / 全空白时不产生 hint，整段 ` | <hint>` 一并省略。
- **跨文件 flush** —— 切到另一个文件（或任意其它事件：`Bash`、`Skill`、错误、cycle
  结束）会先 flush 前一个文件的最终 streak 行（保留在 scrollback 里），再为新文件
  起一行。折叠绝不会跨越非 Edit 行。

三个示例（已去除 ANSI 转义）：

```text
# 单次 Edit
✏ auth.ts | export

# 折叠 ×N（同文件改了 7 次）
✏ auth.ts | export ×7

# 跨文件切换 —— 两行，第一行在第二行开始前被 flush
✏ auth.ts | export ×3
✏ router.ts | replace-all
```

## Cycle 退出摘要（Cycle exit summary）

When a cycle ends and the tmux session detaches, the macOS `.command` window no longer leaves you on a bare `press enter to close` line.

cycle 结束、tmux 会话退出后，macOS `.command` 窗口不再只剩一行 `press enter to close`。

Just before that prompt, the window renders a compact recap so you can review the cycle without scrolling back or opening the cron log:

就在那行提示之前，窗口会渲染一段紧凑的复盘块，让你不必回滚 tmux scrollback 或翻 cron 日志就能复盘本轮：

```text
─── Cycle 20260530-2301-94839 Summary ───
  outcome: delivered · story: US-LOOP-040 · tcr commits: 4
  ci: green
  todo remaining: 7
  phases (top 5 by time):
    build                   612s
    ci                       94s
    pr                       31s
  press enter to close.
```

The summary covers five signals:

摘要覆盖五类信号：

1. Result — the cycle outcome from `runs.jsonl`, rendered as TerminalOutcome.

   本轮处理结果——来自 `runs.jsonl`，经 truth adapter 渲染为 `delivered`、
   `published_pending_merge`、`failed`、`blocked`、`aborted_no_delivery`、
   `aborted_with_delivery`、`orphan_timeout`、`idle_no_work` 或 `unknown`。
2. CI / build status — the latest `ci` event outcome: `green` / `red` / `heal-attempting` / `ci: n/a`.

   测试 / 构建状态——最新 `ci` 事件结果：`green` / `red` / `heal-attempting`，无 ci 事件时 `ci: n/a`。
3. Todo remaining — count of `📋 Todo` lines in `.roll/backlog.md`.

   Todo 剩余——扫 `.roll/backlog.md` 里 `📋 Todo` 行的总数。
4. Phase breakdown — the top 5 cycle phases by elapsed time.

   阶段耗时——按耗时降序的前 5 个阶段。
5. Failure / alert highlights — failed/aborted runs, red CI, active alerts and suspected zero-diff cycles get a `✗` / `⚠` prefix and (on a colour terminal) red / yellow highlighting; a fully green cycle prints in the default colour with no prefix.

   失败 / 告警高亮——failed/aborted、CI red、有 alert、疑似 zero-diff 会带 `✗`（失败）/ `⚠`（告警）前缀，并在彩色终端里红 / 黄高亮；全绿状态以默认色输出、不加前缀。

The `press enter to close` prompt is preserved — the summary prints above it, the close interaction is unchanged.

`press enter to close` 提示保留——摘要打印在它上方，关闭交互完全不变。

### 关闭颜色（Turning off colour）

ANSI colour is only emitted on a real terminal; pipes, redirects and captured output stay plain text. Force colour off with `NO_COLOR=1` (per [no-color.org](https://no-color.org)):

ANSI 颜色仅在真实终端启用；管道 / 重定向 / capture 时输出纯文本。在 TTY 上强制关闭颜色用 `NO_COLOR=1`（遵循 [no-color.org](https://no-color.org)）：

```bash
NO_COLOR=1 roll loop now
```

### 排障：没有摘要出现（no summary appears）

If the cycle exited early (aborted/idle) or `runs.jsonl` had not yet flushed, the window prints a single placeholder line instead, and `press enter` still works:

如果 cycle 早退（aborted/idle）或 `runs.jsonl` 还没写盘，窗口改为打印一行占位文案，`press enter` 仍可用：

```text
(summary unavailable — see log: ~/.shared/roll/loop/cron-<slug>.log)
```

Summary rendering is always silent best-effort: if `python3` is missing or the data is corrupt, the cycle skips the recap and falls through to `press enter to close` — it never changes the `.command` exit code or blocks the window.

摘要渲染始终是 silent best-effort：python3 缺失或数据损坏时，跳过摘要直接走 `press enter to close`——绝不改变 `.command` 退出码，也不阻塞窗口关闭。

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

ALERT 条目会在 `roll loop status`、`roll loop alert` 和 `roll-brief` 输出中显示。

## CI 自愈（US-LOOP-046..050）

当 loop 检测到 HEAD CI 红时，不再立即写 ALERT 停工。
它会先尝试自己把 CI 修好再继续推进 backlog。

**工作流程：**

1. 每轮 cycle 扫 backlog 之前先执行 `roll loop precheck-ci`。
2. CI 绿 → 正常推进。
3. CI 红且允许热修：通过 `roll loop hotfix-head-context` 抓 CI 失败日志和最近 commit diff，调 `roll-fix` 修复，等 CI 变绿。超过 `ROLL_LOOP_HEAL_MAX`（默认 2）次还没修好则写 ALERT 停工。
4. CI 红且已用完热修次数或 `ROLL_LOOP_NO_HEAL=1`：写 ALERT（保留原有行为）。

自家 PR（`loop/*` 分支）在 cycle 结束后才转红（US-LOOP-049）会被**后台自愈**（US-LOOP-062a）：分类为 `loop_self_ci_red`，PR Loop 路由到 `_loop_pr_heal_self`——checkout 该 PR 分支、把失败 CI 上下文交给项目 agent（`_project_agent`）修，受每 PR 自愈预算（`ROLL_LOOP_HEAL_MAX`，默认 2）和每 PR 锁（防重复并发）约束,自愈在后台跑、PR tick 不阻塞。自愈关闭（`ROLL_LOOP_NO_HEAL=1`）或预算用尽时，写去重 `[TYPE:loop-pr-ci-red]` ALERT，绝不静默跳过。

human 已批准、CI 绿、可合并的 PR 会被**主动合并**（US-LOOP-062b）：`_loop_pr_merge_approved` 直接 `gh pr merge --squash`,不再依赖仓库级 auto-merge（可能关着）；合并失败非致命,PR 留开,下一轮重试。

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
| 6 | `cleanup` | 落 PR 终态 + 拆 worktree | < 1 秒 |

> **US-AUTO-044**:主 loop 开完 PR 即退,**不再等合并**。合并 / rebase / 关 PR 交给专职 PR Loop（`com.roll.pr.<slug>`,每 5 分钟）异步处理;有 open PR 的 story 由资格闸跳过,不会重复开,也不会假 Done。

Idle / failed / aborted cycle 只 emit 实际进入过的阶段。
cycle 收尾时 inner runner 在 stdout 打一份按耗时降序的面板：

```
─── Cycle 20260523-114502-12345 Phase Breakdown ───
  agent_invoke           723s  ( 96.2%)  ████████████████████
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

## 降级与观察

- **断网**：周期在网络不可达时失败，loop 降级为**本地交付**——TCR 提交与
  绿测试留在分支上，打印双语提示，连败计数**不**累加（断网永远不该累计触发
  自动暂停），调度照常呼吸。下次联网的周期 push/PR 自然补上。
- **每个 agent 都有实时观察窗**：非 claude agent（pi、kimi、codex 等）在
  macOS 上套伪终端运行，输出逐行流入观察窗，不再憋到进程退出；claude 走
  自己的流式协议，行为不变。

## Launchd lanes(任务清单)

每个项目 slug 下 Roll 只拥有三个 launchd 任务:`com.roll.loop.<slug>`(周期调度)、
`com.roll.dream.<slug>`(夜间扫描)、`com.roll.pr.<slug>`(PR 收件)。`roll loop on`
安装它们;`roll loop off` 卸载它们**并清扫**发现的任何其它 `com.roll.*.<slug>`
plist——旧版本退役的形态(ci/alert/brief)曾以僵尸身份指着已删除的引擎存活数周。
`roll doctor` 列出本机全部 `com.roll.*` 任务及其目标目录与加载状态;目标目录
已不存在的 lane 标红 STALE。
