# Roll v3 — Agent 操作手册

> **`main` 即 v3：roll 的引擎是 TypeScript（`packages/`），bash 留作回落与 oracle。**
> **`main` is v3: the engine is TypeScript (`packages/`); bash stays as the fallback + oracle.**
> 按"反馈闭环 + 能力域分层"收敛。给在本仓干活的 agent / loop 读。v2 归档在 `v2` 分支（锚点 tag `v2-freeze-2026-06-04`）。
> 规格依据：`.roll/v3/README.md`（包地图 + 冲突裁定表）；每 story 纪律：`.roll/v3/build/prompts/p2-build-cycle.md`。

## 0. 这是什么（一句话）

roll 是一个**按反馈闭环设计的 agent harness**：把 LLM agent 当黑盒，用反馈闭环优化对它的控制力。本分支把这台控制器从散落的 bash/skill/py/配置，收敛成 TS 分层系统。

## 1. 当前桥接状态（随每条命令迁移增量更新）

| 范围 | 状态 |
|---|---|
| **走 TS** | `status` · `agent list` · `config`（全面 TS，US-PORT-006：读面 + 写面 + 三个紧凑 facade（loop-window/loop-schedule/dream-time），无 bash 回落；**有意分歧（白名单）**：config 写入不再隐式重挂 launchd（应用新调度走 `roll loop on`，facade 仍打印该提示），CLI 输出与 v2 逐字节一致；并修复 v2 `_config_resolve` 在全局 config.yaml 缺失时的 `set -u` 未绑定变量崩溃）· `prices`（show/help）· `backlog`（显示）· `loop status` · `loop run-once`（v3 runner，含 --dry-run）· `dream run-once`（US-PORT-008：dream 服务 v3 心脏——解析 roll-.dream skill 并就地起 agent 扫描，无 worktree/无 TCR；找不到 skill 即 fail-loud 不盲开 agent）· `loop on|off|pause|resume`（US-LOOP-009 调度面：`on` 生成 v3 自包含 runner——wrapper 直调 run-once；**有意分歧（白名单）**：弃 v2 tmux 外/内层与引擎 source；US-PORT-008 起 dream 服务也由 `on` 生成 v3 自包含 runner（同形：PATH 引导 + PAUSE marker + 直调 `roll dream run-once`，每日调度），退役 FIX-197 的断链僵尸 runner；含 v2 小时窗 printf 八进制潜伏 bug 修复）· `loop eval` · `loop story` · `loop runs`（含 --all/--detail）· `loop signals`（US-PORT-007：四个读面薄读取，eval/story 复用 dashboard cycle 管线、runs 直读 runs.jsonl、signals 走 core detectSignals，无 bash 回落）· `loop monitor` / `loop attach`（US-PORT-007 退役：v3 runner 已把每周期跑进 tmux session roll-loop-<slug>，两者改为单语重定向 stub，不再跑 v2 tmux 弹窗）· `lang` · `skills` · `alert` · `doctor` · `changelog`（确定性：generate --no-ai/--json/--write、help、未知；默认 AI 润色仍回落 bash）· `consistency` · `feedback` · `init`（确定性脚手架 + roll-init.py v2 UI 原生重写；legacy onboard / --apply / 未知 -flag / 无模板回落 bash）· `offboard` · `migrate` · `setup`（全 6 步管线 + roll-setup.py v2 UI 原生重写；仅"无 conventions 源"守卫回落 bash）· `update`（npm/curl 双升级路径 + 缓存失效 + post-update setup 链 + changelog；npm/curl/tar 经 spawn，curl 原子目录 swap 是唯一白名单缺口）· `test`（隔离派发器：仅 type=none，--where 路由 / --reset 锁+派发 / 默认 exec 经 forward 的 npm test 跑宿主；未知类型（含残留 tart 配置，REFACTOR-046 已删该 lane）显式报错 exit 1，绝不静默回落宿主；help 与 unknown-exec 清单为白名单分歧）· `ci`（读面：gh 缺失 warn / 非 git 仓 err / run-list 失败 / 无记录提示 / 逐 run 状态列表；--wait CI gate 的 _ci_wait 轮询回落 bash）· `slides`（渲染器 + 校验器原生重写，逐字节对齐冻结 python oracle：build / list / preview / logs / templates / delete --force / help / 派发；`new` 走 AI agent 生成 deck → 回落 bash，交互式 `delete` 确认 → 回落 bash） |
| 其余子命令 | **bash 回落**（经 `@roll/cli` 桥接，stdio/退出码透传） |
| 引擎 | ✅ 第 0-4 层 100%（地基 5 + CLI 7 + 领域服务 13 + infra 6 + loop 8）；**US-LOOP-006 真实并行验证 3/3 PASS**（v2 done ≡ v3 delivered，真 claude 双腿）；941+ TS 测试全绿，diff-test 逐字节对齐冻结 oracle |
| ⚠️ v2 已知线上缺陷 | claude CLI ≥2.1.x 的 `--add-dir` 变长参数吞掉 v2 拼在末尾的 prompt → v2 loop 的 claude cycle 必败（并行验证钓出）。v2 冻结不修；v3 已修（prompt 绑 -p，白名单分歧） |
| i18n | ✅ `@roll/spec` t()/resolveLang + v2 全量 catalog 582 keys，en/zh diff-test 绿 |
| `skills/` | git submodule → seanyao/roll-skills |

> 每 port 完一条命令，把它从上表挪进「走 TS」行——只改相关行，不大改。

## 2. 沟通

- 用用户语言回答；代码/git/注释用英文；UI 输出跟随多语言设置（locale 单语呈现，不混排）。
- 简洁，讲结果（outcome），不复述实现、不走查代码。
- 自然、同事口吻；成功失败一致的温度。

## 3. 架构不变量（动手前必须守）

1. **反馈闭环是脊柱**：核心作动（编排）→ 控制平面传感/评分/限幅（可观测/Evals/Guardrails）→ 反哺。别把功能做成互不相干的孤岛。
2. **能力域分层 = 每个能力域一个家**：Orchestration / Sandboxing / Tool Use / Context Engineering / Observability / Evals / Guardrails。新代码先问"它属哪个域"，进那个域的包（6 包：spec/core/infra/daemon/cli/web），别又摊回多载体。
3. **守黑盒边界（外层 harness）**：token 级压缩、工具 schema 强制、单次 ReAct 委派内层 agent。
4. **event-driven，不中央编排**：多 loop 独立、经 artifact 协调，单 loop 故障不塌全局。
5. **主干即真相**：Done ≡ 已合进 `main` 分支；退出码不算数，事后对账。
6. **失败要响（fail-loud）**：连续失败 → PAUSE + 记录 + 问 owner；不做静默自愈/自动 fallback 链。
7. **持久优先**：状态从不可变事件流重建，不存独立缓存；写在前、原子 append。
8. **有界且可逆**：一 cycle 一小故事、fresh 上下文、TCR green-or-revert、feature 可整体回退。
9. **反馈带 Goodhart 护栏**：评分信号不自动激活，只生成"待人确认"候选；human-on-the-loop。

## 4. 标准

- **TS**：strict、禁 `any`、函数式、早返回。**类型是层与层之间的契约**——不退回 stdout 文本解析 / heredoc 生成脚本。
- **TCR**：Test → 绿则 commit / 红则 revert。无 WIP commit。
- **测试**：单测覆盖每个公共入口；凡有 v2 对应行为的，写 diff-test 断言"TS 输出 == bash 输出"。
- **Git**：`main` 走 PR + 2 checks（fix/feat/refactor 一律建分支）；不碰 `v2` 归档分支；不 `--no-verify`；不提交密钥；身份动态读 `git config`。
- **不做**：无关重构、投机抽象、为换语言而改变 v2 可观察行为。

## 5. v2 = 标准答案（diff-test oracle）

`v2` 分支（bash v2，锚点 tag `v2-freeze-2026-06-04`）是只读快照、行为标准答案；同一份 bash 也在本仓的 `bin/roll` 内随回落引擎一起发布。bats 套件已随 US-CUT-002 整体退役（diff-test 是现行守护；v2 分支仍保有当年的 bats 全量）。每条迁移 story：先读懂对应 v2 实现的可观察契约（入参/stdout/副作用/退出码/写的文件与事件），TS 版复刻其行为。**行为对齐优先于代码美观。** 写之前先查 `.roll/v3/build/invariants.md` 对应域，把当年的坑当 diff-test/chaos 带走。

新增任何持久化状态前先答 8 问（缺失/并发写/被测试踩/被外部清/版本不兼容/id 不匹配/PID 复用/超时）——答不到五项先别加。

## 6. skills（不重写）

skills 是 markdown + shell，在独立仓 `seanyao/roll-skills`（submodule 挂 `skills/` 原路径），经桥接 `spawn` 调用。**它们是灵魂/契约，不翻成 TS。** clone 后 `skills/` 为空时跑一次 `roll setup` 或 `git submodule update --init --recursive`。

## 7. 与 `.roll/`（嵌套私有仓 roll-meta）

`.roll/` 是独立私有 git 仓（`seanyao/roll-meta`），**非 submodule**。roll-meta 与本仓同步翻车：它的 `main` 现在是实时 backlog——backlog/features/notes 改动 `cd .roll` 后 commit+push 到 **main**。

## 8. 完成 = 上线

`main` 已是默认分支，`@seanyao/roll` 发 TS-first CLI（v3.0.0 起）。v2 在 `v2` 分支（锚点 tag `v2-freeze-2026-06-04`）留一键回滚。剩余子命令继续按表迁移；迁完后 bats 退役、`bin/roll` 仍作回落保留。
