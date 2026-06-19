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

让 AI agent 自己从 backlog 取任务，走你既有的 git + CI 流程交付。支持 Claude、Cursor、Codex、Kimi 等。

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
roll init           # 在当前项目落地 Roll
roll loop on        # 可选：让 AI 自动跑 backlog
```

`roll init` 会识别老项目并在合适时引导到 `$roll-onboard`。
第一次跑建议从[快速上手](guide/zh/getting-started.md)开始。

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
| `roll doctor [skills]` | 环境与安装体检(agents、技能清单、plist、launchd lanes) |
| `roll tune [reset]` | 只建议不自动应用的自调参报告 |
| **卡片与证据** | |
| `roll idea "<一句话描述>"` | 收卡:自动分类、编号、lint、推断 epic、铸全套卡夹——用户加卡的唯一入口 |
| `roll story new <ID> --title <t> [--epic <e>] [--no-index]` | agent/skill 用的单一建卡入口:卡夹 + backlog 行 + 索引刷新(批量用 --no-index) |
| **项目 · 每仓** | |
| `roll init` | 在当前项目落地 Roll(历史代码走 agent 接入) |
| `roll offboard` | 从项目移除 Roll |
| `roll test [--where] [--reset]` | 运行测试套件(通过隔离适配器分发;未知类型显式报错) |
| `roll ci [--wait]` | 查看 / 等待当前 commit 的 CI 状态 |
| `roll release [--dry-run]` | 唯一发版流:版本号→折叠changelog→包闸→提交推送→一致性闸→PR→自动合并→推tag(闸在合并前跑;用 GitHub auto-merge 自驱合并) |
| `roll showcase [--card <ID>]` | 黄金路径标准 E2E(隔离沙箱):重置卡片→异构选角真模型三角(kimi/claude/pi)→走 loop 交付→采集 CLI+web 截屏→装配证据链→给出通过/失败判定 |
| `roll pair [init\|status\|score]` | 跨 Agent 配对:异构同行复检与交付打分 |
| `roll cycles [--since 1d\|3d\|7d\|all]` | 周期账本——每行一个 cycle,失败不被吞 |
| `roll cycle <id>` | 单个 cycle 的完整轨迹带(cycle→story→build→peer→ci→pr→end) |
| web `#loop` cycle 行 | 同一账本展开为共享 ActivitySignal 流，并写 `.roll/loop/cycle-<id>.signals.jsonl` 供回放 |
| `roll peer [--reviewer <agent>] (--prompt <text>\|--file <path>)` | 一次性结构化外部 provider 评审；记录 `.roll/peer/runs.jsonl` |
| **配置 · 本机** | |
| `roll ls [--json] [--stale-days <n>]` | 列出跨项目注册表(`~/.roll/projects.json`):名称 · 版本 · 判定 · 路径;缺失/过期行会被标注,绝不丢弃 |
| `roll config [lang <zh\|en\|--reset>\|…]` | 读写 roll 配置(语言、loop 窗口、dream 时间) |
| `roll agent [set <slot> <agent>\|use <name>\|list]` | 本机复杂度槽位路由(easy/default/hard/fallback) |
| `roll cast [--json]` | 打印复杂度阶梯→角色分工表(与 web 控制台网格同源同数据;`--json` 为机器视图) |
| `roll doctor skills [--strict] [--json]` | 严格技能审计(技能 · 违规 · hub 行数 + 四组调用频次——与 web Skills 页同口径) |
| `roll setup skills` | 同步 `guide/skills.md` 技能目录 |
| `roll doc [--lang en\|zh] [name]` | 在终端查看 Charter / 语言指南文档(`--lang` 缺省回落到配置语言) |
| `roll tool status` | 查看已注册工具及其有效 `.roll/policy.yaml` 状态 |
| `roll prices [refresh]` | 模型价目表(成本核算来源) |
| `roll setup [skills\|-f]` | 首次安装、生成技能目录或重新同步约定到所有 AI 客户端 |
| `roll update` | 升级到最新版本并重新同步 |
| `roll --version` / `roll -v` | 显示已安装的 roll 版本 |

## UI 里的真相模型

交付档案是真相投影，不是 backlog 镜像。持久事实只走一条读路径：
anchors -> selectors -> adapter -> projections。`roll index` 用 Story、
Cycle、Release 三个聚合渲染首页真相板。

- backlog 行是声明；`main` 上的 merge 证据和记录化验收证据才是真相。过早写
  `✅ Done` 会显示成漂移。
- cycle 历史使用 TerminalOutcome 词汇，不再教旧的自由文本摘要。
- 缺失事实显示 `?`。可见的 `0` 表示已知为零，不表示未知。

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
