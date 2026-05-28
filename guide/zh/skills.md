# Roll 技能选择指南

快速选择正确的技能或工具。

## 核心技能

| 用户意图 | 技能 | 说明 |
|---------|------|------|
| **"不确定怎么做"** / **"有几个方案"** | `roll-design` | 探索方案、比较选项、人工决策 |
| **"帮我做一个..."** / **"实现 US-001"** / **"修 FIX-001"** | `roll-build` | 万能入口：US-XXX 故事模式、FIX-XXX 修复模式、自由文本飞行模式——一个技能全覆盖 |
| **"这个逻辑很关键"** / **"涉及支付"** | `roll-spar` | 对抗式 TDD，高风险场景激活 |
| **"修个 bug"** / **"改文案"** | `roll-fix` | 快速修复，无需完整工作流 |
| **"规划需求"** / **"拆成故事"** | `roll-design` | 仅规划，不实现，输出 BACKLOG.md |
| **"并行跑多个 Action"** | `roll-build` | 拆分 Action 后自动判断是否并行 |
| **"检查生产状态"** | `roll-sentinel` | 生产巡检、回归测试 |
| **"调试这个页面"** | `roll-debug` | 深度诊断，采集日志/网络/DOM |
| **"研究这个主题"** | `roll-research` | HV 分析深度调研，输出 PDF 报告 |

## 支撑技能

| 场景 | 技能 | 触发时机 |
|------|------|---------|
| 代码自审 | `roll-.review` | Commit 前，或手动触发 |
| 生成变更日志 | `roll-.changelog` | 成功 Deploy 后自动触发 |
| QA 测试参考 | `roll-.qa` | 写测试时参考 |
| 意图澄清 | `roll-.echo` | 用户输入模糊或不清晰时自动激活 |

## 快速决策树

```
用户输入
    |
+----------------------+
| "不确定方案？"        |--> roll-design
+----------------------+
    | 否
+----------------------+
| "一句话需求？"        |--> roll-build（飞行模式）
+----------------------+
    | 否
+----------------------+
| "有 US-XXX ID？"     |--> roll-build（故事模式）
+----------------------+
    | 否
+----------------------+
| "有 FIX-XXX ID？"    |--> roll-fix
+----------------------+
    | 否
+----------------------+
| "修 bug？"           |--> roll-fix
+----------------------+
    | 否
+----------------------+
| "规划/拆分？"        |--> roll-design
+----------------------+
    | 否
+----------------------+
| "高风险逻辑？"       |--> roll-spar
+----------------------+
    | 否
  人工判断
```

## 技能自评（US-SKILL-010..014）

`roll-build`、`roll-fix`、`roll-design` 完成时各自写一条结构化自评笔
记到 `.roll/notes/`：

Each of `roll-build` / `roll-fix` / `roll-design` writes a structured
self-score note on completion.

```
.roll/notes/2026-05-29-roll-build-US-AUTH-001-1717000000.md
.roll/notes/2026-05-29-roll-fix-FIX-072-1717000123.md
.roll/notes/2026-05-29-roll-design-US-FOO-001-1717000456.md
```

每条笔记是 YAML frontmatter + 自评原因：

```markdown
---
skill: roll-build
story: US-AUTH-001
score: 8
verdict: good
ts: 2026-05-29T03:14:15Z
---

故事干净交付,AC 全部命中。auth-cookie 测试 TCR 重试一次(setup 漏初始化)。
Peer review 有一条 nit,inline 解决。
```

`roll loop status` 在 ROLLUP 区块底部汇总趋势：

```
self-score: mean 7.8 / min 4 / redo 2 (last 14)
```

`redo` 计入 `verdict: regression` 和 `verdict: ok` 且 `score < 6` 的
低置信交付——两者都提示该轮 cycle 值得回看。mean 和 min 覆盖整个
窗口，避免一次糟糕 cycle 被平均掩盖。

The trend line shows mean, minimum, and `redo` count (regression
verdicts plus low-confidence "ok"s) for the last 14 self-score notes.

这些笔记是 `.roll/` 的一部分，跟代码一起提交，质量轨迹在不同机器、
不同协作者之间都可复现，从项目历史里直接可见。

## 自动触发关键词

| 技能 | 触发关键词 |
|------|----------|
| `roll-design` | 讨论、比较方案、怎么选、权衡、不确定用哪个、设计、规划、拆分、写故事、需求分析 |
| `roll-build` | 帮我做、加个功能、改一下、重构、实现 US-、做这个 story、做这个需求、并行、同时开发 |
| `roll-fix` | 修个 bug、改文案、调颜色、报错了、修复 |
| `roll-spar` | 对抗式、攻防、高风险、核心逻辑、支付、权限、安全 |
| `roll-sentinel` | 巡检、检查生产环境、回归测试 |
| `roll-debug` | 调试、诊断、页面有问题、排查 |
| `roll-research` | 深度调研、研究一下、竞品分析、HV 分析、深入了解 |
