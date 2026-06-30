# CLI 实时观察指南 / CLI Live Observation Guide

> roll 的 CLI-first 实时可观测：跟着一个正在跑的 cycle，看它的标准 activity 流，不依赖 web/daemon。

## 这是什么

`roll cycle watch` 是 roll 的**一线实时窗口**。它给出一个进行中 cycle 的**归一化 activity 流**——跨 agent（pi/kimi/codex/cursor/claude）一致、同一个词表、同一个渲染。不需要 daemon 或浏览器；终端里直接看。

这是 roll "抹平 agent 差异"灵魂在实时流维度的落地：每种 agent 的 raw stdout 都经 `normalizerFor(agent)` 映射到标准 `ActivitySignal`，下游渲染统一消费。

## 怎么用

### 看当前 running cycle

```bash
roll cycle watch
```

自动找到当前正在跑的 cycle（最近一条 `cycle:start` 且还没收到 `cycle:end`/`cycle:terminal` 的），用 `tail -F` 跟随 `events.ndjson` 或 `cycle-<id>.signals.jsonl`，实时逐行输出归一化信号。cycle 结束自动退出。

### 看指定 cycle

```bash
roll cycle watch <id>
```

`<id>` 可以是完整 cycle id（如 `c-abc123`），也可以是截短形式（如 `abc123`），或是 ledger 行号（如 `#123`）。

### 只看一帧

```bash
roll cycle watch --once
```

回放当前 cycle 的全部已记录信号一帧后退出，不跟随。适合快速扫一眼状态。

```bash
roll cycle watch <id> --once
```

回放一个已完成（或进行中）cycle 的信号。

### 回放最近 N 行

```bash
roll cycle watch --since 0       # 从头回放 + 跟随（"--since 0" = "all"）
roll cycle watch --since 500     # 回放最近 500 行 + 跟随
roll cycle watch --since 50 --once  # 只回放最近 50 行，退出
```

### 机器可读输出

```bash
roll cycle watch --json          # JSON 输出：cycleId + storyId + agent + outcome + signals[]
roll cycle watch <id> --once --json  # 单帧 JSON
```

## 看到什么

### 顶部概要

```
cycle c-abc12345
story US-OBS-025
agent codex
outcome running
```

每条信号行格式：`●` 彩色圆点 + tier（层级）+ seg（阶段）+ summary（摘要）。

### 信号类别

| 信号 | tier | 含义 |
|------|------|------|
| `lifecycle` | `info` | cycle 生命周期：start / phase change / timeout-reclaim / end / terminal |
| `tcr` | `info` / `warn` / `error` | TCR 微步：test pass / test fail / commit / revert |
| `gate` | `info` / `error` | 闸状态：peer gate / attest gate 通过或失败 |
| `stdout` | `trace` | agent 输出摘要（行数、大小） |
| `tool_use` | `info` | 工具调用开始（tool id + input 摘要） |
| `tool_result` | `info` / `error` | 工具调用结果（ok / error + duration） |

### 信号示例

```
● info     lifecycle  cycle started (pick US-OBS-025)
  │
● info     lifecycle  build phase
● trace    stdout     agent output 42 lines (+2.1KiB)
● info     tcr        test passed (vitest --changed, 7 suites, 142ms)
● info     tcr        commit e3a7f2b (tcr: update architecture.md BC7)
  │
● info     gate       peer gate passed
● info     lifecycle  attest phase
● info     gate       attest gate passed
  │
● info     lifecycle  cycle ended (delivered)
```

### 结局

cycle 结束（或 `--once` 回放完）时输出证据指针：

```
evidence  PR https://github.com/seanyao/roll/pull/999 · diff https://github.com/seanyao/roll/pull/999/files · story .roll/features/*/US-OBS-025/index.html
```

## 三流权威边界

`roll cycle watch` 的每一条信号来自以下三条流中的**投影流（ActivitySignal）**——这是 keystone 契约：

| 流 | 角色 | watch 怎么看 |
|---|------|------------|
| `events.ndjson` | **唯一持久真相** | `cycleActivitySignalsFromEvents()` 将 `RollEvent` 折成 `ActivitySignal`；`tail -F` 跟随新行 |
| `cycle-<id>.signals.jsonl` | **持久化投影** | 如果文件存在且非空，直接读它（runner 侧 `executor.ts` 已把全量信号写进这个文件） |
| `live.log` | **debug 附件** | **不显示**——从不参与 watch 窗口渲染 |

**外挂不变量**：watch 窗口只消费 `ActivitySignal`；永不做 per-agent raw stream 解析。添加新 agent = 加一个 `normalizerFor(agent).normalize()`，watch 窗口零改动。

## 静态导出 vs CLI watch

当前产品面是 CLI-first：共享 `collectDossierState` / `cycleActivitySignalsFromEvents` 选择器，不同 CLI 入口读取同一批事实：

| 入口 | 触发 | 更新 | 依赖 |
|--------|------|------|------|
| `roll index`（静态） | 手动 | 不更新 | 无 |
| `roll cycle watch`（CLI） | 手动 | `tail -F` 实时跟随 | 无（纯文件跟随） |
| `roll status` / `roll pulse` / `roll loop runs` | 手动 | 命令时刻快照 | 无 |

CLI watch 是最低层实时路径——终端开着就能看。`roll supervisor live` 在它之上提供只读多角色 board；浏览器/TUI 版 Supervisor Live Console 是后续工作，必须复用同一 view model。

## 证据按构造（方向）

证据的素材源——activity stream + diff——已经在 BC7 的标准流中。US-OBS-031 的方向是：ac-map / report / 截图引用从 activity 流 + git diff **自动起草**（不再是 builder 手动步骤 `Phase 10.6`）。实际落地范围以 US-OBS-031 的 spec 为准。

## 故障排查

**"no running cycle"**：当前没有 `cycle:start` 未结束的 cycle。传一个 cycle id 看特定的：`roll cycles --since all` 列出所有 cycle，挑一个。

**"no activity signals recorded"**：这个 cycle 的 events.ndjson 里没有归一化信号。可能发生在 US-OBS-026 落地之前的老 cycle——用 `--since all` 重试看原始事件。

**"no event stream"**：项目还没初始化 loop runtime dir（`.roll/loop/`）。跑一次 `roll setup`。

**unparseable score/review（无法解析的评分/评审）**：当某个 evaluator/scorer 或
peer reviewer 的输出无法解析（如 `SCORE` 行前有控制字符、缺 `VERDICT` 行）时，
它不会让整个 cycle 静默假绿。在 `roll cycle <id> --roles` 的执行阵容里，该 agent
那一行显示 `failed`，带 `cause`（如 `unparseable`）和一个 `raw artifact:` 指针。
原始尝试被捕获在 `.roll/loop/peer/` 下——直接打开那个文件看 agent 到底吐了什么。
关键：**即便有 agent 解析失败，也只有一个被采纳（`accepted`）的 score 决定 gate**；
读 `accepted` 那一行（及 `accepted evaluator` 产物链接）拿真正算数的判定。完整读法见
[Cycle Role Visibility](../guide/en/loop.md#cycle-role-visibility) /
[Cycle 角色可观测](../guide/zh/loop.md#cycle-角色可观测)。

**unparseable score/review (English)**: when an evaluator/scorer or peer
reviewer emits output that cannot be parsed, the cycle does not silently turn
green. The agent's row in `roll cycle <id> --roles` shows `failed` with a
`cause` and a `raw artifact:` pointer under `.roll/loop/peer/`. Only the one
`accepted` score gates the delivery — read that row, not the failed attempts.

## 相关

- `docs/architecture.md` §BC7 — 三流契约与 CLI-first 架构
- `packages/cli/src/commands/cycle.ts` — 实现
- `packages/core/src/loop/activity-signal.ts` — ActivitySignal 模型 + normalizer
- `packages/spec/src/types/cycle-activity.ts` — CycleActivityEvent 类型
- `.roll/features/loop-observability/live-console-design.md` — 历史完整设计（旧 web/daemon 第二发射器已退役，远程就绪缝仍是未来设计约束）
- `.roll/features/loop-observability/observability-retro.md` — 为什么是 CLI-first（复盘 + 三 agent 收敛）
