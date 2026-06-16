# 跨 Agent 结对 —— 在 loop 里自动获得异构的第二双眼睛

结对让一个**不同**的 agent（不同厂商）自动复检你的工作。它的 primitive 是
**结对（pair）**而非评审：一个 agent 干完活，一个异构搭档复检，换来视角多样性。
一个模型盲区里藏着的 bug，另一个模型往往一眼看到。

结对与 [`roll peer`](peer.md) 不同：peer 是你（或 loop 风险闸）按需发起的多轮协商；
结对是常驻的单向第二遍，接在 cycle 里，由一份显式配置文件管控。

## 开启 —— 显式，绝不静默

```bash
# 新项目：无需操作——`roll init` 已经帮你生成。
# 现有项目：一条命令补上。
roll pair init        # 从已安装的 agent 物化 .roll/pairing.yaml
```

- **新项目**：`roll init` 会顺带生成 `.roll/pairing.yaml`（界面会告知）——无需单独一步。
- **现有 roll 项目**：直接跑 `roll pair init` 即可，这是最精准最小的命令——**不用**重跑完整
  `roll init`（那还会 re-merge 约定，给 pairing 用是杀鸡用牛刀）。

两条路生成的文件完全一致（同一套脚手架逻辑）；`roll pair init` 幂等（已有 pairing.yaml
不会覆盖，要重生成才加 `--force`）。

这是"默认隐式开"和"纯手写 opt-in"之间的第三条路：命令从 `roll agents list`
**生成**一份显式、可审计的 `.roll/pairing.yaml`，把每个默认值都写进文件（而非藏在
代码里的隐式默认）。**文件存在与否就是开关**——在=开，删掉=关。结对绝不静默触发。

```yaml
# .roll/pairing.yaml —— 自动生成，可自由编辑
enabled: true
stages: [code]
capability:
  claude: [code]
  codex: [code]
  kimi: [code]
```

- `enabled` —— 总开关。只有装了至少两个**不同厂商**时 `roll pair init` 才置 `true`
  （否则没有异构搭档可配）。
- `stages` —— 哪些生命周期阶段触发结对：`design`、`test`、`code`、`cycle`，
  每个可独立关闭，默认仅 `code`。
- `capability` —— 每个 agent 被声明能复检的阶段。声明会与 registry 交叉校验，
  乱写的名字会被拒绝。

## 看它做了什么 —— 可观测性

```bash
roll pair status
```

显示结对池（谁能结对、其厂商、被声明的能力，以及某个 agent**因何被排除**），
外加**结对花了多少钱**：

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

某阶段触发时，选择器**只**保留：已安装、可用、被声明能做该阶段、且与干活 agent
**不同厂商**的——然后在其中轮换（以 cycle id 为种子，可复现）。有战绩的搭档会被
温和偏好（ε-greedy，ε≈0.2），但始终保留探索，任何一对都不会垄断。若没有合格的
异构搭档，这个"没有"本身也会被记录（`pair:none-available`）——绝不静默跳过。

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
- **手动**：`roll pair score <story-id> --summary "<交付摘要>"` 在一个全新会话里走同一适配器。
- **独立性看会话，不看厂商**：同厂全新会话是最低可接受档；不同 agent+model+会话
  （非子 agent）更鼓励。任何与 builder 共享会话的打分——包括其子 agent——都被判为自评而拒收。
  无异构候选、超时或协议不符时**不会**回落成自评；缺席通过 `pair:none-available`
  事件留痕，该 story 仍欠一份全新会话的 Review Score 才能 attest（`review_score_missing`）。
