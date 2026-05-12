# Roll Proposals

> 待审批提案。批准后手工移入 BACKLOG.md 并分配 US-XXX 编号。
> 拒绝时在条目末尾注明拒绝原因，防止 Agent 重复提出相似提案。

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
