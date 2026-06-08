# Changelog

## Unreleased

### 可见性

- roll pair status 显示谁在结对池与其异构标签和能力，谁因何没进池（US-PAIR-002）

### 自动化流水线

- 把 dream 调度剩余子命令改写为 TS，脱离 bash 回落引擎（US-PORT-020）
- 交付段补可重建证据轻量版，含合并请求与集成结论与改动与交付方与成本与时间线（US-EVID-008）

### 工程和测试

- 确定性证据自动落盘，测试输出与覆盖率与产物都写进证据框（US-EVID-002）
- 每条验收标准配一条任何人可重跑的验证命令加测试清单（US-EVID-010）
- 把结对从代码阶段推广到设计测试与周期复盘，每阶段可配可关（US-PAIR-004）

### 其他

- 把项目初始化命令改写为 TS，脱离 bash 回落引擎（US-PORT-013）
- 把技能挂载与约定分发命令改写为 TS，脱离 bash 回落引擎（US-PORT-014）
- 把在线刷新模型价目的命令改写为 TS，脱离 bash 回落引擎（US-PORT-017）
- 把切换与设置 agent 的写入命令改写为 TS，脱离 bash 回落引擎（US-PORT-018）
- 修退役命令引用并立一页新手上手指南（US-DOC-GS-001）
- 证据框在每个周期开头就立好，运行目录与证据归处先备好交给执行用（US-EVID-001）
- 瞬态证据当场采，改前改后与验证时各截一张成对入框（US-EVID-003）
- 收尾时由运行器确定性组装验收报告并刷新档案，不依赖代理记得（US-EVID-004）
- 验收硬闸默认开启，标完成却无报告从提醒升级为发版闸拦截（US-EVID-005）
- 证据生命周期相关文档中英双轨刷新收尾（US-EVID-006）
- 档案脊柱口径对齐，老的已完成卡一次性补跑回填证据（US-EVID-007）
- 自评分作为评分门禁参与通过与否，回归或低分能真的拦下完成（US-EVID-013）
- 无人值守执行器，出错先归因再自动纠正，默认保守且不自动合主干且振荡移交刹车 — report: `.roll/features/acceptance-evidence/US-EVID-014/2026-06-08T23-03-10/US-EVID-014-report.html`
- 无人值守安全刹车，同卡反复退回自动熔断暂停并加一页夜间运行晨报 — report: `.roll/features/acceptance-evidence/US-EVID-016/2026-06-08T23-54-55/US-EVID-016-report.html`
- 结对候选选择器纯函数加脚手架配置：理性筛合格候选、强制不同厂商、可复现轮换、无候选直报，一条命令从代理列表物化一份可读可改的配置文件（US-PAIR-001）
- 代码阶段交付后由一个不同代理单向互检改动，结论留证据与事件，硬超时不阻塞且记成本（US-PAIR-003）
- 跨代理结对的中英双轨文档刷新收尾（US-PAIR-007）
- roll init 顺带生成 pairing 配置并在界面告知，新用户少一步且仍显式（US-PAIR-008）
- release: v3.608.2（PR#544）
- pairing docs + site refresh for roll init scaffolding（PR#543）
- Design doc link opens rendered spec.html (not raw markdown)（US-DOSSIER-004）


## v3.608.2 — 2026-06-08

### 跨 Agent 结对（异构第二双眼睛）

- 结对成为一等能力：交付后由一个**不同厂商**的 agent 单向复检改动，换视角多样性——理性挑选（只挑已装+可用+胜任+异构）、可复现轮换、无搭档如实留痕不静默（US-PAIR-001/003）`[pair]`
- `roll pair init` 物化显式 `.roll/pairing.yaml`：文件在=开、删=关，默认值写进文件而非隐藏；`roll init` 也顺带生成，新项目零额外步骤，现有项目一条命令补上（US-PAIR-001/008）`[pair]`
- `roll pair status` 看结对池：谁能结对、厂商、能力、谁因何被排除，外加**结对花了多少钱**（次数/搭档/成本），可观测不靠猜（US-PAIR-002/006）`[pair]`
- 多阶段结对：设计/测试/代码/周期四个检查点可独立开关，默认仅代码（US-PAIR-004）`[pair]`
- 配对越用越准：成本真实记账 + ε-greedy 偏好高命中异构对但保底探索不锁死多样性（US-PAIR-006）`[pair]`
- 安全底线：30 秒硬超时、超时/出错不阻塞 cycle、绝不自行动主干（US-PAIR-003）`[pair]`

### 可见性

- 故事档案 = 一个故事的全部上下文入口：页顶 As a / I want / So that 原语 + CONTEXT + AC 内联 + 显眼可点的设计文档链接（US-DOSSIER-003）
- 设计文档链接打开 markdown 渲染页而非裸文件（US-DOSSIER-004）
- 验收证据可重跑：每条 AC 配一条任何人能照着重跑的验证命令 + 测试清单，证据从"看截图"升级到"自己能验"（US-EVID-010）

### 工程和测试

- `roll ci --wait` 移植到 TS：CI 等待门脱离 bash，逐轮裁定镜像 v2 顺序（US-PORT-015）
- `roll release ship` 一条受闸命令完成 tag-push（发版第 4 步），一致性闸把关，npm publish 仍人工（US-REL-SHIP）
- cleanup：`.codex/`、`.worktrees/` 进 .gitignore（per-machine 状态不入库）

## v3.608.1 — 2026-06-08

### 自动化流水线

- 非 claude agent 的 loop 观察窗不再黑屏：套伪终端逐行直播，进程组清杀不留孤儿（FIX-224） `[loop]`
- 断网不再误伤：网络不可达时周期降级为本地交付，输出提示而非报错，连败不累计、不误触自动暂停（IDEA-001） `[loop]`

### 可见性

- 三层交付档案：roll index 重建首页总账（愿望→事实进度）、史诗页、故事五站档案，全部来自真实模型可逐层下钻（US-DOSSIER-001a~d）

### 工程和测试

- 验收命令认出卡片文件夹布局：别处一句提及不再劫走归档位置，报告与 AC 解析归位（FIX-225）
- 旧档案树退役收尾：卡片文件夹成为运行产物唯一的家，读取兼容移除（US-META-002c）
- 卡片契约进发版闸：活卡必须有卡片文件夹、证据链接不许悬空，史前卡只计数不拦截（US-CONSIST-006）
- 铸卡单一通道：roll story new 一条命令建卡，拒绝覆盖；每次验收收尾自动刷新档案索引（US-META-009）
- 自评笔记归卡：故事自评住进卡片文件夹，看板趋势与档案复盘双源合并读（US-META-008）
- 发版就绪判定认两种形态：Unreleased 段或预写好的下一版本段都算 changelog 就绪（FIX-226）
- 文档与官网一致性清扫两轮：档案单一家、四槽路由、降级模式、六维闸全部对齐实现（指南中英 + skills + README）

## v3.607.2 — 2026-06-07

### 自动化流水线

- 无技能子模块的项目跑 loop 找不到技能、选 agent 无视项目配置；补全局技能兜底、读项目配置选人、新增 pi 接管（FIX-221） `[loop]`
- loop 选 agent 被项目级单一默认一票否决：所有难度档坍缩成一个 agent，难题不再给 claude；装机探测永真空转；按 v2 链路修复（FIX-223） `[loop]`
- 非 claude agent 的 loop 接管命令全量 port（kimi/codex/deepseek/qwen/agy/gemini/antigravity）（US-PORT-010）
- roll loop now 手动触发降噪：交互终端只看关键节点，不再被逐行 JSON 淹没（FIX-220） `[loop]`

### 工程和测试

- difftest 卸 oracle 收尾：全仓断言测试期不再起任何旧引擎，桥接表与文档记 oracle 卸任（US-PORT-009e）
- 看板冻结测试时钟钉死：快照不再随墙钟与时区漂移，任意日期任意时区可复现，提交闸不再被误堵（FIX-222）

### 其他

- 验收卡史诗归属适配新档案布局：两级目录解析收敛为单一解析点（PR#513）

## v3.607.1 — 2026-06-07

### 可见性

- detectLiveCycle 僵尸周期污染：无 cycle:end 的僵尸周期被误判为"当前正在运行"，叠加 state.current_item 过期，dashboard 头行显示已交付数小时的旧故事；已加 >2h 僵尸跳过+最近活跃优先（FIX-217） `[loop]`

### 其他

- 验收闸查旧档案位：迁移后真报告被判缺失，硬闸假阴性逼出双账，闸址改与写端同源（FIX-216） `[loop]`
- roll peer mktemp 竞态 + 解析器无法解析自然语言决议；已加 PID 防竞态 + prompt 要求 Resolution: 行 + 解析器优先读该行（FIX-219） `[loop]`
- 层层嵌套索引站：从总览到史诗到卡片到报告全程可点击浏览（US-META-003）
- 建卡时自动生成 story 定义文件和全景报告骨架，后续阶段逐步填充（US-META-005）
- 交付与终评产物写入 story 文件夹，与验收报告同处一层（US-META-006）
- 存量 story 数据迁移命令：补定义文件、建文件夹、跳过多故事文件并保留反向引用（US-META-007）

## v3.606.3 — 2026-06-06

### 新功能

- 档案制写入端：待办与交付物同夹的布局支持，含编号到史诗的索引与垃圾回收命令（US-META-001）

### 稳定性

- 版本探针读冻结引擎的化石串：version 显示旧号、update 自检误报、升级 nag 永不消失，三症同根（FIX-202） `[loop]`

### 可见性

- 完成状态抢跑：PR 还没合并卡片就翻了完成，违反完成即已合主干的纪律（FIX-211） `[loop]`
- 面板对历史全瞎：周期记录缺时间戳，八次真实交付显示零，统计无从分桶（FIX-213） `[loop]`
- 面板对运行中的周期全盲：活性探测还读旧信号，真在干活却显示空闲零周期（FIX-203） `[loop]`
- (最小核) — roll loop now 改前台直跑:重入本 CLI run-once,agent 转录经 ROLL_LOOP_STREAM 实时打到当前终端(零 tmux 零弹窗零 tail);launchd 排程仍走静默 runner;buffered 用量采集不变 (#470)（US-PORT-011）

### 自动化流水线

- 终态失真：真实交付已合并完成，周期记录却写失败，失败语义被稀释（FIX-214） `[loop]`
- 无人值守周期自产实拍：给截屏调度器加终端通道，无图形环境时诚实跳过留痕（US-ATTEST-011）
- roll release v3 原生重写：版本号引导、changelog、PR 与 tag 流程提示；发版闸已在 CI（US-PORT-004）
- loop 读面子命令 TS 薄读取（eval、runs、story、signals）；tmux 流的 monitor 与 attach 退役（US-PORT-007）
- dream 服务出 v3 runner（复用调度模板模式）或裁定退役；现状是断链僵尸（US-PORT-008）
- loop cycle cycle-20260606-050516-6852 (#477)（PR#477）

### 工程和测试

- 迁移命令嵌套仓盲区：对私仓的搬迁打到主仓上，吞错自报成功，修执行面并补嵌套形态测试（FIX-215） `[loop]`
- 档案迁移命令：读索引按清单搬树改名重建链，演练模式先行，可重入有测试（US-META-002a）
- difftest 卸 oracle：领域服务层一批对拍全部转冻结期望，测试期不再起 bash 或 python 引擎（US-PORT-009b）

### 其他

- v3 心脏首跑即瘫：skill 路径化石致 agent 盲开、改动漏回主仓、被杀不留痕、cycle 不可观测；修解析+钉题+连 .roll+信号善后+tmux 观测窗（FIX-204） `[loop]`
- 交付可以悄悄跳过验收报告：文本约束没牙，缺报告要在运行时留痕可审计，政策可升硬闸（FIX-207） `[loop]`
- 排程静默死亡：启用命令吞掉挂载失败照报成功，三小时无 tick 全靠人肉掩盖（FIX-212） `[loop]`
- 验收证据惯例升级：文本证据属 agent 自述可伪造，CLI 卡默认改为真实终端截屏走独立捕获通道，文本降级为补充（US-ATTEST-010）
- 验收口径补全：失败与阻塞有名分、敏感信息进档前遮蔽、报告生成后冒烟自检（US-ATTEST-012）
- 验收报告分层且自含待办全貌：卡情上下文与业务结论在前技术折叠，空章节裁剪，设计审查不改证据（US-ATTEST-013）
- 过程内联进报告：时间线与关键转折加折叠全转录，无人过程也可回溯（US-ATTEST-014）
- 执行存量迁移：演练过目后真跑，重写唯一活引用，全仓对账校验存档（US-META-002b）
- skills 验收文案同步新档案布局，跨仓改 roll-skills 后 bump submodule manual-only（US-META-004）
- changelog 生成同输入两次运行结果漂移：探针偶发失败静默切换过滤分支，17 条目消失（FIX-199） `[loop]`
- 观测窗可读性：裸流换三层关键节点转录，信号口径与验收报告时间线同源（US-PORT-012）
- roll brief TS 化：汇报口吻保留，默认一屏精简、细节折叠，跟随 locale 单语；agent 经结构化流只取终稿，绝不漏思考过程（US-PORT-002）
- roll idea TS 化：分类、自动编号、过 lint 规则落卡，与 backlog 存取同源（US-PORT-003）
- changelog 确定性输出转正：AI 润色降级为可选路径或退役，默认不再回落 bash（US-PORT-005）
- config 写面 TS 化，整个 config 命令收口（US-PORT-006）
- difftest 卸 oracle 第一步：立可复用的冻结期望转换范式，先转规格层与基础设施层两批验证可行（US-PORT-009a）
- difftest 卸 oracle：命令行只读命令一批对拍转冻结期望（US-PORT-009c）

## v3.606.2

### 稳定性

- **修复 loop 在姊妹 worktree 布局下整体空转** — 项目身份此前会被解析到 git 主 worktree（对 roll 自身即 v2 冻结 checkout），所有周期在错误目录 idle；现在身份 = 当前 worktree 顶层，状态、日志、取卡全部回到正确项目

## v3.606.1

### 新功能

- **`roll attest` 验收证据链上线** — 每个交付的 story 可生成单文件验收报告：逐条 AC 判定（五档徽章）、证据卡片（截图 / 可搜索的 CLI 文本 / commit·CI·部署链接）、零证据强制降级红线 + 缺口附录；离线可开、可打印 PDF。web/iOS/Android 三端截屏各带前置自动跳过；同 story 自评条目折叠展示
- **发版一致性闸** — 每个 v* tag 在创建 Release 前先过 `roll consistency check`：任一维度对不上即中止发版，差异清单见 job 日志
- **loop 调度面 TS 化** — `loop on/off/pause/resume/now` 原生实现；`loop on` 生成自包含 v3 runner（周期心脏 = `loop run-once`）；`loop now` 检测旧版模板自动再生成后再跑（根治 command not found）

### 稳定性

- **backlog 状态端到端确定性** — 取卡即标 🔨 进行中、交付完成确定性翻 ✅ Done、崩溃残留的认领自动回收；普通项目（.roll 被 gitignore）布局下状态不再悬空
- **changelog 不再漏卡** — 裸 ID（非链接形）的 Done 行正确入草稿；空草稿时 `--write` 不写占位句
- **peer 硬触发留痕** — 高复杂度交付未经评审会在事件流与 ALERT 留下可审计记录

### 精简

- **tart 隔离 lane 移除** — `test_isolation.type` 只留 `none`；残留 tart 配置显式报错退出，绝不静默回落宿主
- **bats 测试套件退役** — 51k 行 bash 测试由 TS diff-test 体系接管（对使用者无感；v2 分支保留全量历史）

### 文档

- **架构与理念文档归仓** — `docs/architecture.md`（分层 / 领域 / 12 条不变量）、`docs/verification.md`、`docs/manifesto.md`
- **双语新章** — 验收证据指南、一致性与发版闸指南、README 仓库结构章节与环境要求修正


## v3.0.0

### TypeScript 重写

- **引擎从 bash 换成 TypeScript** — roll 的核心重写为 pnpm monorepo（`packages/`：spec/core/infra/cli/web 分层）。这是一次引擎替换，不是功能改版
- **命令一个不变** — `roll init` / `loop` / `status` / `backlog` / `prices` / `slides` 等全部子命令的入参、输出、副作用、退出码保持原样；升级后照旧用
- **逐层对拍迁移** — 地基、CLI、领域服务、infra、loop 各层逐条移植，每条命令写 diff-test 断言「TS 输出 == 原 bash 输出」，逐字节对齐冻结的 v2 oracle
- **1031 项 TS 测试全绿** — 单测覆盖每个公共入口 + 跨层 diff-test；`npm i -g @seanyao/roll` 装的就是这套 TS-first CLI

### 兼容与回滚

- **bash 实现留作回落 + oracle** — `bin/roll` 随包一起发布：TS 层尚未接管的命令自动透传 bash，行为零差异；同一份 bash 也是测试套件的标准答案
- **v2 归档在 `v2` 分支** — 锚点 tag `v2-freeze-2026-06-04`，需要时一键回滚

## v2.604.2

### 精简

- **自动简报功能下线(FIX-195)** — 不再后台定时生成每日简报;需要时手动运行 `roll brief` 即可,过往简报都保留

### 稳定性

- **一条坏记录不再拖垮整个自动循环(FIX-193)** — 以前运行历史里出现一条损坏记录,会让 `roll loop` 整个起不来;现在自动跳过坏记录、照常运行

## v2.604.1

### PR Loop 重构

- **统一 PR Loop 分类（CI 唯一门禁）** — 移除分支名特殊处理和 review 门禁，所有 PR 一视同仁：落后→rebase，CI 红→heal，CI 绿→合
- **删除 CI / Alert / Brief Loop** — 6 条服务精简为 3 条（loop、dream、pr），PR Loop 接管 CI 监控和 heal
- **rebase 后立刻合并** — rebase 完成后同轮重取 PR 状态，可合则合，不再等下一轮 tick
- **rebase 先于 heal** — 落后且有 CI 故障的 PR 先 rebase 再判断是否需要 heal
- **修复 rebase 丢失远程 commit** — fetch 后 `checkout -B origin/ref` 再 rebase，不再静默销毁他人推送的 commit
- **修复 BASHPID bash 3.2 兼容** — `${BASHPID:-$$}` 回退，heal 不再崩溃

### 价格系统

- **移除硬编码 parser alias + 精简模型 19→10** — 删除 deepseek-chat/reasoner 别名、kimi-k2 保底，移除已退役的 claude 旧模型
- **`roll prices refresh` 支持多厂商** — 可按 `anthropic|deepseek|kimi` 分别刷新

### 修复

- **修复 `cmd_review_pr` — `gh pr view --json diff` 在任何已发布版本中不存在，改用 `gh pr diff`
- **修复 orphan 结果覆盖** — 允许 `runs.jsonl` 纠正 `cycle_end(orphan)`，成功交付不再显示 `·`
- **修复 changelog generate pyargs bash 3.2 兼容** — 空参数不再 panic

### 文档

- **loop 架构图更新** — 6→3 loop + PR Loop 统一行为
- **价格文档更新** — 多厂商、多币种（USD + CNY）

### backlog 维护

- **自制 `→ v3` 标记统一改为正式 `🚫 Deferred` 状态**
- **推迟 ideation loop 系列（US-AUTO-047..050）至 v3**

## v2.603.1

### 可见性

- **loop tmux 时间戳显示改为本地时区(FIX-169)** — 之前输出 UTC，北京时间显示晚 8 小时，看 loop 现场时间全程对不上；显示改本地时区，事件日志仍存 UTC `[loop]`
- **dashboard ci-timing 完成时回填空 conclusion(FIX-168)** — run 跑完时更新 `ci-timing.jsonl` 里空的 conclusion，时长统计不再缺口 `[loop]`

### 稳定性

- **技能自评笔记不再写错位置(FIX-176)** — 从 `.roll/` 目录内调用时会写成 `.roll/.roll/notes`、趋势统计读不到；现在始终落到正确的 `.roll/notes`

### 自动化流水线

- **changelog generate 只列自上次发布以来的待发布项(FIX-177)** — 之前会把全部 500+ 历史 ✅ Done 都列出来；现在按「上次 release tag 以来的提交」判定，只显示这一版真正要发的内容
- **changelog generate 出完整 + 按项目风格 AI 润色的待发布说明(FIX-178)** — 一条命令产出自上次发布以来的完整内容，用配置的 agent 按 CHANGELOG 风格润色，失败自动回退确定性草稿
- **changelog generate 补录无卡 merged 改动(US-CL-007)** — 发版前已 merge 但没建卡的改动（如直接开 PR 的修正）不再在 Unreleased 里被漏掉
- **PR loop 单轮内关闭已绿的 agent PR(PR #413)** — green 且可合的 agent PR 在同一个 tick 内处理掉，不再留到下一轮 `[loop]`
- **Alert Loop runner 显式传入 `_LOOP_RT_DIR`(FIX-171)** — 之前未显式传入，导致 `_alert_dispatch` 消费端回退到旧共享路径，项目本地 ALERT 永久积压无人处理 `[loop]`
- **loop 按文件路径判断产出落仓(FIX-172)** — 不再读标签，改为看 story 改的文件路径（`.roll/`→roll-meta）；摘标签前的安全前置 `[loop]`
- **loop 仅在 Roll 维护者机器上领卡(US-LOOP-067)** — 别的项目仍跳过，让维护者侧卡以后也能 loop 自己跑 `[loop]`
- **loop 领到 roll-meta 卡后在 `.roll/` 干活(US-LOOP-068)** — 在 `.roll/` 做活、提交到 roll-meta 仓、用 roll-meta 自己的测试做 gate `[loop]`

### 其他

- **roll-meta 卡改到产品仓文件立即 abort(US-LOOP-069)** — 绝不重演把维护者工具塞进产品仓的事故 `[loop]`
- **prices_fetcher 抽象为 vendor 驱动(US-VIEW-023)** — 从 Claude-only 抽象成按 vendor 驱动，加一家厂商只注册一个 vendor、不动抓取主干，Claude 行为不变
- **roll prices refresh deepseek 自动抓价(US-VIEW-024)** — 从官方页抓实价、diff、变了才落盘，deepseek 价格不再只能手工维护
- **roll prices refresh kimi 聚合多子页抓价(US-VIEW-025)** — 聚合 K2.5/K2.6 多子页抓实价，kimi 错价不再像 #406 那样靠人肉发现

## v2.602.5

### 稳定性

- **升级后彻底不再反向提示"升级"回旧版本(FIX-170)** — 续 FIX-166:上次清缓存只在「新版本自己跑升级」时生效,可升级其实是旧版本执行的,所以换版本后偶尔还会被叫去装回旧号(这回升到 2.602.4 又冒出来提示装回 2.602.2)。现在版本检查缓存绑定了写它的版本号,版本一变缓存立即失效,不管 roll update / npm / brew / 手动哪种升级方式都不会再反向提示

## v2.602.4

### 可见性

- **kimi 成本按官方实价显示(价格快照校正)** — 之前 kimi 所有模型都按一个旧低价(¥1/¥4)算,成本被低报约 5-7x;现在按官方实价(K2.6 ¥6.5 in / ¥27 out)显示,kimi-code 的用量成本终于对得上账。deepseek 价格本就正确,顺手清掉过期的折扣注释

## v2.602.3

### 可见性

- **deepseek 的 cycle 也能看到 token 和成本(FIX-164)** — 之前 deepseek 跑的 cycle 明明提了 PR、有耗时,token/成本却是空的(压根没采到用量);现在每轮都按当轮实际 agent 落账,deepseek 和 kimi 一样看得见用量和成本 `[loop]`

### 稳定性

- **roll update 后不再被反向提示"升级"回旧版本(FIX-166)** — 升级后旧的版本检查缓存没清,偶尔还会冒出叫你装回旧号的提示;现在升级会顺手清掉缓存,这点残留也没了 `[loop]`

## v2.602.2

### 自动化流水线

- **自家 PR 跑红了会自动后台修(US-LOOP-062a)** — loop 开的 PR 一旦 CI 变红,会在后台 checkout 交给 agent 修(有次数上限、不重复触发),修不好或关了自愈才告警,不再烂成没人管的僵尸 PR
- **你批准过的绿 PR 会被自动合并(US-LOOP-062b)** — 你 review 通过、CI 又绿的 PR,loop 直接帮你合并删分支,不用再等仓库级 auto-merge、也不用手点

### 可见性

- **kimi / deepseek 成本按人民币 ¥ 显示(FIX-162)** — 之前 kimi 的成本被误标成美元 $,现在和 deepseek 一样按 ¥ 显示,成本总账不再混币种

### 稳定性

- **升级提示不再反向叫你装回旧版本(FIX-163)** — 换上更短的新版本号后,`roll loop on` 等命令一度提示"升级"回旧的年份版本号;现在按 GitHub 最新发布判断,装的是最新就不再误报,发版遇到新号比线上"看起来小"也不再卡住

### 工程和测试

- **roll-design 中等复杂度也过一道 peer(US-SKILL-018)** — 以前只有大改或跨边界的设计才自动触发 peer 评审,现在中等复杂度也会过一道,方向隐患能在拆故事前被独立挑一次;10 秒内可跳过

## v2.602.1

### 新功能

- **curl 一键安装,不用 npm 也能装和升级(US-INSTALL-002~005)** — `curl ... | bash` 从远端按版本拉取、钉版安装到本地并 symlink 进 PATH,支持原地升级、卸载,并能认出当初是 curl 还是 npm 装的 `[loop]`
- **`roll changelog generate` 自动生成更新日志(US-CL-006)** — 从 backlog 已完成故事里提取用户可见的改动,按感知分组生成 CHANGELOG,不用手写 `[loop]`
- **版本号改成更短的 MAJOR.MMDD 格式(US-REL-005)** — 去掉年份前缀,大版本号可手动改(做大改版时改一次即可) `[loop]`

### 可见性

- **loop dashboard 又能看到当天 cycle 了(FIX-157)** — 之前事件文件一旦不存在 loop 不会自动重建,`roll loop status` 整天显示 0 cycle;现在每轮都确保事件落盘,当天 cycle、token、成本都看得见 `[loop]`

### 稳定性

- **loop 不再卡在已完成的故事上空转(FIX-161)** — 描述里恰好出现"待办"字样的已完成故事会被反复领取然后空转;现在选路只认状态列,真待办才会被领 `[loop]`
- **loop 自己开的 PR 跑红了不再被默默吞掉(FIX-158)** — 之前红的 loop PR 既不自动合也没人管、默默烂成僵尸;现在会浮出告警让你看见 `[loop]`
- **落后于 main 的 PR 不再卡着合不进(FIX-159)** — 之前自动 rebase 推不上去、还会把工作区留在别的分支上;现在能正常 rebase 合并并复位 `[loop]`
- **loop 每轮都用最新待办,不再拿过期列表空跑(FIX-160)** — loop 自己写的过程文件会让"拉取最新 backlog"被一直跳过、用陈旧列表反复领已完成的活;现在区分自身产物,backlog 保持新鲜 `[loop]`

## v2026.601.4

### 稳定性

- **从 `.roll/` 子目录跑 `roll` 不再误报"老结构"(FIX-156)** — `.roll/` 是嵌套 roll-meta git repo,从那里跑 `roll loop status` 等命令时 `git rev-parse` 会返回 `.roll/` 自己当 root,然后旧的"新结构存在?"检查找 `.roll/.roll` 找不到,又看到 `.roll/` 里满地 Roll 内容,就误报"老结构、要 migrate";现在检查会向上找直到 `.roll/` 的父目录,认出"这就是该 Roll 项目的私有过程仓",不再误报 `[loop]`
- **peer review 死等终结(FIX-150c)** — 此前 peer 调用挂了就是无限挂,等不到 verdict cycle 就跟着挂;现在 wall-clock 超 `peer_call_timeout`(默认 3min)直接 SIGTERM/SIGKILL 干掉跑挂的 agent,tmux 内的也送 Ctrl-C 中断,设全局标志 `_PEER_LAST_TIMED_OUT` 让上层落 ledger 用,绝不无限等 `[loop]`

## v2026.601.3

### 可见性

- **kimi cycle 现在也能看到 token 和成本(FIX-154)** — 以前 dashboard 对 kimi 那一行全是 `—/—`,看不到主力 agent 花了多少钱;现在 cycle 跑完读 kimi-code 的 `wire.jsonl`,把 token 数和成本写进事件流,RECENT 视图和成本总闸都看得见 `[loop]`

### 稳定性

- **loop 把活派给 AI 后现在真会动手,不再空转零产出(FIX-152)** — kimi 等对话式 agent 拿到 SKILL.md 会把它当成"贴过来的文档"反问"What would you like me to do?",8 秒空返没交付;技能正文前置一条 agent 无关的自主执行指令,kimi/claude/pi/codex/agy 现在都会直接动手 `[loop]`
- **agy 在 loop / cron 自动化里不再卡 tty 等待(FIX-153)** — antigravity(agy)默认要 tty 批准操作,自动化场景拿不到 tty 就一直挂着等;现在 headless 模式自动加 `-p` 和跳过权限标记,跑得到结果 `[loop]`
- **测试不再在桌面弹空报错终端(FIX-155)** — bats 测试跑完临时沙箱删了,但 peer auto-attach 弹的 Terminal 窗口指向那个已不存在的路径,桌面堆一堆空报错的死窗口;给 peer 弹窗补上和 loop 弹窗一样的测试守卫,测试上下文不再弹 `[loop]`

## v2026.601.2

### 新功能

- **curl 安装器骨架:不靠 npm 也能装 roll(US-INSTALL-001)** — 自包含安装脚本探测 OS(仅放行 macOS / Linux)、preflight 检查 `bash≥3.2`/`python3`/`curl`/`tar` 缺啥报啥、把运行时装到 `~/.local/share/roll/` 并 symlink 进 PATH,重复运行即原地升级。本版先从本地源目录复制(真正的 `curl ... | bash` 远端取数留后续故事)`[loop]`

### 可见性

- **peer 评审可靠落盘、能查了(FIX-150a)** — 此前 peer 痕迹碎成三处且大多丢失;统一落盘到项目本地规范路径,新增查询命令翻看历次 peer 记录(发起方 / 对象 / 轮次 / 各方结论 / 耗时),不再依赖 agent 自觉写盘 `[loop]`
- **三个专用 loop(CI / PR / Alert)空闲时也留心跳(FIX-151)** — 健康空闲时不再零日志让人以为没在跑;每轮补一条轻量存活心跳,status 显示各 loop 上次运行距今多久 `[loop]`

## v2026.601.1

### 新功能

- **从 GitHub Issues 直接拉进 backlog (US-SYNC-001..007)** — `roll backlog sync` 把 GitHub issue 按 label 映射成 US/FIX/IDEA 拉进 backlog,`--dry-run` 先预览、`--label` 过滤,重复同步自动跳过已存在的 `[loop]`
- **loop 按任务难度自动挑 AI agent(四槽路由)(US-AGENT-020..031)** — 复杂度分类器把活分到 easy / default / hard 各自的 agent(取代旧的三维历史命中率路由),`roll agent use/set` 锁定或单槽切换,选中的扛不住会自动降级换备用并留痕 `[loop]`
- **每个 cycle 跑完自动打分、能看质量趋势 (US-EVAL-001..005)** — loop 每轮按统一 rubric 自评打分写进记录,`roll loop eval` 看窗口趋势,连续低分自动浮出"该改进了"的信号 `[loop]`
- **onboard 会分析业务 / 技术 / 测试现状 (US-ONBOARD-016/017)** — 接手老项目时多产出领域建模、技术现状、测试覆盖三类分析(区分扫描到的事实和 AI 推断、禁止泛泛而谈),并据此给 backlog 播种候选 story,落盘前 [Y/n] 让你确认 `[loop]`
- **roll-doc 能跨目录深读项目 (US-DOC-015..019)** — 新增 Phase 3b:顺着调用链理出外部集成、部署管线,缺 `AGENTS.md` 自动补、高引用目录自动加 README,报告标注 `file:line` `[loop]`
- **deck 支持按 slide 选版式 (US-DECK-017..019)** — 每页 slide 可声明 layout,渲染器按布局路由到不同版式组件,skill 带选版式 playbook(老 deck 仍兼容)`[loop]`
- **新增 / 删 skill 后自动重建能力清单 (US-SKILL-016)** — `roll skills generate` 扫描 `skills/` 重写清单,CI 有漂移门防手改失忆,不用再手维护目录 `[loop]`

### 自动化流水线

- **专职 PR Loop:开完 PR 不用再守着合并 (US-AUTO-044)** — 主 loop 开完 PR 就退,新增每 5 分钟独立跑的服务专门 rebase / 合并 / 关 PR,合并即自动删分支,同一故事不会重复开 PR `[loop]`
- **专职 CI Loop:CI 抖动自动重跑、flaky 自动浮出 (US-AUTO-045)** — 新增每 5 分钟独立跑的服务,瞬时网络抖动导致的失败自动 rerun,检测 flaky 和耗时劣化,真失败写 ALERT `[loop]`
- **专职 Alert Loop:告警不再刷屏、急事立刻弹通知 (US-AUTO-046)** — 新增每 1 分钟独立跑的服务消费告警,同类 1 小时内聚合防刷屏,error 立即弹 macOS 通知 `[loop]`
- **loop / dream / brief 调度一行命令就能改 (US-LOOP-033..036, fixes FIX-105)** — `roll config loop-window 9-18` / `loop-schedule 30/7` / `dream-time 03:20` / `brief-time 09:15`,改完立刻生效,不用再手工改配置;dream / brief 重新支持精确到分钟 `[loop]`

### 可见性

- **每轮 loop 结束直接看到这一轮干了啥 (US-LOOP-040/042)** — cycle 结束在 `.command` 窗口渲染本轮总结(开了什么 PR、跑没跑测试、有没有告警)`[loop]`
- **远程也能看 loop 在干嘛 (US-OBS-014/015)** — 每轮结束自动推送状态快照,人不在机器前也能远程看 loop 状态 `[loop]`
- **loop 连续改同一文件不再刷屏像卡死 (US-VIEW-020..022)** — `roll loop attach` 里 agent 反复改同一文件折叠成一行 `✏ <文件> ×N`,不再复读长路径 `[loop]` `[doc]`
- **非 Claude agent 也能看到 token/成本 (US-LOOP-027..031)** — dashboard 不再对 pi、codex、Gemini、Kimi、Qwen 的 cycle 黑屏,显示真实 token 和成本;暂无插件的 agent 仍显示 `—/—` `[loop]` `[doc]`
- **loop 跑了哪几轮可跨项目查 (US-LOOP-020)** — 运行记录改存项目本地,`roll loop runs --all` 跨项目聚合查看 `[loop]`

### 稳定性

- **loop 同步不再冲掉你未提交的 .roll 改动 (FIX-145)** — meta-sync 遇到未提交的 `.roll` 编辑时跳过 `reset --hard`,不再清掉本地改动 `[loop]`
- **路由到的故事中途没法做时自动改挑别的 (FIX-146)** — agent 交接时若选中的 story 变不可用,自动重新挑一个,不再空转 `[loop]`
- **修好几个会让 loop runner 崩的小问题 (FIX-147/148)** — runner 因反引号转义报 `press: command not found`、dream/brief 调度默认值错乱,均已修复 `[loop]`
- **`roll agent list` 正确识别 antigravity** — 能正常显示 `antigravity (agy)` 并探测 agy 命令 `[loop]`

### 工程和测试

- **发布说明就是 changelog,不再是两个东西 (US-REL-004)** — Roll 里只有 changelog、没有单独的 "release notes"(也没有 `RELEASE_NOTES.md` / `roll release-notes`):发版时直接把该版 changelog 段落作为 GitHub Release 正文,changelog 本身改用按感知分组 + 第二人称的写法,读起来就是给你看的发布说明 `[release]`

## v2026.529.5

### Added

- **`roll feedback` — 一条命令直接给 Roll 提反馈** — `roll feedback "..."` 直接开一个 GitHub issue,自动附上环境信息(系统 / 版本 / 当前 agent),`--type` 自动映射到对应 label;反馈仓库按 env > 项目 > 全局 > origin 优先级解析,不用手填 `[cli]`
- **loop 按故事自动挑最合适的 AI agent** — 不再所有活都丢给同一个工具:每个故事按硬规则 + 历史命中率软偏好路由到更合适的 agent,`roll loop status` / brief 能看到每个 agent 的命中率 `[agent]`
- **agent 扛不动的活自动拆小,而不是硬憋半成品** — cycle 起步先跑 pre-flight 自检;扛不住就自降级(重新拆小 + 标 🚫 Hold + 干净退出),自动重拆设 chain_depth≥2 上限并告警 `[agent]`
- **每次交付自动打分,能回看质量趋势** — roll-build / roll-fix / roll-design 完成后各写一条统一格式自评分,dashboard 显示趋势(均值 / 最低 / 重做率)`[skill]`
- **合并前自动查测试质量,烂测试进不了主干** — 新增两条测试质量红线(内联外部工具、文件落在仓库外),设计阶段自检 + 合并门扫描;命中写 ALERT,确需绕过用 `[skip-test-quality]` `[test]`
- **loop 活跃时段能按项目单独设** — 不用再让所有项目迁就一个全局时间,活跃窗口从项目本地 `.roll/local.yaml` 读 `[loop]`
- **`roll-doc` 能追踪数据流和调用链** — 不只列模块,还顺着 import 链路把数据怎么流、谁调谁理出来 `[doc]`

### Fixed

- **loop 的 agent 路由以前是摆设,说一套做一套** — 嘴上说"交给 X",实跑的却是安装时写死的另一条命令,手动换工具也不生效;改成每轮运行时按当下挑中的 agent 重建命令,换 agent 立刻生效 `[loop]`
- **干完活却卡在提交、整轮白做** — 提交前被测试门拦下,接着去跑全量 `npm test` 把自己拖死、成果作废;改成只测改动的 `roll test` 快速过关,能正常提交、开 PR `[loop]`
- **非 Claude agent 跑 loop 不再黑屏假死** — deepseek / pi 等执行阶段几十分钟没输出像卡死、心跳也没发;放弃强求实时输出,改成稳定打存活心跳(运行时待下一轮 cycle 实证)`[loop]`
- **dashboard 看不到当天跑完的 cycle** — 事件写入端搬进了项目本地,读取端还在读旧的 shared 文件,卡跑完合了 PR 却显示 Today=0;改成统一从项目本地读并把历史并过去 `[loop]`
- **loop 用 kimi 跑必崩** — kimi 升级新版后调用参数对不上,一跑就挂;已修好 `[agent]`
- **`roll loop on` 调度时间显示全是 00:00** — 渲染时 printf 展开顺序错了,现在正常 `[loop]`
- **没装的工具被误判成"可用"** — 只看到 `~/.claude` 目录就当 Claude 装了、还设成默认 agent;现在必须命令真在 PATH 上才算装 `[agent]`
- **`roll test` 在隔离 VM 里更稳** — 修了 tart 拿到过期 IP 的问题,默认只跑受影响用例让 VM 更快 `[test]`

### Improved

- **loop 日志全改项目本地、按 cycle 全留** — 以前全局 + 项目本地重复存两份、全局那份还无限 append,per-cycle 又 cap 50 偶尔丢轮;改成全落项目本地、不限量、零全局重复,机器层事件单列项目 ops 日志,cycle 结束终端只显示当前这轮 `[loop]`
- **loop 的"完成"现在等于"真合进主干"** — 以前开 PR 那刻就标 ✅ Done,但 PR-protected main 要 review + 绿 CI、自治 cycle 常合不进 → 假 Done;改成真正 merge 才算完成,没合自动退回 📋 待办 `[loop]`
- **同一故事不再每轮重复开 PR** — 选卡前先查它是不是已有开着的 PR,有就跳过,合不进的 PR 不再越堆越多 `[loop]`

## v2026.528.2

### Added

- **loop 换机器跑不会再拿过期 backlog** — 以前在 A 机器跑的 loop，搬到 B 机器继续时会用本地的旧 backlog，不知道有什么新待办；现在每轮开始前自动拉一次最新状态，多台机器始终看同一份 `[loop]`

- **CI 红了 loop 不再干等** — 主干测试挂掉时，loop 以前会停下等人去修；现在先自己分析失败原因、发一个修复，试满 3 次还没修好才发告警找人；自己开的 PR 被 CI 标红后也会自动续上去修，不会因为"本轮 loop 已经结束"就悄悄放弃 `[loop]`

- **`roll test` — 测试跑在独立环境里，不会再误伤本机** — 以前跑完整测试套件会触碰本机的 loop 调度服务，测试一过就把正在运行的 loop 打掉；现在测试在独立的 macOS VM 里跑，本机的 loop 完全不受影响 `[test]`

### Fixed

- **Kimi CLI 改名后全链路都能识别了** — Kimi 把工具从 kimi-cli 改名为 kimi-code、安装目录也换了；Roll 现在新旧名字都能认出来，kimi-code 的安装路径也加进了自动查找范围，调度环境里也能找到，已设好的旧配置不需要动 `[agent]`

- **`roll loop log` 现在真的能看了** — 每轮 cycle 的日志存档修好了；以前文件根本没生成，现在用 `roll loop log` 能查到每一轮跑了什么 `[loop]`

- **loop 跑完的终端窗口不再瞬间消失** — 以前 cycle 结束 Terminal 窗口立刻关掉，来不及看本轮干了什么；现在窗口留着直到你自己关 `[loop]`

### Improved

- **提交安全检查不会再被静默绕过** — Roll 的 TCR 要求每次提交前先过测试；以前在新终端或新机器上开工，这道检查会因为 git 配置没自动生效而悄悄失效，自动化环境尤其容易中招；现在每次打开 Claude Code 新会话、或跑 `roll setup` 都会自动配好，这个漏洞从源头堵死 `[infra]`

- **macOS 自带 bash 下中文命名的测试用例不再被静默跳过** — macOS 系统自带的旧版 bash 在处理中文或特殊字符测试名时会截断，导致这些测试根本没执行却也不报错，本地看起来全绿但实际上漏了一批用例；已修复，本地和 CI 结果现在一致 `[test]`

## v2026.527.1

### Added

- **pi / deepseek 跑的 loop 现在能看到真实 token 和花费** — 仪表盘不再显示 —/—，按人民币原币种计价，连之前没数据的历史轮次也补齐了 `[loop]`
- **`roll loop gc` 清理 loop 残留** — 一条命令清掉废弃项目的残骸文件和过期备份，不再越堆越多 `[loop]`
- **loop 可以用 gemini / openai / qwen 来跑了** — 在 pi / deepseek / kimi 之外多了几个选择 `[loop]`
- **loop 触发频率能设成任意分钟数** — 不再只有几个固定档，1 到 1440 分钟随便填 `[loop]`

### Fixed

- **每日汇总的花费按币种分开显示** — 人民币和美金不再被混加成一个数 `[dashboard]`

## v2026.526.1

### Changed

- **`roll loop --help` 不再显示内部 hook 命令** — notify / enforce-tcr / precheck-ci 移到单独的内部命令区，不给用户看了 `[cli]`

### Added

- **一个故事跑过的所有轮次能合并看了** — `roll loop story <ID>` 一眼看清总耗时、花了多少钱、走过哪几个 PR `[loop]`
- **仪表盘不再丢历史轮次** — 老数据自动归档，往前翻多远都看得到 `[loop]`
- **写 slides 不用再抄模板 HTML** — 9 个常用组件块（卡片、对比、时间线…）直接拿来用 `[deck]`
- **服务状态在窄终端也对齐了** — 中英文混排不再因为汉字占两格错位 `[i18n]`

### Fixed

- **`roll slides new` 失败时给得出手的提示** — 模板找不到列可选项、内容有错指出位置、生成崩了告诉你看哪份日志 `[deck]`
- **跑完整测试不再卡 60 分钟** — loop 启动时的多语言初始化优化后回到正常时长 `[loop]`
- **收拾了 9 个不稳定的测试** `[testing]`

### Docs

- **新增"多台机器同时跑 loop"章节** — 怎么协调、状态符号是啥意思都说清楚 `[loop]`
- **README 更新** — 不再要求 bash 4，macOS 自带的 3.2 就能跑；命令表补上 `roll loop story` `[docs]`

## v2026.525.1

### Added

- **loop 触发频率可以按项目单独设** — 不再全局一刀切，有的项目可以慢点跑 `[loop]`

### Fixed

- **主页不再误报** — 已经开了 loop 的项目不会再被标成"缺失" `[loop]`
- **loop 弹窗关了也能翻回之前的输出** — 不再一关就全没 `[loop]`

## v2026.524.2

### Added

- **`roll slides new` 不再像卡住** — 分阶段显示进度、当前步骤和耗时 `[deck]`
- **`roll slides new` 可以用项目自己的模板** — 不只用内置的了 `[deck]`
- **`roll slides list` 一眼看出 slide 状态** — 哪些能看、哪些生成失败、失败原因也能查 `[deck]`
- **`roll slides templates` 列出可用模板** — 内置和项目自定义的一眼可见 `[deck]`
- **`roll slides delete` 删除幻灯片** — 不再需要手动 rm `[deck]`
- **用 pi / deepseek / kimi 跑的 loop 也能在终端里实时看到进度** — 不再黑屏 `[loop]`
- **网站语言随浏览器自动切换** — 中文用户看到中文 `[i18n]`

### Fixed

- **loop 不再一次吞太多故事** — 每次只做一个，时间可预期 `[loop]`
- **loop 挂了会换备用** — 不再直接放弃 `[loop]`
- **loop 本地工作区不再堆积** — 合并后自动清理 `[loop]`
- **标进行中的故事不再永久卡住** — 超时恢复待办 `[loop]`
- **成本不再虚高** — 支持多模型真实价格 `[dashboard]`
- **dashboard 不再对非 Claude 模型显示空白** — 能看出每轮谁跑的 `[loop]`
- **主页 agent 标签不再骗人** — 显示真名 `[dashboard]`

### Docs

- **新增 `guide/{en,zh}/pricing.md`** — `roll prices` 命令用法、价格快照机制、历史成本固化语义；README 索引同步 `[pricing]`
- **FAQ 新增 A11** — 价格更新后历史 cycle 成本数字不会变 `[pricing]`

## v2026.523.2

### Added

- **每轮 cycle 实时打出 7 阶段进入退出与耗时** — `startup` / `preflight` / `worktree_setup` / `claude_invoke` / `publish_push` / `publish_wait_merge` / `cleanup`，长静默阶段 30–60s 一次心跳，再也不用盯着空屏猜 loop 卡在哪 `[loop]`
- **cycle 结束打一份按耗时降序的阶段面板** — 同时把每阶段秒数固化到 `runs.jsonl` 的 `phases` 字段，跨轮对比"今天哪一步最慢"有完整数据 `[loop]`
- **`roll loop runs` 每行末尾追加 `slowest=<阶段> <占比>%`，新子命令 `roll loop runs --detail <cycle_id>` 打开完整阶段面板** — 不必翻 ndjson 就能定位单轮瓶颈 `[dashboard]`
- **`tests/run.sh --affected [base-ref]`** — TCR micro-step 只跑被本次改动覆盖的测试文件，反馈秒级；改动 `tests/helpers/*` 等保守降级到全套 `[testing]`
- **`tests/run.sh --tier=fast|slow|all`** — 本地 TCR 默认 `fast`，CI 跑 `--tier=all`；`ROLL_TEST_TIME_CAP=1` 时 `fast` 全跑 60s 硬上限，性能漂移立刻打红 `[testing]`
- **测试质量评分卷（6 类反模式 rubric）** — `roll-.dream` Scan 7 按 rubric 输出 `REFACTOR-XXX [test-quality:❶|❷|...]`，单轮上限 5 条，存量 ❶ 类反模式可结构化治理 `[dream]`
- **`roll lang [zh|en|--list]`** — i18n 地基命令：查看 / 切换 / 列出可用语言，按本机 locale 自动选默认；`ROLL_LANG` 环境变量临时覆盖 `[i18n]`
- **`roll prices show / refresh`** — 价格表挪进带版本号的 snapshot，能一键拉官方文档对比；调价不再要改源码、提 PR，每个 version 的价格都查得到 `[pricing]`
- **cycle 结束时按当时价格固化成本** — 以后调价或升级都不会回头改写历史轮次的数字；老事件继续可读，渲染时打 `[legacy]` 标记 `[loop]`

### Fixed

- **dashboard 把已合并 PR 错显示成"开放"** — `roll loop status` 兜底走 git log 找 squash merge subject，原正则只认 `loop/cycle-LABEL` 旧分支名，对新的 `loop cycle LABEL (#N)` 默认 subject 匹配不上；现在两种都认 `[dashboard]`
- **`model_prices.bats` 改用 fixture 价格表注入** — 之前对生产 PRICES 算术断言把调价误伤成测试红，重写后只断结构不变量（cache_read < input、out ≥ in 等）`[testing]`
- **已合入临时分支堆在 origin 不被清理** — `_loop_cleanup_stale_cycle_branches` 漏过 agent / abort 两条路径，现在 cycle 入口先扫一遍再走主流程 `[loop]`
- **临时目录复现 bug 时留下幽灵 launchd 服务** — 自动检测临时路径并把所有 `launchctl` 调用走 sandbox 注册表，主用户 launchd domain 不再被污染 `[launchd]`
- **dashboard 把 story 列错显示成上一轮的 ID** — `_STORY_ID_PAT` 老正则每段只认纯字母，`US-I18N-001` 这种字母+数字混合 segment 匹配不上 → 新 `pick_todo` 被静默丢掉，仍展示前一轮的旧 story 名；正则更新为 `[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-\d+` 后 I18N / K8S / D2 / S3 等命名都能识别 `[dashboard]`

### Docs

- **新增 `guide/{en,zh}/loop.md` "Cycle phases" 小节** — 七阶段表 + 触发时机 + 典型耗时 + 收尾面板样例；FAQ 增 C6 "某阶段慢怎么定位"
- **新增 `guide/{en,zh}/testing.md` "TCR Test Strategy" 小节** — `--affected` 与 `--tier` 两个杠杆的语义、匹配规则、CI/本地默认组合；新增 "测试质量评分卷" 小节列六类反模式与修复方向

## v2026.523.1

### Added

- **`roll loop branches`** — 一眼看见本机残留的 loop 分支；每轮入口先 GC 一次，半途中止的 cycle 也会被收掉 `[loop]`

### Changed

- **dashboard token 列拆成 input / output / cache 写 / cache 读** — cache 是真花钱的，账单终于解释得清 `[loop]`

### Fixed

- **每日 dream / brief 在 macOS 26.4 上从来没真跑过** — 换成 interval 触发，从今天起稳定每天产出 `[loop]`
- **dashboard 上 tcr 次数、built 列表、ALERT 文案不再显示假零或别故事的旧标签** `[loop]`
- **选一个故事不再把别的依赖它的故事也标成"在做"** — dashboard 不再骗你说有人在干活 `[loop]`
- **`roll setup` / `roll update` 不再在隐藏的覆盖提示上无声卡死**
- **`$roll-notes` 现在写到 `.roll/notes/`** — 和 dream / brief 一致，不再扔到项目根目录 `[loop]`
- **loop CI 网关不再把"排队中 / 进行中"误判成失败** `[loop]`

## v2026.522.2

### Changed

- **Roll 改用 Antigravity (`agy`)** — Google 已退役独立 Gemini CLI，agy 是接班产品；老用户重跑 `roll setup` 即可

### Improved

- **dashboard token 列现在只算 input/output，cache 不再混进来虚抬总量** `[loop]`
- **`roll loop status` 现在分清「没装 / 装了关了 / 正常」三种状态** — 之前看不出 loop 到底有没有起来 `[loop]`

### Fixed

- **loop 异常中断时未推送的 commit 不再丢** — 自动开成 PR `[loop]`
- **loop 每小时弹窗不再抢前台焦点** — 后台开 Terminal，不打断你在干的事
- **`roll loop` 在非 git 目录下不再静默崩溃** `[loop]`

## v2026.522.1

### Fixed

- **loop 不再被 Roll 自身测试遗留的后台调度静默杀掉** `[loop]`

## v2026.521.3

### Added

- **`roll slides`** — 给个主题，agent 自动写 18 张双语 slide 并渲染成 HTML 在浏览器里直接打开；`roll slides list` / `preview` 管理已有 deck

## v2026.521.2

### Fixed

- **`roll setup` 不再在 macOS 后台活动列表里留下 ghost「bash」条目** — 改由 `roll init` 和 `roll loop on` 按需安装 `[loop]`
- **`roll setup` 现在能正确显示哪些步骤真的装了** — 之前装好的 skills 和 peer 状态目录会被误标成"跳过" `[loop]`
- **`roll loop status --days 7` 不再吞掉天数参数** — 之前永远只显示默认 3 天，dashboard 底部那条 "more" 提示也改成能直接复制跑通 `[loop]`
- **loop 每轮起手不再刷一堆"找不到文件"报错** — 修了内部脚本里的旧路径，并让 agent 在 zsh 下不再被未匹配的通配符卡住 `[loop]`

## v2026.521.1

### Added

- **dashboard cycle 行现在标出模型和按公开单价算的成本** — 跨账号 / 跨项目可以横向对比和加总，不再被订阅折扣藏掉真实开销 `[loop]`

### Improved

- **`roll setup` 重跑能看出"已是最新"还是"刷新了 X 项"** — 每步上报 changed / unchanged / failed，强制覆盖用 `~` 标出 `[loop]`
- **`roll-peer` 评审第一轮要先独立判断** — 不再被评审方预设结论带跑，跨 agent 才真的是二次判断 `[loop]`

### Fixed

- **`roll init` 默认不再打"Project ready"假提示** — 老项目进引导分支时不再骗你说已就绪 `[legacy-onboard]`

## v2026.520.1

### Added

- **`roll offboard`** — 一键清掉项目里的 Roll 痕迹，先 dry-run 预览、二次确认才动手；命名空间对不上直接拒绝，绝不跨项目误删 `[legacy-onboard]`
- **`roll init` 现在认得出非典型布局的老项目** — 微信小程序、Python 平铺、Terraform 仓不再被当成空项目静默跳过引导 `[legacy-onboard]`
- **onboard / offboard 用户指南** — 完整接入与退出流程文档上线，遗留项目页"怎么退出"段从手动 rm 改为指向新命令 `[docs]`

### Improved

- **公开 README 重写为给使用者看的** — 中英文 README 去掉自我推销语言，围绕安装 + 使用展开，新增贡献指南与漏洞报告说明 `[docs]`
- **markdown 改动不再绕过 CI** — 文档量减下来之后，关键文档改动现在和代码一样要过 CI `[ci]`
- **onboard 留下回退清单** — onboard 完事会记下动过哪些文件、在 AGENTS.md 哪段合并、加了哪些 launchd 调度，作为 offboard 的精准回退依据 `[legacy-onboard]`

### Fixed

- **loop 跑过 45 分钟预算时不再卡死** — watchdog 现在能稳定收掉超时的 claude，下一轮按时启动 `[loop]`
- **loop worktree 里能看到主仓最新 backlog** — 每轮启动会先把主仓 `.roll/` 同步进 worktree，不再因为 meta 滞后让 loop 拿到旧待办 `[loop]`

## v2026.519.3

### Major

- **`.roll/` 拆为独立私有仓库** — 过程文件（backlog / brief / features / dream / domain / briefs）整体迁入嵌套私有 repo `roll-meta`，主仓只留产品文档。AGENTS.md 新增 §9 说明双 repo 协作约定 `[meta]`

### Improved

- **`.roll/features/` 按 Epic 分组** — features 目录由扁平改为 Epic 子目录，附带 loop 架构经验文档 `[docs]`
- **站点登陆页对齐 v2.0 架构** — `docs/site/` 文案与 2.0 实际产物对齐，去掉过期描述 `[docs]`

### Fixed

- **loop 异常退出** — dashboard 不再卡在"运行中"，崩溃 / 被 kill / 超时退出都会写下结束标记 `[loop]`
- **`FIX-065` loop 共享状态隔离** — 测试运行的 loop 不再污染生产 backlog/brief，sandbox 化共享路径 `[loop]`

## v2026.519.2

### Improved

- **`roll init`** — 初始化流程现在显示 6 步编号进度，新建文件用绿色 `+`、合并已有用琥珀 `~`，结尾给三步上手指南 `[loop]`

### Fixed

- **`roll --help` 中 `init` 描述** — 文案从 `+ docs/` 改为 `+ .roll/features/`，对齐 2.0 实际产物和 README；v2 (`lib/roll-help.py`) 与 legacy (`bin/roll`) 两份 help 同步修正 `[FIX-064]`

## v2026.519.1

### Major（大版本重构）

- **项目结构重组 — 过程文件迁入 `.roll/`** — Phase 1 of Legacy Onboard Epic。`BACKLOG.md`、`PROPOSALS.md`、`docs/{features,briefs,dream,design,domain}/` 全部搬入 `.roll/`；`docs/guide/`、`docs/site/`、`docs/intro/` 上移到根级。一次性 breaking change，迁移指南见 `guide/{en,zh}/migration-2.0.md` `[legacy-onboard]`
- **新命令 `roll migrate`** — 老项目一键迁到新结构：dry-run 预览 + `git mv` 保留历史 + 单原子 commit + 三态幂等（仅老 / 仅新 / 并存） `[legacy-onboard]`
- **新版 `roll init` 识别 Legacy 项目** — 检测到现有源码无 `AGENTS.md` 时引导用户进入 onboard 流程：列出本机 AI agent、显式告知 token 消耗、引导运行 `$roll-onboard` `[legacy-onboard]`
- **新技能 `$roll-onboard`** — 三组九问 ≤ 3 分钟，AI 读懂项目后生成 `.roll/onboard-plan.yaml`，bash 侧 `roll init --apply` 执行 `[legacy-onboard]`
- **新命令 `roll init --apply`** — 消费 onboard plan 创建 `.roll/` 结构，按用户选择写 `.gitignore`、同步 AI 工具约定 `[legacy-onboard]`
- **结构强制检测** — 新版 Roll 在老结构项目上拒绝运行 + 引导 `roll migrate`（`setup` / `update` / `version` / `help` / `init` 豁免；`ROLL_SKIP_STRUCTURE_CHECK=1` 旁路） `[legacy-onboard]`

### Improved

- `AGENTS.md` §8 Documentation Conventions 重写匹配新目录结构，明确"过程默认对内、产品默认对外"原则 `[docs]`
- `guide/{en,zh}/practices/` 收入工程规范文档（原 `docs/practices/engineering-common-sense.md`） `[docs]`
- 新增 Python 校验器 `lib/roll-plan-validate.py`，验证 onboard plan 完整性、`generated_at` 24h 时效、版本兼容 `[legacy-onboard]`

### Fixed

- **`roll setup` 后从未开启 loop 的项目** — 不再被 macOS 自动激活、每小时弹出终端窗口 `[loop]`
- **`_write_backlog` 缺 `mkdir -p` 导致 `cmd_init` 在 `.roll/` 不存在时崩** `[legacy-onboard]`
- **`release.sh` 多 feature 时 awk `newline in string` 错误** — macOS BSD awk 不容忍 `-v var=多行`；改用 `ENVIRON` 读取 `[release]`
- **GitHub 仓库改名 Roll → roll** — 内部代码、测试 fixture、文档引用全部同步小写命名 `[chore]`
- **`.roll/backlog.md` 和 `guide/*` 中残留 `docs/features` 等老路径引用** — Story 5 sed 漏覆盖 `.roll/` 和 `guide/` 文件，dream 巡检发现后补齐 `[legacy-onboard]`

## v2026.518.4

### Improved

- **`roll` 主页焕新** — 一屏看清 loop / dream / peer 状态、四道防线、Pipeline 进度和待你处理的事 `[loop]`
- **`roll --help` 焕新** — 命令按日常 / 项目 / 全局三组分类，常用命令 ★ 高亮，不再被大字 ASCII banner 占屏 `[loop]`
- **`roll status` 焕新** — 一行看健康总览，AI 客户端同步状态、约定文件清单、项目模板逐段展示，drift 行直接给修复命令 `[loop]`
- **`roll backlog`** — 待办任务按缺陷 / 故事 / 重构 / 创意四类分组显示，进行中的条目紫色高亮，Blocked / Deferred 分区附带原因 `[loop]`
- **`roll brief`** — 简报现在用终端三段式渲染：摘要数字、已完成亮点、待决策清单按 D1/D2 编号 `[loop]`
- **`roll setup`** — 首次安装流程现在显示 6 步编号进度，每步完成打勾，结尾显示"Setup complete" `[loop]`

### Fixed

- **loop 弹窗现在固定走 Terminal.app** — 不再按终端偏好挑来挑去，省得在新版 Ghostty 上弹窗假成功、备选方案也失效 `[loop]`
- **与 roll agent 对话** — 不再因工具不同而忽冷忽热 `[loop]`
- **大小写不同路径进同一项目** — 不再被 loop 当成两个独立项目、LOCK 和状态不再分裂 `[loop]`
- **loop 跑完一轮** — 不再挡死后续调度、卡到手动 kill `[loop]`
- **binary 升级后 loop dashboard 回落 IDLE 问题** — 旧 binary 用不同路径大小写算出不同 slug，新 binary 启动时自动把旧 slug 的状态文件、日志、历史记录全部迁到新 slug，upgrade 无感无损 `[loop]`
- **loop status 费用显示严重偏低** — `$9.25` 的 cycle 显示为 `$0.04`：读取了最后一次 API 调用的 token 数重新算价，改为直接用 `cost_reported_usd`（loop-fmt 写入的权威累计值） `[loop]`

## v2026.518.3

### Fixed

- **autonomous loop 跑测试时狂开 Ghostty 窗口** — `_write_loop_runner_script` 生成的 outer runner 在 popup 分支只检查 `ROLL_LOOP_NO_POPUP` / mute 文件 / Darwin；当 loop 的执行 agent 跑 bats 跑到 `_loop_test` 这类需要执行生成脚本的测试时，每个 test case 都会真的弹一个 Ghostty 窗口，一轮 cycle 累出 80+ 个孤儿窗口。popup 守卫追加 `BATS_TEST_NUMBER` 判定，任何 bats 上下文里自动跳过 popup `[loop]`

## v2026.518.2

### Fixed

- **`roll loop status` dashboard 崩溃 / 列对齐** — `_dash_release_ready` 用 `grep -c` 在零匹配时返回 "0" + 非零退出码再被 `|| echo 0` 追加一个 "0"，拼成 "0\n0" 让 `[[ -gt ]]` 报语法错；改用 `grep | wc -l | tr -d ' '` 单值返回。Today 表头去掉 "(in progress)" 后缀（曾溢出到 Yesterday 列），数值列宽 6→8 让指标行对齐表头 `[loop]`
- **v2026.518.1 在刚发版的仓库里 dashboard 不可用** — 上面那个崩溃在 HEAD == latest tag、或 tag 之后只有 docs/chore commit 的仓库中必触发；本版作为追加修复，升到 v2026.518.2 即恢复 `[release]`

## v2026.518.1

### Improved

- **`roll loop status` 焕新** — 重设计的 dashboard 替换原本的扁平列表：按天 Today / Yesterday / −2d 分列总账（轮次、PR、耗时、tokens、成本、失败计数），下面每天分段列出 cycle 详情；idle / done / fail 用 `·` / `✓` / `✗` 区分，不再统统挂"运行中"；时间统一显示 UTC+8；同一 cycle 的 pr 事件与 cycle_start 不再被错切成两条；多 story cycle 用 `|` 连起来一行展示；走 `ROLL_UI=v2` 默认开，`ROLL_UI=v1` 一键回退到旧实现 `[loop]`
- **loop 每轮成本和 token 真实可见** — 每个 cycle 结束时把模型用量（input / output / cache_creation / cache_read tokens、claude 上报的折后价、耗时）写进永久事件流，dashboard 按模型公开单价（list price）算出真实成本、按 k / m / b 显示 token，多机器 / 多项目可横向对比；历史 cycle 没写过这条事件的，自动从 claude 自己的会话日志里回灌一份 `[loop]`
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
