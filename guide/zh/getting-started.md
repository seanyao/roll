# Roll — 快速上手

这条路径把一个 git 项目从安装带到验收报告，目标是 5 分钟内跑通第一条
Roll 管理的故事。

## 1. 安装

```bash
curl -fsSL https://seanyao.github.io/roll/install | bash
# 或
npm install -g @seanyao/roll
```

Roll 需要 Node.js 22 或更新版本，并且本机至少装好一个支持的 AI agent。

## 2. 初始化项目

```bash
cd your-project
roll setup
roll init
```

`roll init` 会先诊断当前目录，再决定是否写文件。空项目走新项目骨架；已有
代码库走 `$roll-onboard`；只有 PRD/文档的目录会被当成新项目并指向设计；
部分 Roll 或旧 Roll 布局只打印修复/迁移建议，不直接改文件。

## 3. 从需求到 Backlog

如果你手头有需求文档（PRD、草图、笔记）但还没有源码，`roll init` 会把它识别
为 PRD-only 新项目并指向设计。已有 Roll 骨架但 backlog 为空时，`roll status`
和 `roll doctor` 仍会提示进入设计阶段。

想立刻开始设计对话：

```bash
roll design
```

这条命令会在你的 AI agent 里拉起 `roll-design` 技能。你描述领域模型，agent 把
INVEST 故事写入 `.roll/backlog.md`——然后 `roll loop` 接过去接着干。

你也可以直接在 agent 里跑 `$roll-design`，效果一样。

如果你心里已经有故事，只想快速加一条，跳到第 4 步。

## 4. 写第一条 Backlog

用一句话建一张小故事卡：

```bash
roll idea "Add a health check endpoint"
```

`roll idea` 自动分类、取号、推断史诗、建卡片文件夹 — 一步完成待办行和故事文件夹。

然后编辑 `.roll/features/<史诗>/<ID>/spec.md`，把 AC 写清楚。

第一条故事要小：一个可见行为，一条明确测试路径。

## 5. 启动 Loop

```bash
roll loop on
roll loop status
```

`roll loop status` 是常用快照视图。若当前有 cycle 在跑，并且你想看实时视图，
先用只读 watch 命令：

```bash
roll loop watch
```

排查事件用 `roll loop watch --events`，只有需要原始审计 JSON 时才用
`roll loop watch --raw-events`。所有 watch 模式都是只读；Ctrl-C 只停止视图。

如果不想等调度触发，可以手动跑一轮：

```bash
roll loop now
```

## 6. 生成验收报告

故事落地、backlog 行变成 `✅ Done` 后，生成离线验收报告：

```bash
roll attest US-DEMO-001
```

报告会写进该故事的 `.roll/features/` 文件夹。发布前，每条 AC 都应有 verdict
和证据链接。
