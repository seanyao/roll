# Roll — Changelog

Roll 自动保持 `CHANGELOG.md` 同步，无需手动编写或更新。

## 工作原理

1. `$roll-build`（或 `$roll-fix`）交付故事并暂存 `CHANGELOG.md`。
2. 故事完成提交中包含 `CHANGELOG.md`——不产生单独的 changelog commit。
3. 发版时，Roll 的发布流程将 `## Unreleased` 重命名为版本标签。

## 写什么内容

`$roll-.changelog` 技能读取 `BACKLOG.md`，为每个完成的故事或修复写一条 bullet，只保留用户可见的变化：

**写入：**
- 用户可直接调用的新命令
- 用户能感知到的 bug 修复
- 可见的体验变化（布局、输出、速度）
- 安装、升级、配置相关的改动

**跳过：**
- 内部重构
- 测试基础设施
- 只有开发者会遇到的 bug 修复
- 实现细节

技能内置风格守门——bullet 必须简洁、白话、面向用户。技术黑话会触发重写循环。

## 可发版的两种形态

`roll release` 认两种"changelog 就绪"形态：顶部 `## Unreleased` 段且有条目，**或**预写好的下一版本段（`## v3.608.1 — 2026-06-08`，版本号比 package.json 当前新）——后者正是发布流程自己的惯例。首段版本等于当前版本意味着全部已发完。

```markdown
## Unreleased
- **Added**: `roll loop runs` — 随时查看 loop 最近都跑了什么
- **Fixed**: `roll update` 不再在升级后误报旧版本

## v2026.05.07
- ...
```

## 首次创建与历史回填

若项目尚无 `CHANGELOG.md`，`$roll-.changelog` 会创建文件并将所有历史完成故事按日期倒序回填。

## 手动触发

```bash
$roll-.changelog   # 暂存 CHANGELOG.md（在 build 会话中调用）
```

在 build 会话外单独调用时，会暂存并以 `chore: sync changelog` 提交。

## 另见

- [loop.md](loop.md) — loop 在每个故事结束后自动触发 changelog
- [skills.md](skills.md) — 支持技能表中的 `roll-.changelog`
