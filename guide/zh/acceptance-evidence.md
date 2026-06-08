# 验收证据 — `roll attest`

每个交付完成的 story 都可以带一份**单文件验收报告**：逐条 AC 的判定与支撑证据，
离线可开、可打印 PDF、非工程角色也能读。

## 报告位置

每个 story 只有一个家——史诗下的卡片文件夹：

```
.roll/features/<epic>/<id>/<run-id>/<id>-report.html  ← 报告（自包含）
.roll/features/<epic>/<id>/<run-id>/evidence.json     ← 采集的硬事实
.roll/features/<epic>/<id>/<run-id>/evidence/         ← 原始命令/测试产物
.roll/features/<epic>/<id>/<run-id>/screenshots/      ← 需要视觉验收时的截图
.roll/features/<epic>/<id>/ac-map.json                ← AC → 证据的意图映射
.roll/features/<epic>/<id>/latest                     ← 指向最新一次的软链
```

每次运行按时间戳落盘、永不覆盖。backlog 的 `✅ Done` 行链接到
`latest/<id>-report.html`；CHANGELOG 条目旁可带不可见的
`<!-- evidence: ... -->` 注释 marker 供追溯。

## 三段式生命周期

1. 立框。loop 周期一开始，runner 先创建带时间戳的 run 目录，并把它通过
   `ROLL_RUN_DIR` 交给内层 agent。派生目录 `ROLL_EVIDENCE_DIR` 与
   `ROLL_SCREENSHOTS_DIR` 分别指向 `<run-id>/evidence/` 和
   `<run-id>/screenshots/`。
2. 过程采集。`roll test` 把命令输出和摘要写入 `ROLL_EVIDENCE_DIR`；需要视觉
   验收的端面把截图写入 `ROLL_SCREENSHOTS_DIR`。agent 在故事卡根目录维护
   `ac-map.json`，把每条 AC 映射到支撑证据，并标注状态：`pass` ·
   `readonly` · `partial` · `claimed` · `missing`。
3. 收尾硬闸。交付结束时 runner 调用
   `roll attest <story-id> --run-dir "$ROLL_RUN_DIR"`。`roll attest` 清扫硬事实
   （TCR commits、最新 CI、可选部署探针、test-pass 凭证），渲染报告，把
   `latest` 指向本次 run；若故事档案页存在，则刷新交付段，并刷新
   `.roll/index.json`。

`roll attest` 也可独立运行——没有意图映射时，每条 AC 诚实渲染为 🟧 仅声明。

## 闸口策略

验收闸**默认是 hard**。带 AC 的 story 若交付完成却没有新鲜且内容充足的报告，
不会被标成 `✅ Done`，而是直接拦住。显式迁移窗口可在 `.roll/policy.yaml`
里改成 soft：

```yaml
loop_safety:
  attest_gate: soft
```

soft 模式会记录缺口并发出同一类审计信号，但不阻塞本轮交付。它是临时兼容口，
不是默认行为。

## 红线

**零证据**的 AC 永远不能是 `pass`：渲染层强制降级为 🟧 仅声明，并列入
**Discrepancies（证据缺口）**附录。"我确认它能跑"这类口头完成，正是被这条
红线挡住的东西。

## Self-Score 折叠区

`.roll/notes/` 里存在同 story 自评条目时，报告底部出现折叠的
*Self-Score · 自评* 区；没有自评则整块不出现。

## 卡片从哪来 —— `roll story new`

卡片文件夹只有一个铸造通道：

```bash
roll story new US-PAY-001 --title "退款流程" --epic payments
```

它写出带 frontmatter 的 `spec.md`、故事页骨架，并刷新 `.roll/index.json`。
已存在的卡拒绝覆盖——卡只出生一次，之后由人补充 AC、设计与证据。
技能从不手写卡片文件；任何没有卡的活卡行会被一致性 `cards` 维度在发版闸拦下。

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
