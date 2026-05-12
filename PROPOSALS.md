# Roll Proposals

> 待审批提案。批准后手工移入 BACKLOG.md 并分配 US-XXX 编号。
> 拒绝时在条目末尾注明拒绝原因，防止 Agent 重复提出相似提案。

---
proposed: 2026-05-12 17:00
status: pending
---

## PROPOSAL: Loop 故事完成后自动创建 Draft PR

**Motivation (why):**
Loop 完成一个故事后，commits 已推送，但用户仍需手动跑到 GitHub 创建 PR、填写描述、关联 story。这段手工操作打断了"自主执行 → 人工审核"的交接节奏。US-NOTIFY-001 刚上线，用户现在能被通知"做完了"，但下一步"打开 PR 来审"的成本还是全手工。

**Target scenario:**
```bash
# Loop 完成 US-AUTO-027 后，自动创建草稿 PR 并推送通知：
#
#   ✅ Roll Loop  [roll]
#   US-AUTO-027 完成 — peer 调用 auto-attach
#   PR #42 已创建（草稿）→ https://github.com/user/repo/pull/42

# 用户点通知或运行 roll loop runs 看到：
#   US-AUTO-027  completed  PR #42 (draft)  2026-05-12 03:15

# 如果仓库没有 remote 或 gh 未登录，静默跳过（不报错）
# PR 标题自动使用 story 描述，body 包含：story ID、AC 列表、commit range

# 可在 ~/.roll/config.yaml 控制
# loop:
#   auto_pr: true          # 默认 true（有 gh 时）
#   pr_draft: true         # 默认 draft，不自动 ready-for-review
```

**Acceptance Criteria (draft):**
- [ ] roll-loop skill 在 Phase 11（故事完成写回 BACKLOG）之后，若 `gh` 可用且仓库有 remote，自动执行 `gh pr create --draft`
- [ ] PR 标题 = story 描述，body 包含 story ID、AC 状态、commit 列表（`git log --oneline <base>..<head>`）
- [ ] PR URL 写入 `runs.jsonl` 的本次运行记录，`roll loop runs` 显示
- [ ] macOS 通知消息附带 PR URL（配合 US-NOTIFY-001）
- [ ] `~/.roll/config.yaml` 支持 `loop.auto_pr: false` 关闭；`loop.pr_draft: false` 改为直接 ready-for-review
- [ ] 无 `gh`、无 remote、或 `auto_pr: false` 时静默跳过，不产生错误或警告

**Suggested ID:** US-LOOP-002
**Suggested Epic / Feature:** 自主循环可观测性 / 交接体验
**Estimated complexity:** M（roll-loop skill 扩展 + gh 命令封装 + runs.jsonl 字段 + config 读取）

---

## PROPOSAL: BACKLOG Story 依赖声明 (`depends-on`)

**Motivation (why):**
BACKLOG 里有些故事天然有先后顺序——例如"UI 组件"必须等"后端接口"完成才能开工，或"文档补全"要等对应功能落地。目前用户只能靠手动调整 BACKLOG 表格行顺序来控制执行序，loop 不理解依赖关系，可能选中一个前置条件未完成的故事并白跑一遍。

**Target scenario:**
```bash
# BACKLOG.md 中在 story 描述后面加依赖标注（可选）
# | US-DOC-007 | 补写 loop 英文指南 `depends-on:US-DOC-001` | 📋 Todo |

# loop dispatcher 在选 story 时：
# 1. 发现 US-DOC-007 depends-on US-DOC-001
# 2. 检查 US-DOC-001 状态 → ✅ Done → 可执行
# 3. 若依赖未 Done → 跳过，选下一个 Todo

# roll loop next 中展示依赖状态：
#   Next story: US-DOC-007
#   Depends on: US-DOC-001 ✅ (satisfied)

# roll backlog 展示时对"依赖未满足"的 Todo 加 🔒 标记
#   🔒 US-DOC-007  补写 loop 英文指南  [depends-on: US-DOC-001 ⏳]

# roll-build 非自主模式同样检查依赖，未满足时给出提示而非阻断
```

**Acceptance Criteria (draft):**
- [ ] BACKLOG.md story 描述支持 `depends-on:<US-ID>` 内联标注（可多个，逗号分隔）
- [ ] roll-loop dispatcher 在选 story 前解析依赖，跳过依赖未满足（非 ✅ Done）的故事
- [ ] `roll loop next` 输出依赖状态（满足 ✅ / 待完成 ⏳）
- [ ] `roll backlog` 命令对未满足依赖的故事显示 🔒 标记
- [ ] `roll-build` skill 在执行前检查依赖，未满足时输出提示（不阻断，人工可强制继续）
- [ ] 无 `depends-on` 标注的故事行为与当前完全一致（向后兼容）

**Suggested ID:** US-BACKLOG-002
**Suggested Epic / Feature:** Backlog 生命周期管理
**Estimated complexity:** M（BACKLOG 解析增强 + dispatcher 逻辑 + roll backlog/loop next 显示）

---
proposed: 2026-05-12 14:30
status: approved
approved_id: US-ALERT-001
---

## PROPOSAL: `roll alert` 命令 — ALERT 生命周期管理

**Motivation (why):**
Loop 在遇到阻塞或 TCR 校验失败时会向 BACKLOG.md 写入 ALERT 注释，但之后没有任何专门的管理机制。用户需要手动翻阅 BACKLOG.md 才能发现告警，确认和关闭也全靠人工编辑。随着项目运行时间增长，ALERT 会悄无声息地积累成"死角"。

**Target scenario:**
```bash
# 查看当前所有未确认告警
roll alert

# 输出示例：
#   ⚠ 2 open alerts
#   [ALERT] US-AUTO-010  TCR 微提交数为 0，故事已回退 📋 Todo  (2026-05-11 03:12)
#   [ALERT] FIX-016      launchd ghost 服务清理失败，teardown 需手动 bootout  (2026-05-10 22:05)
#
#   运行 roll alert ack <ID> 确认，roll alert resolve <ID> 标记已解决

# 确认（我看到了，稍后处理）
roll alert ack US-AUTO-010

# 解决（问题已处理）
roll alert resolve FIX-016 "已手动 bootout 并更新 teardown"

# roll brief 和 roll status 中告警摘要只显示 open/acked 状态，resolved 不再重复提示
```

**Acceptance Criteria (draft):**
- [ ] `roll alert` 列出 BACKLOG.md 中所有 `[ALERT]` 注释，按时间倒序，标记状态（open / acked / resolved）
- [ ] `roll alert ack <pat>` 在 ALERT 注释行追加 `[acked: YYYY-MM-DD]` 标记
- [ ] `roll alert resolve <pat> [message]` 追加 `[resolved: YYYY-MM-DD message]` 并将行样式从 ⚠ 改为 ✓
- [ ] `roll status` 和 `roll-brief` 只计入 open+acked 告警数，已 resolved 不计入
- [ ] `roll loop runs` 摘要中告警列仅展示 open 状态

**Suggested ID:** US-ALERT-001
**Suggested Epic / Feature:** Backlog 生命周期管理
**Estimated complexity:** M（bin/roll 新命令 + BACKLOG 解析/标注 + brief/status 联动）

---

---
proposed: 2026-05-12 14:30
status: approved
approved_id: US-NOTIFY-001
---

## PROPOSAL: macOS 系统通知推送 — loop 关键事件主动触达

**Motivation (why):**
Loop 是后台自主运行的，当它在凌晨完成一个 Story 或因 TCR 失败触发 ALERT 时，用户必须主动去 `roll loop runs` 或 `roll status` 才能发现。真正的"自主"应该是"完成了主动告诉你"，而不是"你去问才知道"。当前 auto-attach tmux 解决的是"我在看"的场景，但无法覆盖"我不在但想知道结果"的场景。

**Target scenario:**
```bash
# 默认行为（无需配置）：loop 每次完成 story 或写入 ALERT，
# 发一条 macOS 系统通知（Notification Center）

# 通知示例：
#   🎉 Roll Loop  [roll]
#   US-AUTO-027 完成 — peer 调用 auto-attach
#
#   ⚠ Roll Alert  [roll]
#   US-AUTO-010 TCR 校验失败，已回退 Todo

# 可在 ~/.roll/config.yaml 控制通知级别
# notifications:
#   story_done: true      # 故事完成
#   alert: true           # 新 ALERT
#   brief_ready: false    # 每日简报生成（默认关）
#   channel: macos        # macos | off | webhook（扩展点）

# 临时静音（与 roll loop mute 联动）
roll loop mute           # 同时静音 auto-attach 和系统通知
roll loop mute --notify  # 仅静音系统通知，保留 attach
```

**Acceptance Criteria (draft):**
- [ ] loop runner script 在 story 完成时调用 `osascript -e 'display notification ...'`（无需安装额外工具）
- [ ] loop runner 在写入 ALERT 时同样触发通知
- [ ] `~/.roll/config.yaml` 支持 `notifications.story_done` / `notifications.alert` 布尔开关
- [ ] `roll loop mute` 已存在，扩展其作用范围到通知静音（或加 `--notify` flag 独立控制）
- [ ] `roll-brief` skill 支持可选的 brief_ready 通知（默认关闭）
- [ ] 无 macOS 环境（CI / Linux）时静默降级，不报错

**Suggested ID:** US-NOTIFY-001
**Suggested Epic / Feature:** 自主循环可观测性
**Estimated complexity:** S-M（runner script 扩展 + config.yaml 读取 + mute 联动）

---
proposed: 2026-05-12 14:45
status: pending
---

## PROPOSAL: `roll help <skill>` — 技能内联快速参考

**Motivation (why):**
项目已有 20+ 个 skill，用户常常记不住该用哪个、有哪些 flag、什么时候不该用。目前唯一的方式是打开 `~/.claude/skills/roll-xxx/skill.md` 自己阅读，上下文切换成本高。`$roll-build`、`$roll-fix`、`$roll-design` 各有细微差别，新用户尤其迷失。

**Target scenario:**
```bash
# 快速查看某个 skill 的摘要
roll help roll-build

# 输出：
#   roll-build — 执行 BACKLOG 中的 Story，完整 TCR 节奏
#
#   When to use:
#     Story 已设计完成、AC 明确、可以直接动手实现
#
#   When NOT to use:
#     需求模糊 → $roll-.clarify
#     技术方案未定 → $roll-design
#     修 bug → $roll-fix
#
#   Usage:
#     $roll-build                    # 从 BACKLOG 选 Todo story
#     $roll-build --from-idea IDEA-N # 直接从 IDEA 晋升执行
#
#   Flags:  --from-idea  --non-interactive

# 列出所有可用 skill
roll help --list

# 输出：
#   roll-build       执行 BACKLOG Story（TCR 节奏）
#   roll-fix         修复 Bug / FIX-NNN（TCR 节奏）
#   roll-design      技术方案设计，输出 Feature doc
#   roll-debug       运行时诊断 + BB 注入
#   roll-peer        跨 Agent 代码评审
#   ...（共 N 个）
```

**Acceptance Criteria (draft):**
- [ ] `roll help <skill>` 从对应 skill 目录的 `skill.md` 提取：描述、When to Use、When Not to Use、用法示例，格式化输出到终端
- [ ] `roll help --list` 输出所有 skill 的单行摘要（名称 + 第一句描述）
- [ ] 未找到 skill 时提示相近名称（模糊匹配）
- [ ] 内容直接从 skill.md 文件实时读取，无需单独维护 help 数据源

**Suggested ID:** US-HELP-001
**Suggested Epic / Feature:** 技能可发现性
**Estimated complexity:** S（bin/roll 新子命令 + skill.md 解析，无需改 skill 文件）

---

## PROPOSAL: `roll loop next` — 下次循环将执行故事预览

**Motivation (why):**
Loop 的故事选择逻辑（优先 🔨 In Progress → 再选第一个 📋 Todo，跳过 ⏸ Deferred）对用户是黑盒。用户不知道"loop 下次会做什么"，只能等它跑完看 `roll loop runs`。当 BACKLOG 顺序不理想或有多个 Todo 时，用户无法提前确认 loop 的选择，也无法在不真正触发执行的情况下调试优先级。

**Target scenario:**
```bash
# 在任意时刻查看 loop 下次将选哪个 story
roll loop next

# 输出：
#   Next story: US-BACKLOG-001
#   Deferred 到期提醒 — `roll backlog defer --until`
#   Status: 📋 Todo
#   Epic: Backlog 生命周期管理
#
#   Selection reason: first Todo story (no In Progress found)
#
#   To change order: edit BACKLOG.md story table position
#   To skip this story: roll backlog defer US-BACKLOG-001 <reason>

# 如果有 In Progress：
#   Next story: US-DOC-007  [🔨 In Progress — resumed]
#   Selection reason: existing In Progress takes priority

# 如果 BACKLOG 为空或全部 Done：
#   No pending stories. Loop will run roll-.dream instead.
```

**Acceptance Criteria (draft):**
- [ ] `roll loop next` 复现 loop dispatcher 的选择逻辑，输出将被选中的 story 和选择原因
- [ ] 不触发任何实际执行，纯读 BACKLOG.md（dry-run 语义）
- [ ] 输出包含：story ID、描述、状态、所属 Epic、选择原因
- [ ] 当无可执行 story 时说明 loop 将转入 dream/brief 模式
- [ ] 选择逻辑与 `roll-loop` skill 的 dispatcher 保持同步（单一来源）

**Suggested ID:** US-LOOP-001
**Suggested Epic / Feature:** 自主循环可观测性
**Estimated complexity:** S（bin/roll 新子命令 + BACKLOG 解析，选择逻辑已在 roll-loop skill 中有定义）

---
proposed: 2026-05-12 01:15
status: pending
---

## PROPOSAL: Deferred 到期提醒 — `roll backlog defer --until`

**Motivation (why):**
用户把某个 US 推迟后，原因往往是"时机不对"而非"永远不做"。但推迟之后很容易被遗忘，没有机制提醒用户重新评估，导致 Deferred 列表越积越长、成为死区。

**Target scenario:**
```bash
# 推迟时附带重新评估日期
roll backlog defer US-DOC "过早引入" --until 2026-08-01

# roll brief 在每日简报里自动浮出到期条目
#   ⏸ Deferred — 到期待评估 (1)
#     US-DOC-001  建立 docs/guide/en/  [到期: 2026-08-01, 原因: 过早引入]
#     → 运行 roll backlog promote US-DOC 恢复，或 roll backlog defer US-DOC --until <新日期> 续期

# 用户也可以主动查询
roll backlog deferred          # 列出所有 Deferred，高亮已到期
```

**Acceptance Criteria (draft):**
- [ ] `roll backlog defer <pat> <reason> --until <YYYY-MM-DD>` 将日期写入 status 字段：`⏸ Deferred [reason] until:2026-08-01`
- [ ] `roll backlog` 展示 Deferred 区块时，对已到期条目加高亮标注（而非 dim）
- [ ] `roll-brief` skill 在每日简报里检查到期的 Deferred 条目并单独列出
- [ ] 无 `--until` 时行为与现有 defer 完全一致（无 breaking change）

**Suggested ID:** US-BACKLOG-001
**Suggested Epic / Feature:** Backlog 生命周期管理
**Estimated complexity:** M（bin/roll 的 defer 解析 + brief skill 扩展 + 显示逻辑）

---
merged_into: IDEA-008
merged_reason: 跨项目总览是 dashboard 重设计（IDEA-008）的核心信息层，应在 `$roll-design --from-idea IDEA-008` 时统一规划，不单独立项
---

## PROPOSAL: 跨项目全局视图 — `roll fleet` *(已并入 IDEA-008)*

> 与 IDEA-008「roll dashboard 重设计」高度重叠。
> 审批时用 `$roll-design --from-idea IDEA-008` 统一规划，fleet 视图作为其中一个信息层输出。

**Motivation (why):**
用户在多个项目里都启用了 roll loop，但每次查看状态都需要 cd 进各个目录分别运行 `roll`。没有一个地方能同时看到所有项目的 pending 数量、loop 是否运行、最近是否有异常。这正是 IDEA-008「入口体验应该更好」的核心诉求之一。

**Target scenario:**
```bash
# 在任意目录运行
roll fleet

# 输出：
#   Roll Fleet  项目总览
#
#   ● roll          loop on   7 pending   2 blocked   last brief: 今天 08:00
#   ● bipo-backend  loop on   3 pending   0 blocked   last brief: 今天 07:58
#   ○ my-side-proj  loop off  12 pending  —           last brief: 3天前
#   ⚠ openclaw      loop on   0 pending   —           ALERT: 1 orphan 🔨
#
#   Total: 4 projects · 22 pending · 1 alert
```

**Acceptance Criteria (draft):**
- [ ] `roll fleet` 扫描所有已知 roll 项目（读取 `~/.roll/projects.list` 或从 launchd plist 自动发现）
- [ ] 每行显示：项目名、loop 状态、pending 数、blocked 数、last brief 时间、有无 ALERT
- [ ] `roll fleet cd <name>` 输出 `cd <path>` 供 shell eval（`eval $(roll fleet cd roll)`）
- [ ] 项目列表自动维护：`roll loop on` 时注册

**Suggested ID:** 并入 IDEA-008 → 用 `$roll-design --from-idea IDEA-008` 拆分
**Suggested Epic / Feature:** Dashboard 重设计
**Estimated complexity:** M（作为 IDEA-008 的一个子 story）
