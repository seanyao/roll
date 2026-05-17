# Loop cost telemetry — Plan

> Joint plan for IDEA-025 (list-price cost) and IDEA-027 (cost into events stream).
> Two related Stories: writer side (events emit), reader side (list-price compute).

## 1. Problem

`roll loop` dashboard 上的成本数字现在有两个毛病：

1. **历史丢失**：每轮 cycle 的成本写在一份"最新一轮"临时日志里，被下一轮覆盖。dashboard 看历史时除了最近一轮其他都是 `—`。
2. **不是真实开销**：那个数字是 AI 客户端报上来的折后价，含订阅 / 抵扣等优惠。多个项目想横向对比、加总，必须用同一把"尺"。

## 2. Goal

- 每轮 cycle 把 **token 用量、上报成本、耗时、模型名**写进永久事件流，所有历史可查
- dashboard 用**模型公开单价 × token 量**自己算成本（list price），不用 AI 客户端的折后价
- cron.log 只保留 tmux 实时显示职责，不再当数据源

## 3. Architecture

**Bounded Context**: `Cycle Event Stream`（已有）+ `View Rendering`（已有）。

**事件 schema 增量**：

`cycle_end` 事件的 `detail` 字段从纯文本升级为 JSON：

```jsonc
{
  "ts": "2026-05-17T08:52:59Z",
  "stage": "cycle_end",
  "label": "20260517-084804-59225",
  "outcome": "done",
  "detail": {
    "model": "claude-sonnet-4-6",
    "tokens": {
      "input": 23451,
      "output": 8923,
      "cache_creation": 12030,
      "cache_read": 152134
    },
    "cost_reported_usd": 2.58,
    "duration_ms": 270000
  }
}
```

向后兼容：dashboard 读取时容错处理 detail 是字符串（老数据）或 JSON（新数据）。

**Writer 侧（US-LOOP-004）**：

- claude 的流式输出在结束时有 `result` 事件，含 `total_cost_usd`、`duration_ms`、`usage`（input_tokens / output_tokens / cache_*）
- `lib/loop-fmt.py` 已经在解析这个事件做 tmux 显示，扩展它把同样的字段写一份到 sidecar 文件
- inner runner 在 `cycle_end` 事件发出前读 sidecar，把 JSON 拼进 detail

**Reader 侧（US-VIEW-010）**：

- 新 `lib/model_prices.py` 提供一个模型 → 单价表（per million tokens，input / output / cache_creation / cache_read），单一来源
- `lib/roll-loop-status.py` 解析 cycle_end detail JSON，提取 tokens + model，调 `model_prices.compute_list_cost(model, tokens)` 算 list price
- 这个 cost 替换现有 cron.log 来的折后价；token 列从此有真实数字

## 4. Pricing Table

Claude 公开价格 (per million tokens, USD)：

| Model | Input | Output | Cache Create | Cache Read |
|-------|-------|--------|--------------|------------|
| claude-sonnet-4 | 3 | 15 | 3.75 | 0.30 |
| claude-sonnet-4-6 | 3 | 15 | 3.75 | 0.30 |
| claude-opus-4-7 | 15 | 75 | 18.75 | 1.50 |
| claude-haiku-4-5 | 1 | 5 | 1.25 | 0.10 |

未知模型 fallback 到 sonnet 单价（保守估计），日志一条 warn。模型升级时改这张表即可。

## 5. 关键决策

| ID | 决策 | 取舍 |
|----|------|------|
| D1 | events 用 JSON detail 而不是平铺成顶层字段 | 不破坏 schema 兼容；detail 本来就是 free-form |
| D2 | 单价表硬编码在源码 `lib/model_prices.py` | 简单 / 版本一致；价格变了发版同步即可，不需要远程 fetch |
| D3 | 折后价从 dashboard 完全消失，只显示 list price | 用户明确说"不算优惠" |
| D4 | sidecar 中转而不是 loop-fmt 直接写 events | loop-fmt 不知道当前 slug / project root；保留 shell 侧的事件写入入口 |

## 6. Out of Scope

- 跨模型 / 跨账号成本归属（一个 cycle 切换模型的情况）
- 实时单价（API 拉远端价格表）
- 按 story 汇总成本（先把 raw 落下来，后续 dashboard 加 group-by）
