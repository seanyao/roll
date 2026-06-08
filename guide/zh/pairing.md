# 跨 Agent 结对 —— 在 loop 里自动获得异构的第二双眼睛

结对让一个**不同**的 agent（不同厂商）自动复检你的工作。它的 primitive 是
**结对（pair）**而非评审：一个 agent 干完活，一个异构搭档复检，换来视角多样性。
一个模型盲区里藏着的 bug，另一个模型往往一眼看到。

结对与 [`roll peer`](peer.md) 不同：peer 是你（或 loop 风险闸）按需发起的多轮协商；
结对是常驻的单向第二遍，接在 cycle 里，由一份显式配置文件管控。

## 开启 —— 显式，绝不静默

```bash
roll pair init        # 从已安装的 agent 物化 .roll/pairing.yaml
```

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

`roll pair init` 幂等：不会覆盖你的修改（用 `roll pair init --force` 才重新生成）。

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

## 阶段

`code` 是经过验证的默认——异构搭档复检交付的改动。`design`、`test`、`cycle`
把同一套机制扩到其它检查点；想要更早或更广的第二双眼睛时在 `stages` 里开启。
