# Phase 1 Execution Plan — Legacy Onboard Epic

> 设计文档见 [legacy-onboard-epic.md](./legacy-onboard-epic.md)。本文件是 Phase 1 的**执行级**计划：目标、步骤、验收、约束、风险、决策。
>
> 本文件随 Story 推进**持续更新**（不是 immutable 设计文档）。

## 1. 最终愿景

让 Roll 成为：
- **对外**：Legacy 项目能干净接入（graft / replant 两条路），新项目能 seed 起步
- **对内**：自身完成产品/过程分离，结构清晰、可持续维护

## 2. 本 Epic 范围（Phase 1）

只做两件事：

> **A. Roll 自身把过程文件从根级 / `docs/` 抽取进 `.roll/`（dogfood）**
> **B. 给用户提供 `roll migrate` 和 `$roll-onboard` 两个对外能力**

**明确不在本 Epic 范围：**
- Phase 2：把 Roll 的 `.roll/` lift 到 roll-meta（US-ONBOARD-011 已 deferred）
- 任何 rebuild / replant 实验
- 跨仓库工具链协作设计
- 三种 pattern 文档已在 `seanyao/roll-meta/patterns/` 持久化，不在本 Epic 再造

## 3. 关键决策（已确认）

| # | 问题 | 决策 |
|---|------|------|
| Q1 | v2 分支何时合 main | **一次性 merge**——所有 Story 完成后作为单个原子 breaking event |
| Q2 | npm publish 2.0 时机 | **先 1.x deprecation 版 → 等 N 天 → 2.0**——给用户缓冲期 |
| Q3 | 主线 v1.x 演化 | 用户暂停主线非紧急工作。已有 commit 已 rebase 进 v2 分支 |
| Q4 | GitHub 改名 Roll→roll 时机 | **与 npm publish 2.0 同步**——一个 breaking event |
| Q5 | Roll 自身 `.roll/` 是否 .gitignore | **暂时不进**。Phase 2 时整体搬走到 roll-meta |

## 4. 当前状态

- 分支：`worktree-legacy-onboard-epic` @ rebased on top of `origin/main`
- 工作区：`~/Workspace/roll-v2/roll/`
- Epic setup 已 commit（设计文档 + ADR + Feature specs + BACKLOG entries）
- 主线 v1.x loop 状态：用户将暂停
- roll-meta 已有 3 个 pattern 文档（seed / graft / replant）

## 5. Story 执行清单

| # | Story | 状态 | 依赖 |
|---|-------|------|------|
| 001 | `.roll/` 目录约定 | ✅ Done（设计文档 + ADR-001 承载） | — |
| 002 | 路径引用全量审查（产出 `path-audit.md`） | ✅ Done（464 字面引用 + 20 变量化 + 15 special cases，2 个 ambiguity 已决议） | 001 |
| 003 | `roll migrate` 命令实现（dry-run + git mv + 三态幂等） | 📋 | 002 |
| 004 | 结构强制检测 + 全局命令豁免 | 📋 | 003 |
| 005 | Roll 自身 dogfood migrate（真正的"抽取 .roll/"动作）| 📋 | 003, 004 |
| 006 | Legacy 检测 + Agent 引导 | 📋 | 001 |
| 007 | `onboard-plan.yaml` schema + Python 校验 | 📋 | 001 |
| 008 | `$roll-onboard` 交互技能 | 📋 | 001, 007 |
| 009 | `roll init --apply`（含 .gitignore 写入） | 📋 | 001, 002, 007 |
| 010 | 迁移指南 + 用户文档 | 📋 | 005 |
| 011 | Roll `.roll/` → roll-meta（Phase 2） | ⏸ Deferred | 005 |

**硬阻塞约束：** Story 002 完成前禁止动 `bin/roll` / `tests/` / `skills/` 等代码——所有路径修改必须基于 `path-audit.md`。

## 6. 执行约束

| 约束 | 来源 |
|------|------|
| 代码暂不 commit | 用户 2026-05-19 directive |
| 本地测试必须通过 | 用户 2026-05-19 directive："至少保证本地可以通" |
| 不 push v2 分支 | 用户多次确认"不要合并主分支" |
| 文档可以 commit | 推断（仅"代码"不提交） |
| `.roll/` 自包含约束 | ADR-001 |
| 全局命令豁免 | Kimi peer review accepted |
| Python 做 plan 校验 | Kimi peer review accepted |
| `generated_at` 24h 过期 | Kimi peer review accepted |

## 7. 验收标准

### 7.1 Roll 自身（dogfood）
- [ ] Roll 仓库迁移到 `.roll/` 结构，`docs/` 目录消失
- [ ] `bin/roll` / skills / tests / conventions / templates 所有路径引用更新
- [ ] CI 全绿（`npm test` 通过）
- [ ] `.roll/` 内容自包含，无外向相对路径
- [ ] AGENTS.md §8 重写匹配新结构
- [ ] GitHub 仓库名从 `Roll` 改为 `roll`
- [ ] `package.json` 版本升到 2.0.0

### 7.2 对外能力
- [ ] 真实 Legacy 项目（≥10 源文件、无 AGENTS.md）执行 `roll init` 引导进入 onboard
- [ ] `roll init` 列出本机已装 AI agent + token 告知
- [ ] `$roll-onboard` 三组九问 ≤ 3 分钟完成
- [ ] `roll init --apply` 按 plan 落盘 `.roll/`
- [ ] `roll migrate` 三态幂等（仅老 / 仅新 / 并存）
- [ ] 新版 Roll 在老结构项目上拒绝运行 + 引导 migrate
- [ ] `setup`/`update`/`version`/`help`/`init`（空目录）在任何结构下都能跑
- [ ] 用户拒绝任一 onboard 选项 → 对应文件不生成
- [ ] `rm -rf .roll/` 项目恢复原状

### 7.3 用户卫生
- [ ] 1.x 最后版本含 deprecation 提示（"2.0 将要求 .roll/，请阅读迁移指南"）
- [ ] 老用户不主动升级，1.x 永远可用

## 8. 风险记录

| 风险 | 严重度 | 缓解 |
|------|-------|------|
| Path audit 漏掉变量化路径 → CI 红 | 高 | Story 2 AC 显式要求手动 review 动态路径构造 |
| 三组九问 UX 设计跑偏 | 中 | Story 8 实现后用真实 Legacy 项目试跑 |
| 老用户升级踩坑 | 中 | 1.x deprecation + 迁移指南 (US-ONBOARD-010) |
| Phase 2 deferred 太久变成永久搁置 | 低 | 可接受——Phase 1 已足够价值 |
| 主线 v1.x 与 v2 分支漂移 | 中 | 用户暂停主线；如必须改，每次 rebase 进 v2 |
| Loop 在 main 上跑出新代码污染 v2 | 中 | 用户已确认暂停 loop on main |
| 本地测试 baseline 不全绿（cmd_init 等约 57 个失败）| 中 | **2026-05-19 发现，与 v2 工作无关——main 上同样失败**。可能与本地 ENV / submodule 状态有关，需要单独排查；Story 003+ 改代码前要先解决，否则无法用本地测试验收 |

## 9. 下一步动作

1. 用户在 main 上完成 2 个 pending FIX（loop / `$roll-fix` / 手动均可）
2. FIX 合入 main 后，在 v2 worktree 执行 `git fetch origin && git rebase origin/main` 同步基线
3. 用户暂停 main 上的 loop
4. 标 US-ONBOARD-001 为 Done（设计文档已承载）
5. 开始 US-ONBOARD-002：路径引用全量审查，产出 `path-audit.md`

## 10. 推进节奏

每个 Story 完成后：
- 本地跑 `npm test` 验证全绿
- 更新本文件 §5 的 Story 状态
- 不 commit 代码（用户决定何时统一 commit）
- 简短记录踩到的坑（如有）到 §8 风险记录
- 停下等用户 review 后再进入下一 Story
