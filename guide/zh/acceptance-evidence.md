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

## 设计期声明可视证据

`roll story validate` 在设计期就检查一张卡是否**生而诚实**——带可视证据 AC，
且 web 面要声明可截的产品页。校验器靠两条规则识别：

- **`[visual-evidence]` 标记即定论。** 以字面 `[visual-evidence]` 标记开头的 AC
  条目**本身**就是可视证据 AC，无论后面写什么词——不必再额外写"截图 / screenshot"：
  标记就是你的显式声明。（没标记时，校验器仍认 `screenshot` / `截图` / `录屏`
  这类无歧义名词。）

  ```markdown
  - [ ] [visual-evidence] headless 截 Now 落地页及各 tab 真实渲染
  ```

- **声明的交付面优先于 AC 文本。** 一旦卡有了可视证据 AC，其 surface 先看 frontmatter：
  - 声明了 `deliverable_url:`（别名 `screenshot_url:`）⇒ **web**——卡已承诺一个真实
    产品页,就该截 web 图；
  - 声明了 `physical_terminal:` ⇒ **terminal**，但合同更严格——报告必须包含从 macOS
    `Terminal.app` 真实屏幕像素截下来的图。headless stdout、transcript 渲染图、
    HTML replay 图都不能满足这个合同；
  - 否则声明了 `deliverable_cmd:` ⇒ **terminal**——走终端截屏通道的 CLI 交付；
  - 否则由 AC 文本判定（web / terminal / 含糊）。

  所以声明了 `deliverable_url: .roll/features/agents.html` 的卡判为 **web** 面，
  即便其 AC 文案里提到 `roll` 命令。

## 外部工具就绪度

可视证据依赖机器级工具；这些工具会被显式声明，并在启动时探测：

- `macOS screencapture` —— 可选的终端/GUI 截图工具。它是 macOS 内置工具，
  但运行 `roll` 的终端需要 Screen Recording 权限。缺权限时终端/GUI 截图降级；
  web 证据仍可走 headless Chromium。交互式 `Terminal.app` 授权探针一旦成功，会缓存在
  `ROLL_HOME` 下，后续 `roll doctor` / setup 检查不会反复触发 macOS 权限弹窗；
  如果刚刚授权，先重启 Terminal.app 再信任缓存。
- `Playwright Chromium` —— 可选的 headless web 截图工具，用于 `roll attest`
  和 dossier 截图。安装命令是 `npx playwright install chromium`。

`roll doctor` 总是打印这些工具的可用性、权限状态、影响和修复命令。`roll init`
与 `roll loop go` 在启动时跑同一套探测；交互式终端会询问是否安装/打开缺失的
设置步骤，自动化环境默认静默，除非设置 `ROLL_EXTERNAL_TOOLS=yes` 或
`ROLL_EXTERNAL_TOOLS=no`。选择 `no` 时会说明证据影响，然后继续，不改机器状态。

机器级 Agents 页面（`.roll/features/agents.html`）也显示同一块工具状态，方便
dossier 审阅者区分证据采集问题来自机器配置，而不是 story 代码。

## Review Score 折叠区

`.roll/notes/` 里存在该 story 的评审分条目时，报告底部出现折叠的
*Review Score · 评审分* 区；没有则整块不出现。评审分由全新独立会话的
同行 Reviewer 产出，绝不由工作 agent 自评。

## 卡片从哪来 —— `roll idea`

用一句自然语言加卡：

```bash
roll idea "退款流程在部分支付时会崩溃"
```

`roll idea` 自动分类（bug→FIX / 功能→IDEA）、取下一号、lint 校验、推断归属史诗，
并创建完整卡片文件夹（spec.md + 故事页 + 刷新索引）。一个命令全搞定。

如需显式指定 ID 与史诗，内部命令 `roll story new` 仍在：

```bash
roll story new US-PAY-001 --title "退款流程" --epic payments
```

两条通道都写出带 frontmatter 的 `spec.md`、故事页骨架，并刷新 `.roll/index.json`。
已存在的卡拒绝覆盖——卡只出生一次，之后由人补充。技能从不手写卡片文件；
任何没有卡的活卡行会被一致性 `cards` 维度在发版闸拦下。

## 交付档案 —— `roll index`

`roll index` 把整个档案重建为可浏览的三层**交付档案**（每页都是自包含
HTML——双语、明暗主题、可打印）：

```
.roll/features/index.html              ← 首页：真相板（Story / Cycle / Release）、
                                         真相条、可搜索的史诗卡片
.roll/features/<epic>/index.html       ← 史诗页：史诗账本 + 故事三分组
                                         （已合主干 / 周期中 / 待办）
.roll/features/<epic>/<id>/index.html  ← 故事档案：五站——立项、设计、执行、
                                         交付（验收横幅 + 逐 AC 证据块）、复盘
```

页面上每个数字都来自真相模型——anchors -> selectors -> adapter ->
projections——绝不手填。Story 聚合对比 backlog 声明与 merge/证据真相；
Cycle 聚合只读 TerminalOutcome 终态记录；Release 聚合读取最新发版闸 verdict
和有效 waiver。一句话：**待办是愿望，主干是事实，done ≡ merged。**

首页真相板会显式保留未知。`?` 表示事实缺失或不在已知 schema 内；`0` 表示
已知为零。过早写下的 backlog `✅ Done` 只是和真相冲突的声明，会显示为漂移，
不会被当成已交付。

故事档案页里，截图证据仍是缩略图并可点开看大图。Vitest 输出等文本证据会从
引用的 evidence 文件读取，并以内联、折叠、可滚动的正文块显示在 AC 下；
文件缺失或不可读时，页面显示明确的不可用空态。

**新鲜度模型（FIX-231）：** 看板自己保鲜——每个改变交付真相的节点
（`roll story new`、`roll attest`、`roll backlog block/defer/unblock/promote`）
都会顺手刷新聚合页（首页 + 史诗页，best-effort），新卡、新状态立即可见。
故事页仍是*挂载板*：各生命周期节点就地挂载自己的产出，刷新绝不覆盖已挂载内容。
只有对账才需要手跑 `roll index`——`--rebuild` 会把每张故事页从源重渲
（用于手工合并、历史迁移之后）。
