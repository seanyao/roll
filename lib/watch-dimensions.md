# 上游 AI CLI 关注维度清单

> Upstream AI CLI Compatibility Watch Dimensions Checklist
>
> Version: 1
> Source: IDEA-024
> Created: 2026-05-23

Roll 承接多家 AI CLI 的能力。任一上游的破坏性升级都可能让 Roll 的承载层静默失效。
本清单定义 AI 评估上游变更时的对照维度 —— 每条变更按这 7 个维度打分，输出 high / medium / low / noise 四级。

---

## 维度表

| # | 维度 | 关注什么 | high 触发条件示例 |
|---|------|---------|------------------|
| 1 | 权限模型 | permission prompt 行为、`--dangerously-skip-permissions` 语义、新增 flag 的默认值 | 「-p 模式现在默认不跳权限」、「新增 permission rule 必须显式声明」 |
| 2 | 输出格式 | stream-json schema、事件名、tool icons、JSON 字段命名 | 「tool_use_id 字段重命名」、「新增 thinking 事件类型」、「assistant message content 结构变化」 |
| 3 | Prompt 协议 | CLAUDE.md / AGENTS.md 注入位置、skill prompt 长度上限、system prompt 拼接顺序 | 「CLAUDE.md 不再自动注入」、「system prompt 优先级变化」 |
| 4 | 进程行为 | exit code 语义、stdout/stderr 分流、CWD 处理、worktree / sandbox 边界 | 「-p 模式下 exit code 改为 2 表示需要确认」、「sandbox 默认启用后 CWD 不可写」 |
| 5 | 调用约定 | `-p` / `-c` flag 含义、stdin 输入方式、prompt 参数位置、env var 命名 | 「ANTHROPIC_API_KEY 改名」、「-p 不再接受 stdin」 |
| 6 | 环境依赖 | hook 协议、settings.json schema、MCP server 配置格式 | 「PreToolUse hook 删除」、「settings.json 新增 required 字段」 |
| 7 | 限流/计费 | token 计费方式、上下文窗口、缓存策略、并发限制 | 「prompt cache 默认关闭」、「max_tokens 默认值下调」 |

---

## 分级标准

| Tier | 含义 | 建议动作 | 示例 |
|------|------|---------|------|
| **high** | Roll 承载层接口直接断裂 —— 不改代码 Roll 会功能失效 | 开 FIX-XXX 入 BACKLOG，附评估理由 | stream-json 事件名改了，loop 的 CI gate 不再能解析 CI 结果 |
| **medium** | 行为变化可能影响 Roll 但不一定断裂 —— 需要人关注 | 写 ALERT 提示人 | exit code 语义微调，现有判断逻辑可能在边界条件下误判 |
| **low** | Roll 不直接依赖的变化 —— 仅影响下游用户体验 | 落 dream 日志 | 新增了一个 Roll 没用到的 flag |
| **noise** | 与 Roll 承载层完全无关 | 不记录 | 文档更新、UI 调整、与承载无关的新功能 |

---

## 评估指引

AI 评估时逐条对照：
1. 这条变更碰了清单里哪个维度？
2. 碰到的维度在当前 Roll 代码里有没有对应的依赖点？
3. 依赖点被破坏后 Roll 的哪个功能会失效？
4. 失效的是核心路径（loop/peer/build）还是边缘路径？

**原则**：
- 拿不准时宁可高估一级（medium → high），让人类快速 dismiss 好过漏判
- 同一 CLI 同一版本的多个条目独立评估，但同维度有 ≥2 条 high 时可以合并成一个 FIX
- 只评估当前版本与 `last_seen` 之间的增量变更，不回顾历史

---

## 维护约定

- 每踩新坑后补充新维度或细化现有维度的触发条件
- 版本号递增（`Version: N`），AI 评估 prompt 带版本号便于追溯
- 新增维度不影响已评估历史的 tier 结论
