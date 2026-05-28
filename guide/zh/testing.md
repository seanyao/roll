# Roll — 测试工作流

Roll 在整个交付过程中强制执行测试优先原则：

- **TCR**（Test && Commit || Revert）— 每个微步骤通过测试后才提交。
- **E2E Deposit** — 每个完成的 Story 留下一个 E2E 测试，覆盖其核心用户路径。
- **CI E2E Gate** — Deposit 的 E2E 在每次推送时运行，失败则阻止合并。
- **proof-of-pass** — pre-commit hook 物理拦截未经测试的提交。

## E2E Deposit

TCR 微步骤通过后，`$roll-build` Phase 5.5 自动 Deposit E2E 测试：

1. 检测项目已有的 E2E 基础设施（框架、目录、命名规范）。
2. 编写一个覆盖 Story 关键用户路径的 E2E 测试。
3. 运行它——若红则通过 TCR 修复。
4. 提交：`tcr: e2e deposit for <story-id>`。

Deposit 的测试成为持久的回归守门，CI 和 `$roll-sentinel` 可重放以对抗生产环境。

## Pre-commit Hook（proof-of-pass）

Roll 的 pre-commit hook 要求：测试必须在 **60 秒内**、**与当前暂存树完全匹配**的情况下通过：

```bash
# 测试运行器写入：
# .roll/last-test-pass  ← 时间戳 + 树哈希

# 提交时 hook 检查：
# - 距离上次测试通过 < 60 s
# - 树哈希与当前暂存树匹配
```

使用 TCR（roll-build 的默认节奏）时此过程自动完成。

## CI E2E Gate

模板 CI 工作流（`.github/workflows/ci.yml`）将 E2E 测试作为独立任务，必须通过才能合并。失败时：

1. 查看失败测试名——对应一个 Story ID。
2. 在本地复现。
3. 在 `BACKLOG.md` 开 `FIX-XXX` 条目，或直接用 `$roll-fix` 修复。

## 失败分诊

`$roll-.qa` 为测试金字塔每层提供结构化诊断指引：

| 层级 | 运行命令 | 分诊入口 |
|------|----------|----------|
| 单元测试 | `bats tests/unit/` | 失败测试文件 → 函数名 |
| 集成测试 | `bats tests/integration/` | Setup/Teardown、真实进程 |
| E2E | `<项目 E2E 命令>` | 用户路径、环境 |
| Smoke | `roll doctor` | 工具链健康 |

## TCR 测试策略（Phase 3.0）

TCR 的每个 micro-step 都需要秒级反馈。测试入口提供两个杠杆既保持速度
又不在 CI 里少跑测试。

### `--affected` 只跑被 diff 覆盖的测试

```bash
bash tests/run.sh --affected              # 默认 base = HEAD~1
bash tests/run.sh --affected main         # 显式 base ref
bash tests/run.sh --affected --dry-run    # 打印清单不执行
```

匹配规则（精确 → 模糊 → 保守）：

1. 改动文件本身就是 .bats —— 自跑。
2. 命名约定：`lib/foo.py` → `tests/unit/foo*.bats`、
   `tests/integration/*foo*.bats`。
3. 改动 `tests/helpers/*`、`tests/preconditions.bash` 或 `tests/run.sh`
   → 跑全套（没有安全子集）。

affected set 为空（如纯文档改动）时打印 `no affected tests, skipping suite`
并 exit 0。

### `--tier` fast（TCR 本地）/ slow（CI 与 pre-push）

```bash
bash tests/run.sh                   # 默认 --tier=fast
bash tests/run.sh --tier=slow
bash tests/run.sh --tier=all        # 跑全套；CI 走这条
```

分类顺序（首匹配获胜）：

1. `.bats` 文件头显式 `# bats tier: fast|slow`。
2. 路径在 `tests/integration/` → slow。
3. 引用 `launchctl`、`crontab` 或 `sleep N` 且 N ≥ 5 → slow。
4. 否则 → fast。

CI 里设置 `ROLL_TEST_TIME_CAP=1` 时，`--tier=fast` 跑全套上限 60 秒
（可用 `ROLL_TEST_FAST_CAP_SEC` 覆盖）。性能渐进退化会立刻把套件打红，
不再静默拖。

用户显式给出 .bats 路径时 tier 过滤会让步：
`bash tests/run.sh tests/integration/foo.bats` 在 `--tier=fast` 下也照跑。

默认组合是 `--affected --tier=fast`；pre-push / release 跑 `--tier=all`。

## 测试质量评分卷（rubric）

`guide/zh/testing/quality-rubric.md`（由 `$roll-.dream` Scan 7 消费）列出
夜检扫描会按 `REFACTOR-XXX [test-quality:❶|❷|...|❽]` 输出的八类反模式：

| # | 反模式 | 修复方向 |
|---|--------|---------|
| ❶ | 硬编码业务数据（价格、版本号、产品文案） | 通过 monkey-patch / 构造注入 fixture；断言行为而非数据表 |
| ❷ | 过度 mock（数据库、文件系统、真实边界） | 用真实子系统配小型适配 mock；优先内存测试替身 |
| ❸ | 断言实现细节（私有符号名、内部数据形状） | 通过 public API 断言可观察行为 |
| ❹ | Fixture 顺序耦合（测试间共享可变状态） | 每个测试独立 setup/teardown；用不可变 fixture |
| ❺ | 测私有函数 / 绕过 public API | 改走 public 入口；如果难以到达，说明 API 设计有问题 |
| ❻ | 断言框架行为（在测 bats 本身） | 删测试；信任框架 |
| ❼ | 内联外部工具行为（测试体里复制 `sed`/`grep`/`awk` 流水线） | 调项目自己的 helper；或抽到 `tests/helpers/` 共享 |
| ❽ | 断言 repo 之外的文件（`~/.codex`/`~/.kimi`/`~/.roll` 或系统路径） | 用 `BATS_TMPDIR` 沙箱化，环境变量重定向到临时目录，不碰用户真实配置 |

dream 每轮最多 emit 5 条 REFACTOR，避免 backlog 被噪音淹没。
按优先级逐个收拾。

### 测试质量合并门（US-QA-012 / 013）

❼ 和 ❽ 两类是**硬阻断**：CI 绿后 loop 自动合并前会跑
`roll loop test-quality-check <改动的-bats-文件>`。命中违规时 loop 写
`ALERT-<slug>.md` 并卡住 PR，要么改测试要么 PR 描述加
`[skip-test-quality]` 标记放行（大小写不敏感）。

❼ and ❽ are **blocking**: PR auto-merge is held until violations are fixed
or the PR description carries `[skip-test-quality]`.

绕过请谨慎使用——dream 仍会把违规登记为 REFACTOR,不会因为 skip 就被遗忘。

❶..❻ 是建议性,dream 标 REFACTOR 但门不卡。常规迭代里慢慢清。

带 `# test-quality:allow` 注释的行会被扫描器跳过（文档校验类测试里
合法使用 `awk` 解析 markdown 时用，不触碰生产代码）。

`tests/unit/model_prices.bats` 是 ❶ 类范例 —— 之前的断言读生产费率
表，每次价格调整就把套件打红，即便算术逻辑没动。重写后算术测试走
monkey-patch 的 fixture 价格表，对生产 PRICES 只断结构不变量
（cache_read < input 等）。

## 另见

- [loop.md](loop.md) — loop 如何在每个 Story 中强制 TCR 纪律
- [skills.md](skills.md) — `$roll-build`（交付 + Deposit E2E）
