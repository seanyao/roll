> Mirror of the original Chinese source — English translation pending. See IDEA-NNN for translation status.

# Replant Pattern — Legacy 项目的"翻种"路径

> Roll 三种接入模式之一。另见 [graft-pattern.md](./graft-pattern.md)、[seed-pattern.md](./seed-pattern.md)。
>
> **核心精神：以现有产品为靶子，反推规格、有意识精炼、连根拔起栽新苗。**

## 何时选这个 pattern

适合：
- 现有项目累积包袱太重，重构成本 > 重建成本
- 想借机做一次有意识的架构跃迁（去掉冗余、调整边界、统一约定）
- 团队有能力维持"新旧并行"一段时间
- 现有项目的**测试套件足够完整**（这是反推规格的契约层）

不适合：
- 现有项目还在快速演化（重建期间会持续漂移）
- 测试覆盖率低（反推的规格会丢掉隐性约束）
- 团队不能停下新功能开发

## 目录结构

```
project-builder/                       构建 v2.0 的工程项目
│
├── project-v1.0/                     ⓪ 原料：v1.x 完整 snapshot（只读参照物）
│   └── (按某个 tag 冻结，不随主线演化)
│
├── project-rev/                      ① 粗料：从 v1.0 反推的草稿
│   ├── prd-draft.md
│   ├── architecture-draft.md
│   ├── ddd-draft.md
│   └── us-list-draft.md
│
├── .roll/                            ② 工坊 meta（管理"构建 v2.0"这个项目）
│   ├── backlog.md
│   ├── specs/                         ← 精炼后的 v2.0 权威规格
│   │   ├── prd.md
│   │   ├── architecture.md
│   │   └── ddd.md
│   ├── features/                      每条 Story 详情
│   └── decisions/                     构建过程中的 ADR
│
└── project-v2.0/                     ③ 产物：v2.0 真身（loop 增量构建出来）
    └── (bin/ lib/ ...)
```

## 数据流

```
v1.0 源码 ──反推──→ project-rev/（粗料）
                       │
                       ▼ 精炼（保留 / 丢弃 / 新增 / 重塑）
                   .roll/specs/（设计权威）
                       │
                       ▼ Loop 按 .roll/backlog 增量构建
                   project-v2.0/（产物）
                       │
                       ▼ 发布
                   覆盖 origin 仓库 @ 2.0.0
```

## 三层数据各自的角色

| 层 | 数据性质 | 写一次还是反复改 |
|----|---------|----------------|
| `project-v1.0/` | 不可变 snapshot | 只读 |
| `project-rev/` | AI 反推产物，反映"v1.0 实际行为" | 写一次，后续可补丁但不大改 |
| `.roll/specs/` | 人工精炼后的 v2.0 蓝图 | **反复迭代**，是设计权威 |
| `project-v2.0/` | Loop 按 specs 增量构建的代码 | Story 推进时增长 |

**关键洞察：`project-rev/` → `.roll/specs/` 不是简单 copy，是一次有意识的设计跃迁。**

这是真正去掉 v1.0 累积包袱的窗口。粗料保留下来作为对照组（v2.0 发布时随产物归档到 `project-v2.0/.roll/specs/origins/`，作为历史档案）。

## 执行步骤

1. **冻结 v1.0**：选定 tag/commit，复制源码到 `project-v1.0/`，标注版本号
2. **反推粗料**：AI 读 v1.0 源码 + 测试，产出 `project-rev/` 下的草稿
3. **精炼规格**：人工 review 粗料，做出"保留 / 丢弃 / 新增 / 重塑"的决策，产出 `.roll/specs/`
4. **拆解 Story**：基于 specs 写 `.roll/backlog.md`，按依赖顺序
5. **Loop 构建**：在 `project-v2.0/` 下增量造，Story 实现时引用 `.roll/specs/` 作为权威
6. **对照校验**：每条 Story 完成后用 v1.0 测试套验证 v2.0（如果测试可移植）
7. **发布**：v2.0 满足验收后覆盖 origin 仓库，发布主版本号

## 早停门

| 检查点 | 通过判据 | 不通过怎么办 |
|-------|---------|------------|
| Day 1 后 | PRD 对 v1.0 artifact 覆盖率 ≥ 90% | < 70% 停下来：项目行为已超出"可声明为产品"的范畴 |
| 第一批 Story 后 | v2.0 行为与 v1.0 一致率 ≥ 80% | < 80% 停下来：分析 gap 来自反推漏项还是 v1.0 偶然行为 |

任一门没过 → 切换到 [graft-pattern](./graft-pattern.md)，承认这个项目不适合重建。

## 与其他 pattern 的对比

| 维度 | replant-pattern | graft-pattern | seed-pattern |
|------|----------------|---------------|--------------|
| 对原架构的态度 | 推翻重建 | 保留并嫁接 | 无原架构（从零） |
| 风险 | 高（隐性知识丢失） | 低（不动原码） | 低 |
| 上限 | 高（彻底清债） | 中（仍受历史约束） | 高（无包袱起步） |
| 适用 | 累积包袱重、可冷藏老版本 | 仍在演化、不可停下来 | 新项目、从 idea 阶段 |
| 工作量 | 大（造一个新的） | 小（接入工具链） | 中（先写 spec 再 loop） |

## 实例：Roll 自身

Roll 项目自己用这个 pattern 从 v1.x 重建到 v2.0：
- `roll-builder/roll-v1.0/` ← v2026.518.4 snapshot
- `roll-builder/roll-rev/` ← Claude 反推的 PRD/Arch/DDD/US 草稿
- `roll-builder/.roll/specs/` ← 精炼后的 v2.0 设计权威
- `roll-builder/roll-v2.0/` ← Loop 增量构建的 v2.0 产物，发布到 `seanyao/roll`

这是 Roll 的"自我重塑"工程，也是 replant-pattern 的 reference implementation。
