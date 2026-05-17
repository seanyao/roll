# Upstream AI CLI Compatibility Watch — PRD

**Created**: 2026-05-17
**Status**: Design
**Source**: BACKLOG IDEA-024
**Design prompt**: [docs/design/idea-024-upstream-cli-watch.md](../design/idea-024-upstream-cli-watch.md)
**Trigger**: 连续踩了 Claude Code 升级带来的几个坑（权限弹窗策略变化、launchd PATH 行为变化、stream-json 输出细节调整），都是「先掉进坑里、再回头查问题」。没有任何机制能让 Roll 维护者提前感知上游 CLI 的破坏性变更。

---

## Problem

Roll 是承接多家 AI CLI 能力的元工具（claude、kimi、deepseek、codex、gemini、pi、opencode、trae），对外提供统一的 skill / loop / dream / brief / peer 体验。任何一家上游 CLI 的破坏性升级都可能让 Roll 的承载层（harness engineering）静默失效。

**真实代价**：过去两天踩的几个坑全部是事后排查 —— 找现场、看日志、推断根因、写 FIX，平均每个耗 1-2 小时。如果有提前预警，多数能在 5 分钟内识别并预防。

---

## Solution

**集成到 `roll dream` 作为 Scan 7：上游兼容性扫描**。

```
dream 每晚扫一次
    ↓
拉取 8 家 CLI 的 release notes
    ↓
diff vs 上次扫描记录的「已知最新版本」
    ↓
喂给 AI，对照「关注维度清单」评估每条变更
    ↓
分级输出：high / medium / low / noise
    ↓
high  → 开 FIX-XXX 入 BACKLOG（含评估理由）
medium → 写 ALERT 提示人
low/noise → 落 dream 日志
```

**为什么走 dream 而不是新建 `roll watch`**：
- dream 已有定时（每晚）+ AI 评估 + 输出 REFACTOR/FIX 到 BACKLOG 的成熟管道
- 不增加用户认知负担
- 上游 CLI 升级低频，每晚扫一次足够
- 拟人化叙事自洽：「dream 帮你做梦时顺便溜达一圈，回来告诉你哪里可能有事」

---

## 关注维度清单（初稿）

每条上游变更按这 7 个维度对照评估：

| 维度 | 关注什么 | high 触发条件示例 |
|---|---|---|
| 权限模型 | permission prompt 行为、`--dangerously-skip-permissions` 语义、新增的 flag 默认值 | 「现在 -p 模式默认不能跳权限」 |
| 输出格式 | stream-json schema、事件名、tool icons、JSON 字段命名 | 「tool_use_id 字段重命名」、「新增 thinking 事件类型」 |
| Prompt 协议 | CLAUDE.md / AGENTS.md 注入位置、skill prompt 长度上限、system prompt 拼接顺序 | 「CLAUDE.md 不再自动注入」 |
| 进程行为 | exit code 语义、stdout/stderr 分流、CWD 处理、worktree / sandbox 边界 | 「-p 模式下 exit code 改为 2 表示需要确认」 |
| 调用约定 | `-p` / `-c` flag 含义、stdin 输入方式、prompt 参数位置、env var 命名 | 「ANTHROPIC_API_KEY 改名」 |
| 环境依赖 | hook 协议、settings.json schema、MCP server 配置格式 | 「PreToolUse hook 删除」 |
| 限流/计费 | token 计费方式、上下文窗口、缓存策略、并发限制 | 「prompt cache 默认关闭」 |

清单本身是**活文档**，每次踩新坑都回头补充。版本化存放：`docs/design/idea-024-watch-dimensions.md`。

---

## 拉取来源对照表

| CLI | 主来源 | Fallback | 备注 |
|---|---|---|---|
| claude | GitHub releases (anthropics/claude-code) | `claude --version` + 手动比对 | 频次最高，优先级最高 |
| kimi | npm registry metadata | GitHub releases (MoonshotAI/kimi-cli) | 看哪个更新得快 |
| deepseek | TBD（拉取时探测） | 官网 changelog | DeepSeek TUI 渠道不稳 |
| codex | GitHub releases (openai/codex) | npm | 中速 |
| gemini | GitHub releases (google-gemini/gemini-cli) | `gemini --version` | 中速 |
| pi | GitHub releases | TBD | 低频更新 |
| opencode | GitHub releases (opencode-ai/opencode) | TBD | 低频更新 |
| trae | 官网 changelog | TBD | 文档不规范 |

**失败处理**：任一来源 5xx / 429 / 超时 / 接口变了 → 跳过该 CLI，写 dream 日志，**不阻塞**其他维度扫描。

---

## State 持久化

```yaml
# ~/.shared/roll/dream/watch-state.yaml
last_scan: 2026-05-18T03:00:00+08:00
targets:
  claude:
    last_seen_version: 2.1.4
    last_seen_at: 2026-05-17T20:00:00Z
    last_changelog_hash: sha256:abc...
  kimi:
    last_seen_version: 0.9.2
    ...
```

**Idempotency key**：同一条上游变更不应重复开 FIX —— 用 `(cli, version, changelog_entry_hash)` 三元组去重。

---

## AI 评估 Prompt 骨架

```
SYSTEM:
你是 Roll 的承载层兼容性评估员。Roll 是封装多家 AI CLI 的元工具。下方是一份「关注维度清单」，包含 Roll 真正依赖的接口契约。

任务：判断给定的上游 CLI release notes 条目是否破坏 Roll 的承载层。

输出 JSON：
{
  "tier": "high" | "medium" | "low" | "noise",
  "dimension": "权限模型" | ... ,  // 命中的维度
  "rationale": "<2 句话理由>",
  "suggested_action": "open_fix" | "write_alert" | "log_only",
  "fix_draft_title": "<如果 tier=high，给一个 FIX 标题草稿>"
}

USER:
关注维度清单：
<纳入 docs/design/idea-024-watch-dimensions.md 全文>

待评估的 release notes 条目（来自 {cli} v{version}）：
<条目原文>
```

---

## 集成图

```
┌─────────────────────────────────────────┐
│              roll dream                  │
│  ┌────────────────────────────────────┐ │
│  │ Scan 1: dead code                  │ │
│  │ Scan 2: arch drift                 │ │
│  │ Scan 3: pruning candidates         │ │
│  │ Scan 4: emerging patterns          │ │
│  │ Scan 5: doc coverage gaps          │ │
│  │ Scan 6: doc freshness              │ │
│  │ Scan 7: upstream compatibility ◄── │◄── 新加这一个
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
            │
            ▼
   写 BACKLOG.md (FIX-XXX) / ALERT.md / dream 日志
```

Scan 7 与其他 6 个扫描**并列、互相独立**，失败不影响彼此。

---

## 端到端验收

一次完整跑通时应看到：

```
$ roll dream
[dream] Scan 1-6 ...
[dream] Scan 7: upstream compatibility
  ↳ claude 2.1.3 → 2.1.4: 1 high, 2 medium, 0 low, 3 noise
  ↳ kimi 0.9.2: no change
  ↳ deepseek: fetch failed (logged)
  ↳ ...

[dream] 1 high-impact change → opened FIX-XXX:
  "FIX-XXX: claude 2.1.4 改了 stream-json 的 tool_use_id 字段命名"

[dream] 2 medium-impact changes → ALERT written:
  ~/.shared/roll/loop/ALERT.md (claude 2.1.4: PATH 处理变化)
```

---

## 风险与未决

- **DeepSeek / pi / opencode / trae 的 release notes 来源不规范** —— US-WATCH-002 会逐家定夺，必要时降级为「只看版本号变化、不评估具体条目」
- **AI 评估的稳定性** —— 同一条变更不同次 AI 评估可能给出不同 tier。需要 evaluation prompt 反复打磨；早期阶段允许 false positive（宁可多开一个 FIX 让人快速 dismiss，也不要漏判）
- **dream 总耗时** —— Scan 7 是新增的网络请求 + AI 调用，预计每次新增 30s-2min。需要监控不让 dream 整体跑得过慢
