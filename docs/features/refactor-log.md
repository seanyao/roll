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

---

## REFACTOR-003 删除死代码 is_fresh_project() / _mkscaffold() ✅

**Flagged**: 2026-05-11 (dream scan)
**Completed**: 2026-05-12
**Signal**: 两个函数仅有定义无任何调用方，孤儿测试文件 is_fresh_project.bats 独立存在
**Observation**: is_fresh_project() 是 cmd_init() 简化前的遗留物，_mkscaffold() 同源；保留只增加阅读噪音。

**Scope**: `bin/roll` 删除两函数及其注释；`tests/unit/is_fresh_project.bats` 删除；`tests/unit/sanity.bats` 追加回归 guard

---

## REFACTOR-004 修复 _write_backlog/_ensure_features_dir 使用错误变量名 ✅

**Flagged**: 2026-05-11 (dream scan)
**Completed**: 2026-05-12
**Signal**: `_write_backlog()` 和 `_ensure_features_dir()` 向 `_WK_MERGE_SUMMARY` 追加条目，但 `print_merge_summary()` 只读 `_ROLL_MERGE_SUMMARY`，导致 `roll init` 摘要框中 BACKLOG.md 和 docs/features/ 静默缺失。

**Observation**: `_WK_MERGE_SUMMARY` 是未声明的孤儿变量（从未被初始化或读取），实际上等于写入 /dev/null。用户看到 `[roll] Created: BACKLOG.md` 的 ok 输出，却在摘要框里找不到对应条目，行为不一致。

**Scope**: `bin/roll` 4 处 `_WK_MERGE_SUMMARY` → `_ROLL_MERGE_SUMMARY`；`tests/integration/cmd_init.bats` 追加 2 条摘要框回归测试

---

## REFACTOR-005 提取 _for_each_ai_tool 辅助函数 ✅

**Flagged**: 2026-05-11 (dream scan)
**Completed**: 2026-05-12
**Signal**: `while IFS= read -r entry; do ... done < <(_get_ai_tools)` 模式在 bin/roll 中出现 4 次，且每次都有相同的 `_ai_dir/$_ai_config/$_ai_src` 变量提取样板。

**Observation**: 4 处循环中 2 处（`_sync_conventions` 和 cmd_status 的 sync targets 展示）循环体简单，可以安全提取为回调。另外 2 处（`_link_skills` 和 cmd_status skills 展示）循环体超过 30 行且引用闭包变量，提取为回调反而增加间接层而非减少复杂度，保留原始形式更清晰。

**Scope**: `bin/roll` 新增 `_for_each_ai_tool callback [args...]` helper（+12 行）；`_sync_conventions` 重构为 `_sync_one_tool` + `_for_each_ai_tool` 调用；`tests/unit/for_each_ai_tool.bats` 新增 6 条单元测试

---

## REFACTOR-006 CI 测试套件提速 — 并行文件执行 ✅

**Flagged**: 2026-05-11 (dream scan)
**Completed**: 2026-05-12
**Signal**: CI ubuntu 上 475 个 bats 测试串行执行需 5+ 分钟，根因是 cmd_setup.bats（51s）和 cmd_init.bats（34s）各自串行执行，每个测试都调用一次 `roll setup`（~2s/次）。

**Observation**: bats 内置 `--jobs N` 并行标志，需要 GNU parallel。各测试文件已通过 `mktemp -d` 隔离 TEST_TMP，并行执行无共享状态风险。新增 `tests/run.sh` 自动检测 parallel 可用性：有则 `--jobs 4 --no-parallelize-within-files`，无则降级为串行。CI workflow 新增 `apt-get install -y parallel`。

**Expected speedup**: wall time ≈ max(cmd_setup=51s, cmd_init=34s) + overhead ≈ 55s，相较串行 ~170s 加速 3x；CI ubuntu 上预期从 5+ 分钟降至约 90s。

**Scope**: `tests/run.sh`（新建）；`package.json` test 脚本改为 `bash tests/run.sh`；`.github/workflows/ci.yml` 新增 parallel 安装步骤；`tests/unit/test_runner.bats`（新建，4 条测试）

---

## REFACTOR-007 新建 tests/unit/helpers.bash 消除单元测试重复样板 ✅

**Flagged**: 2026-05-12 (dream scan)
**Completed**: 2026-05-12
**Signal**: 22 个单元测试文件中重复 `source bin/roll`、`mktemp -d`、`rm -rf`、`NO_COLOR=1` 样板，维护摩擦高，模式不统一

**Observation**: 参照 `tests/integration/helpers.bash` 模式，建立对等的 `tests/unit/helpers.bash`，提供 `unit_setup`/`unit_teardown`（基础）和 `unit_setup_cd`/`unit_teardown_cd`（含 cd 的变体）。14 个文件改用 `load helpers`，削减重复代码约 100 行。

**AC:**
- [x] `tests/unit/helpers.bash` 新建，定义 `unit_setup`/`unit_teardown`/`unit_setup_cd`/`unit_teardown_cd`
- [x] `tests/unit/unit_helpers.bats` 新建，12 条测试覆盖结构 + 行为
- [x] 14 个单元测试文件改用 `load helpers`（ai_tool_name、detect_project_type、scan_project_type、merge_convention、update_version_check、for_each_ai_tool、roll_loop_attach、roll_loop_now、roll_loop_path、roll_peer_tmux、release_promote、roll_loop_pause、roll_loop_runs、roll_loop_mute、roll_loop_lock、loop_tcr、roll_ci）
- [x] 全套 487 条测试通过，无退化（1 条预存失败：roll_loop_runs 第 29 条）

**Scope**: `tests/unit/helpers.bash`（新建）；`tests/unit/unit_helpers.bats`（新建）；14 个 bats 文件（setup/teardown 替换，不涉及 bin/roll）

---

## REFACTOR-008 CI 测试二轮精简 Phase 1A ✅

**Flagged**: 2026-05-12
**Completed**: 2026-05-12
**Signal**: 553 用例 / 57 bats 文件，本地 4 并发约 4'21"，CI 5-7min，反馈闭环偏长，PR 提交后等待时间长。
**Observation**: REFACTOR-006 已做并行化但 `--jobs 4` 硬编码，未利用更多核数；docs-only PR 也跑全套测试浪费时间；submodule 未初始化时报错隐晦。

**AC:**
- [x] `tests/run.sh` 用 `nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4` 动态检测核数
- [x] `ROLL_TEST_JOBS` 环境变量覆盖支持
- [x] bats-core 缺失保护（`[ ! -x "$BATS" ]` → 清晰报错 + hint）
- [x] `.github/workflows/ci.yml` `paths-ignore: ['**.md', 'docs/**']` 在 push 和 pull_request 两处
- [x] `tests/unit/test_runner.bats` 加 2 条新测试覆盖动态检测和 submodule guard
- [x] 全套 555 用例通过，CI 在 e87fe4a 30s 内绿（含 setup）

**Scope**: `tests/run.sh`、`.github/workflows/ci.yml`、`tests/unit/test_runner.bats`

**拆出**: ci.yml lint/test-unit/test-integration job split + Phase 2 测试分层 → REFACTOR-009

---

## REFACTOR-009 CI 测试二轮精简 Phase 1B ✅

**Flagged**: 2026-05-12
**Completed**: 2026-05-13
**Signal**: REFACTOR-008 把测试加速一轮后仍单 job 串行跑 ~579 用例，unit 与 integration 没有任何资源争用却互相等待。
**Observation**: GitHub Actions matrix 几乎零成本就能把这两个套件平行跑到两个 runner，且 `tests/run.sh` 只缺一个简单的 "可选目录参数" 入口。

**AC:**
- [x] `tests/run.sh` 接受可选目录参数（`$@` → `SCAN_PATHS` 数组；无参时回落到 unit+integration），向后兼容
- [x] `tests/unit/test_runner.bats` 加 2 条测试覆盖参数支持
- [x] `.github/workflows/ci.yml` 用 `strategy.matrix: suite: [unit, integration]`，`fail-fast: false`，job 命名 `test-${{ matrix.suite }}`
- [x] 本地双套件分别跑通：unit 509 / integration 70，全绿
- [x] 拆 Phase 2 → REFACTOR-010

**Scope**: `tests/run.sh`、`.github/workflows/ci.yml`、`tests/unit/test_runner.bats`

**未做（明确切到 REFACTOR-010）**:
- composite action 抽取（当前 setup 步骤只有 3 步，抽取没显著收益；待 Phase 2 加 lint job 再一起抽）
- `lint` job（依赖 `roll doctor`，目前未建）
- Phase 2 测试瘦身（top 20 慢用例迁移、roll_loop_* 跨文件去重、cmd_setup.bats 拆分）

## REFACTOR-010 CI 测试三轮精简 Phase 2 ✅

**Flagged**: 2026-05-10 (from e2e-lifecycle-plan.md)
**Completed**: 2026-05-14
**Signal**: 738 个测试中存在迁移期残留测试和跨文件重复 existence 检查

**Observation**:
- `roll_loop_cleanup.bats` 7 个测试全 FAIL —— 发版 commit fa41d11 意外删除了 US-AUTO-038 刚加入的 `_claude_remote_snapshot`/`_claude_cleanup_new_branches` 两个函数，已恢复
- `roll_doc_migration.bats` 14 个测试：existence 检查已被 roll_doc_structure.bats 覆盖，content 检查已被 guide_en/zh.bats 覆盖，整个文件是迁移期产物，已删除
- `roll_doc_guide_en/zh.bats` 各 5 个纯文件存在性测试：与 roll_doc_structure.bats 重复，已删除
- `loop_tcr.bats` 3 个预存在失败（与 git --since 日期格式有关），不在本次修复范围

**Actual reduction**: 24 个测试（738 → 714，3.2%）
**25% 目标缺口**: 需要 per-test timing 工具识别 top-20 慢测试；当前测试套件无 timing instrumentation，建议 Phase 3 先加 `--time` 可观测性

---

## REFACTOR-011 session 清理补 local worktree prune ✅

**Flagged**: 2026-05-14 by dream scan
**Completed**: 2026-05-14
**Signal**: session 清理只删远端分支，`.claude/worktrees/` 累积 3 个孤儿 worktree

**Observation**: `_claude_cleanup_new_branches` 在每次 loop 结束后清理 remote claude/* 分支，但对应的本地 worktree（`.claude/worktrees/<name>/`）和本地分支没有被清理。`git worktree list` 随时间增长，也占用磁盘。

**Fix**:
- 新增 `_claude_cleanup_stale_worktrees [project_path]`：扫描 `.claude/worktrees/`，对已合并到 main 的 branch 执行 `git worktree remove --force` + `rm -rf` + `git branch -D`；最后 `git worktree prune`
- 在 `_write_loop_runner_script` 的 inner script 中，紧跟 `_claude_cleanup_new_branches` 之后调用
- 清理了本项目积累的 3 个孤儿 worktree（`laughing-elion-c2b123`、`loving-diffie-01c26d`、`vibrant-poitras-233d52`）

**Files**: `bin/roll`, `tests/unit/roll_worktree.bats`, `tests/unit/roll_loop_cleanup.bats`
