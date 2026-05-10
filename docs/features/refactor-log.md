# Refactor Log

Architectural friction signals flagged during story execution.

## REFACTOR-001 US-AUTO-007 roll backlog 补 TCR 测试 ✅

**Flagged**: 2026-05-10
**Completed**: 2026-05-10
**Signal**: US-AUTO-007 以单次大提交交付，未遵循 TCR 节奏，`cmd_backlog` 无任何测试覆盖
**Observation**: 功能可运行，但缺少回归保护。任何后续修改均可能悄无声息地破坏行为。

**AC:**
- [x] 先写失败测试 `tests/unit/roll_backlog.bats`（RED），commit: `tcr: add roll_backlog.bats RED`
- [x] 测试覆盖：有 📋 Todo 项时输出正确分组（FIX → US → REFACTOR）、无待办时显示 clear 消息、FIX 优先于 US 排列、BACKLOG.md 不存在时以非零退出码报错
- [x] 实现通过所有测试（GREEN），commit: `tcr: roll_backlog tests GREEN`
- [x] 所有已有 101+ 测试不退化

**Scope**: `tests/unit/roll_backlog.bats` 新增；`bin/roll` 仅在测试揭示 bug 时修改

---

## REFACTOR-002 US-AUTO-008 roll loop monitor 补 TCR 测试 ✅

**Flagged**: 2026-05-10
**Completed**: 2026-05-10
**Signal**: US-AUTO-008 同样以单次大提交交付，`_loop_monitor` 无任何测试覆盖
**Observation**: TUI 渲染难以集成测试，但底层状态解析、队列解析、子命令路由均可单元测试。

**AC:**
- [x] 先写失败测试 `tests/unit/roll_loop_monitor.bats`（RED），commit: `tcr: add roll_loop_monitor.bats RED`
- [x] 测试覆盖：`roll loop monitor` 子命令路由正确（不崩溃）、state file 解析逻辑（running/paused/idle 分支）、BACKLOG 队列解析（FIX 优先级）— 不测 TUI 渲染输出；新增 launchd 检测测试（macOS）、_loop_now dual-output（tee）
- [x] 实现通过所有测试（GREEN），commit: `tcr: roll_loop_monitor tests GREEN`
- [x] 所有已有测试不退化（148 用例）

**Scope**: `tests/unit/roll_loop_monitor.bats` 新增；`bin/roll` 修复 `_loop_monitor` crontab→launchd 检测、`_loop_now` 加 tee 双输出
