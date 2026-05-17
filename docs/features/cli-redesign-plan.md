# Roll CLI Visual Redesign — Plan

> Sources: design bundle `roll-dashboard/` (Claude Design export, 2026-05-17), in-flight script `lib/roll-loop-status.py`, BACKLOG IDEA-023.

## 1. Why

`roll-loop-status.py`（IDEA-023 的直接落地）跑出来的视觉风格，比现有 `bin/roll` 大部分子命令的「emoji + ASCII banner + `[roll] ...` 日志行」要现代得多。设计稿把这套语言扩展到了全 CLI 表面（home / status / backlog / brief / setup / init / peer / --help），整套 Part 1 + Part 2 共 20 个 artboard，配色、字形、IA 完全统一。

把它落地，相当于：
- 让所有 roll 命令的输出风格一致 — 任何一张截图都能被一眼认出是 roll
- 把 IDEA-023「按天聚合 / 过滤 tmp / 附耗时与成本」彻底解决（含 4 个真实数据 bug）
- 给后续 roll 命令的输出建立可复用的渲染原语（`lib/roll_render.py`）

## 2. 设计语言（来自设计稿 system.txt）

- **色板**：fg / dim / muted / faint（4 档灰）+ blue（info / refs）/ green（ok）/ amber（warn）/ red（fail）/ purple（in-flight，永远配 pulse）/ pink（仅 section header）/ yellow（版本号）。每个色都强制配字形冗余（`✓ ✗ ⏵ ! ●`），color-blind safe，NO_COLOR=1 完全可解析。
- **字形词汇**：`●` enabled · `○` missing/off · `✓` ok · `✗` fail · `⏵` running · `!`/`⚠` warn · `▤` proposal · `▲▼` delta（永远配 +/− 符号）· `▰▱` progress bar · `●●●○○` 5-step health。
- **保留的数据 emoji**：`📋 Todo` / `🔨 In Progress` / `🔒 Blocked` / `⏸ Deferred` / `✅ Done` — 这 5 个映射到 BACKLOG.md 状态值，是数据不是装饰。
- **字重三档**：bold fg / regular fg / dim / muted / faint。
- **IA 三段式**：眉首（cmd · subtitle + scope · timestamp）→ 段落（pink `SECTION` + zh + hint）→ 详情。每段之间 horizontal rule。
- **双语**：EN 行在前、ZH 行在后，永远分开两行不混排；`--en` / `--zh` 折叠。

完整参考卡见设计稿 `system.txt` artboard（`SystemFrame` in `frames-roll-system.jsx`）。

## 3. 数据 bug 诊断（`roll-loop-status.py` 真机跑）

执行 `python3 lib/roll-loop-status.py` 对 `Roll-a43d1b` 项目实跑后发现：

| Bug | 现象 | 根因 |
|---|---|---|
| A | merged PRs 永远 = 0，即使当天有 PR | `cycle_start`/`cycle_end` 用 label `20260517-084804-59225`，`pr` 用 label `loop/cycle-20260517-084804-59225`（分支名）。`aggregate()` 按 label 分组，PR 事件被切到另一个空 cycle 上 |
| B | 22/24 cycle 永远显示 `⏵ running` | 大多数 cycle 以 `stage: "idle"` 结束（没 Todo 可拣），不发 `cycle_end`。`aggregate()` 没识别 idle，把 outcome 留空当 running |
| C | Today 列错把昨天数据塞进去 | `today_key = sorted(by_day.keys(), reverse=True)[0]` 取的是「最近一天有数据」而不是「真实今天」。今天 0 cycle 时，昨天 24 cycle 会被标 Today；下面的 day band 又正确标 Yesterday，互相矛盾 |
| D | duration / cost 全显示 `—` | `cron-*.log` 行实际是 `\033[90m08:52:44\033[0m  \033[90mcycle done — ...\033[0m`（带 ANSI 转义），正则 `^(\d{2}:\d{2}):(\d{2})\s+cycle done` 匹配失败 |

四个都是脚本 bug，不是设计参数缺失。

## 4. 架构（Renderer + Sister Scripts）

**Bounded Context**: `View Rendering` —— 把数据源（events.ndjson / cron.log / state.yaml / BACKLOG.md / config）渲染成终端输出。这个 context 之前不存在；`roll-loop-status.py` 是第一个住户。

**核心 Aggregate**: `Renderer` —— 提供 `pad / strw / c / row / section_head / metric_row / cycle_row` 等 layout 原语。CJK 显示宽度计算、ANSI 包裹、NO_COLOR fallback、`--en/--zh` 折叠、100-col 栅格 + 80-col 退化，全部住在 Renderer 内。

**模块布局**：

```
bin/roll                     # 现状 bash 主入口（dispatch 不动）
  ↓ exec
lib/roll_render.py           # 共享渲染原语（NEW，US-VIEW-001 抽出）
lib/roll-loop-status.py      # 已存在；US-VIEW-001 修 bug + 改 import
lib/roll-home.py             # US-VIEW-002
lib/roll-help.py             # US-VIEW-003
lib/roll-status.py           # US-VIEW-004
lib/roll-backlog.py          # US-VIEW-005
lib/roll-brief.py            # US-VIEW-006
lib/roll-setup.py            # US-VIEW-007
lib/roll-init.py             # US-VIEW-008
lib/roll-peer.py             # US-VIEW-009
```

**Dispatch（在 bin/roll 现有 case 分支里）**：

```bash
case "${ROLL_UI:-v2}" in
  v2) python3 "${ROLL_PKG_DIR}/lib/roll-<cmd>.py" "$@" ;;
  v1) _legacy_<cmd> "$@" ;;
esac
```

每个 sister script 各自独立：读自己需要的数据源，调 `roll_render` 渲染，stdout 打印一次。`--demo` 子模式让每个脚本都能空跑展示设计稿状态（IDEA: 等同设计稿的 fixture）。

## 5. 灰度策略

- 默认 `ROLL_UI=v2`（新视图）。用户遇问题 `export ROLL_UI=v1` 一键回退到旧实现。
- 旧实现一律保留为 `_legacy_<cmd>` 函数，**当前 minor 不删**。
- 下下个 minor 删 v1，把 `case` 退成单分支。

## 6. 命令范围

**本次重设计（9 个 Story，按设计稿）**：
1. `roll loop` 数据 bug + 抽出 `roll_render` 模块（Wave 1）
2. `roll`（home dashboard，Wave 2）
3. `roll --help`（Wave 2）
4. `roll status`（Wave 3）
5. `roll backlog`（Wave 3）
6. `roll brief`（Wave 3）
7. `roll setup`（Wave 4）
8. `roll init`（Wave 4）
9. `roll peer`（Wave 4）

**本次范围外**（小流量或体验已可用）：`roll release` · `roll ci` · `roll review-pr` · `roll alert` · `roll agent` · `roll update` · `roll loop monitor` · `roll loop now` · `roll version`。后续可单开 Story 补齐。

## 7. 关键决策

| ID | 决策 | 取舍 |
|----|------|------|
| D1 | Python sister scripts，不在 bash 里 printf | bash 重写 CJK 宽度 + ANSI 太脆。复用现有 `roll-loop-status.py` 的模式 |
| D2 | `ROLL_UI=v2` 默认开 + 一键回退 | 用户感知是直接升级；老用户/出问题有逃生口 |
| D3 | 一条命令一个 Story | 8 个小 PR > 3 个大 PR，便于逐条 review、独立回滚 |
| D4 | 不动现有命令/参数，只换渲染 | 重设计的是表面，不是行为。`roll backlog defer ...` 不变 |
| D5 | 装饰性 emoji 与 ASCII banner 全退役；数据 emoji 保留 | 设计稿明确：「emoji 仅在编码状态值时使用，不做装饰」 |

## 8. Domain Model

- Context: `View Rendering`（新增）
- Aggregate: `Renderer` (Root) owns [`Palette`, `GlyphSet`, `Layout`, `Bilingual`]
- Entities touched: `Cycle`（loop-status 用）· `Backlog`（home/backlog 用）· `Convention`（status/setup 用）· `Peer Transcript`（peer 用）
- Events raised: 无（read-only 渲染层，不写数据）
- Cross-context: `View Rendering` 读所有上下文的状态文件；不修改任何外部 context。

## 9. 验收基线（Cross-Story）

每个 Story 共享下列 AC（在 US 里只写差异部分）：
- 终端真彩配色（truecolor `\033[38;2;R;G;B`），NO_COLOR=1 退到字形 + 字重 + 留白
- 100-col 栅格；`COLUMNS<100` 时降级到 80-col 模板
- `--en` / `--zh` / `--no-color` flag 一致；`--demo` 用内嵌 fixture 输出（不依赖真实数据，可作为 CI 截图依据）
- 输出对齐 EAW（CJK 算 2 列）；用 `lib/roll_render.strw()` 算宽度
- 命令本身的行为不变；只换渲染。回归测试：`ROLL_UI=v1 roll <cmd>` 仍走旧实现且通过既有 bats
