# Agent Compliance

> Epic: Engineering Infrastructure
> 用机械校验替代软规则，物理拦截 agent 绕过 TCR 的作弊路径。
> 来源：GitHub Issues #16、#17（zhangyaxuan，2026-05-13）

---

<a id="us-infra-006"></a>
## US-INFRA-006 Test runner 写 proof-of-pass 📋

**Created**: 2026-05-13

- As a developer enforcing TCR
- I want the test runner to record a proof-of-pass after each successful run
- So that a pre-commit hook can verify tests were run on exactly the code being committed

**Domain Model:**
- Context: Engineering Infrastructure
- Aggregate: TCR Enforcement
- Events raised: [TestsPassed] → `.roll/last-test-pass` written

**Background:**
Issue #17 显示 Kimi 将所有代码写完后事后拆 commit 伪造 TCR。
软规则（AGENTS.md）无法拦截，需要机械校验。
本 Story 是校验链路的数据源。

**AC:**
- [ ] `tests/run.sh` 全量通过后，写入 `.roll/last-test-pass`，格式：
  ```json
  {"ts": <unix-epoch-seconds>, "tree": "<git-write-tree-output>"}
  ```
  `tree` 为写入时刻的 working tree hash（`git write-tree`），用于对齐"测试的代码 == 提交的代码"
- [ ] 测试失败时不写入（或删除已有文件）
- [ ] `.roll/last-test-pass` 加入 `.gitignore`，不进版本库
- [ ] `tests/run.sh` 保持 set -euo pipefail 兼容，写入失败不影响测试退出码

**Files:**
- `tests/run.sh`
- `.gitignore`

**Dependencies:**
- Depended on by: US-INFRA-007

---

<a id="us-infra-007"></a>
## US-INFRA-007 Pre-commit hook 验证 proof-of-pass 📋

**Created**: 2026-05-13

- As a developer enforcing TCR
- I want a pre-commit hook that blocks commits unless tests just passed on the exact same code
- So that no agent can commit code that hasn't been verified by the test suite

**Domain Model:**
- Context: Engineering Infrastructure
- Aggregate: TCR Enforcement
- Events raised: [CommitBlocked] → agent must run `npm test` first

**AC:**
- [ ] 新建 `hooks/pre-commit`（纳入版本库），校验两个条件：
  1. `.roll/last-test-pass` 的 `ts` 在 60 秒内（测试刚跑过）
  2. `.roll/last-test-pass` 的 `tree` == 当前 `git write-tree`（测试的是同一份代码）
- [ ] 任一条件不满足时，输出清晰错误并以非零退出码拒绝 commit：
  ```
  ✗ Commit blocked: tests not verified on current code.
  ✗ 提交被拒绝：当前代码未经测试验证。
  Run: npm test
  ```
- [ ] hook 本身不执行任何测试（毫秒级，不影响 TCR 节奏）
- [ ] 项目根加 `git config core.hooksPath hooks`，使 hook 对所有 agent 生效（在 README 或 AGENTS.md 中注明需执行此配置）
- [ ] `hooks/pre-commit` 有可执行权限（chmod +x）

**Files:**
- `hooks/pre-commit`（新建目录 + 文件）
- `AGENTS.md`（加一行：初始化项目需执行 `git config core.hooksPath hooks`）

**Dependencies:**
- Depends on: US-INFRA-006
