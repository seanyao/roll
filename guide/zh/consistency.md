# 一致性 — `roll consistency check`

以真相锚点持续核对六个维度。backlog 的 `✅ Done` 行是声明；`main` 上的
merge 证据、验收报告、cycle 终态事件、发版闸事件才是事实。六个维度为：
① 代码 ↔ backlog 声明 · ② 卡片（每条活卡必须拥有
`features/<epic>/<ID>/spec.md`，证据链接不许悬空；卡片制之后已交付且带 AC
的故事必须拥有 `latest/<ID>-report.html`；卡片制之前的历史 Done 行只计数不拦截）·
③ 文档（changelog / features / guide / README / --help）· ④ 测试 ·
⑤ 双语对等（guide en↔zh + i18n key）· ⑥ 网站。

```bash
roll consistency check          # 人读报告
roll consistency check --json   # 机器可判；exit 0 = 全部通过
```

## 发版闸

每个 `v*` tag 在创建 GitHub Release 之前先过**一致性闸**：任一维度失败即中止
发版，job 日志列出具体差在哪。带着已知漂移发版的唯一方式是把漂移修掉——
不是绕过闸。

验收证据闸默认是 `hard`。`loop_safety.attest_gate: soft` 是显式项目策略，
只用于迁移窗口；一致性检查仍会报告缺失或悬空的证据，避免缺口静默消失。
