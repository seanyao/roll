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
| FIX-018 | runs.jsonl schema 漂移 — 三条记录三种风格（project 全路径/slug、ts UTC/+08:00、alerts number/array、status built/success/noop）；SKILL Step 5 契约不严格，claude 自由发挥；需固定字段类型和 enum | ✅ Done |
| FIX-019 | roll-.changelog 凭感觉填版本号 — loop 在 build/fix 后调用 changelog skill，claude 假设下一个版本号（v2026.511.8/9/11）写进 CHANGELOG.md，但 release.sh 才是版本号的唯一发布权威；导致 CHANGELOG 出现假节，release.sh 后还可能继续被绑架；roll-build/fix/changelog 改为只写 `## Unreleased` 节，release.sh 在拿到真实 N 后把 Unreleased 提升为 vX.Y.Z | ✅ Done |
| FIX-020 | loop 执行过程必须可视化（必要项，不是 nice-to-have）— loop 是 launchd 非人触发，attach 窗口长时间空白等于"AI 在干啥完全黑盒"；inner runner 给 claude 加 `--verbose` 让工具调用、思考阶段事件实时输出，看得见才能信任 | ✅ Done |
| FIX-021 | `roll loop now` 行为应与 launchd 服务完全一致 — 当前走 _agent_run_skill 旁路，没 tmux 弹窗、没 LOCK、没 --verbose；改为直接调 runner script（设 ROLL_LOOP_FORCE 绕过 active-window 检查），并把 "Triggering loop cycle" 翻译成 "正在启动新的循环..." | ✅ Done |
| FIX-022 | auto-attach 硬编码 Terminal.app，忽略用户实际终端 — 装了 Ghostty/iTerm/WezTerm 的用户被强制弹 Terminal.app 多余窗口；应检测 TERM_PROGRAM + 读 config `loop_attach_terminal` 偏好，分别用 `ghostty +new-window`、iTerm AppleScript、Terminal osascript 等正确方式 | ✅ Done |
| FIX-023 | loop 可视化链路无 smoke 测试 — 真跑 backlog 太慢且依赖 BACKLOG 有内容；加 `roll loop test` 用**真 claude** 跑个 trivial prompt（如 `-p "Reply: hello"`），5-10 秒验证整条链路（tmux/弹窗/--verbose 流式/PATH/SessionEnd hook/LOCK/state 收尾）。**开发阶段必须真 claude**（唯一能验"链路真工作"）；**之后回归测试**可加 `--mock` flag 走 echo+sleep 假 claude（快、不烧 token，仅作链路退化检测）；FIX-021 端到端验证依赖此 | ✅ Done |
| FIX-024 | roll-build/roll-loop 在 CI 绿之前就标 ✅ Done — Phase 11 应在 `gh run watch` 确认当前 commit CI 通过后才写回 BACKLOG；需加 `roll ci [--wait]` 命令轮询 `gh run list` 状态，roll-loop 标完 Done 前强制调用；CI 红则保持 🔨 In Progress 并写 ALERT | ✅ Done |
| FIX-025 | `roll loop runs` 时间显示为 UTC，用户看到的时间比本地时间早 8 小时 — `_loop_runs_format_line` 用 sed 直接截取 ISO 字符串的 HH:MM，未转换时区；ts 按 FIX-018 规范存储为 UTC（`Z` 结尾），显示时应用 `date` 命令转为本地时间 | ✅ Done |
| FIX-026 | loop CI gate 被 SSH config 旁路打穿 — 用户 `~/.ssh/config` 把 `github.com` 改写成 IP，`gh` 解析后认不出 known host；`_ci_wait` 和 SKILL 里的 `gh run list` 不带 `-R` flag，全部失败；`2>/dev/null \|\| skip` 把"gh 出错"误判成"gh 未装"，导致 loop 在 CI 红的情况下继续把 story 标 ✅ Done。修：(1) 从 git remote 推导 `owner/repo` 强制传 `-R`；(2) 区分 `command -v gh` (not installed → skip) 和 gh 调用失败 (fail → ALERT)；(3) 修 `tests/unit/roll_loop_runs.bats:43` +08:00 测试数据（与 FIX-025 不兼容导致 CI 红 10 个 commit）；(4) loop 起跑前先验 HEAD CI 红绿，红则拒绝 build；(5) CI workflow 加 `roll setup` 让 e2e sync 测试可运行 | ✅ Done |
| FIX-028 | `roll peer` 结束时 cmd_peer 抛 "line 1737: resolution: unbound variable" — Resolution 已打印（值为 REFINE），但走到 REFINE/OBJECT case 内 `info "Peer requests $resolution. Continue to round $((round + 1))..."` 时崩；与 `set -euo pipefail` 互动诡异（变量明显已设置）。影响：peer 流程在第 1 轮 REFINE 时退出码 1（非预期 2），log file 仍能写入。修：复现 + 找出真正 unbound 变量（疑似 round 在某条件下未 local 化），加 unit 测试覆盖 REFINE/OBJECT/ESCALATE 三条退出路径 | ✅ Done |
| FIX-029 | `_peer_auto_attach` Ghostty 启动参数错位 — `open -na Ghostty.app --args -e "tmux attach -t $session"` 用引号把命令裹成一个 string，Ghostty 把整串当作 login 的 argv 传，导致 `login: tmux attach -t roll-peer-claude-kimi: No such file or directory`；与 loop runner 写法不一致（loop 不用引号，能跑）。已修：移除引号，与 loop 写法对齐（commit pending） | ✅ Done |
| FIX-027 | `roll update` 后 loop 状态被吞为 off — `_install_launchd_plists` 在 plist 内容变化时走 `launchctl unload` + `launchctl load`（**无 `-w`**）做 reload（bin/roll:2218-2223）；但 `_launchd_is_loaded` 读的是 `launchctl print-disabled`（overrides db），macOS Sonoma+ 上 no-`-w` 的 unload 会扰动该 label 在 overrides db 的 enabled 记录，后续 no-`-w` 的 load 不会写回 enabled → dashboard 与 `roll loop status` 误报 off，需手动 `roll loop on` 才能恢复（`load -w` 重写 enabled）。对称性证据：`_loop_on` 用 `load -w`、`_loop_off` 用 `unload -w`，唯独 `_install_launchd_plists` 走 no-`-w` 异常分支。修：reload 路径改用 `launchctl bootout gui/$(id -u)/$label` + `launchctl bootstrap gui/$(id -u) "$plist"`（不动 overrides db），或在 unload/load 后用 `launchctl enable gui/$(id -u)/$label` 显式保留 enabled 状态；加单元测试覆盖"plist 内容变化时 enabled 状态不被吞" `Domain: Autonomous Evolution > LoopScheduler > LaunchdAgent` | ✅ Done |
| FIX-031 | loop LOCK 机制被并发打穿 — 2026-05-13 14:37 实测：runner.sh PID 78577 写进 `.LOCK-roll-d9dfa0` 且进程存活，但同 runner 下又起出第二个 claude 子会话同时操作 REFACTOR-009。**解法**：给 inner script 加二级 LOCK（PID + start-ts 双校验，4h 上限），守 claude 调用现场；7 个 bats unit 测试覆盖 template 结构 + 并发 skip + stale PID + aged lock。`Domain: Autonomous Evolution > LoopScheduler > ConcurrencyGuard` | ✅ Done |
| FIX-032 | roll-loop SKILL Step 2 解析 `depends-on:` / `manual-only:true` 标签 — bin/roll 加 `_loop_check_depends_on` + `_loop_is_manual_only` 两个纯函数（行匹配 `^\| \[?<id>\b` 锚定，避免别行 deps 引用误判）；SKILL Step 2 选 story 前调用，未满足依赖 → 跳过 + 写 runs.jsonl `skipped`；`manual-only:true` → 跳过；13 个 bats unit 测试覆盖 4 路径 + 边界。**Loop-safe**：纯加法，不动 runner.sh。`Domain: Autonomous Evolution > LoopRunner > DependencyGate` | ✅ Done |
| FIX-033 | `roll` dashboard 与底层 state 多处不一致 — 2026-05-13 实测 4 个分裂点同时出现：(1) `roll loop runs` 输出 `No loop runs for current project`，但 dashboard 同屏显示 `last TCR 55min ago · 11 micro-commits today` —— runs.jsonl reader 与 dashboard 的 TCR/commit reader 看的不是同一个数据源；(2) git tree 干净、最近一次 commit (4a12ccf) 是 v2026.513.1 发版后的 docs rewrite，已无未发布变更，但「需要你介入」区仍亮 `✓ Release ready run: roll release` —— release-ready 判定未把"最近 tag 之后是否有可发布 commit"算进去，或者算了但语义把 docs-only commit 也当作可发布；(3)「需要你介入」显示 `📋 8 PROPOSAL`，但 `roll backlog` 列出的 8 items 全是 US/REFACTOR/IDEA，**零个 PROPOSAL** —— 标签名错配（应为 "BACKLOG items" 或拆 PROPOSAL/US/REFACTOR/IDEA 分类显示），且 8 = 4 active + 4 deferred 混算，deferred 不该算进"需要你介入"；(4) Loop Layer `⏸ paused` 与 Dream Layer `⚠ off` 同时存在 —— 需确认 dashboard 把 launchd `unloaded` / pause sentinel / 服务未装 三态区分清楚（参考 FIX-027 已修过 update 吞 enabled 状态的类似问题）。**根因假设**：dashboard renderer 与各子命令各自实现 state 读取，缺单一可信源（single source of truth）；4 个症状很可能共用同一类问题。**修复方向**：先盘清 dashboard 现读哪些文件 / 命令 / 函数，与 `roll loop runs` / `roll backlog` / `roll release` 各自的 reader 对齐到同一组 helpers；分别为 4 个症状加回归测试。`Domain: Observability > Dashboard > StateConsistency` | 📋 Todo |

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
| [US-AUTO-030](docs/features/autonomous-evolution.md#us-auto-030) | dashboard DoD checklist — Prod 部署回填信号源（`roll release` 完成后把部署状态写入 in-progress story 元数据，dashboard 可读） | ⏸ Deferred |
| [US-AUTO-031](docs/features/autonomous-evolution.md#us-auto-031) | dashboard DoD checklist — Sentinel 接管状态信号源（`$roll-sentinel` 运行结果映射到 dashboard 可读位置，体现"AI 接管生产"防线） | ⏸ Deferred |
| [US-AUTO-032](docs/features/autonomous-evolution.md#us-auto-032) | loop 在 worktree 里跑 — 原整块故事按「自我修改悖论」拆分（见 [loop-pr-pipeline-plan.md](features/loop-pr-pipeline-plan.md)）：纯加法的 helpers + 单测 → US-AUTO-036；改 runner orchestration 那段 → US-AUTO-037 | ✅ Done → US-AUTO-036, US-AUTO-037 |
| [US-AUTO-033](docs/features/autonomous-evolution.md#us-auto-033) | loop 自动建 PR + GitHub Auto-merge — story 完成后推 `loop/<US>` 分支，自动 `gh pr create` + `gh pr merge --auto --squash`，CI 绿自动合并，人零介入 `depends-on:US-AUTO-037` | 📋 Todo |
| [US-AUTO-034](docs/features/autonomous-evolution.md#us-auto-034) | loop 起跑先消化开放 PR 再领新 backlog — 每轮 cron Step A 扫 `gh pr list --state open`：(a) `loop/<US>` 自有分支已 auto-merge 在等 → 跳过让 GitHub 平台合；(b) 外部贡献者 / 人工 PR → 调 claude-code-review 评审，approve / request-changes / escalate；(c) 卡住的旧 PR (CI 红、out-of-date) → 试 rebase+重跑 CI，不行则 ALERT。Step B 才扫 BACKLOG 领新 story。把"开放 PR 也是工作单元"纳入 loop 工作流，替代旧版"避让" `Domain: Autonomous Evolution > LoopRunner > PRInbox` `depends-on:US-AUTO-033,US-AUTO-035` | 📋 Todo |
| [US-AUTO-035](docs/features/autonomous-evolution.md#us-auto-035) | claude-code-review.yml 扩展为可 approve/request-changes — 当前 action 仅 `pull-requests: read` 发评论；改为 `pull-requests: write`，评审结论映射为 `gh pr review --approve` / `--request-changes`；评审失败时写 ALERT、附 PR 链接；同步开 repo `required_pull_request_reviews=1`，使「CI 绿 + AI 评审通过」成为合并双门（路径 C）；提供 escape hatch：`SKIP_AI_REVIEW=1` 环境变量绕过（紧急 hotfix）。Domain: Autonomous Evolution > MergeGate > AIReviewer `depends-on:US-AUTO-033` | 📋 Todo |
| [US-AUTO-036](docs/features/autonomous-evolution.md#us-auto-036) | worktree 隔离 Phase 1：纯加法 helpers + 单测 — `bin/roll` 加 `_worktree_path` / `_worktree_create` (幂等) / `_worktree_cleanup` / `_worktree_fetch_origin` (lenient) / `_worktree_submodule_init` / `_worktree_merge_back` (ff-only + alert) + `_worktree_alert` 共 7 个 helpers；`tests/unit/roll_worktree.bats` 11 个用例覆盖 7 测试路径 + submodule 共存 + 边界；**零行 `_write_loop_runner_script` 改动**（loop-safe）。`Domain: Autonomous Evolution > LoopRunner > Worktree` | ✅ Done |
| [US-AUTO-037](docs/features/autonomous-evolution.md#us-auto-037) | worktree 隔离 Phase 2：runner 接入 + 集成验证 — `_write_loop_runner_script` 接入 US-AUTO-036 的 7 个 helpers；inner.sh 起跑前在 `~/.shared/roll/worktrees/<slug>-cycle-<ts>-<pid>` 建 worktree on `loop/cycle-<id>` (origin/main 为基)，cd 进去跑 skill；退出后 ff-merge 回 main + push + cleanup，失败则保留 + ALERT。**采用方案 B**（claude 保留 selection 权，SKILL.md 不变，branch 名用 cycle-id 不用 US-id）。3 个 integration test 覆盖 happy/claude-fail/ff-fail；`roll loop test` 真 claude 36s 验证通过。`Domain: Autonomous Evolution > LoopRunner > RunnerScript` `depends-on:US-AUTO-036` `manual-only:true` | ✅ Done |

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
| REFACTOR-008 | CI 测试二轮精简 Phase 1A — 调度参数化：`tests/run.sh` 用 `nproc`/`sysctl` 动态检测核数（macOS 8、ubuntu-latest 4），替换硬编码 `--jobs 4`，支持 `ROLL_TEST_JOBS` 覆盖；ci.yml `paths-ignore` 跳过 docs-only PR (`**.md` + `docs/**`)；`tests/run.sh` 加 bats-core submodule 缺失保护（清晰报错 + hint）。**实测**：本地 macOS 8 并发 555 用例通过，CI 在 e87fe4a 30s 内绿（含 setup）。**拆出**：ci.yml lint/test-unit/test-integration job split + Phase 2 测试分层 → REFACTOR-009。 | ✅ Done |
| REFACTOR-009 | CI 测试二轮精简 Phase 1B（拆 Phase 2 → REFACTOR-010）— **已交付**：`tests/run.sh` 接受可选目录参数；`ci.yml` 用 matrix 把 unit (509) 与 integration (70) 拆成两个并行 job (`test-unit` / `test-integration`)，墙钟时间显著降低。**未做**：composite action（当前 setup 步骤少，抽取暂无明显收益）；lint job（依赖 `roll doctor`，未建）；Phase 2 测试瘦身（迁移到 REFACTOR-010）。 | ✅ Done |
| REFACTOR-010 | CI 测试三轮精简 Phase 2（从 REFACTOR-009 拆出）— `bats --timing` 产出 top 20 慢用例清单；"内容存在性 / YAML frontmatter / 文件结构"类用例（roll_doc_*、roll_*_skill.bats）迁移到 `roll doctor` lint 或合并删除（需先建 `roll doctor`）；审计 11 个 `roll_loop_*.bats` 跨文件覆盖重叠；`tests/integration/cmd_setup.bats` 29 用例拆分 + 共用 fixture。同步在 ci.yml 增加 `lint` job（接到 `roll doctor`）。**目标**：用例数减少 ≥ 25%，主链路 bats 文件清单不少。 | 📋 Todo |

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
| IDEA-013 | dashboard DoD checklist — UAT 信号源定义（UAT 在 Roll 体系下如何采集？人验？测试环境部署成功？需先定义概念再选实现路径） | ⏸ Deferred |
| IDEA-014 | dashboard DoD checklist — Evidence "活证据"信号源定义（Roll 海报含"活证据·24/7 巡逻"，但落地未设计；可能与 sentinel 数据流耦合） | ⏸ Deferred |
| IDEA-015 | loop worktree 隔离架构 → 落地时按「自我修改悖论」拆分为 US-AUTO-036 (loop-safe helpers) + US-AUTO-037 (manual runner integration)；原 US-AUTO-032 — 当前 loop 直跑 main 工作树，会把用户未暂存的 WIP 吞进 TCR commit（已被 commit 1989800 串味实证）。终态：每个 story 起 `git worktree add ../roll-loop-<US-ID>`，roll-build/roll-fix TCR 在 worktree 完成后 merge 回 main；同时为未来 loop/dream/peer 跨 story 并发隔离铺路。设计待解：(1) launchd runner 如何切目录（`cd $WORKTREE_PATH`）；(2) tmux session 命名与 cwd 切换；(3) 多 worktree 同时跑时 LOCK 策略；(4) 失败时 worktree 是保留还是清理（关系到调试遗留）；(5) merge 回 main 的策略（fast-forward / squash / rebase）；(6) CI 触发路径——worktree 上的 push 是否触发同一 workflow；(7) `_install_launchd_plists` 用 worktree 路径还是 main 路径；(8) 与 dirty-guard（轻量替代方案）的关系——worktree 落地后 dirty-guard 还要不要 | ✅ Done → US-AUTO-036, US-AUTO-037 |
