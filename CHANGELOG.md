# Changelog

## v2026.511.10
- **Fixed**: launchd runner 缺 brew PATH 导致 hook 子进程报 `node: command not found` — launchd 默认 PATH 不含 `/opt/homebrew/bin`，claude 通过 `sh -c` 调 SessionEnd hook 时找不到 node；inner runner 模板显式 `export PATH="/opt/homebrew/bin:$PATH"` 让整条 fork 链都能拿到 brew 工具。
- **Fixed**: runs.jsonl schema 漂移 — 早期 claude 在 status/ts/alerts/project 字段自由发挥（`built` vs `success` vs `noop`、UTC vs `+08:00`、number vs array、全路径 vs slug）。SKILL Step 5 改为"严格契约"：ts 强制 UTC Z 后缀、project 用 slug、alerts/built/skipped 永远是数组、status 限定 `built/idle/failed` 三个 enum 无同义词；contract test 锁死关键不变量留在 prompt 里。

## v2026.511.9
- **Added**: `roll loop runs` 每次 loop 运行的快速可见性 — 单次 loop 结束追加一行 JSON 到 `~/.shared/roll/loop/runs.jsonl`（含 ts/project/run_id/status/built/skipped/alerts/tcr_count/duration_sec），新命令 `roll loop runs [N] [--all]` 倒序显示最近 N 次（默认 10），不必等次日早报就能查到中间 13 次 loop 各干了啥。
- **Added**: loop 跑在 tmux session + `roll loop attach` 实时观看 — runner script 自动把 claude 包进 detached tmux session `roll-loop-<slug>`，输出同时 pipe 到 `cron.log`；执行 `roll loop attach` 可随时 attach 上去看它打字、写文件、commit，Ctrl-B D 分离后 loop 继续跑；未装 tmux 时自动 fallback 到原 headless 模式，零依赖回退。
- **Improved**: roll-.dream 日志改为中文输出 — Dream Log 输出模板（概要 / 死代码 / 架构漂移 / 裁剪候选 / 新兴模式 / 创建的 REFACTOR 条目）和"未发现 / 部分完成"等固定文案全部中文化，与 roll-brief 风格对齐，晨间扫一眼不再需要在中英文之间切换语境。

## v2026.511.8
- **Fixed**: 集成测试 launchd ghost 泄漏 — `integration_teardown` 在删除 TEST_TMP 之前，先 `launchctl bootout` 该沙箱里被 `roll loop on` 注册到 user gui domain 的所有 `com.roll.*` 服务，避免删 plist 后 launchd 仍保留指向不存在路径的 ghost 注册。

## v2026.511.7
- **Added**: loop 执行 story 前显式标记 🔨 In Progress — roll-loop SKILL 在调用 executor 之前先把 BACKLOG 中的故事状态从 📋 Todo 改为 🔨 In Progress 并提交 `chore: mark US-XXX in progress`，brief 简报和 peer agent 都能即时感知正在进行的工作，tcr 微提交不再"对 brief 不可见"。
- **Added**: loop 启动时孤儿 🔨 自愈 — 扫描 BACKLOG 中无对应 state.yaml running item 的 🔨 条目，视为上次崩溃残留，自动 revert 回 📋 Todo 并写 ALERT，避免被"卡"在错误的中间状态里。
- **Improved**: roll-build / roll-fix SKILL 状态转换段更新 — 显式接受 📋 Todo 或 🔨 In Progress 作为 ✅ Done 前置状态，loop 触发链路状态过渡更稳健。

## v2026.511.6
- **Added**: Loop 并发安全 — runner script 启动时写入 per-project LOCK 文件并检测重入；活跃 PID 已存在则跳过本次，残留死 LOCK 自动清理；正常/异常退出均通过 trap 清掉 LOCK。彻底防止两个 loop 实例同时启动造成的 BACKLOG/git 冲突。
- **Added**: roll-loop SKILL 显式声明 skip-🔨 In Progress 语义 — claude 扫 BACKLOG 时跳过已被人工或 peer agent 标记的执行中条目，为人机协同和多 agent 协作奠定基础。
- **Fixed**: 5 个 pre-existing 测试失败 — `run_roll` helper 切换到 TEST_TMP 作为 cwd 避免 slug 冲突；loop status 测试匹配三态显示新文案；dashboard 测试匹配 `_launchd_svc_state` + array 派生 schedule 的新结构。

## v2026.511.5
- **Fixed**: launchd plist 自动 reload — plist 内容变更且服务已加载时自动 unload + reload，升级 roll 后 loop 服务立即生效，无需手动重启
- **Improved**: roll loop status/monitor 三态展示 — 区分 ● 运行中 / ⚠ 已安装未加载 / ○ 未安装，并给出对应的自愈操作提示

## v2026.511.4
- **Fixed**: roll init 自动重建 launchd runner scripts — 升级 roll 后直接跑 `roll init` 即可迁移到独立 runner，无需手动执行 roll setup 或 roll loop on

## v2026.511.3
- **Fixed**: loop/dream/brief 多项目运行隔离 — 共享 run.sh 导致所有项目的 loop 在同一目录执行，改为每个项目独立 runner 脚本（run-{slug}.sh），彻底隔离多项目并发执行环境
- **Fixed**: roll release 自发版拦截 — 在 roll 自身项目执行 `roll release` 时自动拦截并提示改用 scripts/release.sh，防止误操作绕过 2FA

## v2026.511.2
- **Added**: roll loop monitor 三服务状态 — 监控台新增 loop/dream/brief 三个 launchd 服务的运行状态、调度时间和实时 log tail，一屏掌握全局执行情况
- **Fixed**: dashboard 多处展示问题 — 修复 pending_count 算术错误、brief 内联显示 release readiness、移除底部冗余命令列表
- **Fixed**: loop 异常退出后 state 未重置 — 防止 queue 卡住导致后续任务无法执行
- **Fixed**: CI 稳定性 — 修复 _notify_update 裸返回和时间断言，消除环境差异引起的随机失败
- **Improved**: roll-brief 输出格式 — 序号命名、省略空 section、元信息格式精简，减少无效噪音

## v2026.511.1
- **Changed**: roll loop 调度器切换到 launchd（macOS）— `roll setup` 自动安装 loop/dream/brief 三个 launchd 服务（默认关闭），`roll loop on/off/status` 统一走 launchctl 管理，幂等安装，Linux 保留 crontab 回退路径
- **Added**: roll-loop TCR 硬校验 — 故事完成后自动统计 `tcr:` 微提交数量，为 0 时将故事状态回退为 📋 Todo 并写 ALERT，防止 agent 跳过 TCR 节奏
- **Fixed**: CI 测试环境兼容 — 移除依赖本地 state.yaml 的 hello_world.bats，修复 GitHub Actions 持续失败

## v2026.510.10
- **Fixed**: release.sh changelog 同步时序修复 — 修正条件逻辑和执行顺序，确保每次发版时 changelog 正确更新
- **Added**: roll-loop 22:00 自动执行验证 — 新增 hello_world.bats 作为 loop 定时执行的端到端存档，可回放确认调度器正常工作

## v2026.510.9
- **Fixed**: CHANGELOG 改版本号分组 — 每个 release 独立 section，GitHub Release 增量内容提取正确
- **Fixed**: release.yml 加 fetch-depth: 0，确保历史 tag 在 workflow 中可见

## v2026.510.8
- **Fixed**: release.sh 自洽 — 内联 agent 检测和 changelog 同步，发版流程不依赖外部调用
- **Fixed**: roll release 命令重构 — 改为独立调用 roll-release skill，与 scripts/release.sh 解耦
- **Fixed**: GitHub Release workflow 加 fetch-depth: 0，确保历史 tag 可见

## v2026.510.7
- **Fixed**: 版本比较改用 sort -V，防止旧版本号被误判为最新
- **Fixed**: 版本更新后主动清缓存 — 检测到运行版本更新时自动清缓存，避免旧版本幽灵提示
- **Fixed**: Kimi CLI 解析修复 — 剥离 YAML frontmatter 中的 `---` 分隔符，避免调用时解析崩溃
- **Fixed**: dashboard 命令列表补全，`roll --help` 现在展示全部可用命令
- **Added**: `roll release` 命令补全到 usage() 帮助中

## v2026.510.6
- **Fixed**: Agent 调用层统一 — 移除所有 claude -p 硬编码，统一 agent 抽象层，支持 Claude/Kimi/Pi/Codex/OpenCode
- **Fixed**: pi/codex/opencode 支持补全 — _agent_run_skill/_peer_call 穷举所有 agent，未知 agent 给明确错误
- **Fixed**: kimi 非交互调用语法修正为 kimi --quiet -p，经实测验证
- **Fixed**: roll-build / roll-fix Phase 12 强制触发 roll-.changelog，确保 CHANGELOG 与 BACKLOG 同步
- **Added**: roll release 命令 — 在 roll CLI 内直接调用 roll-release skill
- **Added**: GitHub Release 自动创建 — tag push 后由 workflow 从 CHANGELOG diff 提取内容

## v2026.510.5
- **Added**: roll-loop — BACKLOG 自主执行器，支持调度、跨 Agent 路由和失败处理，让 AI 自主推进项目任务
- **Added**: roll-brief — Feature完成汇报、每日晨报、按需简报，一句话掌握项目状态和发布就绪情况
- **Added**: roll-.dream — 每晚代码架构健康巡检，自动产出 REFACTOR 条目，架构问题持续浮出水面
- **Added**: roll-build 架构摩擦信号 — 实现遇阻时自动向 BACKLOG 写入 REFACTOR 标记，技术债持续可见
- **Added**: E2E 自动沉淀 — 每个 Story 交付时自动写一个端到端测试，项目逐步积累可回放的 E2E 套件
- **Added**: CI E2E 门禁 — 模板 CI 每次推送自动跑 E2E 测试，没有 E2E 时静默跳过不阻塞
- **Added**: CI 红灯分诊 — 按严重程度分类 CI 失败，自动路由到 backlog 变成可执行的修复项
- **Added**: roll-debug 自动修复 — 诊断后若根因在项目源码内，自动进入 TCR 修复流程并回验
- **Added**: Changelog 自动生成 — 每次部署后自动更新，首次运行时回填全部历史记录
- **Added**: roll status/update 显示最近更新 — 运行 `roll status` 或 `roll update` 时展示最近 3 个版本的 changelog
- **Fixed**: roll-release 补齐 GitHub Release 创建步骤 — 修复版本更新提醒从不生效的问题

## 2026.05.09
- **Added**: roll-peer 跨 Agent 代码评审 — 支持 Claude Code、Kimi CLI、DeepSeek TUI、Codex CLI 多工具协同评审 (by @seanyao)
- **Added**: DeepSeek TUI 和 Codex CLI 支持 — roll-peer 新增两个 AI 工具后端 (PR #6 by @leoliu198998-ui)
- **Added**: Claude GitHub Actions — PR Assistant 和 Code Review 自动化工作流 (PR #8)
- **Fixed**: roll-peer DeepSeek serve 探测 — 修复 pipefail 和 grep 范围问题，避免误判 (PR #9, #10)

## 2026.05.08
- **Improved**: 技能清单瘦身 — 移除所有技能 YAML 中的 model 字段，简化配置

## 2026.05.07
- **Added**: Pi (pi-coding-agent) 支持 — 新增 AI 工具检测和集成
- **Added**: DeepSeek TUI 支持 — 新增 ai_deepseek 检测和配置同步 (PR #5 by @leoliu198998-ui)
- **Improved**: roll-design DDD 建模 — 增加战略设计（Context Map）和战术建模（Aggregate/Entity/VO）能力
- **Fixed**: roll update 版本校验 — npm install 后验证实际安装版本，CDN 不一致时自动重试
- **Fixed**: AI 工具检测加固 — 修复 pi 工具检测逻辑，补充 _is_ai_installed 测试用例

## 2026.05.06
- **Added**: OpenCode 集成 — 检测 opencode 环境，自动同步全局 AGENTS.md 规则文件
- **Added**: roll-bipo-onboard 技能 — 新员工入职引导流程技能，含 bats 测试
- **Improved**: Git 提交归属 — 用 Co-Authored-By trailer 替代 [client] 前缀，更标准的多 AI 工具归属方式
- **Improved**: AGENTS.md 加入 Scope Gate — 防止技能执行时越界修改不相关文件

## 2026.05.05
- **Added**: 技能权限声明 — 每个技能声明 allowed-tools，约束 AI 工具可用范围
- **Added**: 技能模型绑定 — 每个技能绑定最适合的 AI 模型，平衡性能和质量
- **Added**: Identity 约定 — 从 git config 读取身份信息，禁止在约定文件中硬编码个人数据
- **Improved**: CLI 命令精简 — 收敛为 setup / init / hook / status 四个核心命令
- **Improved**: 约定文件重构 — 公共规则提取到 conventions/global/AGENTS.md，工具专属文件瘦身
- **Fixed**: 同步时清理已删除文件，防止用户机器残留幽灵文件
- **Fixed**: 修正 AGENTS.md 中过时的文件路径引用
- **Fixed**: 修正 GEMINI.md 中技术栈描述错误
- **Fixed**: 修正遗留的 Wukong 品牌引用为 Roll
- **Fixed**: package.json 作者邮箱修正

## 2026.05.04
- **Added**: BB 注入模式 — 对未集成 Black Box 的页面自动注入诊断探针，统一数据采集接口
- **Added**: roll-doctor 技能 — 一键诊断开发工具链健康状态（Node、npm、git、AI 工具等）
- **Improved**: roll-notes 写作风格 — 强制叙事体写作，保持风格一致性
- **Improved**: 约定文件更新 — 整合 insights 建议到全局约定中

## 2026.05.03
- **Fixed**: npm publish 代理冲突 — 发布前清除代理环境变量，避免网络错误
- **Fixed**: 模板中 $roll-story 过时引用 — 统一替换为 $roll-build (PR #4)

## 2026.04.29
- **Improved**: roll-notes 叙事风格 — 强化写作规范，确保笔记保持统一的叙事语调 (by @Sean via Kimi CLI)

## 2026.04.24
- **Added**: Trae IDE 支持 — 生成 project_rules.md 规则文件，`roll` 命令自动检测 Trae 并同步配置
- **Fixed**: 同步函数容错 — 源文件不存在时正常返回，避免 set -e 崩溃
- **Fixed**: Trae 检测和配置迁移 — 修复 ai_* 配置项缺失时的检测逻辑

## 2026.04.22
- **Improved**: 技能审计 P0 — 名称对齐、清理过时引用、补充 When Not to Use 段、统一 license 声明 (PR #3 by @sealfe)

## 2026.04.21
- **Added**: roll-notes 技能 — 开发过程中随手记录想法和笔记，叙事体写作
- **Improved**: 品牌清理 — 清除遗留的旧品牌引用，移除废弃的 roll-probe 技能和 clean 命令
- **Fixed**: git 安装检测 — 直接检查 .git 目录，避免在 nvm 环境下误判
- **Fixed**: roll-release YAML 描述引号修复

## 2026.04.20
- **Added**: roll-release — 一条命令完成版本号、changelog、tag、npm publish 全流程
- **Fixed**: uninstall.sh 同时清理真实目录和符号链接
- **Fixed**: npm 发布 token 切换为 classic automation token，修复 CI 发布失败

## 2026.04.19
- **Added**: npm 分发 — 开发/运行时路径分离、`roll update` 自动更新、后台版本检查提醒、npm 发布基础设施

## 2026.04.17
- **Added**: roll-jot — 一句话快速记录 bug 或想法到 backlog，不打断当前工作
- **Added**: roll-.clarify — 遇到模糊需求时自动追问，确保开工前意图清晰
- **Added**: roll-.clarify 集成到 roll-design 工作流 — 模糊输入时自动触发澄清
- **Improved**: CLI 精简 — 三步极简 init，约定文件转为技能参考，技能自动读取项目上下文
- **Fixed**: roll init 工作流文件缺失 — 补全初始化所需的模板文件 (PR #1 by @leoliu198998-ui)
- **Fixed**: roll-build 技能 YAML 描述引号修复 (by @Sean via Kimi CLI)
- **Fixed**: 通信规则同步和优化 — 对齐全局约定源，抑制实现细节噪音 (by @Sean via Kimi CLI)
