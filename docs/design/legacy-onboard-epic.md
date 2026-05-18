# Epic: Legacy Project Onboarding + 项目管理剥离

> 把"项目管理"从项目里剥离，让 Legacy 项目能干净接入 Roll，老用户和新用户共享同一套目录形态。
> 原始方案：`~/Downloads/legacy-onboard-epic.md`。本文件是经过设计评审后的精化版本。

---

## 1. 核心架构原则

> **过程默认对内，产品默认对外。**

- 根级目录的东西（`bin/`、`guide/`、`site/`、`tests/`）= 产品，给"别人"用
- `.roll/` 里的东西 = 过程，给"我们自己"用
- **对外/对内** 与 **公开/私有** 正交：是否 `.gitignore` 决定公开度，目录结构表达方向

归属判据：被外部引用（AGENTS.md、README、用户文档）= 规范/产品 → 根级；自动产出或仅内部消费 = 过程 → `.roll/`。

## 2. 目标架构

```
project-root/
├── README.md                     # 产品门面
├── LICENSE
├── AGENTS.md                     # AI 约定（根目录是工具约定）
├── CHANGELOG.md                  # 公开沉淀
├── package.json
│
├── bin/ lib/ hooks/ scripts/     # 产品代码
├── conventions/ skills/ template/# 产品分发物
├── tests/                        # 产品验证
│
├── guide/                        # 用户文档（对外产品）
│   ├── en/                       # ← 原 docs/guide/en/
│   │   ├── overview.md
│   │   ├── skills.md
│   │   ├── practices/            # ← 原 docs/practices/（规范类）
│   │   │   └── engineering-common-sense.md
│   │   └── faq.md                # ← 新增或从现有内容提取
│   └── zh/                       # ← 原 docs/guide/zh/
│       ├── overview.md
│       ├── skills.md
│       ├── practices/
│       │   └── engineering-common-sense.md
│       └── faq.md
│
├── site/                         # 网站 + 宣传材料（对外产品）
│   ├── slides/                   # ← 原 docs/intro/（HTML 宣传材料）
│   │   └── roll-introduction.html
│   ├── index.html                # ← 原 docs/site/
│   ├── roll-app.jsx
│   └── ...
│
└── .roll/                        # 项目管理 + 设计过程（对内）
    ├── backlog.md                # ← 原 BACKLOG.md
    ├── proposals.md              # ← 原 PROPOSALS.md
    ├── features/                 # ← 原 docs/features/
    ├── features.md               # ← 原 docs/features.md
    ├── briefs/                   # ← 原 docs/briefs
    ├── dream/                    # ← 原 docs/dream
    ├── design/                   # ← 原 docs/design（本文件所在）
    ├── domain/                   # ← 原 docs/domain
    ├── verification/             # ← 原 docs/practices/ 中的执行记录
    │   └── loop-autorun-verification.md
    ├── onboard-plan.yaml         # 新增：onboard 中间产物
    └── state/                    # loop state、中间产物
```

**`docs/` 目录消失。**

关键结构决策：
- `guide/` 以语言为顶层维度（`en/`, `zh/`），practices 和 faq 收入各语言子目录
- `docs/intro/`（HTML 宣传材料）→ `site/slides/`，不归 `guide/`
- `docs/practices/` 按性质拆分：规范类 → `guide/{lang}/practices/`，执行记录 → `.roll/verification/`
- `docs/INDEX.md` 不在迁移范围——是 `roll-doc` 未来产出物，新项目默认写到 `.roll/index.md`
- `docs/design/`（AGENTS.md §8 未列出的隐藏目录）归入 `.roll/design/`

## 3. 两阶段模型

```
Phase 1（US-ONBOARD-001..010）         Phase 2（US-ONBOARD-011）
────────────────────────              ────────────────────────
根级散落的过程文件                      Roll 的 .roll/
  BACKLOG.md                           整体搬入 roll-meta
  PROPOSALS.md         ──→  .roll/     ──→  seanyao/roll-meta (private)
  docs/features/                       用户项目不受影响
  docs/briefs/ ...                     .roll/ 仍是标准约定
```

- Phase 1 的 `.roll/` 对 Roll 自身是**中转站**，对用户项目是**永久住所**
- `.roll/` 必须是自包含单元：内部文件不允许外向相对路径，引用代码用符号名不用路径
- Phase 2（US-ONBOARD-011）时 `.roll/` 可以整体 lift 到 roll-meta，无需逐文件处理
- Phase 2 的跨仓库工具链协作（loop 读 BACKLOG、状态回写、配置认证）在 US-ONBOARD-011 设计阶段解决

## 4. 三个场景共享同一架构

| 场景 | 入口 | 行为 |
|---|---|---|
| Legacy 项目接入 | `roll init` 检测后引导 → `$roll-onboard` | 交互式认知 + 生成 `.roll/` 结构 |
| 老 Roll 项目迁移 | `roll migrate` | 把 BACKLOG.md / docs/features 等搬入 `.roll/` |
| Roll 自身 dogfood | `roll migrate` 在自身仓库执行 | 把现有结构升级到 `.roll/` + GitHub 仓库改名 roll |

## 5. Legacy Onboard 交互流程

### 5.1 触发判定

`roll init` 在以下两条同时满足时进入 onboard 引导：
- 当前目录没有 `AGENTS.md`
- 且 `src/`、`app/`、`lib/`、`pkg/`、`cmd/` 任一目录非空文件数 >= 10

否则走现有的"空项目 init"路径。

### 5.2 Agent 发现与告知

确认是 Legacy 项目后，`roll init` 在 bash 侧扫描本机已安装的 AI agent（复用 `_for_each_ai_tool()`），输出：

```
[Roll] Detected: legacy project (no AGENTS.md, 47 source files in src/).

[Roll] Onboarding 需要一个 AI agent 来读懂这个项目。检测到：
  ✓ Claude Code   (installed)
  ✓ Cursor        (installed)
  ✗ Codex         (not found)

[Roll] 后续过程会使用你的 agent 调用模型，token 消耗在你自己的账户上。
       代码与对话都留在你的 agent 工具里 —— Roll 本身不上传任何内容。

[Roll] 下一步：打开任一已检测到的 agent，运行：
         $roll-onboard

       完成对话后回到这里，运行：
         roll init --apply
```

边界情况：
- 0 个 agent：报错并指向 README 的快速开始
- 1 个 agent：跳过选择，直接给出对应工具的指引
- 2+ 个 agent：列出选项，由用户决定

### 5.3 三组九问（< 3 分钟）

**第一组 — 项目认知校对**（AI 读完代码后）

1. 识别为 [类型] 项目，主要做 [简述]，对吗？
2. 主要业务领域是 [域 A、域 B、…]，要补充或调整吗？
3. 关键模块是 [X、Y、Z]，有遗漏或误识吗？

**第二组 — 生成范围与边界**

4. 是否生成 backlog / features / domain / briefs 各项？（多选）
5. 已有哪些文档要 include 而非重新生成？（候选列表）
6. 草稿放进 `.roll/` 吗？（默认是；选否则回到传统 `docs/`）

**第三组 — 隐私与下一步**

7. 是否把 `.roll/` 加入 `.gitignore`？（skill 询问，写入 plan，bash 执行）
8. 同步约定到哪些 AI 工具？（Claude / Cursor / Codex / …）
9. init 完成后是否启用 `roll loop`？

### 5.4 流程图

```
roll init
  ↓ 检测 Legacy
  ↓ 扫描可用 agent（复用 _for_each_ai_tool）+ 输出 token 告知
  ↓ 提示用户在所选 agent 里运行 $roll-onboard
$roll-onboard  (skill，在所选 AI 工具里跑)
  ↓ 读代码、理解项目
  ↓ 调用 roll-doc --dry-run 拿 gap 报告（只读，归 skill）
  ↓ 三组九问
  ↓ 写 .roll/onboard-plan.yaml
roll init --apply  (bash)
  ↓ 校验 plan 完整性
  ↓ 调用 roll-doc 生成 drafts（写入，归 bash）
  ↓ 按 plan 落盘到 .roll/
  ↓ 按 plan 写 .gitignore（读 plan 中 Q7 的值）
  ↓ 按 plan 同步 AI 工具约定
```

## 6. 关键架构决策：硬约束 vs 认知

**Bash 负责硬约束（不可绕过）：**
- Legacy 检测、idempotency 判断
- "不碰已存在文件"的检查
- plan 完整性校验
- `roll-doc` 写入模式调用
- `.gitignore` 写入（读 plan 中用户选择，不另行询问）
- 所有最终落盘文件

**Skill 负责认知（AI 必须做）：**
- 读代码、理解项目
- 把发现讲给用户听
- 生成 draft 内容（不直接落盘）
- `roll-doc --dry-run`（只读，取 gap 报告）
- 主持三组九问（含 Q7 .gitignore 询问）
- 产出 `onboard-plan.yaml`

**两边的契约：`.roll/onboard-plan.yaml`**

```yaml
version: 1
generated_at: "2026-05-18T14:30:00+08:00"  # bash 拒绝超过 24h 的 plan

project_understanding:
  type: backend-service | frontend-only | fullstack | cli
  description: "..."
  domains: [...]
  key_modules: [...]

scope:
  approved: [backlog, features, domain, briefs]
  declined: [design]

include_existing:
  - README.md
  - docs/architecture.md

privacy:
  gitignore_dot_roll: true

sync_targets: [claude, cursor]
enable_loop: false
```

Skill 产出这个文件，bash 读这个文件执行所有副作用。**AI 没有直接修改用户项目的能力。**

Plan 校验由 `lib/roll-plan-validate.py`（Python）执行，bash 调用并检查 exit code。不用 bash 原生解析 YAML。校验内容：required fields 完整性 + `generated_at` 不超过 24 小时 + version 兼容性。plan 不存在时输出明确提示"请先在 AI agent 里运行 `$roll-onboard`"。

## 7. 复用与新增

**复用现有零件：**
- `scan_project_type_from_files` — 项目类型检测
- `_merge_global_to_project` / `_merge_claude_to_project` — section 级非破坏性合并
- `roll-doc` skill — scan / gap / fill 四阶段（先 `--dry-run` 取 gap，再正式生成）
- `_for_each_ai_tool()` — 已安装 AI agent 的遍历（REFACTOR-005 提取）

**需要新增：**
- `$roll-onboard` skill — 交互编排 + 写 plan
- `roll init` 的 Legacy 检测分支
- `roll init --apply` 子命令 — 读 plan 执行
- `roll migrate` 命令 — 老路径迁移到 `.roll/`
- 结构强制检测（启动前拦截）
- `.gitignore` 写入逻辑（读 plan 执行，不另行询问）

**明确不做：**
- 双向兼容期 / 不支持老结构并行运行
- 复杂的隐私分级（只支持"是否 .gitignore"一档）
- 重新实现 `roll-doc` 已有的能力
- 触碰用户已有文件（除 section merge 已有的非破坏性追加）
- 让 AI 自动决定生成什么（一切由 plan 决定）

## 8. 迁移路径（One-Shot）

不做双向兼容期。一次切干净。

**机制：**

1. **Major version bump**：发布 2.0
2. **强制检测**：新版 Roll 启动项目命令前检查项目结构
   - 检测到 `.roll/` → 正常运行
   - 检测到老结构 → 拒绝执行，提示 `roll migrate`
   - 都没有 → 走空项目 init 路径
   - **豁免命令**：`setup`、`update`、`version`、`help`、`init`（空目录）不做结构检测
   - **目录遍历**：检测逻辑从 `pwd` 向上遍历到 git root（或 filesystem root），不只看当前目录
3. **`roll migrate` 命令**：原子操作
   - dry-run 模式预览所有变更
   - 真实执行：`git mv` 保留历史 + 更新 `.gitignore`
   - 单个 commit，便于 review 与回滚
   - 三个目标目录：`guide/`、`site/`（含 `slides/`）、`.roll/`
4. **回滚**：`git revert` + `npm install -g @seanyao/roll@1.x`

**`roll migrate` 三态幂等：**

| 状态 | 行为 |
|------|------|
| 仅老路径存在 | 执行迁移 |
| 仅 `.roll/` 存在 | no-op，输出"已迁移"提示 |
| 两者并存（部分迁移） | 报错 + 列出残留路径，要求用户手动确认 |

### 8.1 路径引用全量审查（前置阻塞项）

codebase 当前对老路径的引用分布：

| 区域 | 文件数/引用数 | 风险 |
|---|---|---|
| `bin/roll` | 48 处字面引用 | 主 CLI 行为，漏改即直接报错 |
| `skills/*/SKILL.md` | 13 个文件 | AI agent 按 skill 文本执行，引用错路径就走偏 |
| `tests/` | 25 个文件 | 测试断言路径，漏改 CI 红 |
| `conventions/` | 5 处 | 全局约定，影响所有用户项目 |
| `lib/*.py`、`hooks/`、`scripts/` | 多处 | 边缘但关键路径 |
| `template/`、`templates/` | 1+ 处 | 新建项目模板 |
| 变量化路径 | 如 `briefs_dir="docs/briefs"` | 字面 grep 抓不到，需单独审查 |

**输出物：** Story 2 的可交付是 `path-audit.md`，含：
- 每个引用点的文件 + 行号 + 上下文
- 标注是"读"还是"写"
- 字面 vs 变量化分别成表
- 标注是否在 `roll migrate` 范围内（需迁移真实文件）还是仅代码替换

**Story 2 不完成，Story 3 起任何代码改动都禁止 merge。**

## 9. Idempotency

`roll init` 在已 onboard 的项目上重跑：
- 跳过交互
- 走现有的 section merge（保留现状）
- 不重新生成 drafts

"已 onboard" 的判据：项目里同时存在 `AGENTS.md` 和 `.roll/` 目录。

## 10. Story 拆分（精确依赖）

| # | Story | depends-on | 说明 |
|---|---|---|---|
| 1 | `.roll/` 目录约定 | — | 文档化新结构、命名、文件归属、可搬迁约束 |
| 2 | **路径引用全量审查** | 1 | 产出 `path-audit.md`：字面 grep + 变量化路径手动审查（`cmd_brief`/`cmd_loop`/`_write_backlog` 等动态路径构造）+ template/conventions 触点；后续 Story 的前置阻塞项 |
| 3 | `roll migrate` 命令 | 2 | 基于审查清单：dry-run + 真实执行 + 三态幂等 + 三目标目录（guide/ site/ .roll/） |
| 4 | 结构强制检测 + 全局命令豁免 | 3 | 启动前检查，老结构存在则拒绝 + 提示 migrate；`setup`/`update`/`version`/`help`/`init`（空目录）豁免；检测逻辑从 pwd 向上遍历到 git root |
| 5 | Roll 自身 dogfood migrate | 3, 4 | 执行 migrate + bump 2.0 + GitHub 仓库改名 roll + AGENTS.md §8 重写 + 全部测试文件路径更新 + template/conventions 路径更新 + .roll/ 自包含校验；AC: `npm test` 全绿 |
| 6 | Legacy 检测 + Agent 发现与告知 | 1 | `roll init` 触发判定 + `_for_each_ai_tool()` 扫描 + token 告知 |
| 7 | `onboard-plan.yaml` schema | 1 | 定义中间产物格式 + 校验 |
| 8 | `$roll-onboard` skill | 1, 7 | 交互编排（含三组九问 + Q7 .gitignore） |
| 9 | `roll init --apply`（含 .gitignore 写入） | 1, 2, 7 | 消费 plan 执行所有副作用 |
| 10 | 用户文档 + Migration Guide | 5 | `guide/` 里新增 Legacy onboarding 章节、FAQ、迁移说明 |

Story 1-5 是基础设施。6-9 是 onboarding 主线。10 是收尾。

原 Story 10（.gitignore）合并进 Story 9（`roll init --apply`），.gitignore 写入是 apply 的子动作。

依赖图：

```
1 ──→ 2 ──→ 3 ──→ 4 ──→ 5
│           ↑               ↓
│     ┌─────┘               10
├──→ 6
├──→ 7 ──→ 8
└────────→ 9
     ↑
     7
```

## 11. 验收标准

- 真实 Legacy 项目（10+ 源文件、无 AGENTS.md）执行 `roll init`，能引导进入 onboard
- `roll init` 输出能列出本机已装的 agent，无 agent 时报错指向安装指引
- token 告知在 onboard 启动前显性出现
- 全程 <= 3 分钟、<= 9 个问题
- `path-audit.md` 清单完整
- 新版 Roll 在老结构项目上执行任何命令，明确拒绝运行并提示 `roll migrate`
- `roll migrate` 是原子操作：dry-run 可预览、真实执行产出单个 commit、`git mv` 保留历史
- `roll migrate` 三态幂等：已迁移 no-op、部分迁移报错列残留
- Roll 自身仓库 migrate 后 CI 全绿
- GitHub 仓库名从 Roll 改为 roll
- `.roll/` 内容自包含，无外向硬链接（Phase 2 搬迁前提）
- 用户拒绝任一选项，对应文件不被生成
- `.roll/` 目录可被 `rm -rf` 完整删除，项目恢复原状
- 老用户在不主动 migrate 的情况下，所有现有命令继续工作
- 1.x 最后一个版本包含 deprecation 提示（"2.0 将要求 .roll/ 结构，请参考迁移指南"）
- `roll setup`/`update`/`version`/`help` 在任何项目结构下都能运行
- `roll init --apply` 在无 plan 时给出明确引导；plan 超过 24h 时拒绝并提示重新 onboard
- plan 校验由 Python 执行（`lib/roll-plan-validate.py`），不依赖 bash YAML 解析

## 12. 非目标

- 不做云端服务、不做任何代码上传
- 不做"严格隐私"档（本地不出仓由 `.gitignore` 解决）
- 不替代 `roll-doc`（onboard 是它的编排者，不是替代）
- 不做双向兼容期
- Phase 2（.roll/ → roll-meta）不在本 Epic 范围，但设计满足搬迁前提

## 13. 关联 ADR

本 Epic 的架构决策记录在 `PROPOSALS.md` 尾部：
- ADR-001: `.roll/` 目录约定与内容归属规则
- ADR-002: One-Shot 迁移策略（无双向兼容期）
- ADR-003: `onboard-plan.yaml` — Skill/Bash 契约 Schema
- ADR-004: Bash/Skill 责任边界
