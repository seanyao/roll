# $roll-peer — 结构化外部评审

`$roll-peer` 通过与 goal-mode 终审相同的结构化 adapter 运行外部 provider
reviewer。旧的顶层 peer CLI 已退役；需要这个能力时，在 agent 工作流里调用 skill。

需要多轮协商协议，或需要从 Claude、Codex、Kimi、Pi 等已安装外部 CLI 记录 durable
reviewer fact 时，使用 `$roll-peer`。

## Prompt 形状

```text
$roll-peer
Review this plan and return VERDICT / REASON / FINDING lines.
```

Reviewer 输出必须包含且只包含一行 verdict：

```text
VERDICT: APPROVE|REQUEST_CHANGES
REASON: <short reason>
FINDING: <concrete issue>
```

verdict 行缺失或出现多行时，adapter 保守判为 `REQUEST_CHANGES`。

## 记录的事实

每次采信的 review 都会向这里追加一行 JSON：

```text
.roll/peer/runs.jsonl
```

如果 reviewer 进程产生了输出，transcript 也会写到：

```text
.roll/peer/transcripts/
```

记录字段包括 reviewer agent、provider、command family、verdict、reason、
findings、timeout/error 状态、耗时、transcript 路径和 evidence 路径。goal-mode
终审会在 `goal:final_review` 事件上写入同一组事实字段。

## 解析失败

当 reviewer 或 scorer 在 autonomous cycle 里跑了，但输出**无法解析**时，这次尝试
不会被悄悄丢弃。原始尝试会被捕获到 `.roll/loop/peer/` 下，该 agent 在 cycle
角色阵容里显示 `failed`，带 `cause` 和 `raw artifact:` 指针。

读法见 [Cycle 角色可观测](./loop.md#cycle-角色可观测)，排障步骤见
[排障：无法解析的 score/review](../../docs/live-console.md#故障排查)。

## 外部 reviewer 与辅助 subagent

`$roll-peer` 面向外部 provider reviewer CLI。Codex 内部 subagent 可以辅助并行分析，
但不等同于外部 peer review。adapter 会把 `codex-subagent:*` / `subagent:*` 身份视为
auxiliary，排除在异构 reviewer 选择之外。

## 与 pairing 的关系

Loop pairing 是构建期 gate：自主 cycle 中风险较高的交付 diff 会被异构 peer 复查，
并写入 cycle 证据。`$roll-peer` 是 agent 调用的结构化外部评审 skill。两者共享
provider 多样性原则，但服务不同工作流。
