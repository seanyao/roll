<a id="us-pr-001"></a>
## US-PR-001 `roll review-pr` — agent-agnostic PR 评审命令 📋

**Created**: 2026-05-15
**Plan**: [pr-lifecycle-plan.md](pr-lifecycle-plan.md)
**Peer Review Required**: kimi, pi, gemini（3 次，进入实现前必须全部 AGREE）

- As a maintainer of any Roll-managed project (on GitHub, Gitee, or self-hosted git)
- I want `roll review-pr <number>` to review a PR using whatever AI agent is configured
- So that PR review works identically regardless of git platform or agent choice

**Domain Model:**
- Context: Autonomous Evolution / PR Lifecycle
- Aggregate: `PRReview` — fetches context, renders skill, routes to agent, posts verdict
- Events raised: [PRApproved] / [PRChangesRequested] / [PRReviewUncertain] → `_loop_pr_inbox`

**AC:**
- [ ] `roll review-pr <number>` 命令存在，读取 `_project_agent()` 决定使用哪个 agent
- [ ] 通过 `gh pr view <number> --json title,body,diff` 获取 PR context
- [ ] 创建 temp skill 文件（`mktemp`），将 PR context 注入 `skills/roll-review-pr/SKILL.md` 的占位符（`{{PR_TITLE}}` `{{PR_BODY}}` `{{PR_DIFF}}`）；temp file 在命令结束时清理
- [ ] 调用 `_agent_run_skill`（不改其签名），传入 temp skill 路径
- [ ] 解析 agent 输出的结构化 verdict footer：
  - `<!--VERDICT:APPROVE-->` → `gh pr review <number> --approve`
  - `<!--VERDICT:REQUEST_CHANGES:reason-->` → `gh pr review <number> --request-changes -b "reason"`
  - `<!--VERDICT:UNCERTAIN:reason-->` → 写 ALERT，不提交 review
- [ ] escape hatch：PR body 含 `[skip-ai-review]` → 直接 approve，不调 agent
- [ ] `skills/roll-review-pr/SKILL.md` 存在，包含 3-state 评审指令和 verdict footer 格式说明
- [ ] 单元测试：verdict 解析（APPROVE / REQUEST_CHANGES / UNCERTAIN / skip-ai-review）

**Files:**
- `bin/roll` — 新增 `cmd_review_pr()` + `roll review-pr` dispatcher 入口（+~40 行）
- `skills/roll-review-pr/SKILL.md` ← 新增
- `tests/unit/cmd_review_pr.bats` ← 新增
- `docs/guide/en/loop.md` — 新增 "PR Inbox & Review" 章节（`roll review-pr` 用法、agent-agnostic 说明、escape hatch）
- `docs/guide/zh/loop.md` — 同上，中文版

**Dependencies:**
- Depends on: 无
- Depended on by: US-PR-002, US-PR-003

**Non-goals:**
- 不支持 GHA API mode（`_agent_run_skill` 保持 CLI-only）
- 不处理 fork PR（gh pr view 需要写权限才能 post review；fork PR 静默跳过）

---

<a id="us-pr-002"></a>
## US-PR-002 实现 `_loop_pr_review_external` + `_loop_pr_rebase_stale` 📋

**Created**: 2026-05-15
**Plan**: [pr-lifecycle-plan.md](pr-lifecycle-plan.md)

- As a Roll autonomous loop
- I want external contributor PRs to be reviewed and stale PRs to be rebased automatically
- So that the PR inbox actually does something instead of silently skipping

**Domain Model:**
- Context: Autonomous Evolution / Loop Execution
- Aggregate: `LoopRunner` — fills `_loop_pr_review_external` + `_loop_pr_rebase_stale` hooks

**AC:**
- [ ] `_loop_pr_review_external <number>` 实现：调用 `roll review-pr <number>`（US-PR-001）
- [ ] `_loop_pr_rebase_stale <number> <head_ref>` 实现：
  - `git fetch origin && git rebase origin/main` on the PR branch
  - push 成功 → 写 INFO log，等下一轮 cron 重新评估
  - push 失败（conflict）→ 写 ALERT 含 PR 链接 + "请手动 rebase"
  - fork PR（`head.repo.fork == true`）→ 无写权限，写 ALERT 跳过
- [ ] `_loop_pr_inbox` 中 bot review 检测（来自 Kimi peer review）：
  - 在 verdict 判断前提取 `github-actions[bot]` 的最新 review state
  - APPROVED → `continue`（GHA 已处理，让 auto-merge 推进）
  - CHANGES_REQUESTED → 写 ALERT，`continue`（loop 自有 PR 被打回是高信号事件）
  - `_loop_pr_classify` 签名不变
- [ ] 单元测试：`_loop_pr_review_external` 调用路径；`_loop_pr_rebase_stale` stale/fork/conflict 路径

**Files:**
- `bin/roll` — 实现 `_loop_pr_review_external`（+~10 行）、`_loop_pr_rebase_stale`（+~25 行）、`_loop_pr_inbox` bot 检测（+~10 行）
- `tests/unit/loop_pr_inbox_bot.bats` ← 新增
- `docs/guide/en/loop.md` — 补充 stale PR rebase 行为说明
- `docs/guide/zh/loop.md` — 同上，中文版

**Dependencies:**
- Depends on: US-PR-001
- Depended on by: 无

---

<a id="us-pr-003"></a>
## US-PR-003 GHA optional 加速模板 📋

**Created**: 2026-05-15
**Plan**: [pr-lifecycle-plan.md](pr-lifecycle-plan.md)

- As a maintainer of a GitHub-hosted project managed by Roll
- I want to optionally install a GHA workflow that triggers `roll review-pr` on PR open
- So that contributors get seconds-fast AI feedback instead of waiting up to an hour for the next cron

**Background:**
这是**可选的**加速层，不是 Roll PR review 的必选项。没有此模板，`_loop_pr_review_external`（US-PR-002）在 loop 每轮调度时兜底评审。有了此模板，GitHub 项目可以在 PR 开启时立即触发。模板不包含任何 agent 特定逻辑，只是 `roll review-pr` 的 thin shim。

**Domain Model:**
- Context: GitHub Actions / PR Lifecycle
- Aggregate: `ProjectSetup`（`roll setup` 打印安装提示）

**AC:**
- [ ] `templates/workflows/pr-review-event.yml` 存在，触发条件：`pull_request: [opened, synchronize, reopened]`
- [ ] **无 `branches-ignore: loop/**`**（loop 自有 PR 同样可以触发，虽然 loop_self verdict 会让 loop 跳过，但 GHA 模板可独立评审）
- [ ] job `if:` 条件：`github.event.pull_request.head.repo.fork == false`（fork PR 无写权限，静默跳过）
- [ ] job `if:` 条件包含：`!contains(github.event.pull_request.body, '[skip-ai-review]')`
- [ ] 模板 steps：checkout → 安装 agent CLI（注释说明各 agent 安装方式）→ `roll review-pr ${{ github.event.pull_request.number }}`
- [ ] 模板注释清晰说明：这是可选加速器；没有它 Roll 照常工作（loop 调度兜底）；仅适用 GitHub；fork PR 不支持
- [ ] `roll setup` 末尾提示：如需 GHA 加速，打印安装命令（`cp templates/workflows/pr-review-event.yml .github/workflows/`）
- [ ] 模板中 secrets 注释：只需传配置 agent 对应的一个 API key（不要把所有 agent key 都传入）

**Files:**
- `templates/workflows/pr-review-event.yml` ← 新增
- `bin/roll` — `cmd_setup()` 末尾加安装提示（+~5 行）
- `docs/guide/en/loop.md` — 补充 GHA 可选加速说明（限制、安装方式）
- `docs/guide/zh/loop.md` — 同上，中文版

**Dependencies:**
- Depends on: US-PR-001
- Depended on by: 无

**Non-goals:**
- 不支持 Gitee / self-hosted git（平台专属，超出本 Story 范围）
- 不替换 `claude-code-review.yml` 的 `workflow_dispatch` 模式（两者并存）
