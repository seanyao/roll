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

## Epic: Changelog
### Feature: changelog-integration
| Story | Description | Status |
|-------|-------------|--------|
| [US-CL-001](docs/features/changelog-integration.md#us-cl-001) | roll-build auto-trigger changelog after deploy | ✅ Done |
| [US-CL-002](docs/features/changelog-integration.md#us-cl-002) | roll-.changelog support first-time creation with backfill | ✅ Done |

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
| FIX-016 | 集成测试泄漏 launchd ghost 服务 — `cmd_loop.bats` 中 `roll loop on` 通过 `launchctl load -w` 注册到全局 gui domain，TEST_TMP 清理后注册仍保留，导致 60+ ghost 累积；teardown 需先 bootout 再删 TEST_TMP | ✅ Done |
| FIX-017 | launchd runner 缺 brew PATH 导致 hook 子进程报 `node: command not found` — launchd 默认 PATH 不含 `/opt/homebrew/bin`，claude 通过 `sh -c` 调 SessionEnd hook 时 node 找不到；runner script 模板需显式 `export PATH="/opt/homebrew/bin:$PATH"` 让子进程链都能拿到 | ✅ Done |
| FIX-018 | runs.jsonl schema 漂移 — 三条记录三种风格（project 全路径/slug、ts UTC/+08:00、alerts number/array、status built/success/noop）；SKILL Step 5 契约不严格，claude 自由发挥；需固定字段类型和 enum | 📋 Todo |

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
| [US-AUTO-026](docs/features/autonomous-evolution.md#us-auto-026) | 默认 auto-attach + 极简 mute/unmute — loop/peer 一触发就自动背景弹窗看实时 tmux，roll loop mute 一键关 | 🔨 In Progress |
| [US-AUTO-018](docs/features/autonomous-evolution.md#us-auto-018) | roll-brief 和 roll-.dream 生成文档后自动 git commit — brief 显式化 commit；dream 标准化现有隐式行为 | 📋 Todo |
| [US-AUTO-019](docs/features/autonomous-evolution.md#us-auto-019) | $roll-design 非交互模式 + IDEA 晋升路径 — --from-file / --from-idea，人可离线丢需求等 loop 执行 | 📋 Todo |
| [US-AUTO-020](docs/features/autonomous-evolution.md#us-auto-020) | roll-design + roll-loop SKILL 文档补充 — Confirm 语义澄清 + 紧急绕过路径说明 | 📋 Todo |
| [US-AUTO-021](docs/features/autonomous-evolution.md#us-auto-021) | `roll status` 增加全局 loop 概览区块 — 展示本机所有项目的 loop 状态、调度时间、backlog 待办数 | 📋 Todo |
| [US-AUTO-022](docs/features/autonomous-evolution.md#us-auto-022) | Loop 并发安全 — per-loop LOCK 防重入 + 选 story 跳过 🔨 In Progress，支持人工介入和多 agent 协作 | ✅ Done |
| [US-AUTO-023](docs/features/autonomous-evolution.md#us-auto-023) | `roll loop pause/resume` 人工模式切换 — 轻量暂停调度（保留 plist），支持纯人工/人机协同/纯自主三种模式 | 📋 Todo |
| [US-AUTO-027](docs/features/autonomous-evolution.md#us-auto-027) | peer 调用 auto-attach — 把 `_peer_call` 也包到 tmux session 里，未 mute 时弹窗看 peer 跨 agent 协商（split from US-AUTO-026 因 peer 当前没有 tmux 基建） | 📋 Todo |

## ♻️ Refactor
| ID | Description | Status |
|----|-------------|--------|
| REFACTOR-001 | US-AUTO-007 roll backlog 补 TCR — 遗漏测试，严格按 TCR 节奏补写 cmd_backlog 行为用例 | ✅ Done |
| REFACTOR-002 | US-AUTO-008 roll loop monitor 补 TCR — 遗漏测试，严格按 TCR 节奏补写 _loop_monitor 冒烟用例 | ✅ Done |
| REFACTOR-003 | 删除 bin/roll 中两个死代码函数 `is_fresh_project()`、`_mkscaffold()` 及孤儿测试文件 is_fresh_project.bats — flagged by dream 2026-05-11 | 📋 Todo |
| REFACTOR-004 | 修复 `_write_backlog()` + `_ensure_features_dir()` 使用 `_WK_MERGE_SUMMARY` 而非 `_ROLL_MERGE_SUMMARY`，导致 roll init 摘要中静默丢失 BACKLOG/docs/features 条目 — flagged by dream 2026-05-11 | 📋 Todo |
| REFACTOR-005 | 提取 `_for_each_ai_tool()` 辅助函数消除 AI 客户端迭代逻辑的 4 处重复（bin/roll:~365, ~497, ~1136 等） — flagged by dream 2026-05-11 | 📋 Todo |

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
| IDEA-008 | roll dashboard 重设计 — 当前布局不完整，需要重新规划整体布局、信息密度、交互方式，作为项目入口的体验应该更好 | 📋 Todo |
| IDEA-009 | 文档语言分层规则 — 模型消化/产出的内容用英文，向人披露的信息用中文，解决当前中英混杂问题 | 📋 Todo |
| IDEA-010 | `roll status` 增加全局 loop 概览区块 — 在现有 convention/skills 状态后追加本机所有项目的 loop 服务状态、调度时间和 backlog 待办数 | ✅ Done → US-AUTO-021 |
| IDEA-011 | 基于开源 PI 自研 Coding Agent — 将 Harness Engineering Skills 和管理层内建进去，摆脱第三方 Coding Agent 适配依赖，获得完整自主控制权 | 📋 Todo |
