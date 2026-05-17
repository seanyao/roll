# Changelog

## Unreleased

### Improved

- **`roll loop status` 焕新** — 重设计的 dashboard 替换原本的扁平列表：按天 Today / Yesterday / −2d 分列总账（轮次、PR、耗时、成本、失败计数），下面每天分段列出 cycle 详情；idle / done / fail 用 `·` / `✓` / `✗` 区分，不再统统挂"运行中"；时间统一显示 UTC+8；同一 cycle 的 pr 事件与 cycle_start 不再被错切成两条；走 `ROLL_UI=v2` 默认开，`ROLL_UI=v1` 一键回退到旧实现 `[loop]`
- **`roll update` 不再每次刷 PR 评审两档安装提示** — 两段安装命令挪到 `roll doctor`，在 git repo 内探测分支保护和事件 workflow 的当前状态，只对未启用项显示安装指令 `[pr]`

### Fixed

- **发版管道空版本雪球** — release.sh AI changelog 调用失败时硬退出（不再静默发空 tag）；release.yml 同日合并检测到 fallback notes 时跳过合并，避免把前一个 release body 累积到新版本里 `[release]`

## v2026.517.9

### Improved

- **`roll-loop` 环境变量文档化** — `ROLL_LOOP_FORCE` / `ROLL_LOOP_NO_HEAL` / `ROLL_LOOP_HEAL_MAX` / `ROLL_LOOP_PR_MERGE_TIMEOUT` 四个配置项补入中英双语 configuration 指南，并加 bats 测试守护 `[loop]`
- **BACKLOG 四种条目渲染折叠** — Story / FIX / REFACTOR / IDEA 四组解析循环结构完全一样，合并为单一渲染函数，格式变更不再需要同步四处 `[refactor]`

## v2026.517.8

> 空版本：发版脚本 AI 调用失败 fallback 未拦截，导致无实际内容的 tag 被推出。缺陷已在后续 commit `005601a` 修复（release.sh 和 release.yml 双重校验），见 Unreleased 段。

## v2026.517.7

> 空版本：原因同 v2026.517.8。

## v2026.517.6

### Fixed

- **`features.md` 规划中标记不再依赖 AI 自觉** — 发版脚本 AI 重写后跑机械校验自动补齐 `*(规划中)*`，规则落到 shell 里不再可能被 prompt 漂移悄悄抹掉

## v2026.517.5

合并 v2026.517.1 – v2026.517.5 全部更新。

### New

- **`loop` CI 自愈** — story 引入的 CI 红自动修，修不好才写 ALERT，不再每次都停下等人 `[loop]`
- **`roll loop events`** — 查看每轮详细事件流：任务选择、评审、CI、合并全都有迹可查 `[loop]`
- **`features.md` 区分已上线和规划中** — 一眼看出哪些能用
- **七个功能区补上中英双语用户指南** `[dream]`
- **dream 检测功能目录过期** — 文档落后时不再悄悄无人知晓 `[dream]`
- **Roll 官网上线** — 装、用、原理一站讲清楚

### Improved

- **`roll-build` 收尾三角度并行深审**（重用 / 质量 / 效率），自检清单新增参数膨胀、N+1 等反模式
- **loop 实时输出突出重点** — TCR、评审、CI gate 高亮，工具日志不再喧宾夺主 `[loop]`
- **loop attach 三个等待点动态反馈** — story 执行、CI、PR 合入不再像卡住 `[loop]`
- **官网首屏动画** — 6 秒内演示装好到自动交付的完整流程

### Fixed

- **多 cycle 并行不再双取同一 Todo** — 新 cycle 启动前扫 OPEN 的 loop PR 跳过已认领故事 `[loop]`
- **loop 等 PR 合入 main 才算交付** — 不再 CI 绿就以为代码进了主干 `[loop]`
- **孤儿 worktree 恢复的 PR 不再被 BEHIND 状态卡住** `[loop]`
- **无 PR 时 `roll ci --wait` 不再死等超时** `[loop]`
- **`roll loop runs` 看得到刚跑完的记录**，且跨子目录可见 `[loop]`
- **`roll dream` / `roll brief` / `roll loop` 定时任务不再被 Claude 升级弹窗拦住悄悄失效**
- **mac 休眠不再打断 loop cycle** — 全程保持唤醒 `[loop]`
- **agent 假死时 loop 自动接管**，不再无限挂起 `[loop]`
- **PR 合并失败时 loop 仍把代码备份到独立分支不丢失** `[loop]`
- **loop 启动时自动恢复上一轮中断工作**，意外中断的代码不再失踪 `[loop]`
- **`roll loop now` 卡住状态会先自愈再启动** `[loop]`
- **自治 loop 不再被权限弹窗卡住** `[loop]`
- **`roll peer` 多轮 review 不再中途断线** `[peer]`
- **loop 空跑也清理 worktree**，不再随时间堆积 `[loop]`

## v2026.515.1

- **New**: `roll brief` / `roll dream` 生成文档后自动提交推送 — 每次晨报和夜检不再需要手动 commit `[loop]`
- **New**: 双语 FAQ 指南 — 10 个自治交付常见场景（loop 卡住、PR 冲突、agent 切换、权限问题等），每条含原因和原理，EN + ZH 对照 `[docs]`
- **Fixed**: loop 孤儿状态自愈 — cycle 启动时检测 state.yaml 残留 running，若无活跃进程则自动重置为 idle，防止 loop 因中断永久卡死 `[loop]`
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
