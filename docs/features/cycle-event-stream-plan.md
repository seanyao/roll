# Cycle Event Stream — PRD

**Created**: 2026-05-17
**Status**: Design
**Trigger**: 用户 review 首屏 landing page 动画时发现"动画里展示的事件流"与"产品实际输出"之间存在巨大差距 —— 决定让产品追上动画，而不是把动画降级。

---

## Problem

`roll loop` 每轮 cycle 实际产出的是大段 agent 自言自语的原始流：

```
[loop] cycle 047: worktree /Users/.../roll-cycle-047 on loop/cycle-047
<几百行 agent 思考、tool call、文件 diff、test 输出 ...>
[loop] cycle 047: published; worktree cleaned
```

只有 worktree 创建 / 发布 / 清理 三个时间点上有 `[loop]` 前缀的状态行。中间发生的关键阶段（picking story / peer review / TCR build / CI gate / PR merge）**没有任何结构化标记**。

这造成三个问题：

1. **`roll loop attach` 体验差** —— 用户接进 tmux 看到的是 agent 输出流，要从噪音里自己 parse 当前在哪一阶段
2. **`roll loop monitor` 信息不完整** —— 看板只能展示状态文件里的粗粒度状态（running / idle / paused），无法呈现"当前正在 peer round 2/3"这种细节
3. **landing page 首屏动画无法对应到真实产物** —— 营销图描绘的 5 阶段事件流（story → peer → build → ci → pr）在产品里不存在，存在预期落差

## Solution

**在 cycle runner 内部 emit 一条结构化事件流**，每个关键阶段输出一行带前缀的事件，并行写入两个目的地：

- 标准输出（保持 tmux 实时观看体验）
- 持久化文件（供 `loop monitor` / 历史回放使用）

### 事件格式

每行一个事件，tab 分隔，便于 grep / awk / `loop monitor` 解析：

```
[event]\t<timestamp>\t<stage>\t<label>\t<detail>\t<outcome>
```

字段含义：
- `timestamp` — ISO 8601 本地时间（精确到秒）
- `stage` — 受限集合：`cycle_start` / `story` / `peer` / `build` / `ci` / `pr` / `cycle_end` / `idle`
- `label` — 阶段标识（如 `US-128` / `claude → kimi` / `13 TCR commits` / `green` / `#312`）
- `detail` — 一行人类可读说明（如 `4m 12s · zero-diff reverts: 0`）
- `outcome` — `ok` / `fail` / `warn` / `idle`（空字符串表示进行中）

### 事件目录

每个阶段在以下时机 emit 一行：

| Stage | 触发时机 | 现有 echo 位置（bin/roll） |
|-------|---------|---------------------------|
| `cycle_start` | runner 进入主体，worktree 创建后 | `:2266` |
| `idle` | launchd fire 但 BACKLOG 无 todo / 不在 active window | 新增 |
| `story` | runner SKILL 选定一个 US/FIX 开始执行 | 新增（在 roll-loop SKILL 内 emit） |
| `peer` | roll-peer 发起跨 agent 评审，每轮 emit 一次 | 新增（在 roll-peer SKILL 内 emit） |
| `build` | TCR 实施完成，统计提交数 / 耗时 / zero-diff revert 次数 | 新增（在 roll-build SKILL 内 emit） |
| `ci` | CI gate 通过 / 失败 | 现有 `_loop_enforce_ci` 旁补 |
| `pr` | PR auto-merged / failed | 现有 `_loop_publish_pr` 旁补 |
| `cycle_end` | runner 退出前，统计本轮结果 | `:2309`, `:2319` 等已有 echo 旁补 |

### 持久化

事件文件路径：`~/.shared/roll/loop/events-<slug>.ndjson`

格式选择 NDJSON（不是 tab-sep）—— 因为持久化文件需要支持后续工具（`loop runs`, `loop monitor`, landing page demo replay）以结构化方式读取。每行一个 JSON 对象：

```json
{"ts":"2026-05-17T11:05:02","cycle":47,"stage":"story","label":"US-128","detail":"PR inbox · GHA bot detection · peer required","outcome":""}
{"ts":"2026-05-17T11:05:48","cycle":47,"stage":"peer","label":"claude → kimi","detail":"round 1/3 · AGREE","outcome":"ok"}
```

`stdout` 写人类可读的 tab-sep 行（同一信息的不同 representation），`events-<slug>.ndjson` 写 JSON。两者由统一的 helper 函数 emit，不允许调用方各写各的。

### 渲染层

- **`roll loop attach`** —— tmux session 里直接看 tab-sep 行（终端原生体验，零成本）
- **`roll loop monitor`** —— TUI 看板读 `events-<slug>.ndjson`，按 stage 着色 + 当前 cycle 进度条
- **landing page 动画** —— 读一份固化的样本 NDJSON 文件（可以是真实 cycle 的录制），用与 monitor 相同的渲染逻辑播放。从此营销图 = 产品输出，物理同源。

### 文件保留策略

`events-<slug>.ndjson` 滚动保留：单文件超过 10MB 时改名为 `events-<slug>.NNN.ndjson`（NNN 递增），保留最近 5 个文件。避免无界增长。

## Non-Goals

- 不替换现有 `[loop]` 前缀的状态行 —— 它们继续保留，事件流是叠加层
- 不引入第三方依赖（不用 logging framework）—— 用 shell helper + 标准 JSON 工具（jq 或 python3 -c）即可
- 不改 agent 的原始输出 —— agent 流照旧打到 tmux，事件流是元信息层

## Open Questions

1. **事件 emit 由谁调用？** —— 候选：(a) cycle runner 脚本统一调用，(b) 各 SKILL 内部自己 emit。倾向 (b)，因为 stage 信息（如 peer round 数）只有 SKILL 内部知道；runner 只管 cycle_start / cycle_end / idle 这种边界事件。
2. **事件文件如何并发安全？** —— launchd 同一项目只有一个 cycle 跑，但 manual `loop now` 可能与 launchd 并行触发（虽然有 LOCK 保护）。倾向：emit helper 使用 `flock` 串行化追加。
3. **是否需要 schema 版本字段？** —— 倾向加 `"v":1`，便于将来字段演进。

---

## Dependencies

- 上游：无
- 下游：US-WEB-001（landing page hero 动画依赖此流的 NDJSON 样本作为播放源）
