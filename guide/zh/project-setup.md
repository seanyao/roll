# Roll — 项目初始化

## 初始化项目

在项目根目录执行：

```bash
roll init
```

`roll init` 根据当前目录状态自动选择三种模式之一：

1. **空目录** —— 全新起点。Roll 直接写入 `AGENTS.md` 和空的 `.roll/`
   骨架（`backlog.md`、`features/`、`domain/`），不问问题。这是
   **seed（播种）** 接入模式 —— 见 [patterns/seed-pattern.md](patterns/seed-pattern.md)。
2. **已有遗留代码库** —— Roll 检测到源码但没有 `.roll/`。它**不会**默默
   生成骨架，而是引导你用 `$roll-onboard`：扫描代码、问一组认知 / 范围 /
   隐私问题、产出 `.roll/onboard-plan.yaml` 供审阅。确认方案后执行
   `roll init --apply`。这是 **graft（嫁接）** 模式 —— 见
   [legacy-onboarding.md](legacy-onboarding.md) 与
   [patterns/graft-pattern.md](patterns/graft-pattern.md)。
3. **重新初始化** —— `.roll/` 已存在。Roll 按章节重新合并全局约定到
   `AGENTS.md`，保留所有项目特有内容，并补齐缺失的骨架文件。幂等可重复。

正在从 2.0 之前的布局升级（`BACKLOG.md` 在根目录、`docs/features/`、
`docs/domain/`）？先跑 `roll migrate` —— 见
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
npm install -g roll        # 安装 roll
roll setup                 # 全机器配置 AI 工具（仅需一次）
cd my-project
roll init                  # 初始化该项目（遗留项目走 $roll-onboard）
$roll-design               # 开设计会话，填充 .roll/backlog.md
roll loop on               # 开启自主执行
```

## 创建的文件

| 文件 | 用途 |
|------|------|
| `AGENTS.md` | Agent 约定：领域模型、作用域、编码规范（根目录 — 所有 AI 客户端的入口） |
| `.roll/backlog.md` | 故事跟踪（Epic / Feature / Story / Fix / Refactor） |
| `.roll/features/` | 每个 Feature 的深度文档 |
| `.roll/domain/` | DDD 模型、context map、架构记录 |

## 幂等性

`roll init` 可安全重复执行——已存在的文件会被跳过，只补充缺失的内容。

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
