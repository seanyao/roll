# 跨 Agent 结对 —— 在 loop 里自动获得异构的第二双眼睛

结对让一个**不同**的 agent（不同厂商）自动复检你的工作。它的 primitive 是
**结对（pair）**而非评审：一个 agent 干完活，一个异构搭档复检，换来视角多样性。
一个模型盲区里藏着的 bug，另一个模型往往一眼看到。

Roll 把评审指派看成 scoped Agent 模型里的 `evaluate` 角色：
`Scope -> Role -> Binding -> Agent -> optional Model`。agent 是有限的七个身份
（`claude`、`kimi`、`codex`、`pi`、`agy`、`reasonix`、`cursor`）；model 是挂在该 agent 上的可选数据。

结对与 [`$roll-peer`](peer.md) 不同：peer 是你（或 loop 风险闸）按需发起的多轮协商；
结对是常驻的单向第二遍，接在 cycle 里，由 Project Scope 的 `evaluate` binding 管控。

## 开启 —— 显式，绝不静默

```bash
roll agent                         # 查看 story.evaluate
roll agent migrate --dry-run       # 预览旧 agent 配置的一次性迁移
```

新项目应在 `.roll/agents.yaml` 里声明 evaluator pool：

```yaml
# .roll/agents.yaml
schema: roll-agents/v1
scope: project
defaults:
  story:
    roles:
      evaluate:
        kind: select
        from: [claude, codex, kimi, pi, agy, reasonix]
        require: [evaluate]
        strategy: health-aware
```

`.roll/pairing.yaml` 不再是运行时输入；scoped `evaluate` role 是结对候选的唯一来源。
静态配置列公平候选，auth/network/VPN/account 等运行时失败只在本次 resolution 中跳过候选。

## 看它做了什么 —— 可观测性

Loop cycle evidence 和角色视图会显示结对池（谁能结对、其厂商、被声明的能力，
以及某个 agent**因何被排除**），外加**结对花了多少钱**：

```
  Cross-Agent Pairing — pool status / 结对池状态

  enabled: true · stages: [code]

    ✓ claude  vendor=anthropic · [code]
    ✓ codex   vendor=openai · [code]
    · pi      vendor=pi · [code] · excluded: no heterogeneous partner

  pairings to date: 7 (codex×4, kimi×3) · total cost $0.94 · 11 findings
```

成本从第一天起每次结对都记账——即使还没做预算自适应，你也始终知道这第二双眼睛
花了多少。

## 选择逻辑

某阶段触发时，选择器**只**保留：已安装、可用、被声明能做该阶段、能作为 headless
reviewer 运行，且与干活 agent **不同厂商**的——然后在其中轮换（以 cycle id 为种子，
可复现）。有战绩的搭档会被温和偏好（ε-greedy，ε≈0.2），但始终保留探索，任何一对都
不会垄断。若没有合格的异构搭档，这个"没有"本身也会被记录（`pair:none-available`）——
绝不静默跳过。

## 安全 —— 结对绝不阻塞 cycle

- 对复检设 **30 秒硬超时**（executor 里双保险），慢搭档绝不拖死 cycle。
- **不阻塞**：超时、出错或无搭档都只记录，cycle 照常推进。结对是增强，不是闸。
- **绝不自行动主干**：结对只产证据和事件，不做合并。

## 事件与证据

每次结对先发 `pair:selected`，再发 `pair:verdict`（含裁定、发现数、成本、阶段）
或 `pair:none-available`。裁定同时作为证据写入本轮的 `peer/cycle-<id>.pair.json`。
评分结对发 `pair:score`（分数、裁定、成本），证据写入
`peer/cycle-<id>.score.pair.json`。

## 阶段

`code` 和 `score` 是默认——异构搭档复检交付的改动，另一位给完成的 cycle 打分。
`design`、`test`、`cycle` 把同一套机制扩到其它检查点；想要更早或更广的第二双
眼睛时在 `stages` 里开启。

## Review Score —— 同行打分，绝不让作者给自己打分

agent 给自己的交付打分是利益冲突，所以质量评分（**Review Score**）一律由
**全新独立会话**里的 Reviewer 产出，绝不由工作 agent 自评：

- **loop 内**：验收闸通过后，runner 拉起一个全新会话的 Reviewer 给交付打分。
  note 落在卡片 `notes/` 目录，带溯源——`scoring: pair`、`scored-by: <agent>`
  以及全新会话 id（独立性可核验）。
- **Loop 交付**：验收闸通过后，runner 在全新会话里触发同一适配器。
- **设计产出**（`roll-design`，无 loop cycle）：设计工作流可以触发全新会话的 Reviewer
  评**设计**质量（INVEST 拆分、可视 AC 完整、`deliverable_url` 正确、领域/spec 一致），
  而非代码；记为 `stage=design`。设计 agent 只触发、绝不给自己打分；无可用评审则诚实
  标记未评审（fail-loud），绝不合成自评。
- **只要装了别的 agent，builder 的本体 agent 绝不给自己的 cycle 打分**：此时 builder 被
  整个排除出打分池——要么由独立 Evaluator 评分，要么 fail-loud（即便同厂全新会话也不回落成自评）。
  只有真正的单 agent 安装里，builder 的本体 agent 才是评分者，此时同厂全新会话是最低可接受档。
  独立性仍按 session id 核验（更鼓励不同 `agent × model × session` rig），所以单 agent 场景不会死锁。
  任何与 builder 共享会话的打分——包括其子 agent——都被判为自评而拒收。
  无独立候选、超时或协议不符时**不会**回落成自评；缺席通过 `pair:none-available`
  事件留痕，该 story 仍欠一份全新会话的 Review Score 才能 attest（`review_score_missing`）。
- **真实 agent 输出会先归一化再评分**：Evaluator 回复中夹带终端控制字节、ANSI 启动横幅、
  JSONL stream-json 外壳或 bullet/markdown 前缀都能被接受——解析器先归一化，再严格要求一段完整、
  有序的 `SCORE`/`VERDICT`/`RATIONALE` 块（分数 1..10、合法 verdict）。仅在散文里提到这些标记的仍会被拒。
- **重复出现的最终块若一致也会被容忍**：有的 Evaluator 会重绘终端（最终块出现两次），或先打印
  回复模板和分析、再给出真正的块。解析器只取**最终可用块**，并在所有合法 `SCORE` 行一致、所有合法
  `VERDICT` 行一致时采信——重绘属于已确定的同一答案。真正冲突的重复块（分数或 verdict 不同）、
  模板 `<占位符>` 回声、越界分数、不支持的 verdict 仍会被拒。
- **拒收有可观测的具体原因，而非笼统报错**：回复未被采信时，cycle 记录的是具体原因而非一句
  “unparseable”。`roll loop cycle <id> --roles` 会区分 Evaluator 是**返回了类分数文本但未被采信**
  （如重复块冲突、缺字段）还是**完全没返回任何分数内容**，并在角色行上标出确切原因。
