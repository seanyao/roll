# IDEA-023 设计 prompt — loop 健康度面板

> Loop Health Dashboard — Design Prompt
>
> Source: BACKLOG IDEA-023
> Status: 待 claude design 出稿
> Drafted: 2026-05-17

把下面这段 prompt 拷给 claude design（或任一独立设计会话）。Prompt 自包含，无需额外上下文。

---

## Prompt

# 任务

设计一个 CLI / TUI 工具的运行健康面板，要产品级的设计稿，不要 ASCII 草图。

# 背景

Roll 是一个命令行工具，里面有个叫 roll-loop 的自治模块：launchd 每小时触发一轮 cycle，
AI 自动拣 BACKLOG 待办、写代码、跑测试、开 PR、合入主干。
我每天要瞄几眼它的健康度，但现在没有合适的视图 —— 现成的 `roll loop runs` 是一条按
时间倒序的扁平日志，没分组、没成本、没耗时统计、测试副产物的 tmp 项目还把真项目淹了。

# 用户与场景

主要用户：Roll 项目开发者（也就是我）
核心场景：每天 1-3 次，每次 5-10 秒看一眼，判断 loop 跑得是否符合预期
次要场景：出问题时打开做诊断 —— 看哪一轮失败、什么时候、什么原因

# 要回答的核心问题

5 秒内能扫到：
1. 当前是 idle 还是 running？下一轮 cron 还有多久？
2. 最近几天每天跑了几轮、产出了几个 PR、解决了哪些待办（FIX/US/REFACTOR ID + 描述）
3. 累计耗时、token、美元成本
4. 有没有失败的 cycle？失败原因是什么？
5. trend：今天比昨天健康度变好还是变差？

# 数据源（落盘文件，无需新采集）

events ndjson（每轮 cycle 的结构化事件）：
```json
{"ts":"2026-05-17T03:48:37Z","stage":"cycle_start","label":"20260517-034805-30585"}
{"ts":"2026-05-17T03:57:47Z","stage":"pr","label":"loop/cycle-...","detail":"https://github.com/.../pull/53","outcome":"ok"}
{"ts":"2026-05-17T03:57:47Z","stage":"cycle_end","label":"20260517-034805-30585","outcome":"done"}
```

cron.log（按 cycle 输出的耗时与成本）：
```
03:49:25  cycle done — done · 981s · $4.53
03:57:35  cycle done — done · 1 tcr · 538s · $3.20
```

state.yaml（当前状态）：
```yaml
status: idle
last_run: 2026-05-17T11:49:00+08:00
last_run_items: [FIX-048]
last_run_outcome: success
```

BACKLOG.md（markdown 表格，story 描述）：
```
| FIX-048 | 多 cycle 双取同一 Todo... | ✅ Done |
```

# 约束

- 终端，monospace，假设 100 列宽（也要考虑 80 列窄屏 graceful degrade）
- 双语：EN 和 ZH 分行，不混排
- 默认显示最近 3 天，能 `--days N` 扩展
- 过滤 `tmp-*` 项目
- 静态 CLI 输出（一次性打印）或交互 TUI（全屏 + 键盘导航）都可以，由你判断哪种更合适

# 期望的设计深度

**不要**：
- ASCII 草图风
- 一次抛 3 个雷同的方案
- 把所有信息平铺，缺乏层级

**要**：
- **1 个完整、产品级的主推设计**（其它备选可以一句话提一下）
- 选型立场：你为什么推荐 CLI 还是 TUI，为什么这套信息架构而不是别的
- 视觉系统：颜色语义（绿/黄/红/灰各承担什么职责）、字重（bold / dim / underline 怎么用）、留白与对齐规则
- 信息层级：什么放最顶（glanceable），什么折叠（drill-down），什么默认隐藏
- 状态覆盖：empty state、单日 0 cycle、全部失败、当前 running 中、跨天断电
- 边界情况：单 story ID 很长、窄屏（80 列）、color-blind 用户
- 参照锚点：`lazygit`、`gh dash`、`btop`、`k9s`、`glow` 等成熟 TUI/CLI 的取舍可以参考引用

# 交付物

最终给一份设计文档，包含：
1. 设计立场（CLI vs TUI，为什么）
2. 主推方案的视觉稿（用你能用的最高保真表达 —— 终端真彩配色截图也好，带颜色注释的 markdown 也好）
3. 信息架构图（哪些信息分在哪几个区域，跨区域的关系）
4. 交互流程（如果是 TUI：按键、刷新、drill-down；如果是 CLI：flags / 子命令分发）
5. 状态与边界情况的处理
6. 简短的设计决策日志（3-5 条关键取舍）

---

## 设计产出位置

design agent 出稿后，建议存到同目录下：

- `idea-023-loop-health-dashboard-design.md` — 主设计文档
- `idea-023-loop-health-dashboard-assets/` — 附属资源（截图、调色板等）
