# Roll v3（在建分支）— Agent 操作手册

> ⚠️ **This is the Roll v3 work-in-progress branch. Stable = `main` (bash).**
> ⚠️ **这是 Roll v3 在建分支；稳定版在 `main`（bash，锚点 tag `v2-freeze-2026-06-04`）。**
> 本分支把 roll 从 bash 重写为 TypeScript，按"反馈闭环 + 能力域分层"收敛。给在本分支干活的 agent / loop 读。
> 规格依据：`.roll/v3/README.md`（包地图 + 冲突裁定表）；每 story 纪律：`.roll/v3/build/prompts/p2-build-cycle.md`。

## 0. 这是什么（一句话）

roll 是一个**按反馈闭环设计的 agent harness**：把 LLM agent 当黑盒，用反馈闭环优化对它的控制力。本分支把这台控制器从散落的 bash/skill/py/配置，收敛成 TS 分层系统。

## 1. 当前桥接状态（随每条命令迁移增量更新）

| 范围 | 状态 |
|---|---|
| 全部子命令 | **bash**（`bin/roll`，未开始 port） |
| `packages/` | 空脚手架（pnpm workspace 已就位） |
| `skills/` | git submodule → seanyao/roll-skills |

> 每 port 完一条命令，把它从上表挪进「走 TS」行——只改相关行，不大改。

## 2. 沟通

- 用用户语言回答；代码/git/注释用英文；UI 中英双行。
- 简洁，讲结果（outcome），不复述实现、不走查代码。
- 自然、同事口吻；成功失败一致的温度。

## 3. 架构不变量（动手前必须守）

1. **反馈闭环是脊柱**：核心作动（编排）→ 控制平面传感/评分/限幅（可观测/Evals/Guardrails）→ 反哺。别把功能做成互不相干的孤岛。
2. **能力域分层 = 每个能力域一个家**：Orchestration / Sandboxing / Tool Use / Context Engineering / Observability / Evals / Guardrails。新代码先问"它属哪个域"，进那个域的包（6 包：spec/core/infra/daemon/cli/web），别又摊回多载体。
3. **守黑盒边界（外层 harness）**：token 级压缩、工具 schema 强制、单次 ReAct 委派内层 agent。
4. **event-driven，不中央编排**：多 loop 独立、经 artifact 协调，单 loop 故障不塌全局。
5. **主干即真相**：Done ≡ 已合进 `v3` 分支；退出码不算数，事后对账。
6. **失败要响（fail-loud）**：连续失败 → PAUSE + 记录 + 问 owner；不做静默自愈/自动 fallback 链。
7. **持久优先**：状态从不可变事件流重建，不存独立缓存；写在前、原子 append。
8. **有界且可逆**：一 cycle 一小故事、fresh 上下文、TCR green-or-revert、feature 可整体回退。
9. **反馈带 Goodhart 护栏**：评分信号不自动激活，只生成"待人确认"候选；human-on-the-loop。

## 4. 标准

- **TS**：strict、禁 `any`、函数式、早返回。**类型是层与层之间的契约**——不退回 stdout 文本解析 / heredoc 生成脚本。
- **TCR**：Test → 绿则 commit / 红则 revert。无 WIP commit。提交直进 `v3` 分支（README 裁定 #10）。
- **测试**：单测覆盖每个公共入口；凡有 v2 对应行为的，写 diff-test 断言"TS 输出 == bash 输出"。
- **Git**：不碰 `main`（两仓都是）；不 `--no-verify`；不提交密钥；身份动态读 `git config`。
- **不做**：无关重构、投机抽象、为换语言而改变 v2 可观察行为。

## 5. v2 = 标准答案（diff-test oracle）

`main`（bash v2）是只读快照、行为标准答案。每条迁移 story：先读懂对应 v2 实现的可观察契约（入参/stdout/副作用/退出码/写的文件与事件），TS 版复刻其行为。**行为对齐优先于代码美观。** 写之前先查 `.roll/v3/build/invariants.md` 对应域，把当年的坑当 diff-test/chaos 带走。

新增任何持久化状态前先答 8 问（缺失/并发写/被测试踩/被外部清/版本不兼容/id 不匹配/PID 复用/超时）——答不到五项先别加。

## 6. skills（不重写）

skills 是 markdown + shell，在独立仓 `seanyao/roll-skills`（submodule 挂 `skills/` 原路径），经桥接 `spawn` 调用。**它们是灵魂/契约，不翻成 TS。** clone 后 `skills/` 为空时跑一次 `roll setup` 或 `git submodule update --init --recursive`。

## 7. 与 `.roll/`（嵌套私有仓 roll-meta）

`.roll/` 是独立 git 仓，**非 submodule**。本分支工作期间 roll-meta 同样用 `v3` 分支——backlog/features/notes 改动 `cd .roll` 后 commit+push 到 **v3**（roll-meta main 已冻结且无法上保护，纯纪律守住）。

## 8. 完成 = 上线

backlog 全绿 + 过 `.roll/v3/02-verification.md` 验证门（L1 全绿 + v3 loop 连跑 20 cycle ≥90% + diff-test 对齐）→ 按 `.roll/v3/03-migration.md` P4 翻默认分支，老 bash 留 `v2-final` 一键回滚。
