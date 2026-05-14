# Changelog

## Unreleased

- **New**: 可选的事件驱动 PR 评审模板 — `cp templates/workflows/pr-review-event.yml .github/workflows/`，PR 开即触发 AI 评审，不装也行（loop 每轮兜底） `[pr]`
- **New**: loop PR inbox 从"分类但空转"升级到"分类+执行" — eligible PR 自动调 AI 评审，stale PR 自动 rebase，fork 和冲突写 ALERT；bot 已评审的 PR 自动让步 `[loop]`
- **New**: `roll review-pr <number>` — agent-agnostic AI 代码评审，任意 agent（Claude/Kimi/DeepSeek 等）均可评审任意 git 平台的 PR；PR body 加 `[skip-ai-review]` 可跳过 `[pr]`
- **Fixed**: `roll peer` 终态后 tmux session 不再残留 — AGREE/ESCALATE/UNKNOWN/round≥3 自动 kill，round<3 保留复用 `[peer]`
- **New**: `loop/cycle-*` 远程僵尸分支兜底 GC — 每轮 cycle 结尾扫描已合入 main 的 `loop/cycle-*` 分支并删除，弥补 PR auto-merge 失败时的清理盲区 `[loop]`

## v2026.514.5

- **Fixed**: 上版 `claude/*` 临时分支清理意外失效 — 现已恢复 `[loop]`
- **Fixed**: loop session 结束后本地 worktree 不再积累，`git worktree list` 保持干净 `[loop]`
- **Fixed**: 发版脚本不再维护独立的 agent 检测逻辑，配置变更时两处不再悄悄漂移

## v2026.514.3

### 约定与导航

- `$roll-design` 澄清需求前先自己定位产品端和业务域，问你的问题少了
- `$roll-doc` 为已有项目生成 AGENTS.md 导航骨架 — 新接入 Roll 不再从空白出发

### 自动化流水线

- loop 每轮先消化开放 PR 再领新 backlog — 把队列里的 PR 当成首类工作，不是绕开的障碍 `[loop]`
- 自己开的 `loop/*` 分支不会被自己评审，避免同源 bias `[loop]`
- 24 小时内 rebase 同一个 PR 超过 3 次自动熔断，workflow 文件出错时不再无限循环 `[loop]`
- 每次 session 收尾自动删掉自己推上去的 `claude/*` 临时分支，远端不再积压"看起来要发 PR 实际不会发"的孤儿分支 `[loop]`

## v2026.514.2

### 自动化流水线

- 故事跑完自动开 PR，CI 过了就合入主分支 — 你不需要盯着，审计记录也完整保留 `[loop]`
- AI 评审现在有实权：可以批准或打回 PR，配合 CI 形成双重把关；真的很急可以在 PR 描述里加 `[skip-ai-review]` 临时绕过 `[loop]`
- 散落的 session 分支自动清理，远端仓库不再越来越乱 `[loop]`

### Changelog 开始管自己

- 生成时自动过滤技术黑话，并对照历史风格保持表达一致 `[loop]`
- 写入前有一道自审：行文不达标就退回重写，不进 changelog `[loop]`
- 历史版本全部重新整理：按主题分组、合并同类项、附 `[loop]` / `[dream]` 归因标记
- Release Notes 生成规范写入 Skill：分组规则、条目合并、归因标签、措辞原则

### 可见性

- Peer review 协商现在对所有 agent 实时可见，不再只是 claude 专属
- "Release ready" 只有真的有东西可发时才会亮，纯文档改动不再误报 `[loop]`
- PROPOSAL 的提示指向了实际有内容的地方 `[loop]`

### 其他

- 纯文档改动直接合 main，不等 CI，合并更快
- README 新增 Evolution 章节，梳理 Roll 从工具到自主交付系统的演进脉络

## v2026.513.1

### Loop 更可靠了

- 每轮 story 在独立工作区里跑，完了自动合回来清理；跑挂时现场保留，不会碰主分支上你正在改的东西 `[loop]`
- `depends-on:` 和 `manual-only:` 标签现在真的有用 — Loop 自己会跳过条件没满足的任务，不用再盯着 `[loop]`
- 同时只有一个 Loop 在跑，并发写入的问题修掉了 `[loop]`
- `roll update` 之后 loop 状态不再误报 off `[loop]`

### 测试和 CI

- Unit 和集成测试并行执行，机器有多少核就用多少，等待时间降下来了 `[dream]`
- 纯文档改动不触发 CI 全套测试，合并更快 `[dream]`

### Dashboard

- 重新设计：三层自治状态 + 四道防线 + Pipeline 全景 + 当前焦点 + 介入区，一屏看完 AI 正在做什么 `[loop]`

### 修复

- `roll peer` 协商退出时偶发的崩溃修掉了 `[loop]`

## v2026.512.8

### 掌控感更强了

Loop 已经能跑、能看了——这一批让你对它有更多控制权：

- `roll loop pause` / `roll loop resume` — 想自己上手时一键暂停，做完再让 AI 接着跑 `[loop]`
- `roll alert` — 集中查看、确认、清除 loop 产生的告警，不用翻 loop status `[loop]`
- macOS 系统通知 — story 完成或有新告警时自动弹通知，静音模式下不打扰 `[loop]`
- `roll ci [--wait]` — 查看当前 CI 状态，或等 CI 跑完再继续手头的事

### Loop 更聪明了

- Loop 现在等 CI 通过后才标 story 完成，CI 红了会保持进行中并发出提醒 `[loop]`
- API 出错时自动重试，不再直接中断 `[loop]`
- 弹窗认识 Ghostty 和 iTerm2 了，不再强制弹 Terminal.app `[loop]`
- BACKLOG 支持 `block` / `defer` — 卡住的任务标一下就不占队列了

### 文档体系上线

- loop / dream / peer 中英文用户指南全部上线，覆盖所有子命令和使用场景 `[dream]`
- `$roll-doc` — 扫描任意项目的文档现状，找出缺口并生成草稿 `[dream]`
- Dream 每晚检测文档是否跟代码脱节，发现问题写进重构待办 `[dream]`
- `roll status` 新增跨项目 loop 状态一览

## v2026.511.8

### 终于能看到 Loop 在做什么了

Loop 上线后最大的感受是「不知道它在干啥」——这一批更新专门解决这个问题：

- Loop 开跑时自动弹出终端窗口，AI 干活的过程实时可见 `[loop]`
- `roll loop attach` — 随时接入正在跑的 loop 现场 `[loop]`
- `roll loop runs` — 查看 loop 最近几次跑了什么、完成了哪些 `[loop]`
- BACKLOG 任务执行中实时显示进度标记，不用等做完才知道 `[loop]`
- 不想被打扰时，`roll loop mute` 关掉弹窗，`roll loop unmute` 恢复

### Loop 更稳了

- macOS 上调度从 crontab 换成 launchd，重启后不丢 `[loop]`
- 升级 roll 后 loop 服务自动生效，不用手动重启 `[loop]`
- 多个项目同时跑 loop，互不干扰 `[loop]`
- 崩溃或异常退出后，下次启动自动清理残留状态 `[loop]`
- 并发触发时自动跳过，不重复执行 `[loop]`

### 其他改进

- `roll loop monitor` — 一屏查看 loop / dream / brief 三个服务状态
- `roll loop status` 三态显示：没装 / 装了没启 / 正在跑，一眼看清
- `roll init` 升级后自动迁移 loop 配置，少一步手动操作

## v2026.510.10

### Loop、Dream、Brief 首次亮相

Roll 从「技能编排工具」变成了「自主执行系统」——三个新组件同步上线：

- `roll loop` — 让 AI 自动调度 BACKLOG，Story 一个接一个跑，不用你盯着
- `roll brief` — 每天早上自动整理昨天做了什么，帮你快速恢复上下文
- `roll-.dream` — 每晚自动巡检代码和架构，把发现的问题写成可执行的待办

### 自动化能力

- 每个 Story 交付时自动沉淀一个 E2E 测试，项目逐步积累可回放的验收套件 `[loop]`
- CI 失败会自动分诊，按严重程度路由成 backlog 里可执行的修复项 `[loop]`
- `roll debug` 诊断出根因在源码内时，自动进入修复流程并回验 `[loop]`
- Changelog 每次部署后自动更新，不再需要手动整理 `[loop]`

### 可见性

- `roll status` / `roll update` 运行后展示最近几个版本的更新内容
- `roll release` 命令 — 在 CLI 里直接触发发布，不用记路径

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
