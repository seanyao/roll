# 一致性 — `roll consistency check`

以 backlog 的 `✅ Done` 行为事实源，持续核对六个维度：① 代码 ↔ backlog ·
② 卡片（每条活卡必须拥有 `features/<epic>/<ID>/spec.md`，证据链接不许悬空——
卡片制之前的历史 Done 行只计数不拦截）· ③ 文档（changelog / features /
guide / README / --help）· ④ 测试 · ⑤ 双语对等（guide en↔zh + i18n key）·
⑥ 网站。

```bash
roll consistency check          # 人读报告
roll consistency check --json   # 机器可判；exit 0 = 全部通过
```

## 发版闸

每个 `v*` tag 在创建 GitHub Release 之前先过**一致性闸**：任一维度失败即中止
发版，job 日志列出具体差在哪。带着已知漂移发版的唯一方式是把漂移修掉——
不是绕过闸。
