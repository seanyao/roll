# Changelog

## Unreleased
- **Added**: `roll status` 新增所有项目的 loop 状态一览 — 调度时间、待办数、是否在跑
- **Fixed**: `roll loop attach` 不再黑屏，AI 干活过程实时可见

## v2026.511.7
- **Added**: loop 跑起来时自动弹出一个终端窗口，看 AI 实时干活
- **Added**: `roll loop mute` 关掉自动弹窗，`roll loop unmute` 恢复
- **Added**: `roll loop runs` — 查看 loop 最近几次都跑了什么
- **Added**: `roll loop attach` — 随时接入正在跑的 loop 现场围观
- **Added**: BACKLOG 任务执行中会实时显示 🔨 进度，不用等做完才知道
- **Added**: `roll setup` 自动安装 tmux（macOS 通过 brew）
- **Improved**: 代码巡检（dream）报告改为中文输出
- **Fixed**: loop 在某些情况下完成后不正常退出
- **Fixed**: loop 中途崩溃后下次启动会自动清理残留状态

## v2026.511.6
- **Fixed**: 多个 loop 实例不会再因为定时重复触发而互相打架

## v2026.511.5
- **Fixed**: 升级 roll 后 loop 服务自动生效，无需手动重启
- **Improved**: `roll loop status` 三态显示，看得清是真没装、装了没启、还是在跑

## v2026.511.4
- **Fixed**: 升级 roll 后 `roll init` 自动迁移 loop 配置，少一步手动操作

## v2026.511.3
- **Fixed**: 多个项目同时跑 loop，互不干扰
- **Fixed**: 在 roll 项目里运行 `roll release` 会提示改用 `scripts/release.sh`

## v2026.511.2
- **Added**: `roll loop monitor` — 一屏看 loop/dream/brief 三个调度服务状态
- **Fixed**: dashboard 待办数、release 状态显示问题
- **Fixed**: loop 异常退出后队列卡住不再继续执行
- **Improved**: 简报输出更精简，去掉空白段落和冗余信息

## v2026.511.1
- **Changed**: macOS 上 loop 调度切换到 launchd，比 crontab 更稳定
- **Added**: agent 跳过 TCR 节奏时自动拦回 Todo，强制重做

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
