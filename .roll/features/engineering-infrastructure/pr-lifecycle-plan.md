# Plan: Roll PR 生命周期自管理

> 设计决策记录。对应 US-PR-001 / US-PR-002 / US-PR-003。

## 1. 设计原则

### 原则一：Roll 自管理，不委托平台

Roll 的定位是跨项目、跨 agent、跨 git 平台的自治交付工具。PR 生命周期（评审、合并、清理）是 Roll 的核心职责，不应依赖 GitHub Actions、Gitee CI 或任何平台特性。

```
❌ 错误方向：GHA event-driven → anthropics/claude-code-action → Claude 评审
✓ 正确方向：Roll loop → roll review-pr → _project_agent() → 任意 agent 评审
```

GHA 模板可作为**可选加速器**（对 GitHub 用户：事件驱动比 loop 调度更快），但不是必选项，也不是主路径。

### 原则二：面向所有 Roll 管理的项目，不只是 Roll 自身

`roll review-pr` 命令应该能在任何 Roll 管理的项目里工作，不需要特殊配置。

### 原则三：agent-agnostic

`roll review-pr` 通过 `_project_agent()` 读取当前配置的 agent，走 `_agent_run_skill()` 路由，与现有 loop 逻辑完全一致。

---

## 2. 当前 PR 流程诊断

### 已实现 ✅
- `_loop_pr_classify`: 纯函数路由（loop_self / stale / eligible / blocked_*）
- `_loop_pr_inbox`: 编排 open PR 扫描
- `_loop_pr_rebase_circuit`: 24h 熔断器
- loop 自有 PR 设 `--auto-merge`

### 未实现 ❌（空钩子）
- `_loop_pr_review_external`（line 3382）：外部 PR 评审 → 什么都没发生
- `_loop_pr_rebase_stale`（line 3377）：stale PR rebase → 什么都没发生

### 设计缺陷 ⚠️
- `claude-code-review.yml` 是 `workflow_dispatch`（手动），loop 自有 PR 实际只过 CI，无 AI 评审
- 原 US-GHA-002 硬编码 `anthropics/claude-code-action`，违反 agent-agnostic 原则
- 建议的 `branches-ignore: loop/**` 会导致 loop 自有 PR 跳过 GHA 评审，与设计意图相反

---

## 3. 重新设计

### 核心抽象：`roll review-pr <number>`

```
roll review-pr <number>
  │
  ├─ gh pr view <number> --json title,body,diff → PR context
  ├─ _project_agent() → 读 .roll.yaml / ~/.roll/config.yaml
  ├─ render temp skill：将 PR context 注入 roll-review-pr/SKILL.md 占位符
  │    ({{PR_TITLE}}, {{PR_BODY}}, {{PR_DIFF}})
  ├─ _agent_run_skill "roll-review-pr" → 路由到配置的 agent CLI
  │    agent 阅读 context + 指令 → 输出结构化 verdict
  │
  └─ parse verdict footer:
       <!--VERDICT:APPROVE-->        → gh pr review <number> --approve
       <!--VERDICT:REQUEST_CHANGES:msg--> → gh pr review <number> --request-changes
       <!--VERDICT:UNCERTAIN:msg-->   → write ALERT, escalate to human
```

**关键实现细节（来自 Kimi peer review）：**
- `_agent_run_skill` 保持 CLI-only，不加 API path（避免 6 个 HTTP client 的复杂度）
- verdict 用结构化 footer，不解析自由文本（避免 fragile parsing）
- PR context 通过 temp skill 文件注入（`mktemp` + `envsubst` / `sed`），不改 `_agent_run_skill` 签名

### 新 skill：`skills/roll-review-pr/SKILL.md`

```markdown
---
name: roll-review-pr
allowed-tools: Bash(gh:*)
---
# PR Review

You are reviewing a pull request. Context:

**PR Title:** {{PR_TITLE}}
**PR Body:** {{PR_BODY}}

**Diff:**
{{PR_DIFF}}

Review this PR and respond with:
1. Your analysis (free text)
2. A verdict footer on the LAST line:

If code is acceptable: <!--VERDICT:APPROVE-->
If changes are needed: <!--VERDICT:REQUEST_CHANGES:one-line reason-->
If you are uncertain: <!--VERDICT:UNCERTAIN:one-line reason-->

Escape hatch: if PR body contains [skip-ai-review], output <!--VERDICT:APPROVE--> immediately.
```

### 两条触发路径

```
主路径（platform-agnostic，loop 调度）：
  _loop_pr_review_external <number>  ← 现在实现
    → roll review-pr <number>
    → agent CLI（本地，session auth）
    覆盖所有 git 平台（GitHub / Gitee / 自建）

可选加速路径（GitHub 专用）：
  PR opened → pr-review-event.yml（可选安装）
    → npm install -g roll  （或 checkout）
    → roll review-pr $PR_NUM
    → agent CLI（需在 GHA runner 上安装对应 agent CLI）
  优点：秒级响应，不等 loop 下一轮调度
  缺点：GitHub 专属，需额外配置 agent CLI 安装步骤
```

**注意**：GHA 模板不再使用 `anthropics/claude-code-action`，改为调用 `roll review-pr`（agent-agnostic）。GHA 模板是可选的，没有它 Roll 照常工作。

### loop PR 流程修正

```
Before（存在缺陷）：
  loop 开 PR → auto-merge → _loop_pr_classify: loop_self → skip
  → "GitHub 平台处理" → 但 GHA 是手动触发 → PR 只过 CI，无 AI 评审

After（修正后）：
  loop 开 PR → auto-merge 设置
  → 下一轮调度 → _loop_pr_inbox 扫到 loop/* PR
  → 当前：loop_self → skip（不变）

  但外部 PR（eligible）：
  → _loop_pr_review_external → roll review-pr → agent 评审 → 结果
```

**loop 自有 PR 的 AI 评审问题：**

loop_self 目前直接跳过评审，让 GitHub 平台处理——但平台没有配置自动触发。

正确做法有两个选项：
- **选项 A（简单）**：loop_self 维持跳过，依赖 GHA optional template 做评审。只对安装了 GHA 模板的 GitHub 项目有效。
- **选项 B（彻底）**：去掉 `loop_self` 的无条件跳过，改为 loop 也评审自己开的 PR。但存在 same-source bias 问题（loop 写的代码，loop 来评审）。

**推荐选项 A**：loop 自有 PR 走 GHA optional template。外部 PR 走 `_loop_pr_review_external`（无论有没有 GHA）。这样分工清晰，避免 same-source review。

### bot review 与 _loop_pr_inbox 的协作

当 GHA 已经评审过一个 PR（包括 loop 自己的 PR）：

```bash
# _loop_pr_inbox 中，verdict 判断前检测 bot review（来自 Kimi round-1 REFINE）
bot_review=$(echo "$view_json" | jq -r '
  [.reviews[]? | select(.authorAssociation == "BOT" or .author.login == "github-actions[bot]")]
  | last // {} | .state // ""' 2>/dev/null)

if [ "$bot_review" = "APPROVED" ]; then
  i=$((i+1)); continue  # GHA 已 approve，让 auto-merge 推进
fi
if [ "$bot_review" = "CHANGES_REQUESTED" ]; then
  # 写 ALERT（loop 自己的 PR 被打回是高信号事件）
  _loop_write_alert "PR #${num}: bot review CHANGES_REQUESTED — human inspection required"
  i=$((i+1)); continue
fi
# no bot review → proceed to _loop_pr_classify as today
verdict=$(_loop_pr_classify ...)
```

---

## 4. 故事拆分

| Story | 范围 | loop-safe? | 依赖 |
|-------|------|-----------|------|
| US-PR-001 | `roll review-pr` 命令 + `roll-review-pr` SKILL.md | ✅ | — |
| US-PR-002 | 实现 `_loop_pr_review_external` + `_loop_pr_rebase_stale` | ✅ | US-PR-001 |
| US-PR-003 | GHA optional 模板 `pr-review-event.yml`（thin shim） | ✅ | US-PR-001 |

**注意**：原 US-GHA-002 被本设计取代，标记为 🚫 Hold。

---

## 5. Peer Review 要求

本设计在进入实现前需要 **3 次 peer review**（Kimi + PI + Gemini），关注点：

1. `roll review-pr` 在 GHA runner 上安装 agent CLI 的可行性（各 agent CLI 是否有 npm/apt 安装路径）
2. temp skill 渲染机制（`mktemp` + `envsubst`）是否与现有 `_agent_run_skill` 兼容
3. 选项 A（loop_self 跳过，依赖 GHA）vs 选项 B（loop 也评审自己 PR）的 tradeoff
4. `_loop_pr_rebase_stale` 实现策略（push 权限、fork PR 限制）

---

## 6. 决策记录

| 决策 | 日期 | 理由 |
|------|------|------|
| Roll 自管理 PR 生命周期，不委托 GHA | 2026-05-15 | agent-agnostic + platform-agnostic 原则；GitHub/Gitee/自建 git 均需支持 |
| `_agent_run_skill` 保持 CLI-only | 2026-05-15 | Kimi peer review：加 API path = 6 个 HTTP client，复杂度不值得 |
| verdict 用结构化 footer | 2026-05-15 | Kimi peer review：自由文本解析 fragile；footer 明确可 grep |
| temp skill 渲染注入 PR context | 2026-05-15 | Kimi peer review：不改 _agent_run_skill 签名 |
| GHA 模板降级为可选加速器 | 2026-05-15 | PI peer review：Roll 应 own full lifecycle；GHA 只是 optional accelerator |
| loop_self：维持跳过（选项 A） | 2026-05-15 | 避免 same-source bias；loop 自有 PR 依赖 GHA optional template 评审 |
| 原 US-GHA-002 废弃 | 2026-05-15 | 设计违反 agent-agnostic 原则，被本方案取代 |
