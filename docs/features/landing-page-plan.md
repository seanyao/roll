# Landing Page Hero Animation — PRD

**Created**: 2026-05-17
**Status**: Design
**Trigger**: 用户 review 首屏 hero 右侧动画时发现：(1) 命令叙事错位 —— `roll loop on` 是一次性安装开关，不会产生 cycle 流式输出；(2) 营销文案承载的三层自治价值（loop/dream/brief 调度 + active window）只有 4 秒钟时间窗口讲清楚，不能简单丢弃。

---

## Problem

当前 hero 动画（`docs/site/roll-data.js` 的 `TERMINAL` 数组）把两段不相关的内容串成一个连续 tmux 流：

```
$ roll loop on                                            ← 实为一次性开关
✓ launchd scheduled  loop :05/hr · dream 03:10 · brief 09:00
✓ tmux session       roll-loop-roll · attach with roll loop attach
✓ active window      10:00 – 18:00 · idle outside
[11:05:02] cycle #047 — picking story                     ← 实为 cycle 内部流
→ story  US-128       ...
→ peer   claude → kimi  ...
→ build  13 TCR commits  ...
→ ci     green          ...
→ pr     #312           ...
[11:09:18] cycle #047 — done · idle until 12:05
```

三个失真点：

1. **命令与输出错位** —— `roll loop on` 实际只输出 6 行 setup 回执后退出，不会持续打事件
2. **active window 自相矛盾** —— 与 `roll loop now` 的"立即触发"语义对不上（`bin/roll:2765` 用 `ROLL_LOOP_FORCE=1` 绕过窗口）
3. **cycle 内部事件流是虚的** —— 产品当前不 emit 这种结构化事件（由 US-LOOP-001 解决）

但简单把 `loop on` 换成 `loop now` 会损失更大的营销资产 —— `launchd scheduled · dream 03:10 · brief 09:00 · active window 10:00-18:00` 这一组信息在 4 秒钟内把**整个三层自治架构**讲完了，是页面下方 HOW 段 (Human / Loop / Dream 三层) 的浓缩。直接降级会让首屏失去"装一次就忘了它"的关键 pitch。

## Solution

把单帧 tmux 改为**双帧叙事**，用一个时间快进转场把两件事都讲清楚：

### 第一帧 · 开关装好（hold 800ms）

```
$ roll loop on
✓ launchd scheduled  loop :05/hr · dream 03:10 · brief 09:00
✓ tmux session       roll-loop-roll · attach with `roll loop attach`
✓ active window      10:00 – 18:00 · idle outside
```

这 4 行是 `roll loop on` 实际输出的（小幅美化），讲清三层自治的调度结构。Hold ~800ms 让读者吸收。

### 转场 · 时间快进（1200ms）

视觉：终端 chrome 保持，body 文字变暗到 ~20% opacity，chrome 的 "live" pulse 停跳，右下角浮现一个 monospace 数字时钟 `⏱ 10:23`，时钟以 ~300ms 一跳的速度推进：

```
⏱ 10:23  →  ⏱ 10:47  →  ⏱ 11:00  →  ⏱ 11:05
```

每跳一格，dimmed body 下方飘过一行幽灵 idle 信息（opacity 30%，monospace，灰色）：

```
░ [10:23] idle · BACKLOG empty
░ [10:47] idle · waiting for active window
░ [11:00] idle · checking BACKLOG
```

这三句对应 launchd 真实的三种 idle 原因，让读者感知到"系统一直醒着，只是没事干"，而不是"傻 cron 空跑"。到 `⏱ 11:05` 时钟停住、变红。

### 第二帧 · cycle 自动 fire（~1200ms）

```
[11:05:02] cycle #047 — picking story
→ story  US-128       PR inbox · GHA bot detection · peer required
→ peer   claude → kimi  round 1/3 · AGREE
→ build  13 TCR commits  4m 12s · zero-diff reverts: 0
→ ci     green          Acceptance Check · 12/12 ✓
→ pr     #312           auto-merged · loop/cycle-047

[11:09:18] cycle #047 — done
```

cycle 行按 ~180ms 一条揭示，最后 done 行停留。整段动画结束后 hold 5 秒，整段重复（无限循环）。

### 总时长表

| 阶段 | 时长 | 内容 |
|------|------|------|
| Frame A reveal | 1500ms | 4 行 install 输出逐条 fade-in |
| Frame A hold | 800ms | 读者吸收 |
| Transition | 1200ms | 时钟旋转 + idle 行飘过 |
| Frame B reveal | 1200ms | 7 行 cycle 事件逐条揭示 |
| Frame B hold | 2000ms | 完成态停留 |
| Total | ~6.7s | 单轮播放，循环 |

### Reduced-motion 降级

`@media (prefers-reduced-motion: reduce)`：
- 取消时钟旋转动画 + body dim 过渡 + idle 行飘过
- 直接 Frame A 显示 1.5s → 直接切换到 Frame B 显示 3s → 循环
- 整轮缩短到 ~4.5s

A11y 硬底线，必须实现。

### Fixture 数据源

第二帧的 7 行 cycle 事件，**消费 `docs/site/cycle-sample.ndjson`**（由 US-LOOP-001 提供的样本 NDJSON）。Terminal 组件读 fixture、按 stage 字段渲染颜色和箭头。

这样动画 = 产品输出，将来 cycle 内部行为演进，只需重录 fixture 即可，不必手工改 `roll-data.js` 的 hardcode 字符串。

### Chrome 元素

terminal chrome 维持当前样式（macOS 三色点 + 中央 title）：
- Frame A 期间 title：`roll · install` · live pulse 绿色
- Transition 期间 title：`roll · idle` · pulse 灰色（不跳）
- Frame B 期间 title：`roll-loop-roll · cycle #047` · live pulse 绿色

## Non-Goals

- 不重做 hero 的其他部分（左侧文案 / CTA 按钮 / meta 行）—— 只改右侧 Terminal 组件
- 不引入新的动画库（Framer Motion 等）—— 用现有 `setTimeout` + React state 状态机 + CSS transitions 即可
- 不要求二语版本同步发布 —— EN 先落地，i18n keys 沿用现有结构后续补 ZH

## Open Questions

1. **是否引入 SVG 模拟钟？** —— 当前方案是纯文字数字钟（`⏱ 10:23`），跟 ASCII 终端调性一致。如果设计后续想要更"酷"的视觉，可升级为 SVG 圆盘，但属于增量优化，不阻塞首版。
2. **idle 行的具体文案是否需要 i18n？** —— 倾向不做。idle 行是装饰元素，英文短句即可，ZH 版页面用同样的英文也不违和。
3. **循环间隔多久？** —— 当前方案是 5s hold 后整段重复。也可考虑前几次完整播放后改为只播 Frame B 节省 attention。倾向保持简单：固定间隔无限循环。

---

## Dependencies

- 上游：US-LOOP-001（提供 `cycle-sample.ndjson` fixture，让 Frame B 内容与产品输出物理同源）
- 下游：无
