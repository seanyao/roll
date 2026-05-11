# Roll Proposals

> 待审批提案。批准后手工移入 BACKLOG.md 并分配 US-XXX 编号。
> 拒绝时在条目末尾注明拒绝原因，防止 Agent 重复提出相似提案。

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
