# Pricing — 成本可见性与价格快照

Roll 按**模型公开单价**（而非你的订阅价格）计算每轮 cycle 的成本 — 它是一个可跨项目、跨 agent 对比的基准数字。本文档介绍价格快照机制，以及历史成本如何不受调价影响。

## 成本显示在哪里

dashboard（`roll loop status`）在每轮 cycle 显示两列成本相关数据：

| 列 | 含义 |
|----|------|
| **model** | 使用的 agent + 版本（如 `deepseek-v4-pro`、`claude-sonnet-4-6`），决定了哪套价格生效 |
| **cost** | 按公开单价 × 该轮实际 token 用量计算。币种跟随厂商：Anthropic 显示 `$`（USD），DeepSeek / Kimi 显示 `¥`（CNY） |

Roll 通过**价格快照文件**（而非硬编码常量）查询单价。快照存放在 Roll 安装目录下的 `lib/prices/` 中。

## 支持的厂商

| 厂商 | 币种 | 数据来源 |
|------|------|----------|
| Anthropic (Claude) | USD | `platform.claude.com/docs/en/about-claude/pricing` |
| DeepSeek | CNY | `api-docs.deepseek.com/zh-cn/quick_start/pricing/` |
| Kimi (Moonshot) | CNY | `platform.kimi.com/docs/pricing/chat` |

## 读取当前快照

运行时成本核算直接读取 `lib/prices/` 下的有效快照。单价字段为：

```
in       基础输入 token
out      输出 token
cw       缓存写入 token（单价比输入略高）
cr       缓存读取 token（单价极低）
```

费率单位：**每百万 token，厂商本地币种**。

## 价格快照维护

刷新快照现在是内部维护动作，不再占用公开顶层 CLI 命令。维护者对照各厂商官方定价页；
价格变化时在 `lib/prices/` 下新增 `snapshot-YYYY-MM-DD.json`，再通过正常 review
和发版流程交付。失败抓取或半成品更新永远不覆盖已有快照。

## 价格快照

每个快照是一个 JSON 文件，按日期命名，存放在 `lib/prices/` 下：

```
lib/prices/
  snapshot-2026-05-22.json
  snapshot-2026-06-01.json   ← refresh 检测到价格变化后写入
```

快照内容：

| 字段 | 说明 |
|------|------|
| `version` | 快照创建时的 ISO 8601 时间戳 |
| `effective_at` | 厂商开始执行此价格的日期 |
| `source_url` | 使用的官方定价页面 URL |
| `prices` | 字典：`模型名 → {in, out, cache_create, cache_read}` 每百万 token 单价 |

快照**永不删除** — 每个版本都保留，方便回溯任意时间点生效的费率表。

## 历史成本固化

loop cycle 结束时，Roll 会在 usage 事件中额外写入两个字段：

| 字段 | 用途 |
|------|------|
| `cost_list_usd` | 按当时快照计算出的成本 — 永久固定 |
| `prices_version` | 计算时使用的快照版本号 |

dashboard 渲染历史 cycle 时优先读取 `cost_list_usd`。如果该字段缺失（此功能上线之前的旧 cycle），则回退到用*当前*快照现算，并在行末追加浅灰色 `[legacy]` 标记。

**核心效果：** 厂商调价、新快照、Roll 版本升级都不会回头改写历史 cycle 的成本数字。"当时实际花了多少"是事实，不动。

## 常见问题

**Q: cost 列反映的是我的实际账单吗？**
不是。它使用的是公开单价。如果你是订阅用户（Claude Pro、Team 等），实际成本会更低。把它当成一个可横向对比的基准数字。

**Q: 价格变动后怎么办？**
维护者新增快照并发版。后续 cycle 使用新价格，旧 cycle 的历史成本保持不变。

**Q: 能加其他厂商的价格吗？**
可以，在代码中新增厂商条目，并把 review 过的快照放进 `lib/prices/`。
