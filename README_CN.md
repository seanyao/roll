```
 ██████╗  ██████╗ ██╗     ██╗     
 ██╔══██╗██╔═══██╗██║     ██║     
 ██████╔╝██║   ██║██║     ██║     
 ██╔══██╗██║   ██║██║     ██║     
 ██║  ██║╚██████╔╝███████╗███████╗
 ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚══════╝
```

**[English README](README.md)**

[![官网](https://img.shields.io/badge/官网-seanyao.github.io%2Froll-blue)](https://seanyao.github.io/roll/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/@seanyao/roll.svg)](https://www.npmjs.com/package/@seanyao/roll)
[![CI](https://github.com/seanyao/roll/actions/workflows/ci.yml/badge.svg)](https://github.com/seanyao/roll/actions/workflows/ci.yml)

Roll 是 Supervisor-led 的 CLI harness：把 AI agent 路由进按 Story 收口的规划、构建、评估、git、CI 与验收证据流程。支持 Claude、Cursor、Codex、Kimi、Pi、Reasonix 等本机可用 rig。

## 安装

```bash
curl -fsSL https://seanyao.github.io/roll/install | bash
```

```bash
npm install -g @seanyao/roll
```

环境要求：Node.js ≥ 22。Roll 是自包含的 TypeScript CLI —— 除 node 外无其它运行时引擎。

## 使用

```bash
cd your-project
roll init           # 在当前项目落地 Roll（交互式确认）
roll next           # 接续 design、apply、repair、migrate、loop 或 status
roll loop on        # 可选：让 AI 自动跑 backlog
```

`roll init` 会先诊断当前目录：完整 Roll 项目提示 `roll status`；部分接入
提示 `roll init --repair`；pre-2.0 布局提示迁移且不写文件。已有代码库会进入
`$roll-onboard`；PRD/文档-only 工作区按新项目处理，生成 `.roll/brief.md` 并指向
`roll design --from-file <detected-doc>`。空目录会在交互终端询问你要做什么；脚本或 CI 中，
普通 `roll init` 只读，`roll init --auto` 写入占位 brief 后指向 `roll design`。
已有代码库的 graft 流程里，`roll init --apply` 会先校验产物、打印每个计划文件操作的
审阅检查点，并在写入前等待 owner 确认；自动化必须在审阅后显式使用
`roll init --apply --auto`。
任一路径之后，`roll next` 都是继续按钮：它读取同一份 brief、onboard plan、
backlog 和 Roll 标记，只打印一个最合适的下一步命令，而不是让用户自己猜。
第一次跑建议从[快速上手](guide/zh/getting-started.md)开始。

## V4 Supervisor 执行模型

Roll V4 把项目协调和单 Story 交付拆开：

- **Supervisor Agent** 负责项目级协调：backlog 顺序、跨 Story 上下文、路由建议、重复失败、发布就绪、预算与 owner 升级。它只观察和建议，不实现具体 Story，也不覆盖证据闸。
- **Story Execution Unit** 用执行剖面交付一张 Story：`standard` = Builder，`verified` = Builder -> Evaluator，`planned` = Planner -> Builder -> Evaluator。
- **Planner / Builder / Evaluator 角色**是稳定契约；具体 `agent`、`model`、`rig` 可按 Story 通过路由策略变化。
- **Skills 仍然存在**，是角色调用的能力层。角色调用 `$roll-design`、`$roll-build`、`$roll-fix`、`$roll-peer`、`$roll-.qa` 等技能，而不是把技能重写进 TS。
- **fallback 必须响**。请求的 agent 或 rig 不可用时，Roll 记录不可用并暂停或询问 owner；不会悄悄冒充成另一个 agent。
- **attest 与证据按 Story 收口**。验收入口是这张 Story 自己的 `latest/<id>-report.html`、AC map 和截图/测试产物。

每张 Story 可以声明角色路由：

```yaml
story: US-V4-012
execution_profile: verified
roles:
  builder:
    agent: kimi
    responsibility: update README, docs, guides, website, and samples
  evaluator:
    agent: pi
    responsibility: evaluate new-user clarity and product narrative
```

运行时可用性必须显式记录：如果当前机器不能调用 `kimi` 或 `pi`，交付证据要记录这个限制，不能用静默 fallback 掩盖。

## 接入样例

**从零开始的新项目**

```bash
mkdir my-product && cd my-product
roll init
# 在交互终端描述需求、指向 PRD，或让 Roll 从已有笔记写 .roll/brief.md。
roll next
roll design --from-file .roll/brief.md
roll loop on
```

Roll 会说明下一步设计动作，而不是静默创建假工作。Planner 把需求拆成 Stories，Supervisor 为每张 Story 选择 `standard`、`verified` 或 `planned`，Builder/Evaluator 角色执行，owner 查看按 Story 收口的 attest 证据。

**已有项目接入**

```bash
cd existing-codebase
roll init
roll next
roll init --apply        # 审阅生成的 onboard plan 后再执行
roll loop on
```

Roll 先无破坏地诊断仓库；只有审阅后才写入或更新 Roll metadata。随后 Supervisor 基于已有 backlog、docs、context、open PR 与 route profile 推理。当前状态通过 CLI-first 可观测入口查看：`roll status`、`roll loop watch`、`roll loop runs`、`roll cycle <id>`、`roll loop alert` 和 Story 报告。

## 新项目快速启动

新项目需要先配置 remote，loop 才能推送分支并创建 PR：

```bash
cd your-project
roll init
# 1. 为项目创建 GitHub 仓库并添加为 origin
# 2. 推送当前分支，让 loop 有地方落地工作成果
git push -u origin main
# 3. 启动自主循环
roll loop on
```

如果仓库不存在或不可达，loop 会快速失败并发出 ALERT，避免在无法推送的目
标上浪费 agent token。需要暂停时运行 `roll loop pause` 会持久化暂停标记；
准备好后用 `roll loop resume` 恢复。

## 命令

| 命令 | 说明 |
|------|------|
| **自治 · 日常** | |
| `roll loop <on\|off\|now\|status\|watch\|runs\|log\|story\|events\|eval\|signals\|alert\|fmt\|pr-inbox\|mute\|unmute\|pause\|resume\|reset\|gc>` | 管理自主 BACKLOG 执行循环(含每周期结果评分) |
| `roll loop watch [-n <行数>] [--verbose\|--raw] [--attach]` | 只读、精炼、实时地查看本项目 loop——自动接入 `.roll/loop/live.log`，按 cycle / story / 结果 / ALERT / 成本 / 心跳渲染。绝不写入或干预运行中的 cycle；Ctrl-C 只结束视图，不停 loop。`--attach` 以只读方式加入 loop 的 tmux 观测窗 |
| `roll loop go [--epic <e>\|--cards <ids>] [--budget <usd>] [--for <duration>] [--review <auto\|hetero\|self\|off>]` | 手动运行 goal mode，直到范围内工作完成、暂停或触发预算/用量/时间盒护栏；scheduler off 时也可运行，loop paused 时先 `roll loop resume`；终审默认 `auto` |
| `roll loop goal` | 显示持久化 goal 的范围、终审模式、用量、限制、安全闸和最近裁定 |
| `roll backlog [sync\|block\|defer\|lint\|…]` | 查看、管理、从 GitHub Issues 同步待处理任务 |
| `roll loop alert [list\|ack\|resolve\|log]` | 查看 / 清除 loop 告警 |
| `roll status` | 判定优先的真相摘要，读自同一份快照——LOOP · CYCLE · RELEASE · STORY，STORY 行带 attest 验收覆盖率(`done ≡ 已合并 ∧ 已验收`)——其后是约定/AI 客户端同步健康 |
| `roll supervisor [observe\|advise\|next\|why] [--json]` | 项目级 Supervisor Agent(v0 观察/建议):读取 backlog、合并真相、open PR、路由配置、重复失败与发布就绪，再给出建议性决策。只做跨 Story 协调——绝不实现具体 Story；持久化策略变更需 owner 确认 |
| `roll pulse [--json]` | 今日交付脉搏：窗口内周期数、已合 merged 数、已验收 attested 数，外加一条来自故事光谱的 ASCII 火花线。双语中/EN。`--json` 输出机读 JSON |
| `roll doctor [skills\|--tools]` | 环境与安装体检；`roll doctor --tools` 展示工具与真实截图权限预检，包括 Terminal.app Screen Recording |
| `roll daemon <start\|stop\|status>` | 面向未来浏览器可观测的实验性只读事件广播器；默认 `127.0.0.1:7077`，记录 `.roll/loop/daemon.pid`，loop 从不自动启动它 |
| `roll tune [reset]` | 只建议不自动应用的自调参报告 |
| **卡片与证据** | |
| `roll idea "<一句话描述>"` | 收卡:自动分类、编号、lint、推断 epic、铸全套卡夹——用户加卡的唯一入口 |
| `roll story new <ID> --title <t> [--epic <e>] [--no-index]` | agent/skill 用的单一建卡入口:卡夹 + backlog 行 + 索引刷新(批量用 --no-index) |
| **项目 · 每仓** | |
| `roll init` | 诊断当前目录并路由到新项目脚手架、PRD/design handoff、已有代码库 onboard、repair、migration 或 `roll status` |
| `roll next` | 接续 init/onboard 流程，只给一个最合适的下一步命令：design、apply、repair、migrate、loop 或 status |
| `roll design [--from-file <path>] [--agent <name>]` | 交互式启动 `$roll-design`；`--from-file` 绑定 PRD/brief 作为设计输入 |
| `roll offboard` | 从项目移除 Roll |
| `roll test [--where] [--reset]` | 运行测试套件(通过隔离适配器分发;未知类型显式报错) |
| `roll daemon <start\|stop\|status>` | 管理实验性只读可观测驻守服务(可选加入,从不自动启动) |
| `roll ci [--wait]` | 查看 / 等待当前 commit 的 CI 状态 |
| `roll release [--dry-run]` | 唯一发版流:版本号→折叠changelog→包闸→提交推送→一致性闸→PR→自动合并→推tag(闸在合并前跑;用 GitHub auto-merge 自驱合并) |
| `roll showcase [--card <ID>]` | 黄金路径标准 E2E(隔离沙箱):重置卡片→异构选角真模型三角(kimi/claude/pi)→走 loop 交付→采集 CLI+web 截屏→装配证据链→给出通过/失败判定 |
| `roll pair [init\|status\|score]` | 跨 Agent 配对:异构同行复检与交付打分 |
| `roll cycles [--since 1d\|3d\|7d\|all]` | 周期账本——每行一个 cycle,失败不被吞 |
| `roll cycle <id>` | 单个 cycle 的完整轨迹带(cycle→story→build→peer→ci→pr→end)；同一份轨迹持久化为 `.roll/loop/cycle-<id>.signals.jsonl` 供回放 |
| `roll peer [--reviewer <agent>] (--prompt <text>\|--file <path>)` | 一次性结构化外部 provider 评审；记录 `.roll/peer/runs.jsonl` |
| **配置 · 本机** | |
| `roll ls [--json] [--stale-days <n>]` | 列出跨项目注册表(`~/.roll/projects.json`):名称 · 版本 · 判定 · 路径;缺失/过期行会被标注,绝不丢弃 |
| `roll config [lang <zh\|en\|--reset>\|…]` | 读写 roll 配置(语言、loop 窗口、dream 时间) |
| `roll agent [set <slot> <agent>\|use <name>\|list]` | 本机复杂度槽位路由(easy/default/hard/fallback) |
| `roll cast [--json]` | 打印复杂度阶梯→角色分工表（`--json` 为机器视图） |
| `roll doctor skills [--strict] [--json]` | 严格技能审计(技能 · 违规 · hub 行数 + 四组调用频次——与 web Skills 页同口径) |
| `roll setup skills` | 同步 `guide/skills.md` 技能目录 |
| `roll doc [--lang en\|zh] [name]` | 在终端查看 Charter / 语言指南文档(`--lang` 缺省回落到配置语言) |
| `roll tool status` | 查看已注册工具、有效 `.roll/policy.yaml` 状态与 requirement 就绪度 |
| `roll prices [refresh]` | 模型价目表(成本核算来源) |
| `roll setup [skills\|-f]` | 首次安装、生成技能目录或重新同步约定到所有 AI 客户端 |
| `roll update` | 升级到最新版本并重新同步 |
| `roll --version` / `roll -v` | 显示已安装的 roll 版本 |

## 当前可观测性

Roll 当前是 CLI-first 可观测。持久事实只走一条读路径：anchors -> selectors
-> adapter -> projections。`roll status`、`roll loop watch`、`roll loop runs`、
`roll cycle <id>`、`roll pulse` 和按 Story 收口的 attest 报告，是当前用户面的
真相入口。`roll index` 只是按需的归档/修复渲染器，用来生成静态 HTML 页面；
它不是当前活体交付真相入口。

- backlog 行是声明；`main` 上的 merge 证据和记录化验收证据才是真相。过早写
  `✅ Done` 会显示成漂移。
- cycle 历史使用 TerminalOutcome 词汇，不再教旧的自由文本摘要。
- 缺失事实显示 `?`。可见的 `0` 表示已知为零，不表示未知。

完整的 Supervisor Live Console 和多角色看板是下一阶段工作，不是本 README 声称已交付的能力。

## 仓库结构

开发态是 pnpm monorepo，发布态是单一 npm 包。

```
packages/      TypeScript 引擎（pnpm workspaces）：spec · core · infra · cli · web
lib/           运行时伴生（价格快照、i18n 文案目录）
skills/        Git submodule → seanyao/roll-skills（agent 技能契约）
conventions/   roll setup 同步到各 AI 客户端的约定
template/      roll init 安装的项目脚手架
```

构建与测试：`pnpm install && pnpm -r test`。

发布为单一 npm 包 `@seanyao/roll`：`dist/`（CLI 经 esbuild 打平为单个自包含 ESM）+ `lib/` + `skills/` + `conventions/` + `template/`。

## 文档

| | |
|---|---|
| **从这里开始** | [快速上手](guide/zh/getting-started.md) · [概述与架构](guide/zh/overview.md) · [工程方法论](guide/zh/methodology.md) |
| **日常使用** | [Loop（自主执行器）](guide/zh/loop.md) · [工具与策略](guide/zh/tools.md) · [配置](guide/zh/configuration.md) · [价格与成本](guide/zh/pricing.md) · [FAQ](guide/zh/faq.md) |
| **质量机制** | [验收证据（`roll attest`）](guide/zh/acceptance-evidence.md) · [证据生命周期](guide/zh/acceptance-evidence.md#三段式生命周期) · [一致性与发版闸](guide/zh/consistency.md) · [跨 Agent 配对](guide/zh/pairing.md) · [Peer 评审](guide/zh/peer.md) · [测试隔离](guide/zh/test-isolation.md) |
| **底层设计** | [架构：分层·领域·不变量](docs/architecture.md) · [验证体系](docs/verification.md) · [理念宣言](docs/manifesto.md) |

完整指南目录：[guide/zh/](guide/zh/) —— agent 路由、peer 评审、feedback、backlog 同步、接入模式等。

## 贡献

详见 [CONTRIBUTING.md](CONTRIBUTING.md)，里面有开发流程、测试方法和 PR 约定。

## 安全

详见 [SECURITY.md](SECURITY.md)。漏洞请私下汇报，不要在公开 Issue 里贴。

## License

[MIT](LICENSE)
