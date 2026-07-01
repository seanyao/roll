# Roll — Agent 池与角色选派

> US-AGENT-049 — Roll 从同一个开放的 agent 池中为 Designer、Builder、Evaluator 和 Peer Reviewer 选派角色，按能力、健康状态和成本排序，而不是按品牌或提供商标识进行宽泛封禁。

## 开放池角色选派

Roll 不会因为品牌、提供商或当前 Supervisor 的身份而拒绝 talent。四个选派角色默认从同一个已安装 agent 池中产生，除非 owner 策略显式缩小范围：

- `designer` — 规划与拆分工作（对应 scope 角色 `supervise`）。
- `builder` — 实现 story 与 fix（对应 scope 角色 `execute`）。
- `evaluator` — 在独立会话中评分与评审（对应 scope 角色 `evaluate`）。
- `peer_reviewer` — 对高风险变更进行交叉检查。

## 健康感知排序

当角色绑定使用 `strategy: health-aware` 时，Roll 会对所有候选 agent 排序并解释选择：

```yaml
schema: roll-agents/v1
scope: project
inherits: machine

defaults:
  story:
    roles:
      execute:
        kind: select
        from: [codex, kimi, pi, reasonix, agy, claude]
        require: [execute]
        strategy: health-aware
```

排序器综合考虑：

- 角色能力标签（`canExecute`、`canReview`、`canScore`）
- 观察到的健康信号（`auth`、`timeout`、`parser`、`no_tcr`、`publish`、`cost`）
- 近期结果（success / failure / gave_up）
- 成本档位
- story 风险

被降级的 agent 仍会出现在候选列表中，但不会仅因为"最久未用"就被排在健康的 Builder 前面。

## 查看选派结果

```bash
roll supervisor route --role builder --story US-XXX
roll supervisor route --role builder --story US-XXX --json
```

示例输出：

```text
builder candidates:
  kimi      score  82  eligible · healthy · strong builder · can builder
  pi        score  74  eligible · healthy · good evaluator/build candidate · can builder
  codex     score  72  eligible · healthy · fresh-session capable · can builder
  reasonix  score  61  eligible · healthy · cheap · weaker Builder reliability on broad UI/workflow cards · can builder
  claude    score  55  eligible · healthy · capable generalist · high cost · can builder
  agy       score  25  not eligible · auth degraded · can build · can builder
selected: kimi
```

## 会话独立性

角色独立性通过新会话 ID 和 artifact 交接来强制执行，而不是通过排除同一品牌或提供商。即使允许同品牌独立会话，Builder 也不能通过自己的同一会话来满足 Evaluator 闸门。

## 恢复

被阻塞的 agent 在成功探测或一次新的成功周期后会重新进入正常排序。如果所有候选 agent 都处于降级状态，Roll 会 fail-loud，而不是静默选择一个被阻塞的 agent。
