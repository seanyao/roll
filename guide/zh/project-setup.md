# Roll — 项目初始化

## 初始化项目

在项目根目录执行：

```bash
roll init
```

`roll init` 会先诊断当前目录状态，再决定是否改动文件：

1. **空目录** —— 全新起点。Roll 直接写入 `AGENTS.md`、空的 `.roll/`
   骨架（`backlog.md`、`features/`、`domain/`），以及一份
   `.roll/pairing.yaml`（[跨 agent 结对](pairing.md)，界面会告知），不问问题。这是
   **seed（播种）** 接入模式 —— 见 [patterns/seed-pattern.md](patterns/seed-pattern.md)。
2. **PRD/文档-only** —— Roll 发现需求或产品文档，但没有源码和 manifest。
   这是新项目路径，会指向设计；不会进入 legacy onboarding。
3. **已有代码库但未接入 Roll** —— Roll 检测到源码但没有 `.roll/`。它**不会**默默
   生成骨架，而是引导你用 `$roll-onboard`：扫描代码、问一组认知 / 范围 /
   隐私问题、产出 `.roll/onboard-plan.yaml` 供审阅。确认方案后执行
   `roll init --apply`。这是 **graft（嫁接）** 模式 —— 见
   [legacy-onboarding.md](legacy-onboarding.md) 与
   [patterns/graft-pattern.md](patterns/graft-pattern.md)。
4. **已初始化** —— `.roll/`、`AGENTS.md`、backlog、features 都存在。Roll
   打印 `Already initialized` 和 `Next: roll next`。
5. **部分接入 Roll** —— 有一部分 Roll 标记但不完整。Roll 只打印修复路径，不会
   在项目上叠加新骨架。

正在从 2.0 之前的布局升级（`BACKLOG.md` 在根目录、`docs/features/`、
`docs/domain/`）？先跑 `npx @seanyao/roll@2 migrate` —— 见
[migration-2.0.md](migration-2.0.md)。`roll init` 会拒绝在迁移到一半的
项目上叠加骨架。

## 更新约定和技能

roll 发布新版本后，将新约定同步到项目：

```bash
roll sync
```

`sync` 只覆盖 roll 管理的文件（技能和全局约定），不会动你的 `.roll/backlog.md`、项目源码等文件。

## 典型首次使用流程

```bash
curl -fsSL https://seanyao.github.io/roll/install | bash   # 安装 roll
roll setup                 # 全机器配置 AI 工具（仅需一次）
cd my-project
roll init                  # 诊断并路由该项目
roll design                # 开交互式设计对话，填充 .roll/backlog.md
roll loop on               # 开启自主执行
```

`roll setup` 让你从本机已安装的 agent 里选一个默认 agent。
这个 `primary_agent` 存在 `~/.roll/config.yaml`，交互入口（`roll design`、
`roll agent use`）会用它作为默认。自主 loop 仍然按 `.roll/agent-routes.yaml` 的
分级 rig 路由——二者有意可分：你的交互默认和 loop rig 池可以不同。

## 创建的文件

| 文件 | 用途 |
|------|------|
| `AGENTS.md` | Agent 约定：领域模型、作用域、编码规范（根目录 — 所有 AI 客户端的入口） |
| `.roll/backlog.md` | 故事跟踪（Epic / Feature / Story / Fix / Refactor） |
| `.roll/features/` | 每个 Feature 的深度文档 |
| `.roll/domain/` | DDD 模型、context map、架构记录 |

## 幂等性

`roll init` 可安全重复执行：完整项目会提示 `roll next`，部分项目会给出修复建议，
不会再次强行跑脚手架。

## 另见

- [installation.md](installation.md) — 安装和更新 roll
- [conventions.md](conventions.md) — AGENTS.md 结构和约定
- [patterns/](patterns/README.md) — 三种接入模式（seed / graft / replant）
- [legacy-onboarding.md](legacy-onboarding.md) — 将 Roll 嫁接到已有代码库
- [migration-2.0.md](migration-2.0.md) — 从 2.0 之前的布局升级到 `.roll/`
- [loop.md](loop.md) — 开启自主执行

## Git Hooks 自动配置（US-INFRA-008/009）

Roll 的 TCR 提交前检查在 `hooks/pre-commit` 里。
Git 默认忽略这个目录——需要把 `core.hooksPath` 指向它才能生效。
Roll 在三个地方自动完成配置，不会出现"检查门被绕过"的时间窗口：

1. **`roll setup`** — 在当前仓库设置 `core.hooksPath=hooks`。
2. **自主 loop 每轮 cycle preflight** — 每轮启动时确保 worktree 的 hooks 路径正确。
3. **Claude Code SessionStart hook**（`.claude/settings.json`）— 每次新开 Claude Code 会话时自动执行 `git config core.hooksPath hooks`。

**手动覆盖：** 如果你已经把 `core.hooksPath` 设成了别的值，Roll 不会覆盖它。
自动配置只在该值未设或等于 git 默认值 `.git/hooks` 时才触发。

**排查：** 提交时没有运行测试：

```bash
git config core.hooksPath   # 应该显示: hooks
ls hooks/pre-commit          # 应该存在且可执行
roll setup                   # 重新执行配置步骤
```
