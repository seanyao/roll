# roll-.dream — 夜间代码健康巡检

`roll-.dream` 是每晚自动运行的代码巡检技能，扫描代码库中的架构摩擦、死代码和技术债。
它由 launchd 在凌晨 3 点触发（通过 `roll loop on` 安装），
并将发现的问题以 `REFACTOR-NNN` 条目的形式追加到 BACKLOG.md，等待 loop 执行。

## Dream 做什么

每晚 dream 完整扫描一次代码库，输出两份结果：

1. **`docs/dream/YYYY-MM-DD.md`** — 中文详细报告（每晚一个文件）
2. **BACKLOG.md 条目** — 可操作的 `REFACTOR-NNN` 条目追加到 `## ♻️ Refactor` 表格

报告覆盖以下方面：

- 死代码和未使用函数
- 跨模块的重复逻辑
- 模块边界违反（一个关注点泄漏到另一个模块）
- 已上线功能缺少测试
- 文档覆盖度缺口（缺 EN/ZH 指南、过时引用）

## 如何读 Dream 报告

```bash
# 查看最近 3 次报告
ls -lt docs/dream/ | head -4

# 读取最新报告
cat docs/dream/$(ls -1t docs/dream/ | head -1)
```

每个报告章节末尾有优先级分类：

- **P0** — 阻碍其他工作，本迭代内处理
- **P1** — 显著摩擦，2 周内处理
- **P2** — 低优先级，有空时处理

## REFACTOR 条目生成

发现具体可操作的问题时，dream 向 BACKLOG.md 追加一行：

```markdown
| REFACTOR-005 | 提取 _for_each_ai_tool() — 4 处重复的迭代逻辑 | 📋 Todo |
```

Loop 按正常优先级处理这些条目（晚于 FIX-XXX，与 US-XXX 并列）。

Dream **不会**生成 REFACTOR 条目的场景：
- 修复需要超过 1 天（改为追加为 IDEA）
- 纯粹的风格偏好问题
- BACKLOG 中已有对应 US 或 FIX 条目的问题

## 调度配置

Dream 默认在凌晨 3 点运行。在 `~/.roll/config.yaml` 中配置：

```yaml
loop:
  loop_dream_hour: 3     # 0-23
  loop_dream_minute: 10  # 0-59
```

`roll loop on` 会同时安装 loop、dream、brief 三个 plist。
三个服务统一管理：

```bash
roll loop on       # 安装三个服务
roll loop status   # 查看三个服务的状态
roll loop monitor  # 三个服务的实时监控台
```

## 手动触发

无需等到凌晨 3 点，随时可以手动跑一次 dream 巡检：

```bash
# 在 Claude Code 里直接调用
$roll-.dream
```

Dream 每次运行写入当天日期的文件，并追加到 BACKLOG.md。
同一天运行两次是安全的（只是产生第二次追加，不会覆盖）。
