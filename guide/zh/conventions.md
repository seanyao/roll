# Roll — 约定与 AGENTS.md

Roll 的约定系统让每个 AI Agent 对你的项目有相同的共识——领域模型、编码规范和文档导航。

## AGENTS.md

`AGENTS.md` 是主约定文件，定义：

- **领域模型**：限界上下文、聚合、核心实体
- **编码规范**：语言惯用法、命名、禁止模式
- **作用域规则**：Agent 允许修改的文件范围
- **Where to Look**：关键文档和目录的命名指针
- **Goal-Driven Execution**：要求 Agent 在行动前定义可验证目标

Roll 在 `roll init` 时写入 `AGENTS.md` 骨架，你来填写项目特有的领域模型和规范。

## Goal-Driven Execution 规则

每个 Agent 在开始工作前必须定义可验证目标：

```
Verifiable Goal: <一句话，可判断真假>
Success Criteria: <可衡量的完成标准>
```

这避免了模糊执行（"重构 auth 模块"），强制 Agent 说清楚"完成"是什么样。Roll 的技能在每个故事开始时强制执行此规则。

## Where to Look

`AGENTS.md` 导航段将概念名映射到文件路径：

```markdown
## Where to Look

| 概念 | 位置 |
|------|------|
| 领域模型 | `docs/domain/` |
| Feature 规格 | `docs/features/<name>.md` |
| 用户指南 | `docs/guide/` |
| 测试辅助函数 | `tests/unit/helpers.bash` |
```

`$roll-design` 在新增文档和目录时维护此表。任何进入项目的 Agent 无需扫描整棵树就能导航到权威来源。

## 存量项目：`$roll-doc`

对于文档散落、没有 `AGENTS.md` 的项目：

```bash
$roll-doc
```

`roll-doc` 扫描代码库，推断领域结构，写入带导航表的 `AGENTS.md`，并标记文档缺口（缺少架构文档、未记录的公开 API）供 `$roll-build` 补全。

## 全局约定

`~/.roll/conventions/global/` 中的文件由 `roll setup` 和 `roll sync` 同步到每个 AI 工具的配置目录。修改全局约定后，下次 sync 时自动传播到所有项目。

## 另见

- [project-setup.md](project-setup.md) — `roll init` 创建 AGENTS.md
- [overview.md](overview.md) — 三层模型（人 / BACKLOG / 自主）
