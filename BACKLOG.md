# Project Backlog

## Epic: CLI Simplification
### Feature: cli-simplification
| Story | Description | Status |
|-------|-------------|--------|
| [US-CLI-001](docs/features/cli-simplification.md#us-cli-001) | 精簡 cmd_init() — 移除類型/scaffold，三步極簡 init | ✅ Done |
| [US-CLI-002](docs/features/cli-simplification.md#us-cli-002) | conventions/templates 重新定位為 skills 參考資料 | ✅ Done |
| [US-CLI-003](docs/features/cli-simplification.md#us-cli-003) | skills 加入 Project Context Rule — 觀察再行動 | ✅ Done |

## Epic: Skill Ecosystem
### Feature: new-skills
| Story | Description | Status |
|-------|-------------|--------|
| [US-SKILL-001](docs/features/new-skills.md#us-skill-001) | Add `roll-jot` — fast backlog capture for bugs and ideas | ✅ Done |
| [US-SKILL-002](docs/features/new-skills.md#us-skill-002) | Add `roll-.clarify` — passive scope clarification for vague build requests | ✅ Done |
| [US-SKILL-003](docs/features/new-skills.md#us-skill-003) | Add `roll-notes` — 开发过程随手记录想法和笔记 | ✅ Done |
| [US-SKILL-004](docs/features/new-skills.md#us-skill-004) | Add `roll-doctor` — 一键诊断开发工具链健康状态 | ✅ Done |
| [US-SKILL-005](docs/features/new-skills.md#us-skill-005) | Add `roll-peer` — 跨 Agent 代码评审（Claude/Kimi/DeepSeek/Codex） | ✅ Done |
| [US-SKILL-006](docs/features/new-skills.md#us-skill-006) | Add `roll-bipo-onboard` — 新员工入职引导流程 | ✅ Done |
| [US-SKILL-008](docs/features/new-skills.md#us-skill-008) | Add `roll-doc` — legacy 项目文档自动化（扫描索引 + 缺口补全一体，project-driven） | ✅ Done |
| [US-SKILL-007](docs/features/new-skills.md#us-skill-007) | roll-jot 改名为 roll-idea — 命令名与 IDEA-NNN 编号语义对齐，更直觉 | ✅ Done |

## Epic: Distribution
### Feature: npm-distribution
| Story | Description | Status |
|-------|-------------|--------|
| [US-DIST-001](docs/features/npm-distribution.md#us-dist-001) | Rename REPO_ROOT → ROLL_PKG_DIR — explicit dev/runtime separation | ✅ Done |
| [US-DIST-002](docs/features/npm-distribution.md#us-dist-002) | Add `roll update` command (auto-detects npm vs git install) | ✅ Done |
| [US-DIST-003](docs/features/npm-distribution.md#us-dist-003) | Background version check + update nudge (24h cache) | ✅ Done |
| [US-DIST-004](docs/features/npm-distribution.md#us-dist-004) | npm publish infrastructure (.npmignore, GH Actions, README) | ✅ Done |

## Epic: IDE Integration
### Feature: trae-support
| Story | Description | Status |
|-------|-------------|--------|
| [US-TRAE-001](docs/features/trae-support.md#us-trae-001) | Add project_rules.md convention files (global + 4 templates) | ✅ Done |
| [US-TRAE-002](docs/features/trae-support.md#us-trae-002) | bin/roll integration — detect Trae, refresh project, config template | ✅ Done |

### Feature: opencode-support
| Story | Description | Status |
|-------|-------------|--------|
| [US-OPENCODE-001](docs/features/opencode-support.md#us-opencode-001) | bin/roll integration — detect opencode, sync global AGENTS.md | ✅ Done |

### Feature: ai-tools
| Story | Description | Status |
|-------|-------------|--------|
| [US-AI-001](docs/features/ai-tools.md#us-ai-001) | DeepSeek TUI 支持 — ai_deepseek 检测和配置同步 (PR #5 by @leoliu198998-ui) | ✅ Done |
| [US-AI-002](docs/features/ai-tools.md#us-ai-002) | Pi (pi-coding-agent) 支持 — AI 工具检测和集成 | ✅ Done |
| [US-AI-003](docs/features/ai-tools.md#us-ai-003) | roll-peer 新增 DeepSeek TUI 和 Codex CLI 后端 (PR #6 by @leoliu198998-ui) | ✅ Done |

## Epic: QA & Testing
### Feature: e2e-lifecycle
| Story | Description | Status |
|-------|-------------|--------|
| [US-QA-001](docs/features/e2e-lifecycle.md#us-qa-001) | roll-build Phase 5.5 — E2E Deposit after TCR | ✅ Done |
| [US-QA-002](docs/features/e2e-lifecycle.md#us-qa-002) | Template CI add E2E gating step | ✅ Done |
| [US-QA-003](docs/features/e2e-lifecycle.md#us-qa-003) | roll-.qa add CI failure triage guidance | ✅ Done |

## Epic: Diagnostics
### Feature: roll-debug
| Story | Description | Status |
|-------|-------------|--------|
| [US-DEBUG-001](docs/features/roll-debug.md#us-debug-001) | Add BB Injection mode — mount BB on pages without native integration | ✅ Done |
| [US-DEBUG-002](docs/features/roll-debug.md#us-debug-002) | roll-debug auto-fix — diagnose then auto-TCR when fixable | ✅ Done |

## Epic: Release Management
### Feature: roll-release
| Story | Description | Status |
|-------|-------------|--------|
| [US-REL-001](docs/features/roll-release.md#us-rel-001) | Add roll-release skill — one-command publish flow | ✅ Done |

## Epic: Engineering Infrastructure
### Feature: skill-harness
| Story | Description | Status |
|-------|-------------|--------|
| [US-INFRA-001](docs/features/skill-harness.md#us-infra-001) | 技能权限声明 — 每个技能声明 allowed-tools 约束可用范围 | ✅ Done |
| [US-INFRA-002](docs/features/skill-harness.md#us-infra-002) | Identity 约定 — 从 git config 读取身份信息，禁止硬编码 | ✅ Done |
| [US-INFRA-003](docs/features/skill-harness.md#us-infra-003) | Co-Authored-By 归属 — 用 trailer 替代 [client] 前缀，标准化多 AI 工具归属 | ✅ Done |
| [US-INFRA-004](docs/features/skill-harness.md#us-infra-004) | AGENTS.md Scope Gate — 防止技能执行时越界修改不相关文件 | ✅ Done |
| [US-INFRA-005](docs/features/skill-harness.md#us-infra-005) | roll-design DDD 增强 — 战略设计（Context Map）和战术建模（Aggregate/Entity/VO） | ✅ Done |

### Feature: github-actions
| Story | Description | Status |
|-------|-------------|--------|
| [US-GHA-001](docs/features/github-actions.md#us-gha-001) | Claude GitHub Actions — PR Assistant 和 Code Review 自动化工作流 (PR #8) | ✅ Done |

### Feature: convention-management
| Story | Description | Status |
|-------|-------------|--------|
| [US-CONV-001](docs/features/convention-management.md#us-conv-001) | 全局约定加入 Goal-Driven Execution 规则 — 执行前先定义可验证目标，消除模糊任务 | ✅ Done |
| [US-CONV-002](docs/features/convention-management.md#us-conv-002) | AGENTS.md 加入 "Where to Look" 导航段，roll-design 维护指针 — 任意 agent 进入项目即可导航到 docs/domain/ | ✅ Done |
| [US-CONV-003](docs/features/convention-management.md#us-conv-003) | roll-doc 为存量项目生成 AGENTS.md 导航结构 — legacy 项目不再从空白模板出发 `depends-on:US-CONV-002` | ✅ Done |

### Feature: agent-compliance
| Story | Description | Status |
|-------|-------------|--------|
| [US-INFRA-006](docs/features/agent-compliance.md#us-infra-006) | Test runner 写 proof-of-pass — 测试通过后记录 ts + tree hash 到 `.roll/last-test-pass` (Issues #16, #17) | ✅ Done |
| [US-INFRA-007](docs/features/agent-compliance.md#us-infra-007) | Pre-commit hook 验证 proof-of-pass — 60s 内 + tree hash 吻合才放行，物理拦截未经测试的 commit (Issues #16, #17) | ✅ Done |

## Epic: Changelog
### Feature: changelog-integration
| Story | Description | Status |
|-------|-------------|--------|
| [US-CL-001](docs/features/changelog-integration.md#us-cl-001) | roll-build auto-trigger changelog after deploy | ✅ Done |
| [US-CL-002](docs/features/changelog-integration.md#us-cl-002) | roll-.changelog support first-time creation with backfill | ✅ Done |
| [US-CL-003](docs/features/changelog-integration.md#us-cl-003) | 消除独立的 changelog commit — 并入 story 完成提交 | ✅ Done |
| [US-CL-004](docs/features/changelog-integration.md#us-cl-004) | changelog 风格守门 Phase 1 — 机械 linter（黑名单 grep）+ 以最近 3 个版本 bullets 为 few-shot 锚点 | ✅ Done |
| [US-CL-005](docs/features/changelog-integration.md#us-cl-005) | changelog 风格守门 Phase 2 — stage 前自审 gate，最多 3 轮重写，失败则 ALERT `depends-on:US-CL-004` | ✅ Done |

## 🐛 Bug Fixes
| ID | Description | Status |
|----|-------------|--------|
| FIX-001 | bin/roll sync 加 file-level prune（防止未来删文件在用户机器留幽灵） | ✅ Done |
| FIX-002 | `AGENTS.md` 修正 src/index.ts → bin/roll 等过时引用 | ✅ Done |
| FIX-003 | `GEMINI.md` Stack 段修正：Node.js/commander/Vitest → bash + bats | ✅ Done |
| FIX-004 | npm publish 代理冲突 — 发布前清除代理环境变量 | ✅ Done |
| FIX-005 | 模板中 $roll-story 过时引用统一替换为 $roll-build (PR #4) | ✅ Done |
| FIX-006 | git 安装检测 — 直接检查 .git 目录，避免 nvm 环境下误判 | ✅ Done |
| FIX-007 | roll-release YAML 描述引号修复 | ✅ Done |
| FIX-008 | Trae 检测容错 — 源文件不存在时正常返回，修复 set -e 崩溃 | ✅ Done |
| FIX-009 | roll update 版本校验 — npm install 后验证版本，CDN 不一致时重试 | ✅ Done |
| FIX-010 | uninstall.sh 同时清理真实目录和符号链接 | ✅ Done |
| FIX-011 | AI 工具检测加固 — 修复 pi 工具检测逻辑，补充测试用例 | ✅ Done |
| FIX-012 | roll-peer DeepSeek serve 探测 — pipefail 和 grep 范围修复 (PR #9, #10) | ✅ Done |
| FIX-013 | roll init 工作流文件缺失 — 补全初始化所需模板文件 (PR #1 by @leoliu198998-ui) | ✅ Done |
| FIX-014 | roll-build 技能 YAML 描述引号修复 (by @Sean via Kimi CLI) | ✅ Done |
| FIX-015 | roll-release 缺少 GitHub Release 创建步骤 — 导致版本检查从不生效 | ✅ Done |
| FIX-016 | 集成测试泄漏 launchd ghost 服务 — teardown 补 bootout 清理，防止 TEST_TMP 删后注册仍存 | ✅ Done |
| FIX-017 | launchd runner 缺 brew PATH 导致子进程 `node: command not found` — runner 模板显式 export `/opt/homebrew/bin` | ✅ Done |
| FIX-018 | runs.jsonl schema 漂移（project/ts/alerts/status 字段类型不统一）— 固定契约 + enum | ✅ Done |
| FIX-019 | roll-.changelog 凭感觉填版本号 — changelog 只写 Unreleased 节，release.sh 发版时提升 | ✅ Done |
| FIX-020 | loop 执行过程黑盒 — inner runner 给 claude 加 `--verbose`，工具调用实时可见 | ✅ Done |
| FIX-021 | `roll loop now` 行为与 launchd 服务不一致 — 改为直接调 runner script，补 tmux/LOCK/--verbose | ✅ Done |
| FIX-022 | auto-attach 硬编码 Terminal.app — 检测 TERM_PROGRAM + config 偏好，适配 Ghostty/iTerm/WezTerm | ✅ Done |
| FIX-023 | loop 可视化链路无 smoke 测试 — 新增 `roll loop test` 用真 claude 跑 trivial prompt 验整条链路 | ✅ Done |
| FIX-024 | roll-build/loop CI 绿前就标 Done — 加 `roll ci [--wait]`，CI 红保持 In Progress 并写 ALERT | ✅ Done |
| FIX-025 | `roll loop runs` 时间显示 UTC — `_loop_runs_format_line` 改用 `date` 转本地时区 | ✅ Done |
| FIX-026 | loop CI gate 被 SSH config 旁路打穿 — gh 强制传 `-R owner/repo`，失败=ALERT，起跑前验 HEAD CI | ✅ Done |
| FIX-027 | `roll update` 后 `roll loop status` 误报 off — reload 改用 `launchctl bootout` + `bootstrap`，避免破坏 macOS 的启用状态记录 | ✅ Done |
| FIX-028 | `roll peer` 在 REFINE/OBJECT 收尾时崩溃报 "unbound variable" — 补 `local resolution=""` 初始化，加回归测试 | ✅ Done |
| FIX-029 | `roll peer` 自动弹出 Ghostty 窗口时参数解析错误 — 移除多余引号，与 loop 的写法对齐 | ✅ Done |
| FIX-031 | loop 同时跑两个 claude 会话互相踩数据 — inner script 加第二道锁（进程号 + 启动时间双校验）| ✅ Done |
| FIX-032 | loop 选任务时不理会 `depends-on:` 和 `manual-only:` 标签 — 加过滤逻辑，依赖未完成或标记手动的任务直接跳过 | ✅ Done |
| FIX-033 | dashboard 显示的状态与各子命令不一致（4 处同时出错）— 对齐状态读取逻辑，修 release-ready 判断和 PROPOSAL 计数 | ✅ Done |

## Epic: Autonomous Evolution
### Feature: autonomous-evolution
| Story | Description | Status |
|-------|-------------|--------|
| [US-AUTO-001](docs/features/autonomous-evolution.md#us-auto-001) | roll-build 架构摩擦信号 — 实现遇阻时自动标记 REFACTOR 到 BACKLOG | ✅ Done |
| [US-AUTO-002](docs/features/autonomous-evolution.md#us-auto-002) | roll-.dream — 每晚代码/架构健康巡检，产出 REFACTOR 条目 | ✅ Done |
| [US-AUTO-003](docs/features/autonomous-evolution.md#us-auto-003) | roll-brief — Feature完成/每日晨报/按需简报，含发布就绪建议 | ✅ Done |
| [US-AUTO-004](docs/features/autonomous-evolution.md#us-auto-004) | roll-loop — BACKLOG 自主执行器 + 调度器 + 跨Agent路由 + 失败处理 | ✅ Done |
| [US-AUTO-005](docs/features/autonomous-evolution.md#us-auto-005) | CLI 管理层文档化 — roll loop/brief/agent + .roll.yaml 约定 | ✅ Done |
| [US-AUTO-006](docs/features/autonomous-evolution.md#us-auto-006) | Methodology 自主演化章节（中英双语）— 可选层原则 + 三层架构 | ✅ Done |
| [US-AUTO-007](docs/features/autonomous-evolution.md#us-auto-007) | roll backlog 命令 — 快速查看当前项目未完成任务清单，无需打开 BACKLOG.md 文件 | ✅ Done |
| [US-AUTO-008](docs/features/autonomous-evolution.md#us-auto-008) | roll loop 监控台 — 类似 top 命令，实时查看当前项目的 loop 状态、队列、执行历史，loop 跑完后有迹可查 | ✅ Done |
| [US-AUTO-009](docs/features/autonomous-evolution.md#us-auto-009) | launchd 调度迁移 — roll setup 安装 plists（默认关闭，幂等）；roll loop on/off/status/monitor 全面切换到 launchd，废弃 crontab | ✅ Done |
| [US-AUTO-010](docs/features/autonomous-evolution.md#us-auto-010) | roll-loop TCR 硬校验 — 故事完成后检查 tcr: 微提交数量，为 0 时将故事回退为 📋 Todo 并写 ALERT，防止 agent 跳过 TCR 节奏 | ✅ Done |
| [US-AUTO-011](docs/features/autonomous-evolution.md#us-auto-011) | roll loop monitor 增强 — 显示三服务 launchd 状态（loop/dream/brief）+ 实时 log tail | ✅ Done |
| [US-AUTO-012](docs/features/autonomous-evolution.md#us-auto-012) | loop 调度时间和 agent 移入 ~/.roll/config.yaml — 默认错开整点（:05/:10/:15），可配 hour/minute，免改源码 | ✅ Done |
| [US-AUTO-013](docs/features/autonomous-evolution.md#us-auto-013) | roll-propose skill — 人主动发起，从产品视角生成 1-3 条 proposed US 写入 PROPOSALS.md 等待审批 | ✅ Done |
| [US-AUTO-014](docs/features/autonomous-evolution.md#us-auto-014) | `_install_launchd_plists` 变更自动 reload — plist 内容变化且服务已加载时自动 unload + reload，消除静默失效 | ✅ Done |
| [US-AUTO-015](docs/features/autonomous-evolution.md#us-auto-015) | `roll loop status/monitor` 三态展示 — 区分 ● loaded / ⚠ installed-not-loaded / ○ not-installed，含自愈提示 | ✅ Done |
| [US-AUTO-016](docs/features/autonomous-evolution.md#us-auto-016) | loop 执行 story 前标记 🔨 In Progress — brief 可感知进行中状态，tcr 微提交不再对 brief 不可见 | ✅ Done |
| [US-AUTO-024](docs/features/autonomous-evolution.md#us-auto-024) | `roll loop runs` 每次 loop 运行的快速可见性 — 单次 loop 结束写 JSONL，新命令显示最近 N 次摘要 | ✅ Done |
| [US-AUTO-025](docs/features/autonomous-evolution.md#us-auto-025) | loop 在 tmux session 里跑 + `roll loop attach` 实时观看 — 让 loop 从看不见的子进程变成可随时 attach 的活终端 | ✅ Done |
| [US-AUTO-017](docs/features/autonomous-evolution.md#us-auto-017) | roll-.dream 日志改为中文输出 — 与 roll-brief 语言风格对齐 | ✅ Done |
| [US-AUTO-026](docs/features/autonomous-evolution.md#us-auto-026) | 默认 auto-attach + 极简 mute/unmute — loop/peer 一触发就自动背景弹窗看实时 tmux，roll loop mute 一键关 | ✅ Done |
| [US-AUTO-018](docs/features/autonomous-evolution.md#us-auto-018) | roll-brief 和 roll-.dream 生成文档后自动 git commit — brief 显式化 commit；dream 标准化现有隐式行为 | ✅ Done |
| [US-AUTO-019](docs/features/autonomous-evolution.md#us-auto-019) | $roll-design 非交互模式 + IDEA 晋升路径 — --from-file / --from-idea，人可离线丢需求等 loop 执行 | ✅ Done |
| [US-AUTO-020](docs/features/autonomous-evolution.md#us-auto-020) | roll-design + roll-loop SKILL 文档补充 — Confirm 语义澄清 + 紧急绕过路径说明 | ✅ Done |
| [US-AUTO-021](docs/features/autonomous-evolution.md#us-auto-021) | `roll status` 增加全局 loop 概览区块 — 展示本机所有项目的 loop 状态、调度时间、backlog 待办数 | ✅ Done |
| [US-AUTO-022](docs/features/autonomous-evolution.md#us-auto-022) | Loop 并发安全 — per-loop LOCK 防重入 + 选 story 跳过 🔨 In Progress，支持人工介入和多 agent 协作 | ✅ Done |
| [US-AUTO-023](docs/features/autonomous-evolution.md#us-auto-023) | `roll loop pause/resume` 人工模式切换 — 轻量暂停调度（保留 plist），支持纯人工/人机协同/纯自主三种模式 | ✅ Done |
| [US-AUTO-028](docs/features/autonomous-evolution.md#us-auto-028) | `roll-.dream` Scan 6 — 文档新鲜度持续监测（滞后文档/隐性约定/模块漂移 → REFACTOR → loop） `depends-on:US-SKILL-008` | ✅ Done |
| [US-AUTO-027](docs/features/autonomous-evolution.md#us-auto-027) | peer 调用 auto-attach — 把 `_peer_call` 也包到 tmux session 里，未 mute 时弹窗看 peer 跨 agent 协商（split from US-AUTO-026 因 peer 当前没有 tmux 基建） | ✅ Done |
| [US-AUTO-029](docs/features/autonomous-evolution.md#us-auto-029) | `roll` dashboard 重设计 — 自治优先布局（三层 × 四道防线主视觉 + Pipeline 全景 + Current Focus DoD + Human×AI 介入区），把 AI 在自动跑什么放第一眼 | ✅ Done |
| [US-AUTO-030](docs/features/autonomous-evolution.md#us-auto-030) | dashboard 完成度检查项 — 接入 `roll release` 的部署状态信号 | ⏸ Deferred |
| [US-AUTO-031](docs/features/autonomous-evolution.md#us-auto-031) | dashboard 完成度检查项 — 接入 `$roll-sentinel` 的运行状态信号 | ⏸ Deferred |
| [US-AUTO-032](docs/features/autonomous-evolution.md#us-auto-032) | loop 在独立 worktree 里跑 — 拆为 US-AUTO-036（辅助函数）+ US-AUTO-037（接入 runner） | ✅ Done → US-AUTO-036, US-AUTO-037 |
| [US-AUTO-033](docs/features/autonomous-evolution.md#us-auto-033) | loop 完成任务后自动开 PR + auto-merge，CI 绿自动合入，无需人工介入 `depends-on:US-AUTO-037` | ✅ Done |
| [US-AUTO-034](docs/features/autonomous-evolution.md#us-auto-034) | loop 每轮先处理未合入的 PR（自有等合/外部评审/卡住的尝试 rebase），再去领新任务 `depends-on:US-AUTO-033,US-AUTO-035` | ✅ Done |
| [US-AUTO-035](docs/features/autonomous-evolution.md#us-auto-035) | AI 代码评审可批准或打回 PR，与 CI 形成合并双门；紧急情况可用环境变量跳过 `depends-on:US-AUTO-033` | ✅ Done |
| [US-AUTO-036](docs/features/autonomous-evolution.md#us-auto-036) | worktree 隔离 Phase 1 — 加 7 个辅助函数 + 单元测试，不改动 runner | ✅ Done |
| [US-AUTO-037](docs/features/autonomous-evolution.md#us-auto-037) | worktree 隔离 Phase 2 — runner 接入辅助函数，每轮在独立目录跑，完成后合回主干 `depends-on:US-AUTO-036` `manual-only:true` | ✅ Done |
| [US-AUTO-038](docs/features/autonomous-evolution.md#us-auto-038) | 清理遗留的 `claude/*` 临时分支 — 每次 claude 会话结束后立即删除，不做定期扫描 `depends-on:US-AUTO-033` | ✅ Done |

## Epic: Documentation
### Feature: documentation
| Story | Description | Status |
|-------|-------------|--------|
| [US-DOC-001](docs/features/documentation.md#us-doc-001) | 建立 `docs/guide/en/` + 反向补写 loop/dream/peer 英文用户指南（价值点、场景、命令参考） | ✅ Done |
| [US-DOC-002](docs/features/documentation.md#us-doc-002) | 建立 `docs/guide/zh/` + 中文版 loop/dream/peer 用户指南（镜像 EN，华语用户主阅读层） | ✅ Done |
| [US-DOC-003](docs/features/documentation.md#us-doc-003) | 建立 `docs/domain/` + DDD context-map + autonomous-operation 领域模型（英文，工程层） | ✅ Done |
| [US-DOC-004](docs/features/documentation.md#us-doc-004) | 迁移现有散落文档至新结构：methodology×2 → guide/，skill-selection-guide → guide/，loop-autorun-verification → practices/ | ✅ Done |
| [US-DOC-005](docs/features/documentation.md#us-doc-005) | README 精简重构（≤120行 + doc index）+ AGENTS.md 新增 Documentation Conventions 章节 | ✅ Done |
| [US-DOC-006](docs/features/documentation.md#us-doc-006) | 扩展 roll-.dream 文档覆盖度巡检 + brief 展示 doc coverage（缺 EN guide / 缺 ZH 翻译 / 文件落错目录） | ✅ Done |

## ♻️ Refactor
| ID | Description | Status |
|----|-------------|--------|
| REFACTOR-001 | US-AUTO-007 roll backlog 补 TCR — 遗漏测试，严格按 TCR 节奏补写 cmd_backlog 行为用例 | ✅ Done |
| REFACTOR-002 | US-AUTO-008 roll loop monitor 补 TCR — 遗漏测试，严格按 TCR 节奏补写 _loop_monitor 冒烟用例 | ✅ Done |
| REFACTOR-003 | 删除 bin/roll 中两个死代码函数 `is_fresh_project()`、`_mkscaffold()` 及孤儿测试文件 is_fresh_project.bats — flagged by dream 2026-05-11 | ✅ Done |
| REFACTOR-004 | 修复 `_write_backlog()` + `_ensure_features_dir()` 使用 `_WK_MERGE_SUMMARY` 而非 `_ROLL_MERGE_SUMMARY`，导致 roll init 摘要中静默丢失 BACKLOG/docs/features 条目 — flagged by dream 2026-05-11 | ✅ Done |
| REFACTOR-005 | 提取 `_for_each_ai_tool()` 辅助函数消除 AI 客户端迭代逻辑的 4 处重复（bin/roll:~365, ~497, ~1136 等） — flagged by dream 2026-05-11 | ✅ Done |
| REFACTOR-006 | CI 测试套件提速 — 当前 377 个 bats 测试在 CI (ubuntu) 约需 5+ 分钟，排查：重复覆盖的用例、可并行的文件组、慢测试根因（integration/cmd_setup.bats 尤慢）；目标：CI 时间减半，不降低覆盖率 | ✅ Done |
| REFACTOR-007 | 新建 `tests/unit/helpers.bash` — 消除 22 个单元测试文件中重复的 source/mktemp/rm/NO_COLOR 样板，参照 tests/integration/helpers.bash 模式 — flagged by dream 2026-05-12 | ✅ Done |
| REFACTOR-008 | CI 测试二轮精简 Phase 1A — 按机器核数动态并行，文档类改动跳过 CI，补充缺失依赖的报错提示 | ✅ Done |
| REFACTOR-009 | CI 测试二轮精简 Phase 1B — 单元测试和集成测试拆成两个并行任务运行 | ✅ Done |
| REFACTOR-010 | CI 测试三轮精简 Phase 2 — 找出慢测试，把文件结构检查类用例迁移到 `roll doctor`，目标减少 25% 用例数 | ✅ Done |
| REFACTOR-011 | session 清理只删远端分支，本地 worktree 未 `git worktree remove` — `.claude/worktrees/` 长期积累，`git worktree list` 越来越嘈杂 — flagged by dream 2026-05-14 | ✅ Done |
| REFACTOR-012 | `scripts/release.sh` 中 `_detect_agent()` 与 `bin/roll config_get()` 双维护 config 读取逻辑 — config schema 变更时两处静默漂移 — flagged by dream 2026-05-14 | 📋 Todo |
| REFACTOR-013 | docs: `$ROLL_CONFIG` / `$ROLL_GLOBAL` 在 bin/roll 中分别引用 18 / 9 次，docs/ 中无任何提及 — 用户无法发现这两个配置入口 — flagged by dream 2026-05-14 (hint: $roll-doc) | 📋 Todo |

## Epic: Backlog 生命周期管理
### Feature: alert-lifecycle
| Story | Description | Status |
|-------|-------------|--------|
| [US-ALERT-001](docs/features/alert-lifecycle.md#us-alert-001) | `roll alert` 命令 — ALERT 查看 / ack / resolve 生命周期管理，与 brief/status 告警计数联动 | ✅ Done |

## Epic: 自主循环可观测性
### Feature: notifications
| Story | Description | Status |
|-------|-------------|--------|
| [US-NOTIFY-001](docs/features/notifications.md#us-notify-001) | macOS 系统通知推送 — loop story 完成 / ALERT 写入时主动触达，与 `roll loop mute` 联动，无 macOS 环境静默降级 | ✅ Done |

## 💡 Ideas
| ID | Description | Status |
|----|-------------|--------|
| IDEA-001 | conventions/global/AGENTS.md 加 Identity 规则：从 git config 读取，禁止硬编码个人数据 | ✅ Done |
| IDEA-002 | roll CLI 启动时显示最近三个版本的 changelog 内容 | ✅ Done |
| IDEA-003 | 技能审计 P0 — 名称对齐、清理过时引用、补 When Not to Use、统一 license (PR #3 by @sealfe) | ✅ Done |
| IDEA-004 | roll loop 监控台 — 类似 top 命令，实时查看当前项目的 loop 状态、队列、执行历史，loop 跑完后有迹可查 | ✅ Done → US-AUTO-008 |
| IDEA-005 | roll backlog 命令 — 快速查看当前项目未完成任务清单，无需打开 BACKLOG.md 文件 | ✅ Done → US-AUTO-007 |
| IDEA-006 | roll-jot 改名为 roll-idea — 命令名与 IDEA-NNN 编号语义对齐，更直觉 | ✅ Done → US-SKILL-007 |
| IDEA-007 | loop 调度时间和默认 agent 移入配置文件（.roll.yaml 或 ~/.roll/config.yaml），方便用户调整而不需要改 bin/roll 源码 | ✅ Done → US-AUTO-012 |
| IDEA-008 | roll dashboard 重设计 — 当前布局不完整，需要重新规划整体布局、信息密度、交互方式，作为项目入口的体验应该更好 | ✅ Done → US-AUTO-029 |
| IDEA-009 | 文档语言分层规则 — 模型消化/产出的内容用英文，向人披露的信息用中文，解决当前中英混杂问题 | ✅ Done → US-DOC-001..006 |
| IDEA-010 | `roll status` 增加全局 loop 概览区块 — 在现有 convention/skills 状态后追加本机所有项目的 loop 服务状态、调度时间和 backlog 待办数 | ✅ Done → US-AUTO-021 |
| IDEA-012 | Legacy 项目文档自治 — 三层体系：① `roll-doc-index` 整合散落文档生成可寻址索引；② `roll-doc-fill` 从 codebase 反向推导缺失文档（架构/编码规范/API 契约）；③ `roll-.dream` 新增 Scan 6（文档新鲜度）持续检测滞后/隐性约定/模块漂移，产出 REFACTOR 条目走 loop 自动维护，结果汇入 brief | ✅ Done → US-SKILL-008, US-AUTO-028 |
| IDEA-013 | dashboard 完成度检查项 — UAT 信号源定义（怎么采集、谁来验，概念待定） | ⏸ Deferred |
| IDEA-014 | dashboard 完成度检查项 — "活证据"信号源定义（与 sentinel 数据流可能有关联，设计待定） | ⏸ Deferred |
| IDEA-015 | loop 在独立目录（worktree）里跑，避免污染主干正在编辑的代码 — 拆为 US-AUTO-036 + US-AUTO-037 落地 | ✅ Done → US-AUTO-036, US-AUTO-037 |
| IDEA-016 | PR 生命周期管理迁移到 GitHub Actions — 评审触发、CI 绿后 auto-merge、rebase 失败诊断、stale 清理全部由 GitHub Actions event-driven 处理；Loop 只检查自己开的未收口故事。需先验证 US-AUTO-034 落地效果再做设计。 | ⏸ Deferred |
