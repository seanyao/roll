# Autonomous Evolution

> Epic: 为 Roll 引入自主演化能力。Agent 可在无人干预的情况下持续执行、自我反思、
> 自我重构；人类只在简报后决定是否发布。

---

<a id="us-auto-001"></a>
## US-AUTO-001 roll-build 架构摩擦信号 📋

**Created**: 2026-05-10

- As a developer using roll-build
- I want architectural strain detected during Story implementation to be automatically flagged
- So that REFACTOR entries accumulate in BACKLOG without interrupting current work

**Domain Model:**
- Context: Build
- Aggregate: Story execution flow
- Events raised: [ArchitectureFrictionDetected] → BACKLOG (REFACTOR entry)

**AC:**
- [ ] roll-build 在实现过程中识别架构摩擦信号（需大规模改动现有结构、模块边界不清晰、跨 Context 耦合等）
- [ ] 自动在 BACKLOG.md 追加 `REFACTOR-XXX` 条目（含触发 Story ID、摩擦描述）
- [ ] 不中断当前 Story 实现流程
- [ ] 摩擦详情写入 `docs/features/refactor-log.md`

**Files:**
- `skills/roll-build/SKILL.md`
- `BACKLOG.md`
- `docs/features/refactor-log.md`（按需创建）

**Dependencies:**
- Depended on by: US-AUTO-004（loop 执行 REFACTOR 条目）

---

<a id="us-auto-002"></a>
## US-AUTO-002 roll-dream 📋

**Created**: 2026-05-10

- As an autonomous agent system
- I want a nightly skill that reviews code structure and architecture health
- So that technical debt and architectural drift are surfaced proactively as REFACTOR entries

**Domain Model:**
- Context: Autonomous Evolution
- Aggregate: Codebase health state
- Events raised: [DreamCompleted] → BACKLOG (REFACTOR entries) + docs/dream/

**AC:**
- [ ] 新建 `skills/roll-dream/SKILL.md`，定义巡检逻辑：死代码、架构漂移（对比 `docs/domain/`）、可修剪抽象、可提炼模式
- [ ] 产出 `REFACTOR-XXX` 条目写入 BACKLOG.md
- [ ] 巡检报告写入 `docs/dream/YYYY-MM-DD.md`
- [ ] SKILL.md 明确与 `roll-sentinel` 的区别（sentinel 看运行时，dream 看代码结构）
- [ ] SKILL.md 包含 cron 和 GitHub Actions 两种调度配置示例

**Files:**
- `skills/roll-dream/SKILL.md`（新建）
- `BACKLOG.md`
- `docs/dream/`（按需创建）

**Dependencies:**
- Depended on by: US-AUTO-004

---

<a id="us-auto-003"></a>
## US-AUTO-003 roll-brief 📋

**Created**: 2026-05-10

- As a human product owner
- I want periodic briefings summarizing what the agent has done
- So that I can stay informed and make confident release decisions without being in the execution loop

**Domain Model:**
- Context: Autonomous Evolution
- Aggregate: Project state snapshot
- Events raised: [BriefGenerated] → docs/briefs/

**AC:**
- [ ] 新建 `skills/roll-brief/SKILL.md`
- [ ] 三种触发模式：Feature 完成时自动触发、每日早晨定时触发、`$roll-brief` 按需调用
- [ ] 简报内容：已完成（US/FIX/REFACTOR）、进行中、BACKLOG 队列概况、需人类介入的升级项、发布就绪建议
- [ ] 输出到 `docs/briefs/YYYY-MM-DD-HH.md`
- [ ] 明确区别于 `roll-.changelog`：简报是 owner 面内部消化，changelog 是用户面发布说明

**Files:**
- `skills/roll-brief/SKILL.md`（新建）
- `docs/briefs/`（按需创建）

**Dependencies:**
- Depended on by: US-AUTO-004（loop 在适当时机触发 brief）

---

<a id="us-auto-004"></a>
## US-AUTO-004 roll-loop 📋

**Created**: 2026-05-10

- As an autonomous agent system
- I want an hourly BACKLOG executor that routes and runs pending items automatically
- So that the project can self-evolve end-to-end without human intervention in execution

**Domain Model:**
- Context: Autonomous Evolution
- Aggregate: Execution scheduler
- Events raised: [LoopCycleCompleted], [LoopPaused] → state.yaml + ALERT

**AC:**
- [ ] 新建 `skills/roll-loop/SKILL.md`，定义路由逻辑：US-XXX → `$roll-build`，FIX-XXX → `$roll-fix`，REFACTOR-XXX → `$roll-build`
- [ ] `~/.roll/config.yaml` 支持 `loop.primary` / `loop.fallback` agent 配置
- [ ] 调度器基础设施：GitHub Actions cron 配置模板 + 本地 cron 安装说明
- [ ] 失败处理：网络错误指数退避（2s/4s/8s/16s）→ token 耗尽切换 fallback agent → 持续失败暂停写 ALERT
- [ ] 状态文件 `~/.shared/roll/loop/state.yaml`：记录当前执行项、断点，支持恢复
- [ ] 执行边界：`roll-release` 步骤不自动执行，升级到 `roll-brief` 通知人类
- [ ] 在适当节点自动触发 `roll-brief`（Feature 完成时）

**Files:**
- `skills/roll-loop/SKILL.md`（新建）
- `conventions/global/AGENTS.md`（补充 loop 调度说明）
- `.github/workflows/roll-loop.yml`（GitHub Actions 模板，新建）
- `~/.roll/config.yaml`（新增 loop 配置段说明）

**Dependencies:**
- Depends on: US-AUTO-001, US-AUTO-002, US-AUTO-003（loop 执行这三者的产出）

---

<a id="us-auto-005"></a>
## US-AUTO-005 CLI 管理层文档化 ✅

**Created**: 2026-05-10
**Completed**: 2026-05-10

- As a developer using Roll's autonomous evolution features
- I want the CLI commands and per-project config to be documented
- So that I can manage the loop without guessing at the interface

**AC:**
- [x] BACKLOG.md 补 US-AUTO-005 / US-AUTO-006 条目
- [x] autonomous-evolution.md 补 CLI 管理层说明（roll loop/brief/agent）
- [x] `.roll.yaml` per-project agent 配置约定记录在 feature doc
- [x] IDEA-004 roll-brief 推送渠道写入 BACKLOG Ideas

**CLI 管理命令（已实现于 bin/roll）:**

```bash
# 自主循环管理（本项目）
roll loop on              # 启用调度（写入 crontab：loop 每小时 + dream 01:00 + brief 08:00）
roll loop off             # 停用调度（移除 crontab 条目）
roll loop now             # 立即触发一个周期（有中断则自动恢复）
roll loop status          # 查看调度状态 + 当前 state.yaml + ALERT

# 简报
roll brief                # 展示最新简报；超过 24h 自动重新生成

# Agent 切换（per-project）
roll agent use <name>     # 设置当前项目的 agent（写入 .roll.yaml）
roll agent list           # 列出已安装的 agent
roll agent                # 查看当前项目使用的 agent

# 无参数时（在项目目录）
roll                      # 展示项目 dashboard：loop 状态 + 最新 brief 摘要
```

**`.roll.yaml` 约定（per-project agent 配置）:**

```yaml
# .roll.yaml — 项目根目录，per-project 配置
# 覆盖 ~/.roll/config.yaml 的全局 agent 设置
agent: claude   # claude | kimi | deepseek | opencode | ...
```

- 由 `roll agent use <name>` 自动写入，也可手动编辑
- 按需加入 `.gitignore`（个人偏好）或提交（团队统一）
- 全局回退：`~/.roll/config.yaml → loop.primary_agent`，再回退到 `claude`

**Files:**
- `bin/roll`（新增 cmd_loop / cmd_brief / cmd_agent / _dashboard）
- `BACKLOG.md`
- `docs/features/autonomous-evolution.md`

---

<a id="us-auto-006"></a>
## US-AUTO-006 Methodology 自主演化章节 ✅

**Created**: 2026-05-10
**Completed**: 2026-05-10

- As a Roll user
- I want the methodology documentation to explain the autonomous evolution layer
- So that I understand it's optional, how local cron works, and the three-layer architecture

**AC:**
- [x] methodology-en.md 新增 Loop D 自主演化章节
- [x] methodology.md 同步中文版
- [x] 说明三层架构（基础层 / 自主层 / 反思层）及其可选性
- [x] 说明本地 cron 优于 GitHub Actions 的原因
- [x] 说明 dashboard 行为（roll 无参数）

**Files:**
- `docs/methodology-en.md`
- `docs/methodology.md`
