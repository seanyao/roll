# 遗留项目接入 Roll

> 在现有代码库上接入 Roll，不破坏你团队现有的工作流。

如果你有一个已经运行了一段时间的真实项目——有代码、有测试、有历史、有约定——想开始用 Roll 管理它，这是你要走的路径。

## 三种接入模式

| 模式 | 适用场景 | 取舍 |
|------|---------|------|
| **Seed**（播种） | 新项目从零开始 | 摩擦最低，day 1 就有 specs/backlog |
| **Graft**（嫁接，本页） | 活跃的遗留项目，还在演化 | 零侵入原代码，Roll 在上层叠加 |
| **Replant**（翻种） | 想清债、重写一次 | 工作量大，需要先反推规格 |

本页讲 **graft**。关于 seed / replant，见 [接入模式文档](https://github.com/seanyao/roll-meta)（维护者私有仓，README 有公开摘要）。

## Graft 做了什么

- **读**你的项目，理解类型、领域、关键模块
- **问**你 9 个问题，3 分钟内完成
- **生成** `.roll/` 目录，与原代码并列（不动你的源文件）
- **同步**Roll 约定到你用的 AI 工具
- 你得到的项目同时拥有：原来的工作流 + Roll 的项目管理能力

Graft 是**完全可逆**的：跑 `roll offboard` 让 Roll 自己撤销它加进来的全部痕迹（见下文"怎么退出"）。

## 分步操作

### 1. 安装 Roll

```bash
curl -fsSL https://seanyao.github.io/roll/install | bash
```

或通过 npm：

```bash
npm install -g @seanyao/roll@latest
```

然后：

```bash
roll setup
```

### 2. 在项目里跑 `roll init`

```bash
cd your-project
roll init
```

Roll 会检测到这是已有代码库且尚未接入 Roll（有源码/清单文件，但没有当前 Roll 标记），打印类似：

```
Detected: existing codebase without Roll
Recommended path: agentic-onboard
Facts:
  - manifests: package.json
  - source dirs: src
  - test dirs: tests
  - source files: 47
  - Roll markers: none
  - facts hash: sha256:...
Next: $roll-onboard
Agent status: available: claude, codex
Run `$roll-onboard` with an available agent, review the artifacts, then run `roll init --apply`.
No files changed.
```

### 3. 在 AI agent 里跑 `$roll-onboard`

打开你想用的 agent（Claude Code、Codex CLI、Cursor 等），运行：

```
$roll-onboard
```

技能会：
1. 浏览你的仓库，告诉你它看到的项目结构
2. 第一组 3 问：确认推断的项目类型 / 领域 / 关键模块
3. 第二组 3 问：要生成哪些 `.roll/` 产物，哪些现有文档要 include 而非重新生成
4. 第三组 3 问：`.gitignore`、AI 工具同步、loop 启用与否
5. 只写两个结构化产物：`.roll/init-diagnosis.yaml` 和 `.roll/onboard-plan.yaml`

总耗时：3 分钟以内。

### 4. 应用 plan

回到终端，先审阅 `.roll/init-diagnosis.yaml` 和 `.roll/onboard-plan.yaml`，然后执行：

```bash
roll init --apply
```

这一步会先校验成对的 diagnosis / plan 产物，任何写文件之前先拒绝不支持的 schema 版本、过期或 stale 的 facts hash、非幂等 file operation、路径穿越和 shell-command key。

校验通过后，Roll 会打印 apply 审阅检查点：表格列出每个计划操作的动作、目标路径、
合并/创建模式，以及是否保留用户内容。在交互终端里，确认前不会写入任何已审阅的变更。

如果是在非交互自动化里执行，审阅后要显式确认：

```bash
roll init --apply --auto
```

校验通过后，Roll 会：
- 按你选的 scope 创建 `.roll/` 子目录
- 如果选了"生成 backlog"，写入初始 `.roll/backlog.md`
- 你标记 include 的现有文档不会被覆盖
- 如果 Q7 说 yes，把 `.roll/` 加入 `.gitignore`
- 把 Roll 约定同步到你选的 AI 工具

完事。`roll status` 看新状态。

### 5.（可选）启动自治 loop

如果 Q9 选了 yes，`roll loop on` 会按定时表激活 loop，自动从 `BACKLOG.md` 拉 `📋 Todo` 任务，跑 `$roll-build` / `$roll-fix`。

## Graft 的边界

Roll 只动它**自己的**文件：

| Roll 会动 | Roll 不会动 |
|----------|------------|
| `.roll/`（全部） | `src/`、`lib/`、`tests/` 等你的代码 |
| `AGENTS.md`（不存在则创建，存在则 section 级合并） | `README.md` |
| `.gitignore`（仅当 Q7 说 yes） | `package.json`、`pyproject.toml` 等 |

如果你已有 `CONTRIBUTING.md` 或 `.github/` workflow，Roll 不会碰它们。如果想把 Roll 工作流接到现有 CI，需要你后续手动配置。

`$roll-onboard` 自己的边界比 `roll init --apply` 更窄：agent 只能写 `.roll/init-diagnosis.yaml` 和 `.roll/onboard-plan.yaml`。`AGENTS.md`、`.gitignore`、backlog、features、docs、offboard changeset 都由 apply 命令负责。

## 怎么退出

`roll init --apply` 把它创建的每个文件、目录、`.gitignore` 行都记到了 `.roll/onboard-changeset.yaml`。`roll offboard` 命令读这份清单，撤销 onboard 时的全部改动。

**先预演（默认）：**

```bash
cd your-project
roll offboard
```

这是 dry-run，不会真的删除。输出会列出清单中记录的所有产物，以及将要从 `.gitignore` 撤销的行。

**确认后执行：**

```bash
roll offboard --confirm
```

Roll 不创建的文件 / 目录原封不动；你自己加到 `.gitignore` 的内容也保留。执行成功后，清单文件本身也会被删除。

安全保障：

- 找不到 `.roll/onboard-changeset.yaml`（比如较早版本的 Roll 没记录、或者这个项目从没跑过 `roll init --apply`），`roll offboard` 拒绝执行，并打印手动 `rm` 命令，不会自己猜。
- 如果清单里的路径不在当前项目根目录下（跨项目串路径），`roll offboard` 也拒绝执行，并提示你切到正确目录再跑。

**完全卸载（全机器）：**

```bash
roll offboard --confirm
npm uninstall -g @seanyao/roll
```

项目回到接入前的状态。

## FAQ

**Q: 没装 AI agent 怎么办？**
至少装一个。Claude Code、Codex CLI、Cursor 都可以——安装免费，AI 调用走你的账户消耗 token。

**Q: 已经有从别的工具来的 `BACKLOG.md` 怎么办？**
Roll 会检测为 pre-2.0 Roll 项目（不是 legacy），让你跑 `npx @seanyao/roll@2 migrate`。如果文件来自完全不同的工具，先重命名（`mv BACKLOG.md old-backlog.md`）再跑 `roll init`。

**Q: roll-onboard 推断的项目类型不对，怎么改？**
在对话里告诉它。第一组 3 问就是为了让你纠正。Skill 把纠正后的理解写进 plan，bash 信任 plan。

**Q: 能手动编辑 `.roll/onboard-plan.yaml` 吗？**
可以，但要和 `.roll/init-diagnosis.yaml` 配套。`roll init --apply` 要求两边的 `factsHash` 一致，并会重新计算当前项目 facts hash；同时不允许 shell-command key，`file_operations` 只能声明那两个位于项目内且幂等的允许文件。超过 24 小时、相对当前项目已 stale，或由旧版 `$roll-onboard` 生成的 plan，都应该重新生成。

手动改过的 plan 仍然会进入同一个审阅检查点；没有交互确认或显式 `--auto` 时，不会修改文件。

**Q: 我们团队用 GitHub Issues / Jira / Linear，Roll 会替代它们吗？**
不会。Roll 的 `BACKLOG.md` 是给 AI loop 自治执行用的。你团队的外部 tracker 继续用。有的团队只把"AI-loop 能执行的 story"放 Roll，纯人工任务留在原 tracker。
