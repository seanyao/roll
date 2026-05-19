# Claude Code `/goal` + ralph-loop 机制原理记录

> 2026-05-19 通过当时会话的 transcript JSONL 反推 + 阅读 ralph-loop 源码整理。
> 设计层面的启示见 [loop-architecture-lessons](./loop-architecture-lessons.md)；
> 这份文档只记录"它们是怎么工作的"，不做评价。

## Claude Code 内置 `/goal`

属于 Claude Code v2.1.144 本体的 native 命令，**不是用户级 skill/plugin**。
执行体藏在 `Claude.app` 的 asar 包里，本地没有可读的脚本文件。但协议层
完全可以从 transcript JSONL 的 attachment 输出反推出来。

### 协议流程

```
/goal <condition>
        │
        ▼
注入 attachment:
   { "type": "goal_status",
     "met": false,
     "sentinel": true,
     "condition": "<原文>" }
        │
        ▼
注入 isMeta=true 的 user message:
   "A session-scoped Stop hook is now active with condition: ...
    The hook will block stopping until the condition holds.
    It auto-clears once the condition is met."
        │
        ▼
agent 正常工作直到准备结束 turn
        │
        ▼
Stop hook 拦截 → 喂 transcript + condition 给评估器（独立 LLM call）
   判断 met=true/false
        │
        ├─ met=false → 注入新 attachment "condition has NOT been
        │              satisfied. <详细 reason>" → 继续下一 iteration
        │
        └─ met=true  → 注入 attachment with
                       { "met": true, "iterations": N,
                         "durationMs": ..., "tokens": ... }
                       → goal 自动清除
```

### 可观察字段

```
attachment 中的统计字段：
  iterations    本轮 goal 跑了几次迭代
  durationMs    总耗时
  tokens        总 token 消耗
```

本次复盘会话实际数据：2 iterations / 589 秒 / 24,213 tokens（第一轮
只写了 doc 没真动手被打回，第二轮才把 P0+P1+P2 都做完）。

### 关键特性

- **session-scoped**：goal 只对当前 session 生效，不跨 session
- **完成判定**：LLM 智能评估（不是字符串匹配）
- **状态存储**：Claude Code 本体内部，**不落盘**，测试代码绝对碰不到
- **取消方式**：`/goal clear`
- **触发**：自然语言 condition，可以多行

## 社区开源对照实现 ralph-loop

完整源码：

```
~/.claude/plugins/marketplaces/claude-plugins-official/plugins/ralph-loop/
├── hooks/stop-hook.sh      ← 核心：190 行 bash
├── commands/ralph-loop.md
├── commands/cancel-ralph.md
└── README.md
```

### 状态文件协议

```
文件位置：.claude/ralph-loop.local.md（项目根目录下）

---
iteration: N
max_iterations: 50
completion_promise: "DONE"
session_id: <UUID>
---
<prompt text 永不改变>
```

### Stop hook 执行流程

```
Stop hook 触发时
        │
        ▼
{1} 状态文件存在？──否──→ 正常退出
        │是
        ▼
{2} session_id 匹配？──否──→ 不干涉
        │是
        ▼
{3} 达 max_iterations？──是──→ 删状态 + 退出
        │否
        ▼
{4} 从 transcript JSONL 抓最后 100 行 assistant
    用 jq 提取末尾 text block
        │
        ▼
{5} 用 perl -0777 抓 <promise>...</promise>
    匹配 completion_promise？
        ├─是──→ 删状态 + 退出（任务完成）
        └─否
        │
        ▼
{6} iteration++ 写回
        │
        ▼
{7} 输出 JSON 阻止 stop：
    { "decision": "block",
      "reason":   "<原 prompt>",
      "systemMessage": "🔄 iteration N" }
```

### 显式枚举的 7 种失败模式

每种都有清晰 stderr + 删状态 + exit 0：

```
1. 状态文件缺失              → exit 0, allow stop
2. session_id 不匹配         → exit 0, don't touch
3. iteration 字段非数字      → rm state, stderr explain, exit 0
4. max_iterations 非数字     → 同上
5. 超 max_iterations         → 干净停止
6. transcript 文件缺失       → rm state, stderr, exit 0
7. transcript 无 assistant   → 同上
8. jq parse 失败             → 同上（捕获 $?）
```

### 关键特性

- **session-scoped**：state file 里存 session_id，不干涉其他 session
- **完成判定**：字符串精确匹配（用 `=`，不是 `==`，因为 glob 字符会破坏）
- **状态存储**：项目内 `.claude/`，跟 git 范畴一致
- **取消方式**：`/cancel-ralph`
- **触发**：`/ralph-loop "<prompt>" --max-iterations N --completion-promise "<text>"`

## 两者协议对比

```
                       /goal (内置)                ralph-loop (社区)
─────────────────      ───────────────────────     ───────────────────────
状态存储               Claude Code 本体内存         项目根 .claude/xxx.md
完成判定               LLM 评估（智能）             字符串精确匹配
迭代次数上限           未知（可能无限）             显式 max_iterations
session 隔离           原生（attachment per-session） state 文件里存 session_id
触发                   /goal <自然语言条件>         /ralph-loop "..." --completion-promise "..."
取消                   /goal clear                  /cancel-ralph
统计                   attachment 含 iterations/tokens 无
注入回 prompt 的内容    系统 message + 评估器 reason 原 prompt 一字不变
源码可读性             不可读（asar 内置）          可读（190 行 bash）
```

## 共同设计哲学

把 Stop hook 当成"逃生门上的锁"。Agent 想结束时先回答"任务真的完成
了吗"。没完成就喂原指令再来一遍，直到条件满足。这就是 Ralph Wiggum
技法（命名取自《辛普森一家》— "I'm a soldier of progress"）：

> "Ralph is a `while true` loop."

简单、无状态、靠 agent 在 transcript 上的自反馈推进。**复杂性留给
任务本身，不进入 loop 控制平面。**
