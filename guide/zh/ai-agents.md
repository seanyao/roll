# Roll — AI Agent 支持

Roll 支持多种 AI 编码 Agent。每个 Agent 使用相同的约定和技能——切换 Agent 不需要改变工作流。

## 默认 Agent（`primary_agent`）

`roll setup` 和 `$roll-onboard` 让你从本机已安装的 agent 里选一个默认。选择
结果作为 `primary_agent` 存在 `~/.roll/config.yaml`。

哪些场景用 `primary_agent`：
- **交互入口** —— `roll design`、`roll agent use`、onboard 流程默认用它。若本机
  只装了一个 agent，它会自动设为 primary。
- **`roll doctor`** —— 显示当前 primary。

哪些场景**不**用：
- **自主 loop** —— 复杂度路由独立读取 `.roll/agent-routes.yaml`。你的交互默认和
  loop rig 池有意可分。例如你可以用 `claude` 做交互式设计对话，但 loop 任务路由到
  `kimi`/`pi`/`reasonix`。

`primary_agent` 和你在复杂度槽里配置的 `default` 档 agent 可以不同——这是有意
设计的，不是配置错误。

## 支持的 Agent

| Agent | CLI 命令 | 备注 |
|-------|----------|------|
| Claude Code | `claude` | 默认主 Agent |
| Kimi CLI | `kimi-code`（旧版回退：`kimi-cli` / `kimi`） | 良好备用；支持 peer review。配置目录：`~/.kimi-code/`（旧版 `~/.kimi/` 仍可识别） |
| Codex CLI | `codex` | OpenAI；`openai` 别名仍可解析到 codex。安装：`npm install -g @openai/codex` |
| Antigravity | `agy` | Google Gemini CLI 的继任者，复用 `~/.gemini/` 与 `GEMINI.md`。用 `roll agent use antigravity` 选择（旧别名 `gemini` 仍可识别）。安装：`npm install -g @antigravity/agy` |
| Pi (pi-coding-agent) | `pi` | `deepseek` 别名仍可解析到 pi。 |
| Reasonix | `reasonix` | DeepSeek 原生 coding agent。安装：`npm i -g reasonix@next`；需要 `DEEPSEEK_API_KEY` |

无人值守 loop 会在启动已选中的 agent 之前检查必需凭据。Reasonix 可以从环境变量
`DEEPSEEK_API_KEY` 或 `~/.reasonix/.env` 读取密钥；两边都没有时，Roll 会在真正
spawn 前写出点名 `reasonix` 与 `DEEPSEEK_API_KEY` 的 `agent:blocked` auth 事件和
ALERT，避免烧到 cycle 中途才变成模糊鉴权失败。检查只发生在具体 builder、reviewer、
scorer 或 ac-map 补救 agent 被选中之后，未被选中的 optional agent 缺凭据不会暂停整个 loop。

## 新增 Agent

Agent 的具体差异只放在一份 profile 里，不散落到下游 runner/gate。新增或调整
agent 时：

1. 在 `packages/core/src/agent/specs.ts` 增加公开 registry 项。
2. 在 `packages/cli/src/runner/agent-spawn.ts` 增加或更新 runner profile。
   profile 负责 argv 构造、workspace sandbox 的消费方式、PTY 包装、headless
   review 能力，以及必要的 child env hook。
3. `executor.ts`、attest gate、test 路由保持 agent-agnostic。它们调用
   `agentProfile(name)` 或 `agentSpawnEnvironment(name)`，不判断具体 agent 名。
4. 为 profile 与 registry 项补单测。

## 复杂度路由（四个槽）

Roll 按**任务复杂度**把活儿派给 agent。故事的 `est_min` 归到三档之一，每档由
`.roll/agents.yaml` 的四个槽映射到具体 agent：

```yaml
schema: v3
easy:     { agent: kimi }      # est_min <= 8
default:  { agent: kimi }      # 8 < est_min <= 20（也是兜底默认档）
hard:     { agent: claude }    # est_min > 20
fallback: { agent: pi }        # 选中的 agent 离线时顶上
```

驱动分档的 `est_min` 取自**故事 spec 的 YAML frontmatter**
（`.roll/features/<epic>/<ID>/spec.md`），spec 未声明时回退到 backlog 行的
`est_min:` 标记。spec 是唯一真相来源，因此升档手段是：在 spec frontmatter 里
调高 `est_min`，把卡死的卡送进更硬的档位（例如 `est_min: 24` → `hard`）。

The `est_min` that drives tier selection is read from the **story spec's YAML
frontmatter** (`.roll/features/<epic>/<ID>/spec.md`), falling back to the
`est_min:` tag on the backlog row when the spec declares none. The spec is the
single source of truth, so the escalation lever is: bump `est_min` in the spec
frontmatter to send a stuck card to a harder tier (e.g. `est_min: 24` → `hard`).

每次指派都是一个 rig：`agent × model`。agent 必须是六个支持身份之一；model 是挂在
该 agent 上的字符串。例如 `pi` 可以运行 `deepseek-v4-pro`，但 `deepseek` 不是 agent
槽位值。

```bash
roll agent                # 查看四个槽 + 在线状态 + 最近降级痕迹
roll agent list           # 显示本机已装的所有 agent
roll agent set hard claude   # 改某一档的 agent
roll agent use kimi       # 把 easy/default/hard 三档全锁成一个（fallback 不动）
```

`roll agent use <name>` 保留了老的单 agent 习惯 —— 现在含义升级为「把三个复杂度档
全锁成这个 agent」。每个 roll 技能（`$roll-build`、`$roll-fix` 等）和 loop 都自动
按这些槽路由。

## Per-Machine，不进 git

`.roll/agents.yaml` 是 **per-machine** 的：它列在 `.roll/.gitignore` 里，绝不
commit，所以每台机器各管各的 agent 槽。这样一台机器的 agent 选择不会泄漏到另一台
（或进共享的 meta repo）。

`~/.roll/config.yaml` 里的 `primary_agent`（由 `roll setup` / onboard 设置）也是
per-machine 的，管交互入口默认值。loop 路由独立使用 `.roll/agents.yaml`——二者分离，
详见上方 [默认 Agent](#默认-agentprimary_agent) 一节。

## 评分与结对也受同一套槽约束

`.roll/agents.yaml` 里声明的 agent 同时充当 peer 评分与跨 agent 结对的项目级白名单。
机器上可能还装了其他 agent（例如 `codex` 或 `claude`），但评分和结对只自动启用槽位里
已配置的 agent。这样无人值守的评审与打分池就不会随本机已装软件漂移，而是始终对齐项目
声明的 agent 名册。

## 透明软优先（档内 nudge）

在复杂度档之上 —— 档（`easy` / `default` / `hard`）是**硬约束**，决定查哪个槽 ——
Roll 再叠一层**软优先**：在**同一档内**按各 agent 的历史命中率给候选 agent 重新排序。
这是被弃用的旧历史偏好的透明、可审计的继任者。

软优先怎么算：

- **只在档内重排。** 档（`easy` / `default` / `hard`）绝不改变；任务永远不被挪到别的
  档，只有解析出的这一档内部的 agent 才可能被重排。
- **按 (agent × 故事类型)。** 命中率按 agent 与故事类型（故事 id 前缀，如 `US` /
  `FIX`）查表，数据来自 `runs.jsonl` 的 cycle 历史，经 `result_eval` 聚合。
- **样本下限。** 样本数少于 8 的 (agent × 故事类型) 组合不参与 —— 低于此值统计上没有
  意义，于是保留 est_min 槽位 agent，审计行会写明这一点。
- **确定性。** 同一历史输入 → 同一 agent 输出。无随机数、无时间种子、无衰减时钟。重排
  是其输入的纯函数，可由固定测试输入复现。

nudge 理由在哪看：

- 路由器产出人类可读的理由，例如
  `kimi in-tier hit_rate 0.82 (n=14) > slot claude 0.61 (n=11) for US -> prefer kimi`。
- loop 把它打印在 `[loop] story … routed to …` 行，记进事件日志（`story_routed`），
  路由出的 agent 与复杂度 `tier` 是 `runs.jsonl` 的一等列。

怎么关：

- 设 `ROLL_AGENT_NUDGE=0`（也接受 `off` / `false` / `no`）。关掉后，路由行为**完全
  等同**纯 est_min 槽位路由 —— 直接用解析出的槽位 agent，不做任何重排。

与**被弃用的**旧软偏好的区别：旧的历史偏好是隐式的、不可预测的、不可解释的。这一个是
**确定、可审计、可一键关**的 —— 它只能在档内重排 agent，绝不会悄悄把活儿跨档挪走。

## 约定同步

`roll setup` 将全局约定（`AGENTS.md`、`CLAUDE.md`）复制到每个检测到的 AI 工具的预期目录。新增 Agent 后重新运行：

```bash
roll setup
```

## 多 Agent Peer Review

`$roll-peer` 将设计或代码决策路由到第二个 AI Agent 进行交叉验证。路由按 capability map — 若主 Agent 是 Claude，Peer 默认使用 Kimi 或 Reasonix。

详见 [peer.md](peer.md)。

## 另见

- [configuration.md](configuration.md) — Agent 配置项
- [peer.md](peer.md) — 跨 Agent peer review
- [loop.md](loop.md) — 自主 loop 里的复杂度 agent 路由
