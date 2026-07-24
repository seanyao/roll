# Workspace-first 交付

Workspace 是 Roll 本地的需求、规划、执行与统一交付边界。Repository 是绑定到
Workspace 的代码资源，不是项目身份，也不是第二套 Roll 控制平面。

一台机器可以保持多个 active Workspace。每个变更命令必须解析到一个精确目标；只有
明确声明的 `--all` 聚合视图可以只读跨 Workspace。

## 心智模型

```text
Machine
├── Agent 能力与容量
├── Workspace registry
├── 共享 repository cache
└── Workspaces
    ├── requirements + backlog
    ├── Story / Issue 记录
    └── runtime projections
```

稳定的 `workspaceId` 才是身份。Registry 把 ID 映射到 canonical path，因此移动
Workspace 只改变位置，不改变身份。系统没有 global current Workspace，也没有单例
active 槽位。

Repository cache 位于 `~/.roll/repos/<repoId>.git`，是机器共享、可删除重建的 bare
cache。删除或重建 cache 不得改变 backlog、Issue 完成状态、merge evidence 或集成验收。

## 创建并激活 Workspace

先在目标目录外写一份版本化 `roll.workspace-create/v1` 配置，再预览确定性计划：

```bash
roll workspace create ws-payments --config /absolute/path/workspace-create.yaml --check --json
```

`--check` 只读校验身份、root、需求绑定、repository remote、alias、integration branch、
cache 决策与已有内容。只应用审阅过的配置：

```bash
roll workspace create ws-payments --config /absolute/path/workspace-create.yaml --json
roll workspace activate ws-payments
```

初始化只创建 Workspace 权威文件与 repository binding，不创建常驻 product checkout。
它也不会把 Workspace 设成全局当前目标：activate 控制 scheduler eligibility，每次命令
仍独立解析自己的目标。

只读查看生命周期：

```bash
roll workspace list --all --json
roll workspace show ws-payments --json
```

## 目标解析与 fail-loud

Workspace-aware 命令接受 `--workspace <ID|路径>`。解析会综合显式参数、
`ROLL_WORKSPACE`、当前目录与 active registry 条目；这些信号必须收敛到同一个 Workspace。

例如：

```bash
roll backlog --workspace ws-payments
roll loop status --workspace ws-payments
roll agent --workspace ws-payments
roll delivery list --workspace ws-payments
```

如果两个 Workspace 都处于 active 且没有更强 selector，Roll 会列出候选并以非零退出。
显式参数、环境变量与 cwd 指向不同目标时也会 fail loud。`pause`、`archive`、scheduler
控制和 delivery reconcile 等变更拒绝 `--all`。

planning 与 delivery 命令只把选定 Workspace 当作 project-data authority。即使从任意
目录运行，也不会创建 `<cwd>/.roll`：

```bash
roll story new US-PAY-102 --title "重试退款" --epic payments --workspace ws-payments
roll idea "改进退款诊断" --workspace ws-payments
roll design "拆分退款恢复方案" --workspace ws-payments
roll attest US-PAY-102 --workspace ws-payments
```

这些命令及其内部 view refresh 只读写 canonical Workspace 下的 `backlog/index.md`、
`features/`、`runtime/` 与派生 `index.json`。legacy `.roll` 只作为 migration input；
Roll 不会同时写两套布局。

## Requirement 与 Issue 布局

执行前先采集 requirement revision，并保留 provider ref 与 digest。`backlog/` 中的 Story
契约开始执行后成为一个 Issue：

```text
<workspace>/
├── requirements/<provider>/<requirement>/
├── backlog/.../<storyId>/spec.md
└── issues/<storyId>/
    ├── manifest.json
    ├── events.ndjson
    ├── <repoAlias>/
    ├── artifacts/
    └── evidence/
```

Repository worktree 只能通过 Issue 命令创建或修复：

```bash
roll workspace issue init US-PAY-101 --workspace ws-payments --check --json
roll workspace issue init US-PAY-101 --workspace ws-payments --json
```

可写代码只存在于 `issues/<storyId>/<repoAlias>/` worktree。只读 repository target 可以
提供 context，但不成为必需交付 leg。任一 setup leg 失败时只回滚本次新建状态，而且不会
spawn Builder。

## 一个 Story，多个独立 repository 事实

Story/Issue 本身就是统一交付单元。Roll 不引入 Delivery Set、Workspace-level codebase
或 superproject 来制造跨 repository 的物理原子性。

每个 required repository 独立记录：

- governed branch 与 TCR commits；
- provider PR 状态与 required CI checks；
- 权威 merge commit。

只有全部 required repository 已 merge，并且 integration command 针对精确 merged SHA
通过，Issue 才算 delivered。单个 PR 已 merge、本地 branch、worktree、绿色单测或 backlog
的 `Done` 声明都不够。

查询与对账统一使用同一个 Issue fold：

```bash
roll delivery show US-PAY-101 --workspace ws-payments
roll delivery reconcile US-PAY-101 --workspace ws-payments --dry-run --json
roll delivery reconcile US-PAY-101 --workspace ws-payments
```

`roll delivery reconcile` 折叠 Issue events 与 provider/main 事实，先刷新 Requirement attest
projection，再更新 backlog projection；它绝不把 backlog Markdown 当成完成真相。
`roll loop reconcile` 只是同一 fold 的 alias，不是第二套 parser。

## Local-only campaign gate

如果 campaign 要求所有本地验收完成后才能产生外部变更，请在专用 integration branch 上配置
`publish_mode: local`。该模式运行同一套本地 evidence gate，并把 commit 落到配置的本地
integration branch；它不会 push 分支，也不会创建 PR。所有依赖 Story 与 requirement-level
critical flow 必须先在同一个精确 integration-branch SHA 上通过。改回 `remote` 是另一个需要
owner 审批的发布决定。

## 强制历史迁移

Repository-local `.roll/` 只是历史输入，不是第二种长期运行模式。不要在它上面再初始化一套
竞争 Workspace。先停止 active runtime，确认产品 Git clean 且远端可达，再采集只读计划：

```bash
roll workspace migrate --from . --check
roll workspace migrate --from . --workspace ws-payments --check --json > workspace-migration-plan.json
```

以下情况会 fail loud：产品 Git dirty 或 unpushed、进行中的 Git operation、不安全 linked
worktree 或 recursive submodule、active runtime、`.roll` 下的 symlink、无法验证的 remote
truth，以及 cache/registry 冲突。

如果 `.roll` 被产品 repository 跟踪，先通过正常受审的 TCR/PR/push cutover 只移除计划内
路径。Apply 会证明专用 cutover commit 已由远端可达，并逐个核对保存的 digest。普通 tracked
metadata 完成后留下 `.roll/RELOCATED.json`，旧路径不能继续静默作为 repository-local runtime。

应用 owner 保存的精确计划：

```bash
roll workspace migrate --from . --workspace ws-payments --plan workspace-migration-plan.json
```

事务先写 journal，再映射 requirement、design、backlog 与 evidence；只创建或复用机器 bare
cache，校验全部 digest，最后才 register/activate。它绝不创建 Workspace-level product
checkout。注册前可以用 `--rollback` 恢复原子移动的源文件。

如果 `.roll` 是独立 Git repository，Roll 只复制映射内容，不会 link、commit 或 push；命令
会输出手工 roll-meta 移交说明，后续继续走 owner 审批的 metadata workflow。

## 诊断与恢复

```bash
roll workspace doctor ws-payments --json
```

Doctor 只读检查 registry/manifest 一致性、cache identity、Requirement projection 与 archive
trust、Issue journal/worktree、runtime lock 和机器容量。每次只能执行一个具名 typed repair；
provider facts、不可变 Requirement archive 与 Issue completion evidence 不会被编造或删除。

更多细节见[配置](configuration.md)、[Workspace Doctor](workspace-doctor.md)、
[Loop](loop.md)和[历史迁移](legacy-onboarding.md)。
