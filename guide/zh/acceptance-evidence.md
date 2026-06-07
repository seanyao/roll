# 验收证据 — `roll attest`

每个交付完成的 story 都可以带一份**单文件验收报告**：逐条 AC 的判定与支撑证据，
离线可开、可打印 PDF、非工程角色也能读。

## 报告位置

每个 story 只有一个家——史诗下的卡片文件夹：

```
.roll/features/<epic>/<id>/<run-id>/<id>-report.html  ← 报告（自包含）
.roll/features/<epic>/<id>/<run-id>/evidence.json     ← 采集的硬事实
.roll/features/<epic>/<id>/latest                     ← 指向最新一次的软链
```

每次运行按时间戳落盘、永不覆盖。backlog 的 `✅ Done` 行链接到
`latest/<id>-report.html`；CHANGELOG 条目旁可带不可见的
`<!-- evidence: ... -->` 注释 marker 供追溯。

## 报告怎么产生

1. build/fix 的**验证门**阶段，agent 把原始输出 dump 到
   `.roll/features/<epic>/<id>/evidence/*.txt`，截屏放
   `…/screenshots/*.png`（web 用 Playwright、iOS 用 simctl、Android 用
   adb——工具缺失时各端干净跳过；CLI 类 story 不截屏，改为捕获 ANSI 文本，
   报告内可搜索）。
2. agent 写 `ac-map.json`——哪条证据支撑哪条 AC，每条 AC 一个状态：
   `pass` · `readonly` · `partial` · `claimed` · `missing`。
3. `roll attest <story-id>` 清扫硬事实（TCR commits、最新 CI、可选部署探针、
   test-pass 凭证）并渲染报告。

`roll attest` 也可独立运行——没有意图映射时，每条 AC 诚实渲染为 🟧 仅声明。

## 红线

**零证据**的 AC 永远不能是 `pass`：渲染层强制降级为 🟧 仅声明，并列入
**Discrepancies（证据缺口）**附录。"我确认它能跑"这类口头完成，正是被这条
红线挡住的东西。

## Self-Score 折叠区

`.roll/notes/` 里存在同 story 自评条目时，报告底部出现折叠的
*Self-Score · 自评* 区；没有自评则整块不出现。

## 交付档案 —— `roll index`

`roll index` 把整个档案重建为可浏览的三层**交付档案**（每页都是自包含
HTML——双语、明暗主题、可打印）：

```
.roll/features/index.html              ← 首页：总账（愿望→事实进度条）、
                                         生命周期脊柱、可搜索的史诗卡片
.roll/features/<epic>/index.html       ← 史诗页：史诗账本 + 故事三分组
                                         （已合主干 / 周期中 / 待办）
.roll/features/<epic>/<id>/index.html  ← 故事档案：五站——立项、设计、执行、
                                         交付（验收横幅 + AC 表）、复盘
```

页面上每个数字都来自真实模型——`spec.md`、`ac-map.json`、`latest/` 指针、
自评 note、`tcr:` 提交——绝不手填。一句话：**待办是愿望，主干是事实，
done ≡ merged。**
