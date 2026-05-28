# roll feedback —— 一句话从 CLI 提 GitHub issue

`roll feedback` 在项目根目录直接开 GitHub issue,bug / idea / UX
反馈不用切浏览器手填。

`roll feedback` opens a GitHub issue directly from the CLI — no
browser context switch needed.

## 快速上手

```bash
roll feedback --type bug --title "Safari 上登录失败" \
              --body "复现步骤: 1. ... 2. ..."
```

装了 `gh` 且已登录时,直接调 `gh issue create` 提交 issue,带上解析出
的仓库、标题、正文、标签。

没装 `gh` 时,命令打印一条预填好的 URL(`github.com/<owner>/<repo>/issues/new?...`),
浏览器打开就是。也可以强制走 URL 路径:

```bash
roll feedback --type idea --title "加暗色主题" --body "..." --print-url
```

## 参数说明

| Flag        | 说明 |
|-------------|------|
| `--type`    | `bug` / `idea` / `ux`,默认 `bug`,决定 label 前缀 |
| `--title`   | 必填,issue 标题 |
| `--body`    | issue 正文,空也行,只要没 `--no-env` 仍会自动附环境信息 |
| `--repo`    | `owner/repo` 覆盖默认仓库 |
| `--no-env`  | 关掉自动附的 Environment 段落 |
| `--print-url` | 打印预填 URL,不调 gh |
| `--help`    | 内嵌帮助 |

## --type 到 GitHub label 的映射（US-FB-004）

label 是给 GitHub Actions / project board 用的,issue 自动归类回
Roll backlog 时少一道映射:

| `--type` | 自动加的 label |
|----------|---------------|
| `bug`    | `bug,FIX` |
| `idea`   | `idea,enhancement,US` |
| `ux`     | `ux,enhancement` |

`FIX` / `US` 这两个后缀对应 Roll backlog id 前缀,issue 拉回时直接对得上。

## 目标仓库优先级（US-FB-003）

`roll feedback` 按以下顺序解析目标仓库,先匹配到的就用:

1. `--repo owner/repo` flag（显式,最高优先）
2. `ROLL_FEEDBACK_REPO=owner/repo` 环境变量（一次性覆盖）
3. `.roll/local.yaml` 里的 `feedback_repo: owner/repo`（项目固定）
4. `~/.roll/config.yaml` 里的 `feedback_repo: owner/repo`（全局默认）
5. `git remote get-url origin` 推导出的 GitHub owner/repo（兜底）

文档项目想把 feedback 提到引擎项目?在项目级配置里固定:

```yaml
# .roll/local.yaml
feedback_repo: my-org/my-engine
```

## 自动附环境信息（US-FB-002）

默认 `roll feedback` 在 issue body 末尾追加 `### Environment` 段:

```
### Environment
- roll version: 2026.529.1
- OS: Darwin 25.4.0 arm64
- shell: zsh
- current agent: pi
- language: en_US.UTF-8
- project: my-app
```

排查时不用再问"你 roll 几号版本、什么系统",一条 issue 自带。提
feature request 时环境无关的话,加 `--no-env` 关掉。

The `Environment` section is appended automatically; `--no-env` disables it.
