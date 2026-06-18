# roll peer — 结构化外部评审

`roll peer` 通过与 goal-mode 终审相同的结构化 adapter，运行一次外部 provider
reviewer。它是 TS-native 命令，不会回退到已退役的 bash peer surface。

需要 agent 工作流里的多轮协商协议时，用 `$roll-peer`。需要从 Claude、Codex、
Kimi、Pi 或其它已安装外部 CLI 留下一条耐久的一次性 reviewer fact 时，用
`roll peer`。

## 命令参考

```bash
roll peer --reviewer codex --prompt "Review this plan and return VERDICT/REASON/FINDING lines"
roll peer --reviewer kimi --file /tmp/review-prompt.md --json
roll peer --worker claude --mode hetero --file /tmp/final-review.md
roll peer --mode self --reviewer claude --prompt "Self-check this evidence"
roll peer --timeout-ms 300000 --reviewer pi --file /tmp/review.md
```

参数：

| 参数 | 含义 |
|------|------|
| `--reviewer <agent>` | 直接指定 reviewer。 |
| `--worker <agent>` | 用于异构选择的工作 agent；默认取当前项目配置的 agent。 |
| `--mode auto` | 按排序依次尝试异构 reviewer；全部异构候选失败后才降级为同 provider self review。 |
| `--mode hetero` | 必须不同 provider；不可用时写 `ERROR` fact。 |
| `--mode self` | 允许同 provider review。 |
| `--prompt <text>` | 内联 prompt 文本。 |
| `--file <path>` | 从文件读取 prompt。 |
| `--json` | 将结构化 reviewer fact 打印为 JSON。 |
| `--timeout-ms <ms>` | 单次 review 超时；默认 180000 ms。 |

Reviewer 输出必须包含且只包含一行 verdict：

```text
VERDICT: APPROVE|REQUEST_CHANGES
REASON: <short reason>
FINDING: <concrete issue>
```

verdict 行缺失或出现多行时，adapter 保守判为 `REQUEST_CHANGES`。

## 记录的事实

每次运行都会向这里追加一行 JSON：

```text
.roll/peer/runs.jsonl
```

如果 reviewer 进程产生了输出，transcript 也会写到：

```text
.roll/peer/transcripts/
```

记录字段包括 reviewer agent、provider、command family、verdict、reason、
findings、timeout/error 状态、耗时、transcript 路径和 evidence 路径。
goal-mode 终审会在 `goal:final_review` 事件上写入同一组事实字段。

## 外部 reviewer 与辅助 subagent

`roll peer` 面向外部 provider reviewer CLI。Codex 内部 subagent 可以辅助并行分析，
但不等同于外部 peer review。adapter 会把 `codex-subagent:*` / `subagent:*`
身份视为 auxiliary，排除在异构 reviewer 选择之外。

## 与 pairing 的关系

`roll pair` 是构建期 gate：自主 cycle 中风险较高的交付 diff 会被异构 peer 复查，
并写入 cycle 证据。`roll peer` 是操作员命令和可复用 adapter，用于一次性结构化
review。两者共享 provider 多样性原则，但服务的 workflow 不同。
