---
hidden: true
name: cnx-spar
description: Adversarial TDD mode with Attacker/Defender agents. Attacker writes tests to break the system, Defender writes minimal code to pass. Use for high-risk logic like auth, payments, data integrity, or complex state machines.
---

# Spar

对抗式 TDD：两个 Agent 攻守协同，推动系统构建更稳固。

## When to Use

**手动触发：**
- 用户明确要求 `$cnx-spar`
- 涉及核心业务逻辑，需要更高质量保证

**自动触发（agent 判断）：** 满足任一条件时建议启用
- 涉及认证/权限/安全
- 涉及金钱/支付/计费
- 涉及数据完整性（写入后不可逆）
- 复杂状态机 / 并发逻辑
- 之前出过 bug 的模块（BACKLOG 有相关 FIX 记录）

**不要用于：**
- UI 样式调整、文案修改
- 简单 CRUD
- 配置变更
- 工作量不值得两个 agent 协同的小任务

## Roles

### Attacker (Red Agent)

**目标：找到代码的弱点，写出能让系统挂掉的测试。**

- 思考边界条件、异常输入、并发场景、状态不一致
- 写出尽可能刁钻的测试用例
- 不关心实现难度，只关心"这个场景系统扛得住吗"
- 每轮至少写 1 个 RED test，可以写多个

### Defender (Green Agent)

**目标：用最简洁、最健壮的代码让所有测试通过。**

- 不能修改 Attacker 写的测试（除非测试本身有 bug）
- 追求最小实现，不过度设计
- 每轮让所有测试 GREEN，然后 commit
- 可以重构，但必须保持 GREEN

## Workflow

```
User: "$cnx-spar 实现转账逻辑" 或 agent 自动判断启用
    │
    ▼
┌─────────────────────────────────────┐
│ 0. Setup                            │
│    - 明确功能范围和 AC               │
│    - 创建测试文件骨架                │
│    - Attacker 和 Defender 各自的     │
│      context brief                   │
└─────────────┬───────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│ Spar Loop (重复直到收敛)            │
│                                     │
│  ┌───────────────────────────────┐  │
│  │ 🔴 Attacker Turn             │  │
│  │    - 分析当前代码/接口        │  │
│  │    - 写 1+ 个 RED test       │  │
│  │    - 说明攻击意图:            │  │
│  │      "测试并发转账时余额一致性" │  │
│  └──────────────┬────────────────┘  │
│                 │                    │
│                 ▼                    │
│  ┌───────────────────────────────┐  │
│  │ 🟢 Defender Turn             │  │
│  │    - 读 Attacker 的测试      │  │
│  │    - 写最小代码让测试通过     │  │
│  │    - 跑全部测试 → GREEN      │  │
│  │    - git commit              │  │
│  └──────────────┬────────────────┘  │
│                 │                    │
│                 ▼                    │
│  ┌───────────────────────────────┐  │
│  │ 🔴 Attacker Turn (again)     │  │
│  │    - 审视 Defender 的实现     │  │
│  │    - 找新弱点，写新 RED test  │  │
│  │    - 或者: "找不到新弱点了"   │  │
│  └──────────────┬────────────────┘  │
│                 │                    │
│        ┌────────┴────────┐          │
│        │                 │          │
│   有新 test         无新 test       │
│   → 继续循环        → 退出 Spar     │
│                                     │
└─────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│ Wrap-up                             │
│    - Attacker 总结攻击覆盖面        │
│    - Defender 总结防御策略           │
│    - 合并报告                       │
│    - 继续正常 story-build 流程      │
│      (push → CI → deploy → verify)  │
└─────────────────────────────────────┘
```

## Spar 收敛条件

Attacker 宣布结束的条件（满足任一）：
- 连续 2 轮写不出新的 RED test
- 已覆盖: happy path + 边界值 + 异常输入 + 并发/竞态 + 状态一致性
- 达到约定的最大轮次（默认 5 轮）

## Agent Context Brief

### Attacker Brief Template

```markdown
## Role: Attacker (Red Agent)

你的目标是找到这段代码的弱点。

### 功能描述
{功能的 AC 和接口定义}

### 当前实现
{Defender 最新的代码，或"尚未实现"}

### 已有测试
{当前已存在的测试用例}

### 你的任务
写出 1+ 个新的测试用例，让当前实现失败（RED）。
思考方向：
- 边界值（0, -1, MAX_INT, 空字符串, null）
- 异常流（网络断开, 超时, 重复请求）
- 并发（两个请求同时到达）
- 状态一致性（中途失败后系统状态是否干净）

### 输出格式
每个测试说明攻击意图:
  "攻击: {场景描述} — 预期系统应该 {期望行为}"
```

### Defender Brief Template

```markdown
## Role: Defender (Green Agent)

你的目标是让所有测试通过，用最简洁的实现。

### 功能描述
{功能的 AC 和接口定义}

### 当前代码
{你之前写的代码，或空}

### 新增的 RED tests
{Attacker 这轮写的测试}

### 你的任务
修改/新增代码，让所有测试（包括之前的）通过。
规则：
- 不能修改 Attacker 写的测试
- 追求最小改动
- 保持代码清晰
- 所有测试 GREEN 后 commit
```

## Status Report

每轮结束向用户报告：

```
⚔️ Spar Round {N}

  🔴 Attacker:
     攻击: {场景1} — {结果}
     攻击: {场景2} — {结果}

  🟢 Defender:
     防御策略: {简述怎么防的}
     测试状态: {通过数}/{总数} ✅

  📊 累计: {总测试数} tests, {总轮次} rounds
  🔄 下一轮: Attacker 继续寻找弱点...
```

## Hard Rules

1. **Attacker 不写实现代码** — 只写测试和攻击分析
2. **Defender 不改测试** — 除非测试本身有 bug（需说明理由）
3. **每轮必须 commit** — Defender 让测试 GREEN 后立即 commit，保持仓库干净
4. **攻击意图必须说明** — 不能只写测试不解释"为什么这个场景重要"
5. **最大轮次限制** — 默认 5 轮，防止无限循环

## Integration with story-build

Spar 替代 story-build 中的 step 4-5（Test Design + TCR Implementation）：

```
story-build 正常流程:
  1. Clarify Story
  2. Split Actions
  3. Define verification
  ──────────────────────
  4. Test Design Review    ← Spar 替代这步
  5. TCR Implementation    ← 和这步
  ──────────────────────
  6. Local CI check        ← 回到正常流程
  7. Quality Review
  ...
```

**从 story-build 自动切入 Spar：**

当 agent 在 step 3 评估 Action 为高风险时：
```
⚔️ 检测到高风险 Action: {描述}
   风险因素: {认证/支付/数据完整性/...}
   建议启用 Spar 模式 — 确认？ [Y/n]
```

用户确认后进入 Spar，完成后回到 story-build step 6 继续。

## Example

```
User: "$cnx-spar 实现用户余额转账"

⚔️ Spar: 用户余额转账

── Round 1 ──

🔴 Attacker:
   攻击 1: 转账金额为 0 — 应拒绝
   攻击 2: 转账金额为负数 — 应拒绝
   攻击 3: 转账金额超过余额 — 应拒绝并保持余额不变

🟢 Defender:
   实现: transfer(from, to, amount) 基础校验
   测试: 3/3 ✅
   commit: "tcr: transfer basic validation"

── Round 2 ──

🔴 Attacker:
   攻击 4: 转账给自己 — 应拒绝
   攻击 5: 两个并发转账，总额超过余额 — 只应成功一个

🟢 Defender:
   实现: 加 self-transfer 检查 + 乐观锁
   测试: 5/5 ✅
   commit: "tcr: transfer self-check and concurrency lock"

── Round 3 ──

🔴 Attacker:
   攻击 6: 转账中途数据库异常 — 双方余额应不变（原子性）
   攻击 7: 收款方账户不存在 — 应拒绝并保持发送方余额

🟢 Defender:
   实现: 数据库事务包裹 + 收款方存在性检查
   测试: 7/7 ✅
   commit: "tcr: transfer atomicity and recipient validation"

── Round 4 ──

🔴 Attacker:
   找不到新弱点了。已覆盖: 输入校验、自转账、并发、原子性、关联账户。

⚔️ Spar Complete!
   📊 4 rounds, 7 tests, 3 commits
   🔴 攻击覆盖: 输入边界 + 业务规则 + 并发 + 原子性
   🟢 防御策略: 前置校验 + 乐观锁 + 事务
```
