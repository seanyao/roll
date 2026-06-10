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

`roll init` 会创建 `.roll/` 工作区和 `AGENTS.md`。已有代码库可能会先进入
legacy onboarding，再真正写文件。

## 3. 写第一条 Backlog

用一句话建一张小故事卡：

```bash
roll idea "Add a health check endpoint"
```

`roll idea` 自动分类、取号、推断史诗、建卡片文件夹 — 一步完成待办行和故事文件夹。

然后编辑 `.roll/features/<史诗>/<ID>/spec.md`，把 AC 写清楚。

第一条故事要小：一个可见行为，一条明确测试路径。

## 4. 启动 Loop

```bash
roll loop on
roll loop status
```

`roll loop status` 是常用快照视图。若当前有 cycle 在跑，并且你想看实时终端，
按 status 里显示的 session 名附加 tmux：

```bash
tmux attach -t roll-loop-<project-slug>
```

如果不想等调度触发，可以手动跑一轮：

```bash
roll loop now
```

## 5. 生成验收报告

故事落地、backlog 行变成 `✅ Done` 后，生成离线验收报告：

```bash
roll attest US-DEMO-001
```

报告会写进该故事的 `.roll/features/` 文件夹。发布前，每条 AC 都应有 verdict
和证据链接。
