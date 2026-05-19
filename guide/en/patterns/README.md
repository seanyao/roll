> Mirror of the original Chinese source — English translation pending. See IDEA-NNN for translation status.

# Roll 接入模式（Patterns）

> 三种把 Roll 引入项目的标准姿势。基于项目所处的生命周期阶段与团队风险偏好选择。

## 三种 pattern 速览

| Pattern | 中文 | 起点 | 比喻 |
|---------|------|------|------|
| [seed-pattern](./seed-pattern.md) | 播种 | 空目录 + 愿景 | 处女地播种 |
| [graft-pattern](./graft-pattern.md) | 嫁接 | 仍在演化的现有项目 | 砧木上嫁接接穗 |
| [replant-pattern](./replant-pattern.md) | 翻种 | 累积过多债的现有项目 | 连根拔起栽新苗 |

## 决策树

```
你的项目处于哪个状态？
    │
    ├── 还没开始 / 只有一个 idea
    │       └──→ seed-pattern
    │
    └── 已有代码
            │
            ├── 项目仍在快速演化、不能停 → graft-pattern
            ├── 团队想小步试水 Roll      → graft-pattern
            ├── 代码量 < 1000 行         → graft-pattern（先嫁接，需要时再 replant）
            │
            ├── 累积包袱重、想清债       → replant-pattern
            ├── 想借机做架构跃迁         → replant-pattern
            └── 现有版本可冷藏           → replant-pattern（必要前提）
```

## 三种 pattern 的核心精神对比

| 维度 | seed | graft | replant |
|------|-----------|-------|---------|
| 对原架构 | 不存在 | 零侵入保留 | 推翻 |
| 可逆性 | — | 高（`rm -rf .roll/`） | 低（发布后） |
| 风险 | 低 | 低 | 高 |
| 上限 | 高 | 中 | 高 |
| 启动门槛 | 中（要写 spec） | 低 | 高 |
| 典型周期 | 持续演化 | 持续演化 | 一次性工程 |

## 共通要素

无论选哪个 pattern，三者都共享同一个 `.roll/` 目录约定：

```
.roll/
├── backlog.md       项目管理入口
├── specs/           设计权威（PRD / Architecture / DDD）
├── features/        Story 详情
├── briefs/  dream/  Roll 自动产出
├── decisions/       ADR
└── state/           运行时中间产物
```

差别在于 **`.roll/` 是怎么诞生的**：
- seed：人手写 specs + backlog
- graft：`$roll-onboard` 从现有项目反推后落盘
- replant：先反推到 `roll-rev/`，精炼后写入 `.roll/specs/`

## 选错了怎么办

三种 pattern 之间存在迁移路径：

| 从 | 到 | 可行？ |
|----|----|-------|
| graft | replant | ✓ 任何时候都可以"升级"为重建 |
| graft | seed | ✗ 项目已存在，不能假装没有 |
| replant | graft | ✓ 反推后发现不必重建，退回嫁接 |
| seed | graft | 不适用（seed 已经是从零起步） |
| seed | replant | ✓ 项目跑一段时间后决定重建 |

最常见的真实路径：**graft 起步 → 跑半年 → 决定 replant 清债**。这是最稳健的演进路线。
