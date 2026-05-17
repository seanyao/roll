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

---

## REFACTOR-012 release.sh 消除 _detect_agent 双维护 ✅

**Flagged**: 2026-05-14 by dream scan
**Completed**: 2026-05-14
**Signal**: `scripts/release.sh` 自定义了 `_detect_agent()` 与 `bin/roll` 的 `_project_agent()` 逻辑完全重复

**Observation**: 两处各自 grep `.roll.yaml`/`~/.roll/config.yaml`；一处改了另一处不知道，配置字段变动时会悄无声息地漂移。

**Fix**: `release.sh` 改为在执行前 `source "${REPO_ROOT}/bin/roll"`，直接调用 `_project_agent()`；顺带把内联 frontmatter 剥离逻辑替换为 `_skill_content()`，消除第二个重复。

**Files**: `scripts/release.sh`, `tests/unit/release_promote.bats`

---

## REFACTOR-013 docs: ROLL_HOME / ROLL_CONFIG / ROLL_GLOBAL ✅

**Flagged**: 2026-05-14 (dream scan)
**Completed**: 2026-05-14
**Signal**: `ROLL_CONFIG`/`ROLL_GLOBAL` 在 bin/roll 中分别引用 18 / 9 次，`docs/` 中无任何提及。用户无法发现这两个配置入口。
**Observation**: 三个变量都派生自 `ROLL_HOME`，但默认值、覆盖语义、典型用法都没有用户可读的文档。CI/沙箱/团队 convention 切换场景全靠源码考古。

**AC:**
- [x] 新增 `docs/guide/en/configuration.md` 和 `docs/guide/zh/configuration.md`
- [x] 列出 `ROLL_HOME` / `ROLL_CONFIG` / `ROLL_GLOBAL` 的默认值、用途、覆盖示例
- [x] `docs/guide/en/overview.md` 和 `zh/overview.md` 加入 `configuration.md` 链接
- [x] 新增 `tests/unit/roll_doc_configuration.bats` 锁定文档内容不变量

**Scope**: `docs/guide/en/configuration.md`、`docs/guide/zh/configuration.md`、`docs/guide/{en,zh}/overview.md`、`tests/unit/roll_doc_configuration.bats`

---

## REFACTOR-014 删除三个未调用的初始化辅助函数 ✅

**Flagged**: 2026-05-15 by dream scan
**Completed**: 2026-05-15
**Signal**: 死代码 — 三个函数从未被生产代码调用

**Observation**:
- `_write_gitignore()` (原 L1135) 和 `_write_env_example()` (原 L1149)：init 简化时剩余的残骸，无任何调用点，无测试
- `detect_project_type()` (原 L1167)：有 8 个单元测试，但无生产调用者；cli-simplification-plan.md 标注为"供 refresh_project 使用"，但 refresh_project 从未实现，过去两次 dream 扫描（05-11、05-12）都选择保留，05-15 正式清除

**Fix**: 从 bin/roll 删除三个函数（83 行）；删除孤儿测试文件 `tests/unit/detect_project_type.bats`（8 个测试）。测试从 778 → 770，全绿。

**Files**: `bin/roll`, `tests/unit/detect_project_type.bats`

---

## REFACTOR-015 删除不可达的 tools/roll-fetch 模块 ✅

**Flagged**: 2026-05-15 by dream scan
**Completed**: 2026-05-15
**Signal**: 死代码 — 整个模块随 npm 发布但任何用户路径均无法到达

**Observation**:
- `tools/roll-fetch/` 包含 `SKILL.md`（`hidden: true`）和 `smart-web-fetch.js`
- `bin/roll` 只处理 `skills/` 目录，从不查找 `tools/`，所以用户无法通过 `roll` 命令触发
- `package.json` 的 `files` 数组显式包含 `"tools/"`，导致 3 个文件随 npm 包发布
- 自身内部也有死代码：`tryLLMNative()` 是占位空壳，`isBlockedOrLowQuality` 参数未使用，`calculateQualityScore` 结果无分支消费

**Fix**: 从 `package.json` 的 `files` 数组移除 `"tools/"`，删除 `tools/roll-fetch/` 目录（756 行）。

**Files**: `package.json`, `tools/roll-fetch/` (deleted)

---

## REFACTOR-016 统一配置读取 — 删除 _config_read_string，_config_read_int 改为薄包装器 ✅

**Flagged**: 2026-05-15 by dream scan
**Completed**: 2026-05-15
**Signal**: 配置读取双实现 — sed（config_get）vs awk（_config_read_string），`~` 展开行为不一致

**Observation**:
- `config_get`（L98）用 sed 解析，展开 `~`，有 5 个调用点（peer settings）
- `_config_read_string`（旧 L2078）用 awk 解析，不展开 `~`，3 个调用点（均为 `loop_attach_terminal`）
- `_config_read_int`（旧 L2071）同 awk 实现但加整数验证，14 个调用点
- 两套解析逻辑并存：改 config 格式时需同时考虑 sed 和 awk 行为

**Fix**: 
- 3 处 `_config_read_string` 调用替换为 `config_get`，删除函数（loop_attach_terminal 不含路径，~展开无副作用）
- `_config_read_int` 内部改用 `config_get` 解析，保留整数验证逻辑
- 现在只有一条 YAML 解析路径：`config_get`

**Files**: `bin/roll`

---

## REFACTOR-022 引入 simplify 三轴代码审查到 roll-.review + roll-build ✅

**Flagged**: 2026-05-17 by user
**Completed**: 2026-05-17
**Source**: Claude Code 2.1.143 内置 `/simplify` skill（prompt 原文见文末附录）

**Motivation**: Simplify 是 Claude Code 内置 skill，只有使用 Claude Code 的用户能享受。Roll 是跨 agent 的元工具（Kimi / DeepSeek / Codex / Gemini / Pi 等），把 simplify 的三轴审查能力内化到 roll-* skill 后，**所有 agent 的用户都能在 TCR 流程中受益** —— 不再依赖某家 IDE 的内置功能。这与 roll 既有的跨 agent 定位一致（参见 roll-peer / roll-review-pr）。

**Signal**: 现有 `roll-.review` 六维 checklist（Correctness / Security / Maintainability / Performance / Testability / Scope）覆盖宽但条目偏抽象，缺少可执行的"反模式清单"。Simplify skill 用三个并行 sub-agent 对 diff 做 Reuse / Quality / Efficiency 三轴扫描，每轴都有具体可勾选的反模式（如"参数 sprawl"、"TOCTOU 存在性预检"、"N+1 模式"），适合直接借鉴。

**Observation**:
- `roll-.review` 每个 TCR 微步骤 commit 前都跑一次 —— 一个 US 可能 10+ 次调用，**承受不了**三 sub-agent 并行的 token 开销
- `roll-build` Phase 7（Pre-Push Code Review）每个 US 收尾才跑一次 —— 是 simplify 三 agent 并行原本就为之设计的形态（大粒度累积 diff + 多视角并行）
- 跨微步骤累积才显现的问题（如重复抽象、跨文件 copy-paste、参数 sprawl 蔓延）正是单步 review 抓不到、大粒度重审能抓到的盲区

**Design — 双层嵌入**:

### Layer 1: roll-.review 内联 checklist（每 TCR 步，零额外成本）

在 `skills/roll-.review/SKILL.md` 的 "Review Dimensions" 段增加 simplify 三轴维度（作为 inline checklist，**不**调起 sub-agent）：

```
┌─────────────────────────────────────────────────────────┐
│  Reuse 维度（高优先级）                                  │
│    □ 新写的函数是否重复了既有 utility / helper          │
│    □ 内联逻辑（字符串、路径、环境检查）是否有现成工具    │
│                                                          │
│  Quality 维度（替换原 Maintainability 的具体化）         │
│    □ 冗余 state（可派生的缓存值、可直接调用的 observer） │
│    □ 参数 sprawl（加新参数 vs 重构既有函数）            │
│    □ 微变体 copy-paste（应抽共享抽象）                   │
│    □ 抽象漏接（暴露内部细节 / 越过边界）                 │
│    □ Stringly-typed（用裸串而非常量 / 联合类型）         │
│    □ JSX 嵌套冗余（包装容器无布局价值）                  │
│    □ 嵌套条件 ≥3 层（应早返回 / lookup / cascade）       │
│    □ 无谓注释（解释 WHAT / 描述本次改动 / 引用调用方）   │
│                                                          │
│  Efficiency 维度（替换原 Performance 的具体化）          │
│    □ 重复计算 / 文件读取 / 网络调用 / N+1                │
│    □ 错失并发（独立操作串行执行）                        │
│    □ 热路径膨胀（启动 / per-request 加阻塞工作）         │
│    □ 循环里的无变化 update（缺 change-detection guard）  │
│    □ TOCTOU 存在性预检（应直接操作 + 错误处理）          │
│    □ 内存（无界数据结构 / 漏 cleanup / listener 泄漏）   │
│    □ 操作过宽（读整文件取一段 / 加载全集只为筛一项）     │
└─────────────────────────────────────────────────────────┘
```

原 6 维不删，但 Maintainability / Performance 两维下挂这些具体条目；Reuse 作为新增第 7 维。

### Layer 2: roll-build Phase 7 升级（每 US 一次，三 agent 并行）

`skills/roll-build/SKILL.md` 的 Phase 7 当前内容是 `$roll-.review staged`。升级为：

```
Phase 7: Pre-Push Code Review (Three-Axis Deep Review)

输入: git diff main...HEAD（整个 Story 的累积 diff）

并行调起三个 Agent（subagent_type=general-purpose，每个传入完整 diff）:
  - Agent 1: Reuse Review     → 找既有 utility 替代
  - Agent 2: Quality Review   → 8 条反模式扫描
  - Agent 3: Efficiency Review → 7 条反模式扫描

聚合三方发现 → 修复（false positive 直接 skip，不辩论）→ 汇总修了什么

通过后才进入 Phase 8: Commit & Push
```

每个 agent 的具体 prompt 直接引用文末附录（保持与 Claude Code 原版同源，便于将来跟随官方更新）。

**AC**:
- [x] `skills/roll-.review/SKILL.md` "Review Dimensions" 段扩展为 6+1 维（新增 Reuse），Maintainability / Performance 下挂 simplify 反模式条目
- [x] `skills/roll-build/SKILL.md` Phase 7 重写为三 agent 并行重审，diff 范围改为 `main...HEAD`，含 Phase 3.5 vs Phase 7 职责分工说明
- [x] `skills/roll-build/SKILL.md` Phase 7 与 Phase 3.5（Peer Review Gate）的顺序与职责分工明确（peer 关注架构/方向，三轴关注实现质量）
- [x] 新增 `tests/unit/roll_review_dimensions.bats` — 16 条用例覆盖 7 维 checklist + Phase 7 三轴结构
- [x] CHANGELOG 与 `docs/features/refactor-log.md` 同步更新

**Files**:
- `skills/roll-.review/SKILL.md`（修改）
- `skills/roll-build/SKILL.md`（修改 Phase 7）
- `tests/unit/roll_review_dimensions.bats`（新增 / 测试覆盖）
- `docs/features/refactor-log.md`（本条目）

**非目标 / 不在本次范围**:
- 不改 `roll-.dream`（夜检定位是架构漂移与死代码，与 diff-based review 不重叠）
- 不替换原 6 维，只扩充
- Phase 7 三 agent 调度失败时不阻塞 push —— 退化为 `roll-.review staged`（保留 fallback）

---

### Appendix: Simplify Skill Prompt 原文

> 来源：Claude Code 2.1.143 内置 `/simplify` skill（从二进制 strings 提取）。落盘存档以防上游变更后无法回溯。

```text
# Simplify: Code Review and Cleanup

Review all changed files for reuse, quality, and efficiency. Fix any issues found.

## Phase 1: Identify Changes

Run `git diff` (or `git diff HEAD` if there are staged changes) to see what
changed. If there are no git changes, review the most recently modified files
that the user mentioned or that you edited earlier in this conversation.

## Phase 2: Launch Three Review Agents in Parallel

Use the Agent tool to launch all three agents concurrently in a single
message. Pass each agent the full diff so it has the complete context.

### Agent 1: Code Reuse Review

For each change:

1. **Search for existing utilities and helpers** that could replace newly
   written code. Look for similar patterns elsewhere in the codebase — common
   locations are utility directories, shared modules, and files adjacent to
   the changed ones.
2. **Flag any new function that duplicates existing functionality.** Suggest
   the existing function to use instead.
3. **Flag any inline logic that could use an existing utility** — hand-rolled
   string manipulation, manual path handling, custom environment checks,
   ad-hoc type guards, and similar patterns are common candidates.

### Agent 2: Code Quality Review

Review the same changes for hacky patterns:

1. **Redundant state**: state that duplicates existing state, cached values
   that could be derived, observers/effects that could be direct calls
2. **Parameter sprawl**: adding new parameters to a function instead of
   generalizing or restructuring existing ones
3. **Copy-paste with slight variation**: near-duplicate code blocks that
   should be unified with a shared abstraction
4. **Leaky abstractions**: exposing internal details that should be
   encapsulated, or breaking existing abstraction boundaries
5. **Stringly-typed code**: using raw strings where constants, enums (string
   unions), or branded types already exist in the codebase
6. **Unnecessary JSX nesting**: wrapper Boxes/elements that add no layout
   value — check if inner component props (flexShrink, alignItems, etc.)
   already provide the needed behavior
7. **Nested conditionals**: ternary chains (`a ? x : b ? y : ...`), nested
   if/else, or nested switch 3+ levels deep — flatten with early returns,
   guard clauses, a lookup table, or an if/else-if cascade
8. **Unnecessary comments**: comments explaining WHAT the code does
   (well-named identifiers already do that), narrating the change, or
   referencing the task/caller — delete; keep only non-obvious WHY (hidden
   constraints, subtle invariants, workarounds)

### Agent 3: Efficiency Review

Review the same changes for efficiency:

1. **Unnecessary work**: redundant computations, repeated file reads,
   duplicate network/API calls, N+1 patterns
2. **Missed concurrency**: independent operations run sequentially when they
   could run in parallel
3. **Hot-path bloat**: new blocking work added to startup or
   per-request/per-render hot paths
4. **Recurring no-op updates**: state/store updates inside polling loops,
   intervals, or event handlers that fire unconditionally — add a
   change-detection guard so downstream consumers aren't notified when
   nothing changed. Also: if a wrapper function takes an updater/reducer
   callback, verify it honors same-reference returns (or whatever the "no
   change" signal is) — otherwise callers' early-return no-ops are silently
   defeated
5. **Unnecessary existence checks**: pre-checking file/resource existence
   before operating (TOCTOU anti-pattern) — operate directly and handle the
   error
6. **Memory**: unbounded data structures, missing cleanup, event listener
   leaks
7. **Overly broad operations**: reading entire files when only a portion is
   needed, loading all items when filtering for one

## Phase 3: Fix Issues

Wait for all three agents to complete. Aggregate their findings and fix each
issue directly. If a finding is a false positive or not worth addressing,
note it and move on — do not argue with the finding, just skip it.

When done, briefly summarize what was fixed (or confirm the code was already
clean).
```

**Slash-arg 行为**：`/simplify <text>` 调用时，`<text>` 作为 `## Additional Focus` 追加到 prompt 末尾，三个 agent 都会拿到 —— roll-build Phase 7 应保留此入口，允许 US 收尾时指定本次审查的侧重点。

---

## REFACTOR-023 CI 自愈计数器合并入 state.yaml ✅

**Flagged**: 2026-05-17 by simplify review
**Completed**: 2026-05-17
**Signal**: `_loop_self_heal_ci()` 写入 `heal/<story>.count` 独立文件；自愈成功后若漏调 `_loop_clear_heal_state()`，count 文件长期堆积；与 `state.yaml` 生命周期脱钩。

**Observation**: CI 自愈计数与主状态记录（state.yaml）分开存储导致两个清理路径不同步。heal/ 文件只在 `_loop_clear_heal_state()` 或 `roll loop reset` 时删除；如果 loop 在 CI 变绿后、调 clear 前崩溃，文件永久残留。将计数并入 state.yaml 后，state.yaml 被覆盖/删除即自动清理，无需额外维护。

**Fix**:
- `_loop_self_heal_ci()` 改为读写 `state.yaml` 的 `heal_count:` 字段（不再 mkdir heal/）
- `_loop_clear_heal_state()` 改为从 state.yaml 中移除 `heal_count:` 行
- `_loop_reset()` 保留 `rm -rf heal/` 以清理历史遗留文件
- `tests/unit/roll_loop_self_heal.bats` 全面更新：12 条测试反映新行为

**Files**: `bin/roll`, `tests/unit/roll_loop_self_heal.bats`

---

## REFACTOR-024 roll-loop SKILL.md CI 自愈流程可读性改进 ✅

**Flagged**: 2026-05-17 by simplify review
**Completed**: 2026-05-17
**Signal**: CI 自愈流程用三层嵌套 ASCII 树呈现（`│   1. Capture...`），分支与编号步骤混排，代码块内嵌在树节点里，可读性差。

**Fix**: 将嵌套树替换为两个并列编号子流程（Path A — 允许/Path B — 耗尽），代码块独立成段。同步移除已被 REFACTOR-023 废弃的 `heal/<story_id>.count` 路径引用，改为 `state.yaml` 中的 `heal_count:` 字段。

**Files**: `skills/roll-loop/SKILL.md`, `tests/unit/roll_loop_self_heal_doc.bats`（新增）
