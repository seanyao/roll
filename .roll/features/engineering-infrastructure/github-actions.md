<a id="us-gha-001"></a>
## US-GHA-001 Claude GitHub Actions — PR Assistant 和 Code Review 自动化工作流 ✅

**Created**: 2026-05-10
**Completed**: 2026-05-10 (PR #8)

- As a Roll project maintainer
- I want Claude to automatically review PRs via GitHub Actions
- So that code quality gates are enforced without manual intervention

**AC:**
- [x] `claude-code-review.yml` 工作流存在并可通过 `workflow_dispatch` 触发
- [x] workflow 调用 `anthropics/claude-code-action` 完成评审
- [x] 评审结果写入 PR comment
