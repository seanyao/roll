# Feature: Release Script

> **2026-05-16 update**: The `roll-release` skill and `roll release` CLI subcommand
> have been removed. Release flow is now 100% script-driven via `scripts/release.sh`
> — npm publish requires real-terminal 2FA, which a skill cannot orchestrate.
> US-REL-001 below is kept as historical record.

<a id="us-rel-001"></a>
## US-REL-001 Add roll-release skill — one-command publish flow ✅ (superseded)

**Created**: 2026-04-19
**Completed**: 2026-04-20

- As a roll maintainer
- I want to run `$roll-release` to publish a new version
- So that releasing is a single command with no manual version calculation

**AC:**
- [x] Skill file `skills/roll-release/SKILL.md` created
- [x] Version format: `MAJOR.MMDD.N` (e.g. `v2.601.1`), MAJOR from `.roll/ops/MAJOR_VERSION`; N auto-increments from existing git tags for the day (superseded by US-REL-005)
- [x] Updates `VERSION="..."` in `bin/roll`
- [x] Updates `"version"` field in `package.json`
- [x] Commits with message `[release] vYYYY.MMDD.N`
- [x] Creates git tag `vYYYY.MMDD.N` and pushes with `git push && git push --tags`
- [ ] GitHub Actions `publish.yml` auto-publishes to npm on tag push (OIDC Trusted Publishing pending — workaround: `npm publish` locally)
- [x] Skill shows proposed version and asks for confirmation before making any changes
- [x] Added to README skill list

**Files:**
- `skills/roll-release/SKILL.md` (new)
- `README.md`

**Dependencies:**
- `.github/workflows/publish.yml` must exist (already done in US-DIST-004)

<a id="us-rel-002"></a>
## US-REL-002 发版脚本 AI 调用瘦身 ✅

**Created**: 2026-05-17
**Completed**: 2026-05-17

- As a Roll 维护者
- I want 发版时 `scripts/release.sh` 的 AI 调用更快更省
- So that 每次发版不再干等三次 claude 串行响应

**AC:**
- [x] changelog 同步和 release notes 生成合并为一次 AI 调用（原来两次串行）
- [x] features.md 重写的 prompt 不再内联 BACKLOG 全文（36KB → ~2KB 结构摘要）
- [x] 每次 AI 调用只发送 SKILL.md 中该任务需要的 section，不传全量 16KB
- [x] 最终产物（CHANGELOG.md、release_notes.txt、docs/features.md）内容不变
- [x] `release.sh` 端到端执行时间显著缩短，AI 调用从 3 次降为 2 次

**Files:**
- `scripts/release.sh`
- `tests/unit/release_ai_calls.bats` (new)
- `tests/integration/release_features_sync.bats` (E2E deposit added)

**Dependencies:**
- 无（纯脚本内部重构，不影响接口）

<a id="us-rel-003"></a>
## US-REL-003 发版脚本每步显示 spinner + 阶段名 + 耗时 📋

**Created**: 2026-05-21
**From**: IDEA-034

- As a Roll 维护者
- I want 跑 `roll-release` 时每个慢步骤都有可见的 spinner 动画、当前阶段名和已耗时
- So that 长时间寂静的 AI 调用和网络推送不再看起来像卡住；任何一步卡了我能立刻判断卡在哪、卡多久

**Domain Model:**
- Context: Release Management
- Aggregate: ReleaseRun（一次发版执行的状态机）
- Entities touched: 无新增；只是给现有 7 个阶段加可观测性外壳
- Events raised: 无（本地观测，不进入 cycle event stream）
- Cross-context: 无

**AC:**
- [ ] `.roll/ops/release.sh` 增加 `_spin <label> <cmd...>` 帮助函数：在 TTY 下用 braille 序列 `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` 动画显示，每 100ms 一帧，行尾带 `[Ns]` 当前耗时
- [ ] spinner 写到 FD 3（指向 `/dev/tty`），不污染被包命令的 stdout/stderr，原有的 `> release_notes.txt 2> $_tmp_err` 重定向行为完全保留
- [ ] 步骤完成行内被替换为 `✓ <label> (Ns)`，失败为 `✗ <label> (rc=N, Ns)`，行首用 `\r\033[2K` 清行
- [ ] 非 TTY 环境（CI、`2>&1 | tee`、管道）spinner 自动退化：起始打 `» <label>...`、结束打 `done <label> (Ns)` 或 `fail <label> (rc=N, Ns)`，纯文本无 ANSI
- [ ] 用 EXIT/INT/TERM trap 清理 spinner 子进程，脚本中断不留僵尸
- [ ] 包以下 5 个慢步骤（其余步骤太快不值得包）：
  - `[1/5] Generating CHANGELOG.md (AI)` — 包 `_run_changelog_and_notes`
  - `[2/5] Rewriting .roll/features.md (AI)` — 包 `_run_features_sync_skill`
  - `[3/5] Pushing to origin` — 包 `git push && git push --tags`（合并显示一行）
  - `[4/5] Syncing roll-meta` — 包 `.roll/` 子仓的 `git push`
  - `[5/5] Checking npm registry` — 包 `npm view "@seanyao/roll@${VERSION}"` 那一行
- [ ] `npm publish --access public` 不包 spinner，保留 npm 自身的上传进度条
- [ ] 脚本末尾追加总耗时：`✅ Released vXXX (total Ns)`，N 是从 confirm prompt 通过后到 publish 完成的整段秒数
- [ ] 现有 `echo "Syncing CHANGELOG.md..."` `echo "Rewriting .roll/features.md..."` 等手写状态行被移除（spinner label 已覆盖同样的信息）
- [ ] 兼容 macOS bash 3.2（不用 bash 4 特性如关联数组、`mapfile`）
- [ ] 幂等性不变：脚本中途失败再跑一次，spinner 不影响"该步已做完则跳过"的判断

**Files:**
- `.roll/ops/release.sh`（修改）
- `.roll/features/release-management/roll-release.md`（本文件，标 ✅ Done）
- `.roll/backlog.md`（行状态翻 ✅）

**Dependencies:**
- 无

---

<a id="us-rel-004"></a>
## US-REL-004 release notes 生成从发版流程剥离成独立 skill/命令 ✅

**Created**: 2026-05-31
**Completed**: 2026-06-01（PR #364,auto-merge armed;全量套件绿）
**Origin**: owner — 每次发版都卡在现场 AI 写 notes,太慢;想提前生成查阅,发版只做收尾。

**交付(两条路都做了)**:
- `roll release-notes [version]` 命令 + `_release_notes_gather`(从 CHANGELOG `## Unreleased` 抽取,确定性,3 单测)→ 写可审阅的 `RELEASE_NOTES.md`。
- `roll-release-notes` skill(AI 润色:主题摘要 / 分组 / 用户视角 / 双语 / 去内部 tag)。
- `.roll/ops/release.sh` 短路:存在 `RELEASE_NOTES.md` 就直接用、跳过现场 AI 生成;否则回退原路径。
- 代码↔文档对齐:重生成 `guide/skills.md`、`guide/{en,zh}/skills.md` 加触发行、CHANGELOG 条目。
- 实证:2026-06-01 用本命令 + skill 生成了 v2026.601.1 的 release notes(双语、人话)。

**问题陈述(白话)**

现在发版流程里有一次**现场 AI 调用**:`.roll/ops/release.sh:82-114` 的 `_run_changelog_and_notes()`,一次调用同时干两件事——同步 CHANGELOG.md + 生成 GitHub Release Notes。这次 AI 调用是发版收尾最慢、最不可控的一段:owner 只能在发版当下干等它跑完,没法提前审阅 notes,也拖长了整个 release 的墙钟时间。

**目标**

把 **release notes 生成**这一半从发版流程里剥出来,做成可**提前任意时刻运行**的独立 skill / 命令(如 `roll release-notes [version]`),产出一个**可查阅、可编辑**的 notes 文件;`release.sh` 改为**消费**已生成的 notes——只做版本号计算 + 推送 + 建 GitHub Release,不再内联现场写 notes。

**AC**

- [ ] 新增独立生成入口(skill 或 `roll release-notes` 命令,二选一见下 Open Question):基于 CHANGELOG 的 `## Unreleased` + 自上个 tag 起 merged 的 US/FIX/REFACTOR,生成 release notes,落到可查阅文件(如 `RELEASE_NOTES.md` 或 `.roll/release-notes/<version>.md`)
- [ ] 可在发版前的任意时刻运行,产物供 owner 审阅 / 手改
- [ ] `release.sh` 改造:**存在**已生成的 notes 文件则直接消费(建 GH Release 用它);**不存在**则提示"先跑 `roll release-notes`"而不是静默现场生成。把 `_run_changelog_and_notes()` 的 notes 部分移走(CHANGELOG 同步保留或并入,见下)
- [ ] 双语 notes 遵循项目 Bilingual 约定(英文一行、中文一行,绝不同行)
- [ ] 生成确定性:相同输入(同一段 unreleased + 同一批 PR)→ 稳定结构的 notes(便于审阅 diff)
- [ ] **代码 ↔ 文档对齐(硬性)**:同步更新 `guide/{en,zh}` 的发版文档、`README*` 提及、若做成 skill 则更新 `guide/*/skills.md` 技能目录;`roll-doctor` 与 doc-structure 测试必须绿
- [ ] 测试:notes 生成 happy path + 发版流程在 notes 缺失时给出提示(不静默)

**Open Question(设计时定)**

- **skill 还是 CLI 命令?** 倾向:做成 skill(`$roll-release-notes`,AI 驱动,和 `roll-.changelog` 同源风格),再用一个瘦命令 `roll release-notes` 触发——保持"AI 生成类走 skill"的一致性。
- **CHANGELOG 同步何去何从?** 现在 `_run_changelog_and_notes` 把"改 CHANGELOG"和"出 notes"耦在一次调用。CHANGELOG 同步本就是 `roll-.changelog` 的职责(deploy 后自动触发),本卡只搬 notes 那半;是否顺手让 release.sh 不再碰 CHANGELOG,设计时定。

**Files(预估,设计时细化)**

- `.roll/ops/release.sh`(移除内联 notes 生成,改消费已生成文件)
- 新增 skill `skills/roll-release-notes/`(若走 skill 路线)或 `bin/roll` 新增 `roll release-notes` 命令
- `guide/en/*`、`guide/zh/*`(发版文档 + 技能目录,代码↔文档对齐)
- 测试:notes 生成 + release 流程消费

**Dependencies**

- 与 `roll-.changelog`(US-CL-*)相关:复用 CHANGELOG `## Unreleased` 作为输入源,但职责不同(changelog = 内部 backlog→CHANGELOG;release-notes = 对外发布说明,可基于 changelog)

---

<a id="us-rel-005"></a>
## US-REL-005 版本号去掉「年」,改用可手动 bump 的 major 段 📋

**Created**: 2026-06-01

- As a roll maintainer cutting releases
- I want the version string to lead with a manually-controlled major number instead of the calendar year
- So that 版本号语义从「哪一年发的」变成「哪个产品大版本」,做 v3 时只需手动 bump 一次,日常发版仍按月日 + 当日次数自增

**Domain Model:**
- Context: Release Management
- Aggregate: Release Versioning(`.roll/ops/release.sh` 的 VERSION 计算段)
- Events raised: 无(纯计算逻辑变更)
- Cross-context: 无;`package.json` / `bin/roll` 的 version 镜像由 release.sh 同步,格式天然兼容

**决策(已与 owner 确认):**
- Major 来源:专用文件 `.roll/ops/MAJOR_VERSION`,内容是裸整数 `2`;cut v3 时把它改成 `3`
- 版本格式:`v{MAJOR}.{MMDD}.{N}`,例 `v2.601.1`(月份不补前导零,保持现有 `date +%-m%d`),**仍是合法 semver**,下游 npm / 版本比较不受影响

**Agent profile:**
- est_min: 10
- risk_zone: medium  (发版基础设施 + 用户可见版本格式;但改动面小、隔离在 VERSION 计算段)
- chain_depth: 0

**AC:**
- [ ] 新增 `.roll/ops/MAJOR_VERSION`,内容为单行裸整数 `2`(无 `v` 前缀、无多余空行)
- [ ] `release.sh` 第 11–14 行:删除 `TODAY=$(date +%Y)`,改为 `MAJOR_VERSION=$(cat "${REPO_ROOT}/.roll/ops/MAJOR_VERSION")`,`VERSION_PREFIX="${MAJOR_VERSION}.${MMDD}"`;计算说明注释从 `YYYY.MMDD.N` 改为 `MAJOR.MMDD.N`
- [ ] N 自增逻辑不变:仍按 `v${VERSION_PREFIX}.*` 查本地 + 远端 tag 取最大值 +1;验证 glob `v2.601.*` 不会误匹配旧 tag `v2026.601.*`(`.` 在 git fnmatch 里是字面量,`v2` 后紧跟 `0` 而非 `.`,不匹配)
- [ ] MAJOR_VERSION 文件缺失或非整数时给出清晰报错并 `exit 1`,不静默退化成 `v.601.1`
- [ ] `bash tests/run.sh` 全绿(bash 3.2 兼容:不引入 `${var^^}` / `mapfile` / `declare -A`)
- [ ] 新增/调整测试:断言给定 MAJOR_VERSION=2 + 某 MMDD 时 `VERSION_PREFIX` 形如 `^[0-9]+\.[0-9]+$`,且最终 tag 形如 `^v[0-9]+\.[0-9]+\.[0-9]+$`(release.sh 是交互脚本,把前缀计算抽成可 source 的小函数,或写独立 bats 断言文件内容 + 正则)
- [ ] 手动验证:dry-run(confirm 前 abort)确认 `Proposed version:` 打印 `2.601.N` 形态

**Files:**
- `.roll/ops/MAJOR_VERSION` (新增)
- `.roll/ops/release.sh` (第 11–14 行 + 注释)
- `tests/unit/` (新增或扩展版本格式断言)

**Dependencies:**
- Depended on by: US-REL-006(文档刷新收尾)
- Note: `site/roll-data.js` 的 version 字段由 marketing-site 流程单独维护,release.sh 不碰,**不在本卡范围**

---

<a id="us-rel-006"></a>
## US-REL-006 Phase 1 版本号格式文档刷新(中英双轨) ✅

**Created**: 2026-06-01
**Completed**: 2026-06-02

- As a roll maintainer / contributor reading the release docs
- I want the documented version format to match the shipped `v{MAJOR}.{MMDD}.{N}` scheme
- So that 下一个读发版文档的人不会看到过时的 `YYYY.MMDD.N` 描述

**Agent profile:**
- est_min: 6
- risk_zone: low  (纯文档/注释)
- chain_depth: 0

**AC:**
- [x] `.roll/features/release-management/roll-release.md` 中 US-REL-001 第 20 行的 `Version format: YYYY.MMDD.N (e.g. 2026.419.1)` 更新为 `MAJOR.MMDD.N (e.g. v2.601.1),MAJOR 来自 .roll/ops/MAJOR_VERSION`
- [x] `release.sh` 顶部计算注释与代码一致(随 US-REL-005 落地;此处复核无残留 `YYYY`)
- [x] 全仓 sweep 确认无用户可见文档(`guide/{en,zh}`、`README*`、`skills/*/SKILL.md`)仍把版本格式写成 `年月日` / `YYYY.MMDD`;命中则同步修正
- [x] 若需改双语文档:**英文一行、中文一行,绝不同行**(遵循项目 Bilingual 约定) — 无需改动
- [x] `roll-doctor` 与 doc-structure 测试绿

**Files:**
- `.roll/features/release-management/roll-release.md` (line 20 — ✅)
- `.roll/ops/release.sh` (注释 #11 — ✅)
- (sweep 无命中)

**Dependencies:**
- Depends on: US-REL-005
- Worked example: 参考 `features/authoring/slide-deck-generator.md` 的 US-DECK-015 —— Phase 收尾合并成一张 doc-refresh story 的范例
