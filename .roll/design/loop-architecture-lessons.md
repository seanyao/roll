# Long-Running Loop 架构经验 — /goal 与 ralph-loop 对 roll-loop 的启示

> 写于 2026-05-19，源自当天 FIX-064 事故的事后复盘。
> 关联：[loop-state-isolation](../features/loop-observability/loop-state-isolation.md)（FIX-065 治本方案）。

## 缘起

2026-05-19 那次 cycle 跑 FIX-064 时被自己写的测试吓停，连环触发了三轮 cycle 失败、三个悬挂 PR、一个误报 ALERT。事后回看，roll-loop 历史上累积的 FIX-037 / 038 / 040 / 045 / 047 / 052 / 057 / 065 一长串 "loop 自身 bug" 不是孤立事件，而是**长时循环任务设计模型本身**的结构性后果。

恰好那段会话用了 Claude Code 本体的 `/goal` 命令（Stop hook 机制）和社区插件 `ralph-loop`，两者都是同类问题的简化变种。把它们和 roll-loop 三向对比，能看清 roll-loop 哪些复杂性是必要的、哪些是可以消解的。

## 三种 loop 结构的本质差异

```
                     ralph-loop         /goal              roll-loop（当前）
─────────────       ─────────────      ─────────────      ───────────────────
触发位置             单 session 内      单 session 内      跨 session、跨进程
触发方式             反应式（Stop hook） 反应式（Stop hook） 轮询式（launchd cron）
迭代粒度             短（1 turn）       短（1 turn）       长 cycle（10-30 min）
状态存储位置         项目 .claude/      Claude Code 内存   ~/.shared/roll/（全局）
完成检测             promise 字符串匹配 LLM 评估条件       PR 合上 + CI 绿
失败代价             cheap（重启）      cheap（重启）      expensive（残骸要清）
session 隔离         state 带 session_id 原生 attachment   按 project slug
代码量               190 行 bash        不可见（本体）     数千行 bash
累计 race/orphan FIX 0                  0                  8+
```

roll-loop 比那两个野心大得多 — 长 cycle、跨 session、cron 触发、要求真实 PR 合并。**失败面也大得多，每条额外能力都是新的失败维度。**

## 六条核心原则

### 1. 状态文件必须有"测试沙盒契约"

```
ralph-loop 的姿态                roll-loop 的现状
─────────────────────             ─────────────────────
状态 = 项目 .claude/xxx.md        状态 = ~/.shared/roll/...
默认无 fallback                   默认 fallback 到生产路径
session_id 严格匹配               按 project slug 匹配
测试碰不到                        测试可以静默泄漏
```

FIX-065 的根本教训：所有 loop 内部状态文件都该满足"路径必须显式提供，未提供就 abort"。`~/.shared/roll/loop/` 当年是为了让多个 roll 项目共享 daemon 而设计的全局路径，结果让"测试和生产"也共享了同一池——这不是设计意图。

ralph-loop 的做法干脆：状态文件搬到 `.claude/` 项目根下，本身就在 git 范畴内，绝对不会和测试 sandbox 冲撞。

### 2. 完成信号必须和健康信号分离

```
roll-loop 现在的设计（不健康）
                                  ┌─────────────┐
ALERT 文件 ──────────────────→    │  loop 决策  │
state.yaml status: running ───→   │  下一步做啥 │
heartbeat 还在动 ────────────→    │             │
                                  └─────────────┘
任何一处写假信号就能误导决策

ralph-loop / /goal 的设计（健康）
agent 显式发 <promise>DONE</promise> ──→  "完成了吗"
iteration counter ───────────────────→   "还能继续吗"
两个独立通道，agent 只能影响一个，监控只读另一个
```

今天 ALERT 翻车的根因之一：ALERT 文件**既是对外报警出口，又是 loop 自我健康闸门，还能被任何函数写入**。一个文件三种语义，必然出事。

### 3. 反应式触发 vs 轮询触发的本质代价

```
反应式（ralph-loop / /goal）       轮询式（roll-loop）
────────────────────────────       ─────────────────────
触发=Stop hook 自然事件             触发=launchd cron 外部时钟
无并发可能                          必须有 LOCK + heartbeat +
                                      orphan 检测 + cleanup
失败 = 同一 session 内重试          失败 = 跨 cycle 残骸要清
状态最小                            状态多到需要 self-heal

→ 简单、无 race                    → 强大、能跨机器，
                                      但 race 永远修不完
```

FIX-037 / 038 / 040 / 045 / 052 / 057 全是轮询模型的"race + 残骸"问题。**ralph-loop 没有任何一个对应的 FIX**——它根本没这些 race 面。

启发：长 cycle 真的需要 cron 触发吗？还是可以用 `tmux new-window` 启动一个长 session，让 Stop hook 在 session 内串起来？后者把 race 和 orphan recovery 全消除了，代价是失去"机器重启后自动恢复"。

### 4. 状态文件应分层：protocol vs gate

ralph-loop 的状态文件只是**协议载体**（这是第几次迭代、原 prompt 是什么），**不是健康闸门**。健康闸门是 transcript 里的字符串匹配，是只读评估。

roll-loop 的 `state.yaml` 把两件事混在一起：
- 协议（`current_item`, `started_at`, `run_id`）
- 闸门（`status: running/idle/blocked`）

混在一起的后果：任何写一面的人都能误伤另一面。

```
分层建议
┌──────────────────────────────────────────────┐
│  Layer 3  对外信号（人/dashboard 看）        │
│           ALERT、events.ndjson、runs.jsonl   │
│           ← 只能由 cycle controller 写       │
├──────────────────────────────────────────────┤
│  Layer 2  健康闸门（loop 自己读决定走停）    │
│           内存对象 / 进程间显式 RPC          │
│           ← 不落盘，任何测试都摸不到         │
├──────────────────────────────────────────────┤
│  Layer 1  协议载体（cycle 间传递必要状态）   │
│           state.yaml 仅含 idle/running 元信息│
│           ← 落盘但带签名，写入需要 token     │
└──────────────────────────────────────────────┘
```

### 5. 失败模式要枚举，不是发现

ralph-loop 190 行 bash 显式枚举 7 种失败：

```
1. 状态文件缺失       → exit 0, allow stop
2. session_id 不匹配  → exit 0, don't touch
3. iteration 字段非数字 → rm state, stderr explain, exit 0
4. max_iterations 非数字 → 同上
5. 超 max_iterations  → 干净停止
6. transcript 文件缺失 → rm state, stderr, exit 0
7. transcript 无 assistant message → 同上
8. jq parse 失败      → 同上（捕获 $?）
```

每一种都有清晰 stderr + 删状态 + exit 0。**显式优雅退出永远比假设状态正确更稳。**

roll-loop 是反过来——FIX-037 到 FIX-065 全是"发现一个修一个"。这是 evolved system 的本性，但可以反思：

```
新加任何状态文件前要回答的 8 个问题：

  1. 文件缺失时怎么办？
  2. 文件被并发写时怎么办？
  3. 文件被测试踩到怎么办？      ← FIX-065 漏了
  4. 文件被外部清掉怎么办？
  5. 文件版本不兼容怎么办？
  6. session_id/run_id 不匹配怎么办？  ← FIX-052 漏了
  7. PID 复用怎么办？              ← FIX-038 漏了
  8. 超时怎么办？                  ← FIX-057 漏了

五项以下基本意味着没想清楚。
```

### 6. Ralph 哲学：保留一个 dumb fallback

> "Ralph is a `while true` loop. The prompt never changes."

ralph-loop 的核心是**简单到无聊**：原 prompt 一字不变喂回去，靠 agent 读文件状态自己改善。

roll-loop 不是这个哲学——它**主动给 agent 注入新上下文**（哪个 story、当前 backlog、之前的 commit、CI 状态……）。让 cycle 更"聪明"但也更脆弱。每一个上下文注入都是新的失败面。

启发不是放弃 roll-loop 的设计，而是**保留一个 fallback 模式**：当智能注入失败 N 次后，降级为"把 backlog.md 整个文件丢给 agent，让它自己选"——最 dumb 但最不会出错。

## 三条最 actionable 的改造路径

按治本程度排序：

```
P1 ── 状态文件搬到项目内
       ~/.shared/roll/loop/   →   .roll/loop/
       彻底切断"测试和生产共池"的可能
       FIX-065 + 未来一类同源 bug 全消
       配套：测试 harness 强制 _SHARED_ROOT=$TEST_TMP override

P2 ── 健康闸门内存化，落盘的只剩协议
       state.yaml 只保留"上次跑了啥、什么时候、谁"
       ALERT 改成纯出口（loop 只写不读）
       loop 决策走另一条独立通道（pidfile + signal / RPC）

P3 ── 引入 completion_promise 思想
       每个 cycle 结束时 agent 必须显式输出
       result: success | failed | partial 的结构化信号
       loop 不再靠"PR 是否合并 + ALERT 是否存在"反推状态
       agent 自己说自己干完了什么
```

这三条做完，剩下 50% 的 race/orphan FIX 系列会自然失去意义——race surface 本身缩小了。

## 参考：两者的具体实现

这份文档关注的是**设计原则**而非实现细节。Claude Code 内置 `/goal` 的协议反推、ralph-loop 的状态机和失败模式枚举、两者的共同设计哲学（Ralph Wiggum 技法），单独整理在 [claude-code-goal-mechanism](./claude-code-goal-mechanism.md)。

简而言之：两者都把 Stop hook 当成"逃生门上的锁"，agent 想结束时先回答"任务真的完成了吗"，没完成就喂原指令再来一遍。**复杂性留给任务本身，不进入 loop 控制平面。**

roll-loop 是反过来的选择——loop 控制平面承担了大量"我该做什么 / 跑得健康吗 / 上一轮怎样了"的逻辑。这个选择带来 race surface 也带来能力，但每一个能力都该问一句"它能不能被 Ralph 哲学消化掉"。
