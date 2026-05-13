# Agent Compliance

> Epic: Engineering Infrastructure
> 确保所有 AI Agent（尤其 Kimi CLI）严格遵循 TCR 节奏和 Roll 执行纪律。
> 来源：GitHub Issues #16、#17（zhangyaxuan，2026-05-13）

---

<a id="us-infra-006"></a>
## US-INFRA-006 AGENTS.md 执行纪律加固 📋

**Created**: 2026-05-13

- As a project maintainer
- I want agent convention files to include explicit stop conditions and non-negotiable TCR rules
- So that any AI agent working on this project cannot bypass the workflow without violating a written constraint

**Domain Model:**
- Context: Engineering Infrastructure
- Aggregate: Agent Convention
- Events raised: [ConventionViolationDetected] → agent must stop

**Background:**
GitHub Issue #17 报告 Kimi 将所有代码一次性写完后事后拆 commit 伪造 TCR；
Issue #16 指出当前 AGENTS.md 有约束规则但缺乏"违反则停止"的明确指令。

**AC:**
- [ ] `AGENTS.md`（项目根）Workflow 节增加「执行纪律」子节，包含：
  - 开工前：AC 明确 + design doc 存在，否则 **停止**
  - TCR 强制：每个 micro-step 必须在 green 后立即 commit，不允许 working tree 积压多步改动
  - 禁止：未通过 `npm test` 提交；禁止事后拆 commit
  - 完工必须：同步更新 `BACKLOG.md` 和 `docs/features/` 对应文件，缺一不可
- [ ] `conventions/global/AGENTS.md`（分发模板）同步加入相同纪律节，确保下游项目也受约束

**Files:**
- `AGENTS.md`
- `conventions/global/AGENTS.md`

**Dependencies:**
- Triggered by: GitHub Issues #16, #17
- Related: US-INFRA-007

---

<a id="us-infra-007"></a>
## US-INFRA-007 创建 .kimi/AGENTS.md — Kimi 专属前置执行规则 📋

**Created**: 2026-05-13

- As a project maintainer
- I want a .kimi/AGENTS.md that Kimi CLI reads with priority
- So that Kimi receives stricter pre-flight checks and cannot skip TCR without violating a written rule

**Domain Model:**
- Context: Engineering Infrastructure
- Aggregate: Agent Convention
- Events raised: [KimiPreflightFailed] → agent must stop and ask user

**Background:**
Kimi CLI 优先读取项目中的 `.kimi/AGENTS.md`。当前该文件不存在，
意味着 Kimi 缺乏项目级强制约束，只读全局配置。

**AC:**
- [ ] 创建 `.kimi/AGENTS.md`，包含：
  - 开工三步自检：① 读 `BACKLOG.md` 找当前 US → ② 读 `docs/features/*.md` 确认 AC 完整 → ③ AC 有歧义则停止并问用户
  - 每次 action 前：列出将修改的文件（≤5 个）+ 测试策略，等用户确认后才写代码
  - TCR checklist：Test → Green → `git commit -m "tcr: ..."` / Red → `git checkout -- .` → 重新设计；不允许 working tree 积压多步改动
  - 禁止行为清单：未经用户确认写代码 / 事后拆 commit / 跳过 `npm test` / 一个 commit 混入多个 US 改动

**Files:**
- `.kimi/AGENTS.md`（新建）

**Dependencies:**
- Triggered by: GitHub Issues #16, #17
- Related: US-INFRA-006
