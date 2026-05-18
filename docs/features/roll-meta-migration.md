# Feature: Roll-Meta Migration (Phase 2)

> Part of Epic: Legacy Project Onboarding + 项目管理剥离
> Design doc: [docs/design/legacy-onboard-epic.md](../design/legacy-onboard-epic.md) §3 两阶段模型
> Depends on: US-ONBOARD-005 (Roll self-migrate to `.roll/` first)

## Background

Phase 1（US-ONBOARD-001 至 005）把 Roll 自身的过程文件搬进 `.roll/`，是阶段性目标。
最终图景是产品代码和项目管理完全分仓：

- `seanyao/roll` (public) — 只剩产品：bin/ guide/ site/ conventions/ skills/ tests/
- `seanyao/roll-meta` (private) — 所有过程：backlog/proposals/features/briefs/dream/design/domain

用户项目不受影响，`.roll/` 仍是它们的永久住所。

## US-ONBOARD-011: Roll 自身 `.roll/` 迁入 roll-meta

Lift Roll's `.roll/` contents into the `roll-meta` private repository.

**Acceptance Criteria:**

### 内容迁移
- [ ] Roll 仓库的 `.roll/` 目录全部内容（backlog.md, proposals.md, features/, briefs/, dream/, design/, domain/, verification/, state/）迁入 roll-meta
- [ ] roll-meta 现有内容（`BACKLOG.md`, `decisions/`, `features/upstream-watch*`）与 Roll 的内容合并，无文件名冲突
- [ ] roll-meta 内部目录结构按 `.roll/` 约定重组（如 `BACKLOG.md` → `backlog.md`，`decisions/` → 与 `proposals.md` 整合）
- [ ] Roll 仓库 `.roll/` 目录删除，git 历史保留（不做 history rewrite）

### 工具链协作
- [ ] `roll loop` 能从 roll-meta 读取 BACKLOG（认 roll-meta 为 SOT）
- [ ] `$roll-build`/`$roll-fix` 写完成状态时回写到 roll-meta（不是 Roll 仓库）
- [ ] `roll-brief`/`roll-.dream` 写产出到 roll-meta，不污染 Roll 仓库工作区
- [ ] `roll backlog`/`roll alert` 等读取命令的来源切换到 roll-meta

### 配置与认证
- [ ] `~/.roll/config.yaml` 支持声明 `meta_repo: seanyao/roll-meta`
- [ ] 私有仓库访问通过用户已配置的 `gh` 凭证完成，不引入新的 token 流程
- [ ] 用户未配置 `meta_repo` 时，回退到 in-repo `.roll/`（保持向后兼容）
- [ ] 公开 contributors 看不到 backlog/dream 等敏感内容，但能正常 build/test/PR

### 验证
- [ ] Roll 仓库 CI 全绿（测试不依赖 in-repo backlog）
- [ ] roll-meta 仓库可以独立 sync（`gh repo clone` + 读取就能看到完整项目状态）
- [ ] 一轮完整 loop cycle 在新架构下跑通：领取 story → build → PR → merge → 状态回写 roll-meta
- [ ] 用户项目（即非 Roll 自身的项目）行为完全不受影响，`.roll/` 仍是本地永久目录

## 设计未定项（Story 开工前需先讨论）

下列问题在 Story 自己的设计阶段解决，不阻塞 US 进入 BACKLOG：

1. **跨仓库读写一致性**：loop 在 worktree 里跑时，BACKLOG 读自 roll-meta，story 完成提交是回写 roll-meta 还是 Roll 仓库？建议两边都写（Roll 提交代码，roll-meta 提交状态），但分支策略需明确。

2. **roll-meta 现有结构的重组方案**：roll-meta 现有 `BACKLOG.md`（大写）、`decisions/`、`features/upstream-watch*`，与 Roll 的 `.roll/` 内容如何合并？建议在 Story 开工前出一份 dry-run 映射表。

3. **CI 对 backlog 的依赖**：当前 `release.sh`、`roll-.changelog`、features.md 校验都依赖 in-repo BACKLOG。CI 是否要 clone roll-meta？还是把这些校验挪到 roll-meta 的 CI？

4. **Phase 2 完成后 `.roll/` 在 Roll 仓库的去向**：完全删除？还是保留 `.roll/state/`（loop 运行时状态，project-local）？建议保留 state，删除持久数据。
