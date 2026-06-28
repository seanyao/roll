# 反馈与 issue 入口

Roll 把两条反馈路径分开：

- 输入应该进入本地 Roll backlog 时，用 `roll idea "<一句话>"`。
- 输入属于公开仓库或跨项目 tracker 时，直接用 `gh issue create`。

## 本地 Roll backlog

```bash
roll idea "Safari 登录在 session cookie 过期后失败"
roll idea "给 Story 报告归档加暗色主题"
```

`roll idea` 会分类、分配下一个 ID、推断 epic、铸卡夹、追加 backlog 行并刷新索引。
这是项目 owner 把零散反馈变成 Roll 工作项的常规入口。

## GitHub Issues

公开 bug 或外部协作直接走 GitHub：

```bash
gh issue create \
  --repo owner/repo \
  --title "Safari 登录失败" \
  --body "复现步骤：1. ... 2. ..."
```

如果项目看板会把 issue 回流进 Roll backlog，可以按需加 `bug`、`idea`、
`enhancement`、`FIX`、`US` 等 labels。
