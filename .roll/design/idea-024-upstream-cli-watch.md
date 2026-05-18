# IDEA-024 设计 prompt — 上游 AI CLI 兼容性监视

> Upstream AI CLI Compatibility Watch — Design Prompt
>
> Source: BACKLOG IDEA-024
> Status: 待 roll-design 出稿
> Drafted: 2026-05-17

把下面这段 prompt 拷给一个独立设计会话（建议用 `$roll-design`）。Prompt 自包含。

---

## Prompt

# 任务

为 Roll 设计一个「上游 AI CLI 兼容性监视」机制：定时拉取支持的几家 AI CLI 的 release notes，
AI 评估每次升级是否影响 Roll 的承载层（harness engineering），有影响就开 FIX 或写 ALERT。

请给出**架构与集成设计**，不是写代码 —— 重点在选型立场、数据流、和已有系统的协作。

# 背景

Roll 是一个跨多家 AI CLI 的元工具：作为 harness 承接 Claude Code、Kimi、DeepSeek、Codex、Gemini
等的能力，对外提供统一的 skill / loop / dream / brief / peer 体验。

**问题**：过去几天连续被 Claude Code 的升级踩了好几个坑（权限弹窗策略变化、新版 prompt 格式、
launchd PATH 行为、stream-json 输出细节等）。每次都是「先掉进坑里，再回头查问题」。
没有任何机制能让我们**提前感知**上游 CLI 的破坏性变更。

# 设计目标

让 Roll 维护者（人或 dream）能在每次上游 CLI 升级后 **24 小时内**得到一份评估：
1. 哪几家 CLI 在过去一段时间里发了新版？
2. 各自 release notes 里哪几条变更可能影响到 Roll 的承载层？
3. 影响的严重度（破坏性 / 行为变更 / 无关）？
4. 建议动作（开 FIX 哪条 / 写 ALERT / 等下次踩坑再说）？

# 监视范围

至少覆盖：
- `claude` (Anthropic Claude Code)
- `kimi` (Moonshot Kimi CLI)
- `deepseek` (DeepSeek TUI)
- `codex` (OpenAI Codex CLI)
- `gemini` (Google Gemini CLI)
- `pi` (pi-coding-agent)
- `opencode` (opencode)
- `trae` （Trae CLI）

每家的 release notes / changelog 来源可能不同（GitHub releases / npm / 官网 / 直接 CLI `--changelog`）。
设计时要列清楚每家的拉取来源和兜底策略。

# 「影响承载层」是什么意思？

Roll 的承载层包括但不限于：
- 权限模型（permission prompts、`--dangerously-skip-permissions` 等 flag）
- 输出格式（stream-json 事件结构、`✏` / `→` 等符号约定）
- prompt 协议（CLAUDE.md / AGENTS.md 注入位置、skill prompt 长度上限）
- 进程行为（exit code、stdout/stderr 分流、CWD 处理、worktree / sandbox 限制）
- 调用约定（`-p` flag 含义、stdin 输入、prompt 参数位置）
- 环境依赖（hook / settings.json / MCP server 配置）

设计时**给出一份「关注维度清单」**，明确什么变化算 high-impact、什么算 medium、什么 noise。
AI 评估时拿这份清单做对照。

# 集成位置（已定）

经过讨论已确定：**集成到 `roll dream` 作为新增扫描维度（Scan 7：上游兼容性）**，
不另起 `roll watch` 子命令。理由：
- dream 已有定时（每晚）+ AI 评估 + 输出 REFACTOR/FIX 到 BACKLOG 的成熟管道
- 不增加用户认知负担
- 上游 CLI 升级不是高频事件，每晚扫一次足够
- 命名上「dream 帮你做梦的时候顺便去外面溜达一圈」叙事自洽

# 数据流（建议）

```
[每晚 dream cron]
    ↓
[Scan 7: 拉每家 CLI 的 release notes]
    ↓
[diff vs 上次扫描时记录的最新版本]
    ↓
[AI 用「关注维度清单」评估每条变更]
    ↓
[输出分级清单：high / medium / low / noise]
    ↓
[high → 开 FIX-XXX 入 BACKLOG，medium → 写 ALERT，low/noise → 只落 dream 日志]
```

# 约束

- 复用 dream 现有的 cron、日志、BACKLOG 写入路径，不另起调度
- 上次扫描的「已知最新版本」需要持久化（建议 `~/.shared/roll/dream/watch-state.yaml`）
- 拉取失败（限流 / 网络 / 接口变了）要 graceful degrade —— 写日志但不阻塞 dream 其余扫描
- 同一条上游变更不应重复开 FIX —— 需要 idempotency 机制（hash / 版本号去重）
- AI 评估要可审计 —— 把「这条变更为什么被评为 high」的理由也写进 FIX 描述

# 期望的设计深度

**不要**：
- 写代码 / 写 bash 函数实现
- 把它做成另一个独立命令（已确定走 dream Scan 7）
- 过度工程：不需要订阅 / push / webhook，pull 即可

**要**：
- 「关注维度清单」的初稿（具体到 5-10 条 high-impact 维度）
- 每家 CLI 的 release notes 拉取来源 + fallback 方案（一张表）
- AI 评估 prompt 的设计骨架（系统提示 + 输入格式 + 输出 schema）
- 与 dream 现有 6 个 scan 的位置关系（顺序、依赖、互斥）
- idempotency 机制设计（去重 key 怎么取，state 怎么存）
- 失败处理 / 限流策略
- 验收标准：一次完整端到端跑通的预期产出长什么样

# 交付物

一份设计文档，包含：
1. 「关注维度清单」表格
2. 每家 CLI 的拉取来源对照表
3. AI 评估 prompt 骨架
4. dream 集成图（新 scan 在哪、读写哪些 state 文件）
5. 输出示例（high / medium / low 各一条）
6. 验收标准（end-to-end 跑通时该看到什么）
7. 风险与未决问题（哪些 CLI 暂时没有合适的 release notes 来源？）

---

## 设计产出位置

design agent 出稿后，建议存到同目录下：

- `idea-024-upstream-cli-watch-design.md` — 主设计文档
- `idea-024-watch-dimensions.md` — 关注维度清单（独立维护，会逐步迭代）
