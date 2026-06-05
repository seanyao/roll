# 一致性 — `roll consistency check`

以 backlog 的 `✅ Done` 行为事实源，持续核对五个维度：① 代码 ↔ backlog ·
② 文档（changelog / features / guide / README / --help）· ③ 测试 ·
④ 双语对等（guide en↔zh + i18n key）· ⑤ 网站。

```bash
roll consistency check          # 人读报告
roll consistency check --json   # 机器可判；exit 0 = 全部通过
```

## 发版闸

每个 `v*` tag 在创建 GitHub Release 之前先过**一致性闸**：任一维度失败即中止
发版，job 日志列出具体差在哪。带着已知漂移发版的唯一方式是把漂移修掉——
不是绕过闸。
