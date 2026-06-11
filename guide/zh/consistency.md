# 一致性 — `roll release consistency check`

以真相锚点持续核对六个维度。backlog 的 `✅ Done` 行是声明；`main` 上的
merge 证据、验收报告、cycle 终态事件、发版闸事件才是事实。六个维度为：
① 代码 ↔ backlog 声明 · ② 卡片（每条活卡必须拥有
`features/<epic>/<ID>/spec.md`，证据链接不许悬空；卡片制之后已交付且带 AC
的故事必须拥有 `latest/<ID>-report.html`；卡片制之前的历史 Done 行只计数不拦截）·
③ 文档（changelog / features / guide / README / --help）· ④ 测试 ·
⑤ 双语对等（guide en↔zh + i18n key）· ⑥ 网站。

```bash
roll release consistency check          # 人读报告
roll release consistency check --json   # 机器可判；exit 0 = 全部通过
```

## 发版闸

每个 `v*` tag 在创建 GitHub Release 之前先过**一致性闸**：任一维度失败即中止
发版，job 日志列出具体差在哪。带着已知漂移发版的唯一方式是把漂移修掉——
不是绕过闸。

验收证据闸默认是 `hard`。`loop_safety.attest_gate: soft` 是显式项目策略，
只用于迁移窗口；一致性检查仍会报告缺失或悬空的证据，避免缺口静默消失。

## 文档对齐边界

registry 漂移已经是硬红线：命令注册表、README、guide 或 `--help` 彼此不一致时，
FIX-242 守卫会让一致性检查和发版闸失败。`roll attest` 里的 `doc-gap` 信号仍是
shadow-only：当交付 diff 改了用户可见命令面或输出文案文件，却没有在同一 diff
触及 README/docs/guide/site 时，它只在报告里给出警示，暂不改变退出码或 Gate 结论。
