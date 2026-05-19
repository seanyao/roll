# CLI Visual Redesign

> Plan: [cli-redesign-plan.md](cli-redesign-plan.md)
> Design bundle: Claude Design export `roll-dashboard/` (2026-05-17). Reference frames named below in italics.

整个 roll CLI 在设计稿里被重新做了一遍，用同一套终端配色 / 字形 / 双语 / 三段式 IA。这份 feature 把它落地成 9 个 Story（Wave 1 修数据 + 抽渲染器，Wave 2-4 一条命令一个 Story）。所有 Story 共用以下基线 AC（在每个 US 里只写差异）：

- 终端 truecolor；NO_COLOR=1 退到字形 + 字重 + 留白仍可解析
- 100-col 栅格；`COLUMNS<100` 时按 80-col 模板退化
- `--en` / `--zh` / `--no-color` flag 一致；`--demo` 输出内嵌 fixture
- 用 `lib/roll_render.strw()` 算 EAW 宽度；CJK 占 2 列
- 命令行为不变只换渲染；`ROLL_UI=v1 roll <cmd>` 走旧实现，原 bats 全过

---

<a id="us-view-001"></a>
## US-VIEW-001 修 `roll loop` 数据 bug + 抽出 `lib/roll_render.py` ✅

**Created**: 2026-05-18
**Completed**: 2026-05-18
**Plan**: [cli-redesign-plan.md](cli-redesign-plan.md)
**Wave**: 1

- As a Roll maintainer
- I want `roll loop` 上跑出来的数据真实可信，并把渲染原语抽到独立模块
- So that 后续 8 条命令重设计能复用同一套渲染器

**Domain Model:**
- Context: View Rendering（新增）
- Aggregate: Renderer (Root) owns [Palette, GlyphSet, Layout, Bilingual]
- Cross-context: 只读 events / cron / state / BACKLOG，不写

**AC:**
- [x] Bug A 修：`pr` 事件的 label `loop/cycle-XXX` 通过 `normalize_cycle_label()` 规范化到 `XXX`，与 `cycle_start` 配对
- [x] Bug B 修：`stage: "idle"` 识别为 cycle 终结，outcome=`idle`，在 RECENT 列表显示 `·` 灰点；不计入 failed
- [x] Bug C 修：`today_key` 改为 `now.strftime("%Y-%m-%d")`（真实今日），yesterday/-2d 用 `timedelta` 推算
- [x] Bug D 修：`load_cron_log()` 用 `roll_render.strip_ansi()` 去 ANSI 转义再 regex 匹配
- [x] 渲染原语全部迁到 `lib/roll_render.py`（PAL · c · strw · strip_ansi · pad · row · fmt_dur · fmt_delta · trunc · empty_rollup · section_head · metric · metric_dur · metric_dollar · day_band · cycle_row），`roll-loop-status.py` 改 import 使用
- [x] `bin/roll loop status` 走 `ROLL_UI=v2`（默认）调 Python，`ROLL_UI=v1` fallback 到 `_legacy_loop_status`
- [x] `python3 lib/roll-loop-status.py --demo` 输出与重构前 byte-identical（仅时间戳跳动）
- [x] 真实数据跑通：merged PRs=11、16:48 cycle 显示 `4m / $2.58`、idle cycle 显示 `·`、Today/Yesterday 分列正确
- [x] 衍生发现：cycle_end 比 cron.log 晚 10+ 分钟，改用 `pr_ts` 锚定匹配；display TZ 固定 UTC+8

**Files:**
- `lib/roll_render.py`（新建，~180 行）
- `lib/roll-loop-status.py`（4 bug 修复 + import 迁移 + pr_ts/TZ 修复）
- `bin/roll`（`_loop_status` 加 ROLL_UI dispatch，旧实现重命名 `_legacy_loop_status`）
- `tests/unit/roll_render.bats`（13 个测试：renderer 原语 + 4 bug 回归）

**Dependencies:**
- Depended on by: US-VIEW-002 through US-VIEW-009 都依赖 `lib/roll_render.py`

**Realizes IDEA**: IDEA-023

**Follow-up IDEAs raised**: IDEA-025（list-price cost from tokens × model rate）· IDEA-026（多机 loop 记录合并）

---

<a id="us-view-002"></a>
## US-VIEW-002 `roll` home dashboard 重设计 ✅

**Created**: 2026-05-18
**Completed**: 2026-05-18
**Plan**: [cli-redesign-plan.md](cli-redesign-plan.md)
**Wave**: 2 · Reference frame: `HomeFrame` in `frames-roll-home.jsx`

- As a Roll user
- I want `roll` 裸命令打出一屏可一眼看到「现在系统在干什么 / 三层状态 / 四道防线 / Pipeline 计数 / Current Focus / Need You」
- So that 每天进项目目录就敲一下 `roll` 能知道全貌

**AC:**
- [x] 顶部 identity 行：`roll · Roll vYYYY.M.D` 左对齐 / `agent X · git ✓ branch · timestamp` 右对齐
- [x] Eyebrow：根据 `state.yaml` 显示 `⏵ now working <story> · stage <n/m>` 或 `● next HH:MM · in Nm Ss · last ✓ HH:MM <story>`
- [x] THREE LAYERS 段：Loop / Dream / Peer 三行，状态点 + 名称 + 状态词 + 调度 + last 事件（参考 `LayerRow`）
- [x] FOUR DEFENSES 段：TCR / Auto Review / Spar / Sentinel 四列（参考 `DefenseCell`）
- [x] PIPELINE 段：Idea ▸ Backlog ▸ Build ▸ Verify ▸ Release 五列计数 + `▲ in-flight` 标注（计数来自 BACKLOG.md）
- [x] CURRENT FOCUS · DoD 段：仅当 Build > 0 显示；8 个 DoD chip 占两行（AC / CI / TCR / Peer / Coverage / Docs / Spar / Branch）
- [x] NEED YOU 段：alert 数量、proposal 数量、release-ready 提示，跳转命令蓝色高亮
- [x] 底部 quick-nav 两行：`roll loop / backlog / brief / status / peer / --help`
- [x] 装饰性 emoji 与 ASCII banner 退役；BACKLOG 状态 emoji（📋🔨🔒⏸✅）保留

**Files:**
- `lib/roll-home.py`（新建）
- `bin/roll`（裸 `roll` 命令的 dispatch 加 ROLL_UI 分支，`_dashboard` 重命名为 `_legacy_home`）
- `tests/unit/roll_home.bats`（新建，9 tests）
- `tests/integration/cmd_dashboard.bats`（更新 golden path for v2）

**Dependencies:**
- Depends on: US-VIEW-001

---

<a id="us-view-003"></a>
## US-VIEW-003 `roll --help` 重设计 ✅

**Created**: 2026-05-18
**Completed**: 2026-05-18
**Wave**: 2 · Reference frame: `HelpFrame` in `frames-roll-home.jsx`

- As a Roll user
- I want `roll --help` 不再用 6 行 ASCII ROLL banner 占屏，而是一行品牌 + tagline，命令按 AUTONOMY / PROJECT / MACHINE 三组分类
- So that 第一次看 help 就能立刻找到自己想敲的命令

**AC:**
- [x] 顶部 wordmark 紧凑两行：`roll · autonomous delivery for software teams` + ZH 译文 + 版本号
- [x] `usage  roll <command> [options]` 单行
- [x] AUTONOMY 组（loop / brief / backlog / peer / alert）— 日常使用，前 3 个带 `★` 高亮
- [x] PROJECT 组（init / status / agent / ci / release / review-pr）— 项目内
- [x] MACHINE 组（setup / update / version）— 全局
- [x] 每条命令两行：英文一行（命令名蓝色 bold + args dim + 英文说明）+ 中文一行（dim）
- [x] 底部 examples 块（4 个常用场景）+ docs / issues 链接

**Files:**
- `lib/roll-help.py`（新建）
- `bin/roll`（`--help` / `-h` dispatch 加 ROLL_UI 分支，`usage()` 重命名为 `_legacy_help()`）
- `tests/unit/roll_help.bats`（新建，9 tests）
- `tests/integration/cmd_help.bats`（新建，3 E2E tests）

**Dependencies:**
- Depends on: US-VIEW-001

---

<a id="us-view-004"></a>
## US-VIEW-004 `roll status` 重设计 ✅

**Created**: 2026-05-18
**Completed**: 2026-05-18
**Wave**: 3 · Reference frame: `StatusFrame` in `frames-roll-views.jsx`

- As a Roll user
- I want `roll status` 显示一行 healthy 总览 + 全局约定文件清单 + AI 客户端 sync 表 + 项目模板 + 本项目状态
- So that 一眼判断同步链路完整、能在 drift 时直接看到要敲哪条命令

**AC:**
- [x] 顶部一行 `● healthy   X of Y AI clients in sync · N skills mounted · M templates present` 或 `! drift ...`
- [x] GLOBAL CONVENTIONS 段：AGENTS.md / CLAUDE.md / GEMINI.md / .cursor-rules / project_rules.md 等 `+` 绿色已存在 / `−` 红色缺失
- [x] AI CLIENTS 表：name / convention / path / sync / skills 五列；drift 行用 hl-warn 浅琥珀底色
- [x] drift 行下方接修复提示行（蓝色高亮 `roll setup -f <client>`）
- [x] PROJECT TEMPLATES 段：4 个模板的文件数横排
- [x] THIS PROJECT 段：AGENTS.md / BACKLOG.md / docs/features/ / loop · launchd / dream · launchd 五行 metric

**Files:**
- `lib/roll-status.py`（新建）
- `bin/roll`（`cmd_status` dispatch 加 ROLL_UI 分支，`cmd_status` 重命名为 `_legacy_status`）
- `tests/unit/roll_status_v2.bats`（新建，8 tests）
- `tests/unit/roll_status.bats`（更新 ROLL_UI=v1 for legacy tests）
- `tests/integration/cmd_status.bats`（更新 + v2 golden path test）

**Dependencies:**
- Depends on: US-VIEW-001

---

<a id="us-view-005"></a>
## US-VIEW-005 `roll backlog` 重设计 ✅

**Created**: 2026-05-18
**Completed**: 2026-05-18
**Wave**: 3 · Reference frame: `BacklogFrame` in `frames-roll-views.jsx`

- As a Roll user
- I want `roll backlog` 按 Bug Fixes / User Stories / Refactors / Ideas 四组分类，外加 Blocked / Deferred 折叠区
- So that 当前 Todo 全貌可见，in-progress 项目用 pulse 高亮

**AC:**
- [x] 顶部右侧 `12 Todo · 2 Blocked · 3 Deferred` 标签
- [x] 四组：Bug Fixes（红）/ User Stories（蓝）/ Refactors（琥珀）/ Ideas（dim）；每条两行（ID + EN / ZH）
- [x] in-progress 项目：`⏵` 紫色 pulse + 行 hl-run 紫底色
- [x] Blocked 段：`🔒` + ID + 描述 + 阻塞原因括号注释
- [x] Deferred 段：`⏸` + ID + 描述 + 推迟原因
- [x] 底部 triage / drill 命令提示行
- [x] 子命令 `roll backlog block/defer/unblock <pattern> [reason]` 行为不变

**Files:**
- `lib/roll-backlog.py`（新建）
- `bin/roll`（`backlog` 的 dispatch 加 ROLL_UI 分支）
- `tests/unit/roll_backlog.bats`（新增 6 个 v2 测试）
- `tests/integration/cmd_backlog.bats`（新建 E2E 测试）

**Dependencies:**
- Depends on: US-VIEW-001

---

<a id="us-view-006"></a>
## US-VIEW-006 `roll brief` 重设计 ✅

**Created**: 2026-05-18
**Completed**: 2026-05-18
**Wave**: 3 · Reference frame: `BriefFrame` in `frames-roll-views.jsx`

- As a Roll user
- I want `roll brief` 渲染最新 brief markdown，但用终端原生格式而不是纯 markdown
- So that owner 一眼看到 SUMMARY / HIGHLIGHTS / DECIDE 三段，决策项被琥珀 D1/D2 编号高亮

**AC:**
- [x] 顶部 eyebrow + 简报文件路径 + Nh ago
- [x] SUMMARY 段：一行核心数字 + ZH 译文 + 三行高亮（✓ Shipped / ! Watch / ⚠ Decide）
- [x] HIGHLIGHTS 段：每条 `— <STORY-ID> <title>` + dim 描述
- [x] DECIDE 段：D1 / D2 / ... 琥珀编号 + 描述
- [x] 底部 next / drill / alert 跳转行
- [x] 数据源：`docs/briefs/<date>.md` 解析；无新简报时自动 regen（行为不变）

**Files:**
- `lib/roll-brief.py`（新建）
- `bin/roll`（`brief` 的 dispatch 加 ROLL_UI 分支）
- `tests/unit/roll_brief.bats`（新增 7 个 v2 测试）
- `tests/integration/cmd_brief.bats`（新建 E2E 测试）

**Dependencies:**
- Depends on: US-VIEW-001

---

<a id="us-view-007"></a>
## US-VIEW-007 `roll setup` 重设计 ✅

**Created**: 2026-05-18
**Completed**: 2026-05-18
**Wave**: 4 · Reference frame: `SetupFrame` in `frames-roll-flows.jsx`

- As a first-time Roll user
- I want `roll setup` 用编号步骤 + 状态字形（`✓` / `!` / `✗` / `⏵`）实时显示进度
- So that 滚屏的 `[roll] ...` 日志变成清爽的 6 步流程，drift 在第 5 步用琥珀 `!` 提示

**AC:**
- [x] 顶部 eyebrow + scope (machine-level · ~/.roll/)
- [x] 6 个编号步骤（参考设计稿）：detect / fetch / install skills / symlink / drift check / templates
- [x] 每步两行（EN + ZH）+ 可选 detail 块（用 `TreeBranch` 风格的软链接展开）
- [x] Step 5 drift 状态用琥珀 `!` + 修复提示 `roll setup -f <client>`
- [x] 结尾 `✓ Setup complete · total Ns` + next 提示行
- [x] 流式输出（每步完成立刻 flush），不是一次性 dump

**Files:**
- `lib/roll-setup.py`（新建；Python v2 renderer，--demo 模式显示 6 步进度）
- `bin/roll`（`cmd_setup` 加 ROLL_UI=v2 dispatch + --demo flag）
- `tests/unit/roll_setup.bats`（新建；7 个单元测试，6/7 GREEN，1 skip）
- `tests/integration/cmd_setup.bats`（追加 4 个 e2e 测试）

**Dependencies:**
- Depends on: US-VIEW-001

---

<a id="us-view-008"></a>
## US-VIEW-008 `roll init` 重设计 ✅

**Created**: 2026-05-18
**Completed**: 2026-05-19
**Wave**: 4 · Reference frame: `InitFrame` in `frames-roll-flows.jsx`

- As a project owner
- I want `roll init` 显示 6 个编号步骤（detect type → create AGENTS.md → BACKLOG.md → docs/features/ → merge existing CLAUDE.md → link skills）
- So that 初始化时清楚每一步动了哪个文件，已有文件 merge 而不是覆盖时用 `~` 琥珀

**AC:**
- [x] 顶部 eyebrow + 项目路径
- [x] 6 步流程，每步 `✓` 绿 / `!` 琥珀（merge）/ `✗` 红 / `⏵` 紫
- [x] 文件操作用 `+ filename` 绿色（新建）/ `~ filename` 琥珀（merge）
- [x] 结尾 `✓ Project ready` + NEXT 段三步（编辑 BACKLOG / 跑一轮 / 启用 loop）
- [x] 项目类型自动检测（package.json / Cargo.toml / pyproject.toml 等）— 行为不变

**Files:**
- `lib/roll-init.py`（新建；v2 demo 渲染器，6 步编号 + `+`/`~` 文件标记 + NEXT 段）
- `bin/roll`（`cmd_init` 加 `--demo` 解析 + ROLL_UI=v2 dispatch；v1 fallback 保留旧实现）
- `tests/unit/roll_init.bats`（新建；7 个测试覆盖 demo 输出 + 路由）

**Dependencies:**
- Depends on: US-VIEW-001

---

<a id="us-view-009"></a>
## US-VIEW-009 `roll peer` 重设计 📋

**Created**: 2026-05-18
**Wave**: 4 · Reference frame: `PeerFrame` in `frames-roll-flows.jsx`

- As a Roll user
- I want `roll peer` 把跨 Agent 对审过程渲染成 ROUND 1 / ROUND 2 ... 段落，每轮显示 proposer 与 reviewer 的 concern/nit/ack/block
- So that 跨 Agent review 不再是平铺日志，而是可读的协商 transcript + 最终 verdict

**AC:**
- [ ] 顶部 eyebrow `roll peer · cross-agent review` + trigger 标签（紫色 complexity=large 等）
- [ ] subject 行：story ID + title + PR # + diff stat
- [ ] proposer / reviewer / round 行：两个 agent 名字配色（claude 蓝、codex 粉、kimi 琥珀、deepseek 绿等）
- [ ] 每轮 ROUND N pink section header + hint
- [ ] 每条 turn：`agent` 名 + weight chip（`● concern` 琥珀 / `○ nit` dim / `✓ ack` 绿 / `✗ block` 红）+ body 缩进
- [ ] 终止 VERDICT 行：`✓ VERDICT · approved` 或 `✗ VERDICT · changes requested`
- [ ] artifact 路径 + next 跳转

**Files:**
- `lib/roll-peer.py`（新建；wrapper 现有 peer 逻辑）
- `bin/roll`（`peer` 的 dispatch 加 ROLL_UI 分支）

**Dependencies:**
- Depends on: US-VIEW-001

---

<a id="us-view-010"></a>
## US-VIEW-010 dashboard 用模型公开单价算成本 📋

**Created**: 2026-05-18
**Plan**: [loop-cost-telemetry-plan.md](loop-cost-telemetry-plan.md)

- As a Roll user
- I want dashboard 上每轮 cycle 的成本是按模型公开单价 × 实际 token 用量算出来的真实开销
- So that 不同项目、不同账号之间可以横向对比、加总，不受订阅 / 抵扣干扰

**Domain Model:**
- Context: View Rendering
- Cross-context: Cycle Event Stream（消费 cycle_end 含 token + model 的 detail）

**AC:**
- [ ] dashboard 优先读取 cycle_end 事件 detail 里的 model + tokens；找不到时显示 `—`
- [ ] 新增模型单价表（input / output / cache_create / cache_read，per million tokens，USD）；未知模型 fallback 到 sonnet 单价并 warn
- [ ] cost 列从此显示 list-price 计算结果，不再使用 AI 客户端上报的 total_cost_usd
- [ ] token 列从此有真实数字（用 k/m/b 计量）
- [ ] rollup（今日 / 昨日 / 前天）的 cost / tokens 都从事件流加总
- [ ] 老数据（detail 是字符串）保持兼容：cost / tokens 显示 `—`，但不破坏其他列
- [ ] **cycle row 新增 model 列**，显示每轮 cycle 使用的模型名 + 版本（`opus-4-7` / `sonnet-4-6` / `haiku-4-5`），未知模型显示 `?`；位置在 cost 列前；窄屏自动隐藏。版本号必须带上——同系列跨版本（如 sonnet-4-5 → 4-6）单价 / 行为都会变，缺版本号就丢了对账依据。这是 cost 列的语境注释：一眼看清"今日 91M tok / 昨日 148M tok 但今日 cost 反而高"是因为 model 换了

**Files:**
- `lib/model_prices.py`（新建：单价表 + compute_list_cost + 模型短名映射）
- `lib/roll-loop-status.py`（解析 cycle_end detail，调单价表）
- `lib/roll_render.py`（cycle_row 增加 model 列；窄屏判断）
- `tests/unit/roll_render.bats`（新增单价表 + cost 计算 + model 列渲染回归）

**Dependencies:**
- Depends on: US-LOOP-004

## US-VIEW-011 dashboard 显示 cycle 的 PR 落地状态 📋

**Created**: 2026-05-19

- As a Roll 用户
- I want loop dashboard 上每一轮 cycle 都看得到 PR 号和它的落地状态（合并 / 关闭 / 仍开）
- So that PR 被关掉没合并的轮次不会从视野里消失 — token 花了就要看见，方便点开排查为什么白跑

**背景**:
2026-05-19 13:11 那轮 cycle 跑完开了 PR #77（重复 fix FIX-064），被自动 close 掉没合并。当前 dashboard 行只显示 `✓ 13:11   17m   3.6M   $2.65   —`，看不出有 PR、更看不出 PR 被关掉了，3.6M token 像凭空消失。

**Domain Model:**
- Context: View Rendering + Cycle Event Stream
- Cross-context: 需要 `pr` 事件携带 PR 落地状态（merged / closed / open），目前只有 `outcome: ok`

**AC:**
- [ ] `pr` 事件 outcome 字段新增三态：`merged` / `closed` / `open`；开 PR 时先写 `open`，后续在 cycle_end 前回查 GH API 写终态
- [ ] dashboard cycle row 在 backlog id 之后追加 PR 标记：合并 = `#NN ✓`、关闭未合并 = `#NN ↩`、仍开 = `#NN …`；无 PR 的 cycle 行不变
- [ ] cycle 完成但 PR 被关闭（白跑）的行 glyph 从 `✓` 改成 `⊘`，一眼区分"真交付"和"白跑"
- [ ] rollup 区域的 `merged PRs` 计数保持现状（只计 merged），与 row 标记互补不冲突
- [ ] 历史数据兼容：老 `pr` 事件只有 `outcome: ok` 时按 `open` 渲染，不破坏老 row

**Files:**
- `bin/roll`（开 PR 时写 `outcome: open`；cycle_end 前回查 GH 状态写终态事件）
- `lib/roll-loop-status.py`（aggregate 解析 PR 状态、记 PR 号；outcome 派生 `⊘` 分支）
- `lib/roll_render.py`（cycle_row 后缀 PR 标记 + glyph 分支）
- `tests/unit/roll_render.bats`（merged / closed / open 三态 + 无 PR 的回归）

**Dependencies:**
- Depends on: US-LOOP-001（pr 事件流）
