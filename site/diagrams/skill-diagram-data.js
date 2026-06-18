window.RollSkillDiagrams = {
  skills: [
    {
      id: "roll-onboard",
      name: "$roll-onboard",
      title: { en: "Legacy Project Onboarding", zh: "老项目接入" },
      sub: { en: "Survey. Infer. Plan. Apply later.", zh: "问询、推断、出计划，稍后再应用。" },
      lede: {
        en: "Bring Roll into an existing codebase without surprise edits. The skill reads the project, asks nine scoped questions, writes only <b>.roll/onboard-plan.yaml</b>, and leaves mutation to <code>roll init --apply</code>.",
        zh: "把 Roll 接入现有代码库，但不偷改源文件。本技能读取项目、提出 9 个范围化问题，只写 <b>.roll/onboard-plan.yaml</b>，真正落地交给 <code>roll init --apply</code>。"
      },
      modes: [
        { tag: "A", title: { en: "Legacy project", zh: "老项目" }, body: { en: "No Roll structure yet, source files already exist. Read code and infer project shape before asking.", zh: "已有源码、还没有 Roll 结构。先读代码推断项目形态，再提问。" } },
        { tag: "B", title: { en: "Partial migration", zh: "半迁移项目" }, body: { en: "Old markers such as <code>BACKLOG.md</code> or <code>docs/features/</code> stop the flow; migrate with the v2 toolchain first.", zh: "发现 <code>BACKLOG.md</code> 或 <code>docs/features/</code> 等旧标记即停止；先用 v2 工具链迁移。" } }
      ],
      merge: { en: "▼ both paths protect source files from surprise edits ▼", zh: "▼ 两条路径都保护源文件不被意外修改 ▼" },
      bands: [
        { key: "plan", label: { en: "Discover", zh: "发现" }, steps: [
          { no: "STEP 0", title: { en: "Pre-flight legacy check", zh: "老项目预检" }, desc: { en: "Confirm this is a legacy root: no <code>AGENTS.md</code>, has source code, no existing onboard plan unless owner approves overwrite.", zh: "确认这是老项目根目录：没有 <code>AGENTS.md</code>、已有源码；若已有接入计划，需询问是否覆盖。" }, chips: ["fail loud"] },
          { no: "STEP 1", title: { en: "Read code and infer domains", zh: "读代码并推断领域" }, desc: { en: "Use manifests, README and tree shape to identify project type, description, domains and key modules.", zh: "基于 manifest、README 和目录形态识别项目类型、描述、领域与关键模块。" } }
        ] },
        { key: "build", label: { en: "Analyze", zh: "分析" }, steps: [
          { no: "STEP 1b", title: { en: "Domain, tech and test assessment", zh: "领域、技术与测试评估" }, desc: { en: "Produce bounded contexts, stack/dependency risks and test evidence from real filesystem scans. Test claims carry <code>detected</code> or <code>inferred</code> evidence tags.", zh: "产出 bounded context、技术栈/依赖风险，以及来自真实文件扫描的测试证据。测试结论必须带 <code>detected</code> 或 <code>inferred</code> 标签。" }, chips: ["evidence"] },
          { no: "STEP 2", title: { en: "Read-only doc gap report", zh: "只读文档缺口报告" }, desc: { en: "Run <code>roll-doc --dry-run</code> to find missing Roll artifacts and docs that can be included rather than regenerated.", zh: "运行 <code>roll-doc --dry-run</code> 找出缺失的 Roll 产物，以及可复用而非重写的现有文档。" } }
        ] },
        { key: "ship", label: { en: "Plan", zh: "计划" }, steps: [
          { no: "STEP 3", title: { en: "Nine questions across three groups", zh: "三组九问" }, desc: { en: "Ask about scope/privacy, workflow and conventions. User answers become hard constraints, not suggestions.", zh: "围绕范围/隐私、工作流与约定提问。用户答案成为硬约束，不是建议。" } },
          { no: "STEP 4", title: { en: "Write onboard plan only", zh: "只写接入计划" }, desc: { en: "Serialize the reviewed contract to <code>.roll/onboard-plan.yaml</code>. Do not edit source, gitignore, docs or backlog.", zh: "把已确认契约序列化到 <code>.roll/onboard-plan.yaml</code>。不改源码、gitignore、文档或 backlog。" }, gate: true, chips: ["hard boundary"] }
        ] },
        { key: "verify", label: { en: "Apply Later", zh: "稍后应用" }, steps: [
          { no: "HANDOFF", title: { en: "roll init --apply owns mutation", zh: "由 roll init --apply 负责落地" }, desc: { en: "The plan is the handoff artifact. Shell-owned initialization applies it after review.", zh: "接入计划就是交接产物。用户 review 后，由 shell 侧初始化流程应用。" } }
        ] }
      ],
      foot: [
        { title: { en: "Hard boundary", zh: "硬边界" }, items: { en: ["Read and infer, but do not mutate project source.", "Only <code>.roll/onboard-plan.yaml</code> may be created.", "Privacy and scope answers are hard constraints."], zh: ["可以读和推断，但不修改项目源码。", "唯一可创建文件是 <code>.roll/onboard-plan.yaml</code>。", "隐私与范围答案是硬约束。"] } },
        { title: { en: "Stop signs", zh: "停止信号" }, hard: true, items: { en: ["Partial v2 migration markers require v2 migrate first.", "Existing plan requires explicit overwrite approval.", "Untaggable test claims fail validation."], zh: ["发现 v2 半迁移标记时先跑 v2 migrate。", "已有计划时需明确批准覆盖。", "测试结论没有证据标签会校验失败。"] } }
      ]
    },
    {
      id: "roll-design",
      name: "$roll-design",
      title: { en: "Design Before Code", zh: "先设计再编码" },
      sub: { en: "Discuss. Model. Decompose. No code.", zh: "讨论、建模、拆解，不写代码。" },
      lede: {
        en: "Turn a vague goal into <b>INVEST stories with a concrete, signed-off design</b>. DDD depth scales with risk, decomposition only slices an agreed design, and the skill stops before implementation.",
        zh: "把模糊目标变成<b>背后有具体、已确认方案的 INVEST 故事</b>。DDD 深度随风险伸缩；拆解只切分已认可方案；到实现前即止步。"
      },
      href: "roll-design-skill.html",
      modes: [
        { tag: "A", title: { en: "Interactive mode", zh: "交互模式" }, body: { en: "Vague input or open approach → clarify, discuss and converge before designing.", zh: "输入模糊或方向开放 → 先澄清、讨论、收敛，再设计。" } },
        { tag: "B", title: { en: "Non-interactive mode", zh: "非交互模式" }, body: { en: "<code>--from-file</code>, <code>--from-idea</code> or high-confidence input skips questions and writes planned stories.", zh: "<code>--from-file</code>、<code>--from-idea</code> 或高置信输入跳过提问，直接写规划故事。" } }
      ],
      merge: { en: "▼ both converge on the shared design pipeline ▼", zh: "▼ 殊途同归：共享设计流水线 ▼" },
      bands: [
        { key: "plan", label: { en: "Clarify", zh: "澄清" }, steps: [
          { no: "STEP 0", title: { en: "Pre-clarify localization", zh: "Pre-clarify 定位" }, desc: { en: "Internally pin product surface, user role and business domain so known facts do not become open questions.", zh: "内部锁定产品端、角色与业务域；已知事实不再当开放问题问。" } },
          { no: "STEP 1", title: { en: "Clarify when vague", zh: "输入模糊时澄清" }, desc: { en: "Summarize intent, assess complexity, ask targeted questions, then wait for the reply.", zh: "复述意图、评估复杂度、问针对性问题，然后等待回复。" } },
          { no: "PEER 1", title: { en: "Direction review", zh: "方向评审" }, desc: { en: "Medium or cross-context direction gets a cross-agent challenge before modeling.", zh: "中等复杂度或跨上下文方向，在建模前做跨 agent 挑战。" }, gate: true, chips: ["10s opt-out"] }
        ] },
        { key: "build", label: { en: "Model", zh: "建模" }, steps: [
          { no: "STEP 2", title: { en: "DDD depth dial", zh: "DDD 深度拨盘" }, desc: { en: "Greenfield gets full modeling; a story gets a bounded-context slice; a fix only gets a context tag.", zh: "新项目全量建模；故事做 bounded context 切片；修复只标 context。" } },
          { no: "STEP 2a", title: { en: "Strategic modeling when needed", zh: "必要时战略建模" }, desc: { en: "Event storming, context map and ubiquitous language are used when the domain risk warrants them.", zh: "领域风险足够时使用事件风暴、context map 与统一语言。" } }
        ] },
        { key: "ship", label: { en: "Design", zh: "设计" }, steps: [
          { no: "STEP 3", title: { en: "Detailed solution design", zh: "详细方案设计" }, desc: { en: "Produce schemas, worked samples, interface signatures, mapping rules and edge cases before any decomposition.", zh: "拆解前必须产出 schema、完整样例、接口签名、映射规则与边界情况。" }, gate: true },
          { no: "PEER 2", title: { en: "Plan review", zh: "方案评审" }, desc: { en: "Medium/large designs receive peer review before splitting.", zh: "中大型方案在拆分前接受同行评审。" }, gate: true, chips: ["review"] }
        ] },
        { key: "verify", label: { en: "Decompose", zh: "拆解" }, steps: [
          { no: "STEP 4", title: { en: "Split into INVEST stories", zh: "拆成 INVEST 故事" }, desc: { en: "Only slice the agreed design into backlog/spec artifacts; do not implement.", zh: "只把已认可方案切成 backlog/spec 产物；不实现。" } }
        ] }
      ]
    },
    {
      id: "roll-build",
      name: "$roll-build",
      title: { en: "Universal Delivery", zh: "通用交付" },
      sub: { en: "One entry. Any input. Full delivery.", zh: "一个入口，任意输入，完整交付。" },
      lede: {
        en: "Take one request from story id or vague sentence through a <b>reversible, test-guarded, evidence-landing</b> pipeline to merged-on-main.",
        zh: "把一条需求从 story 编号或模糊一句话，经一条<b>可逆、测试守护、证据落地</b>的流水线送到合入主干。"
      },
      href: "roll-build-skill.html",
      modes: [
        { tag: "A", title: { en: "Story mode", zh: "Story 模式" }, body: { en: "Input is <code>US-XXX</code> → read backlog, split actions and execute TCR.", zh: "输入是 <code>US-XXX</code> → 读 backlog、拆 action、执行 TCR。" } },
        { tag: "B", title: { en: "Fly mode", zh: "Fly 模式" }, body: { en: "One sentence → clarify, design, create the US, then switch to Story mode.", zh: "一句话 → 澄清、设计、创建 US，再切回 Story 模式。" } }
      ],
      merge: { en: "▼ both converge on the shared TCR pipeline ▼", zh: "▼ 殊途同归：共享 TCR 流水线 ▼" },
      bands: [
        { key: "plan", label: { en: "Plan", zh: "规划" }, steps: [
          { no: "STEP 0", title: { en: "Pre-flight self-check", zh: "Pre-flight 自检" }, desc: { en: "Use estimate and chain depth to decide whether this cycle can close, or self-downgrade into smaller stories.", zh: "用估时与 chain depth 判断本轮能否闭环；过大则自降级拆成更小故事。" } },
          { no: "STEP 1-3", title: { en: "Read story, split actions, define verification", zh: "读故事、拆 action、定义验证" }, desc: { en: "Actions stay small, directly executable and tied to a test/online verification matrix.", zh: "Action 保持小、可直接执行，并绑定测试/在线验证矩阵。" } }
        ] },
        { key: "build", label: { en: "Build", zh: "构建" }, steps: [
          { no: "PHASE 3.5", title: { en: "Peer review gate", zh: "同行评审闸" }, desc: { en: "Risky or cross-module plans trigger cross-agent review before implementation.", zh: "高风险或跨模块方案在实现前触发跨 agent 评审。" }, gate: true },
          { no: "PHASE 5", title: { en: "TCR implementation loop", zh: "TCR 实现循环" }, desc: { en: "Write failing tests, make minimal code, green commits, red reverts.", zh: "先写失败测试、最小实现，绿则提交、红则回退。" }, loop: true, chips: ["Test && Commit || Revert"] }
        ] },
        { key: "ship", label: { en: "Ship", zh: "交付" }, steps: [
          { no: "PHASE 6", title: { en: "Pre-push CI gate", zh: "推前 CI 闸" }, desc: { en: "Run the full local suite before push; never push red.", zh: "推送前跑完整本地套件；绝不带红推送。" }, gate: true },
          { no: "PHASE 8-9", title: { en: "PR, CI and merge", zh: "PR、CI 与合并" }, desc: { en: "Worktree-first branch, PR, green CI, merge to main. Done means merged.", zh: "worktree-first 分支、PR、CI 绿、合入 main。Done 即已合并。" } }
        ] },
        { key: "verify", label: { en: "Verify", zh: "验证" }, steps: [
          { no: "PHASE 10.5", title: { en: "Fresh evidence gate", zh: "新鲜证据闸" }, desc: { en: "Before Done, tests/build/runtime verification evidence must be freshly produced in-session.", zh: "翻 Done 前，测试/构建/运行时验证证据必须是本会话新鲜产出。" }, gate: true },
          { no: "PHASE 10.6", title: { en: "Acceptance evidence deposit", zh: "验收证据落地" }, desc: { en: "Map ACs to evidence, render report and refresh the delivery dossier.", zh: "把 AC 映射到证据、渲染报告并刷新交付档案。" } }
        ] }
      ]
    },
    {
      id: "roll-idea",
      name: "$roll-idea",
      title: { en: "One-Liner Capture", zh: "一行捕获" },
      sub: { en: "Classify. Number. Append. Stop.", zh: "分类、编号、追加，然后停止。" },
      lede: {
        en: "Capture a short idea or bug note without expanding it into a design session. The skill reads backlog, assigns the next <b>IDEA</b> or <b>FIX</b> id, appends one row, and reports where it landed.",
        zh: "捕获一句想法或缺陷记录，不展开成设计会。本技能读取 backlog，分配下一个 <b>IDEA</b> 或 <b>FIX</b> 编号，追加一行，并报告落点。"
      },
      modes: [
        { tag: "I", title: { en: "Idea", zh: "想法" }, body: { en: "Feature or improvement note → append to <code>Ideas</code>.", zh: "功能或改进想法 → 追加到 <code>Ideas</code>。" } },
        { tag: "F", title: { en: "Bug", zh: "缺陷" }, body: { en: "Broken behavior or regression language → append to <code>Bug Fixes</code> as <code>FIX-NNN</code>.", zh: "破损行为或回归描述 → 以 <code>FIX-NNN</code> 追加到 <code>Bug Fixes</code>。" } }
      ],
      merge: { en: "▼ both are intentionally shallow backlog capture ▼", zh: "▼ 两者都只是浅层 backlog 捕获 ▼" },
      bands: [
        { key: "plan", label: { en: "Read", zh: "读取" }, steps: [
          { no: "STEP 1", title: { en: "Open .roll/backlog.md", zh: "打开 .roll/backlog.md" }, desc: { en: "The existing backlog is the numbering source of truth. Missing backlog is a loud error.", zh: "现有 backlog 是编号真相来源。缺少 backlog 时明确报错停止。" } }
        ] },
        { key: "build", label: { en: "Classify", zh: "分类" }, steps: [
          { no: "STEP 2", title: { en: "Bug or idea", zh: "缺陷或想法" }, desc: { en: "Defect language such as broken behavior, regression, bug, missing or wrong behavior maps to <code>FIX</code>; otherwise <code>IDEA</code>.", zh: "破损、回归、bug、缺失或错误行为归为 <code>FIX</code>；其他归为 <code>IDEA</code>。" } },
          { no: "STEP 3", title: { en: "Assign next id", zh: "分配下一个编号" }, desc: { en: "Scan existing rows and allocate the next stable <code>FIX-NNN</code> or <code>IDEA-NNN</code>.", zh: "扫描现有行，分配下一个稳定的 <code>FIX-NNN</code> 或 <code>IDEA-NNN</code>。" } }
        ] },
        { key: "ship", label: { en: "Append", zh: "追加" }, steps: [
          { no: "STEP 4", title: { en: "Append exactly one row", zh: "只追加一行" }, desc: { en: "Create the Ideas section if needed, update stats if present, and never rewrite existing entries.", zh: "需要时创建 Ideas 段，存在统计行则更新；绝不改写已有条目。" }, gate: true }
        ] },
        { key: "verify", label: { en: "Report", zh: "报告" }, steps: [
          { no: "OUTPUT", title: { en: "Return id, type, table and text", zh: "返回编号、类型、表和原文" }, desc: { en: "Vague notes are recorded verbatim with a pending-detail marker rather than clarified.", zh: "模糊记录照原文入库，并标记细节待确认，而不是追问。" } }
        ] }
      ]
    },
    {
      id: "roll-fix",
      name: "$roll-fix",
      title: { en: "Focused Repair Workflow", zh: "聚焦修复流" },
      sub: { en: "Reproduce. Test. Patch. Prove.", zh: "复现、写测、修补、证明。" },
      lede: {
        en: "A lighter TCR path for narrow <b>FIX</b> or <b>BUG</b> work. It keeps the same green gates as delivery, but centers on root cause and a regression signal.",
        zh: "面向窄范围 <b>FIX</b> 或 <b>BUG</b> 的轻量 TCR 路径。它保留交付的绿色门禁，但核心是根因与回归信号。"
      },
      modes: [
        { tag: "FIX", title: { en: "Backlog fix", zh: "Backlog 修复" }, body: { en: "Input is a <code>FIX-NNN</code> or <code>BUG-NNN</code> item with context to read.", zh: "输入是带上下文可读取的 <code>FIX-NNN</code> 或 <code>BUG-NNN</code>。" } },
        { tag: "HOT", title: { en: "Focused hotfix", zh: "聚焦热修" }, body: { en: "A narrow bug report can enter directly when broad feature delivery is unnecessary.", zh: "窄范围缺陷可直接进入，无需走完整 feature 交付。" } }
      ],
      merge: { en: "▼ both converge on regression-first TCR ▼", zh: "▼ 两者都汇入回归信号优先的 TCR ▼" },
      bands: [
        { key: "plan", label: { en: "Diagnose", zh: "诊断" }, steps: [
          { no: "STEP 1", title: { en: "Read fix row and context", zh: "读取修复项与上下文" }, desc: { en: "Start from the FIX/BUG row, linked files and failure context.", zh: "从 FIX/BUG 行、关联文件与失败上下文开始。" } },
          { no: "STEP 2", title: { en: "Reproduce or explain why not", zh: "复现或说明无法复现原因" }, desc: { en: "A repair needs a concrete failure signal. If local reproduction is impossible, document the exception explicitly.", zh: "修复需要具体失败信号。若本地无法复现，必须明确记录例外原因。" }, gate: true }
        ] },
        { key: "build", label: { en: "Repair", zh: "修复" }, steps: [
          { no: "STEP 3", title: { en: "Write failing regression test first", zh: "先写失败回归测试" }, desc: { en: "Lock the bug with a failing test or an approved alternate regression signal.", zh: "用失败测试锁住 bug，或使用已说明的替代回归信号。" }, chips: ["RED"] },
          { no: "STEP 4", title: { en: "Patch through TCR", zh: "通过 TCR 修补" }, desc: { en: "Minimal patch, focused test, local CI checks. Red means another repair micro-step.", zh: "最小补丁、聚焦测试、本地 CI 检查。红则进入下一修复微步。" }, chips: ["green = keep"] }
        ] },
        { key: "ship", label: { en: "Review", zh: "评审" }, steps: [
          { no: "STEP 5", title: { en: "Self-review and blocking findings", zh: "自检与阻塞项处理" }, desc: { en: "Blocking review findings are fixed in another TCR cycle, not waved through.", zh: "阻塞性评审发现必须再走一轮 TCR 修掉，不能放过。" } }
        ] },
        { key: "verify", label: { en: "Evidence", zh: "证据" }, steps: [
          { no: "DONE", title: { en: "Backlog, evidence and PR", zh: "Backlog、证据与 PR" }, desc: { en: "Update repair evidence, keep docs aligned for user-visible changes, and open the PR.", zh: "更新修复证据；若用户可见行为变了，同步文档；最后开 PR。" } }
        ] }
      ]
    },
    {
      id: "roll-debug",
      name: "$roll-debug",
      title: { en: "Black-Box Browser Diagnostics", zh: "黑盒浏览器诊断" },
      sub: { en: "Probe. Trace. Fix only owned causes.", zh: "探针、追踪，只修项目自有根因。" },
      lede: {
        en: "Attach to a web page, mount a temporary Black Box probe, collect runtime evidence, and only patch source-traceable project-owned issues. External faults stay attributed, not hidden.",
        zh: "接入网页，临时挂载 Black Box 探针，收集运行时证据，只修可追溯到项目源码的自有问题。外部故障要归因，不掩盖。"
      },
      modes: [
        { tag: "PAGE", title: { en: "Live page issue", zh: "页面现场问题" }, body: { en: "Use when a web page needs console, network, DOM, storage and state capture.", zh: "页面需要 console、network、DOM、storage 与状态采集时使用。" } },
        { tag: "NOT", title: { en: "Not a static scan", zh: "不是静态扫描" }, body: { en: "Architecture drift goes to Dream; general code review goes to review skills.", zh: "架构漂移交给 Dream；通用代码评审交给 review 类技能。" } }
      ],
      merge: { en: "▼ diagnostics lead fixes, not guesses ▼", zh: "▼ 诊断证据驱动修复，不靠猜 ▼" },
      bands: [
        { key: "plan", label: { en: "Attach", zh: "接入" }, steps: [
          { no: "STEP 1", title: { en: "Open or attach to target page", zh: "打开或接入目标页面" }, desc: { en: "Start from observed runtime behavior, not source assumptions.", zh: "从观察到的运行时行为开始，而不是源码假设。" } }
        ] },
        { key: "build", label: { en: "Probe", zh: "探针" }, steps: [
          { no: "STEP 2", title: { en: "Mount Black Box probe", zh: "挂载 Black Box 探针" }, desc: { en: "Collect console errors, network failures, DOM signals, storage and app state while the issue reproduces.", zh: "问题复现时采集 console 错误、网络失败、DOM 信号、storage 和应用状态。" }, chips: ["temporary"] },
          { no: "STEP 3", title: { en: "Trace root cause", zh: "追踪根因" }, desc: { en: "Separate project-owned source causes from external services, browser environment and data conditions.", zh: "区分项目源码自有根因、外部服务、浏览器环境与数据条件。" } }
        ] },
        { key: "ship", label: { en: "Fix", zh: "修复" }, steps: [
          { no: "STEP 4", title: { en: "Patch only owned causes", zh: "只修自有根因" }, desc: { en: "If source-traceable, patch through normal engineering gates. If not, report attribution and evidence.", zh: "可追溯到源码则按正常工程门禁修；否则报告归因与证据。" }, gate: true }
        ] },
        { key: "verify", label: { en: "Clean", zh: "清理" }, steps: [
          { no: "STEP 5", title: { en: "Unmount probe and report", zh: "卸载探针并报告" }, desc: { en: "Cleanup is mandatory. Final evidence should show diagnostics, fix and absence of leftover probe state.", zh: "清理是硬要求。最终证据需说明诊断、修复与没有遗留探针状态。" }, gate: true }
        ] }
      ]
    },
    {
      id: "roll-doc",
      name: "$roll-doc",
      title: { en: "Documentation Inventory and Drafting", zh: "文档盘点与补齐" },
      sub: { en: "Scan. Index. Detect gaps. Draft from code.", zh: "扫描、建索引、找缺口、基于代码补文档。" },
      lede: {
        en: "Inventory documentation, generate <code>docs/INDEX.md</code>, detect undocumented modules, and draft fills from source evidence. It is a documentation tool, not a presentation generator.",
        zh: "盘点文档、生成 <code>docs/INDEX.md</code>、识别未文档化模块，并从源码证据起草补全文档。它是文档工具，不是演示稿生成器。"
      },
      modes: [
        { tag: "INV", title: { en: "Inventory", zh: "盘点" }, body: { en: "Map docs and code surfaces into an indexable structure.", zh: "把文档与代码表面整理为可索引结构。" } },
        { tag: "FILL", title: { en: "Draft fills", zh: "起草补齐" }, body: { en: "Write missing docs only from current code evidence.", zh: "只基于当前代码证据补齐缺失文档。" } }
      ],
      merge: { en: "▼ docs stay linked to real source behavior ▼", zh: "▼ 文档始终锚定真实源码行为 ▼" },
      bands: [
        { key: "plan", label: { en: "Scan", zh: "扫描" }, steps: [
          { no: "STEP 1", title: { en: "Scan docs and code surfaces", zh: "扫描文档与代码表面" }, desc: { en: "Find existing docs, modules, public entry points and README-level promises.", zh: "找出现有文档、模块、公共入口与 README 层承诺。" } }
        ] },
        { key: "build", label: { en: "Index", zh: "建索引" }, steps: [
          { no: "STEP 2", title: { en: "Generate or update docs/INDEX.md", zh: "生成或更新 docs/INDEX.md" }, desc: { en: "Keep docs navigable and linked so future agents can find the right source quickly.", zh: "让文档可导航、可链接，后续 agent 能快速找到正确来源。" } },
          { no: "STEP 3", title: { en: "Identify undocumented modules", zh: "识别未文档化模块" }, desc: { en: "Gap detection is evidence-based; filenames alone are not behavior.", zh: "缺口识别基于证据；文件名本身不等于行为。" }, gate: true }
        ] },
        { key: "ship", label: { en: "Draft", zh: "起草" }, steps: [
          { no: "STEP 4", title: { en: "Draft from source evidence", zh: "基于源码证据起草" }, desc: { en: "Summaries, usage notes and module docs must trace to current code, tests or existing docs.", zh: "摘要、用法说明与模块文档必须能追溯到当前代码、测试或现有文档。" } }
        ] },
        { key: "verify", label: { en: "Keep Honest", zh: "保持真实" }, steps: [
          { no: "GATE", title: { en: "No invented behavior", zh: "不编造行为" }, desc: { en: "If behavior cannot be evidenced, leave it out or mark it as unknown.", zh: "无法从证据确认的行为，宁可不写或标未知。" }, gate: true }
        ] }
      ]
    },
    {
      id: "roll-doctor",
      name: "$roll-doctor",
      title: { en: "Roll Toolchain Health", zh: "Roll 工具链体检" },
      sub: { en: "Check install, skills, conventions and links.", zh: "检查安装、skills、约定与链接。" },
      lede: {
        en: "Diagnose why Roll itself is not working: installation layout, skill frontmatter, convention sync, symlink integrity, templates and config validity. Doctor fails loud on broken contracts.",
        zh: "诊断 Roll 自身为什么不工作：安装结构、skill frontmatter、约定同步、symlink 完整性、模板与配置有效性。Doctor 对破损契约要响亮失败。"
      },
      modes: [
        { tag: "ROLL", title: { en: "Roll malfunction", zh: "Roll 异常" }, body: { en: "Use when skills, conventions, sync or CLI setup looks broken.", zh: "skills、约定、同步或 CLI 安装看起来坏了时使用。" } },
        { tag: "NOT", title: { en: "Not content editing", zh: "不负责改内容" }, body: { en: "Doctor diagnoses; changing skill content still belongs to roll-skills maintenance.", zh: "Doctor 负责诊断；修改 skill 内容仍属于 roll-skills 维护。" } }
      ],
      merge: { en: "▼ health checks make broken contracts visible ▼", zh: "▼ 体检让破损契约可见 ▼" },
      bands: [
        { key: "plan", label: { en: "Install", zh: "安装" }, steps: [
          { no: "CHECK 1", title: { en: "ROLL_HOME structure", zh: "ROLL_HOME 结构" }, desc: { en: "Verify <code>~/.roll</code>, skills, conventions and templates are present.", zh: "确认 <code>~/.roll</code>、skills、conventions 与 templates 存在。" } }
        ] },
        { key: "build", label: { en: "Skills", zh: "Skills" }, steps: [
          { no: "CHECK 2", title: { en: "Skill health and audit", zh: "Skill 健康与审计" }, desc: { en: "Each skill needs readable <code>SKILL.md</code>, valid frontmatter, descriptions and route cases. Strict audit catches drift.", zh: "每个 skill 需要可读 <code>SKILL.md</code>、有效 frontmatter、描述与路由用例。严格审计捕获漂移。" }, gate: true },
          { no: "CHECK 3", title: { en: "Symlink integrity", zh: "Symlink 完整性" }, desc: { en: "Claude, Gemini/Antigravity, Trae and other surfaces should point to valid skill targets.", zh: "Claude、Gemini/Antigravity、Trae 等表面应指向有效 skill 目标。" } }
        ] },
        { key: "ship", label: { en: "Conventions", zh: "约定" }, steps: [
          { no: "CHECK 4", title: { en: "Convention sync", zh: "约定同步" }, desc: { en: "Compare global convention files and agent includes such as <code>@roll.md</code>.", zh: "对比全局约定文件与 <code>@roll.md</code> 等 agent include。" } },
          { no: "CHECK 5", title: { en: "Template and config validity", zh: "模板与配置有效性" }, desc: { en: "Check project templates, new-project template and Roll config shape.", zh: "检查项目模板、新项目模板与 Roll 配置形态。" } }
        ] },
        { key: "verify", label: { en: "Verdict", zh: "结论" }, steps: [
          { no: "REPORT", title: { en: "Fail loud with exact evidence", zh: "带精确证据响亮失败" }, desc: { en: "Broken contracts should be visible with commands, paths and remediation hints.", zh: "破损契约应带命令、路径与修复提示清楚可见。" } }
        ] }
      ]
    },
    {
      id: "roll-peer",
      name: "$roll-peer",
      title: { en: "Cross-Agent Negotiation", zh: "跨 Agent 协商" },
      sub: { en: "Challenge high-risk decisions with a bounded peer.", zh: "用有界 peer 挑战高风险决策。" },
      lede: {
        en: "Invoke an external agent perspective when explicitly requested or required by a documented gate. It records consensus, disagreement and unresolved questions, but does not override local evidence.",
        zh: "在用户明确要求或文档化门禁要求时，引入外部 agent 视角。它记录共识、分歧与未解问题，但不覆盖本地证据。"
      },
      modes: [
        { tag: "ASK", title: { en: "Explicit request", zh: "明确请求" }, body: { en: "User asks for peer review, negotiation or <code>/peer</code>.", zh: "用户要求 peer review、协商或 <code>/peer</code>。" } },
        { tag: "GATE", title: { en: "Documented gate", zh: "文档化门禁" }, body: { en: "A build/design workflow requires peer review because risk or architecture scope is high.", zh: "构建/设计流程因风险或架构范围较高而要求 peer 评审。" } }
      ],
      merge: { en: "▼ peer advice enters local gates, not the other way around ▼", zh: "▼ peer 建议进入本地门禁，而不是反过来覆盖门禁 ▼" },
      bands: [
        { key: "plan", label: { en: "Authorize", zh: "授权" }, steps: [
          { no: "STEP 1", title: { en: "Confirm peer is allowed", zh: "确认允许 peer" }, desc: { en: "Do not spawn subagents unless explicitly requested or required by an established gate and tool availability.", zh: "除非明确请求或既有门禁要求且工具可用，否则不启动子 agent。" }, gate: true }
        ] },
        { key: "build", label: { en: "Route", zh: "路由" }, steps: [
          { no: "STEP 2", title: { en: "Select external perspective", zh: "选择外部视角" }, desc: { en: "Route to an appropriate different agent or review surface for the decision at hand.", zh: "为当前决策路由到合适的不同 agent 或评审表面。" } },
          { no: "STEP 3", title: { en: "Run bounded rounds", zh: "运行有界轮次" }, desc: { en: "Negotiate within fixed rounds, usually propose, challenge and refine.", zh: "在固定轮次内协商，通常是提案、挑战、精炼。" }, chips: ["bounded"] }
        ] },
        { key: "ship", label: { en: "Record", zh: "记录" }, steps: [
          { no: "STEP 4", title: { en: "Record consensus and dissent", zh: "记录共识与分歧" }, desc: { en: "Capture agreement, objections and unresolved questions with enough context for the owner.", zh: "捕获同意、反对与未解问题，给 owner 足够上下文。" } }
        ] },
        { key: "verify", label: { en: "Escalate", zh: "升级" }, steps: [
          { no: "STEP 5", title: { en: "Escalate when consensus fails", zh: "无法达成共识时升级" }, desc: { en: "Owner decisions, tests and local evidence remain authoritative.", zh: "owner 决策、测试与本地证据仍是权威。" }, gate: true }
        ] }
      ]
    },
    {
      id: "roll-review-pr",
      name: "$roll-review-pr",
      title: { en: "Pull Request Review", zh: "Pull Request 评审" },
      sub: { en: "Diff-grounded findings and one verdict.", zh: "基于 diff 的发现与单一判定。" },
      lede: {
        en: "Review a pull request diff for correctness, security, conventions and scope. The output ends with exactly one verdict: <code>APPROVE</code>, <code>REQUEST_CHANGES</code> or <code>UNCERTAIN</code>.",
        zh: "评审 PR diff 的正确性、安全、约定与范围。输出最后必须只有一个判定：<code>APPROVE</code>、<code>REQUEST_CHANGES</code> 或 <code>UNCERTAIN</code>。"
      },
      modes: [
        { tag: "PR", title: { en: "PR diff review", zh: "PR diff 评审" }, body: { en: "Input includes title, body and diff. Findings cite files and lines.", zh: "输入包含标题、正文与 diff。发现需引用文件和行号。" } },
        { tag: "SKIP", title: { en: "Skip marker", zh: "跳过标记" }, body: { en: "<code>[skip-ai-review]</code> immediately approves without analysis.", zh: "<code>[skip-ai-review]</code> 立即 approve，不做分析。" } }
      ],
      merge: { en: "▼ review ends in exactly one machine-readable verdict ▼", zh: "▼ 评审以一个机器可读判定结束 ▼" },
      bands: [
        { key: "plan", label: { en: "Read", zh: "读取" }, steps: [
          { no: "STEP 1", title: { en: "Read title, body and diff", zh: "读取标题、正文与 diff" }, desc: { en: "Check the claimed scope against actual changed files.", zh: "把声明范围与实际改动文件对账。" } }
        ] },
        { key: "build", label: { en: "Analyze", zh: "分析" }, steps: [
          { no: "STEP 2", title: { en: "Correctness, security, conventions, scope", zh: "正确性、安全、约定、范围" }, desc: { en: "Prioritize real defects and missing evidence over style preferences.", zh: "优先真实缺陷与缺失证据，而非风格偏好。" }, gate: true },
          { no: "STEP 3", title: { en: "Write concise findings", zh: "写出简洁发现" }, desc: { en: "Use 2-10 sentences and cite concrete file/line references for issues.", zh: "用 2-10 句说明，并为问题引用具体文件/行。" } }
        ] },
        { key: "ship", label: { en: "Verdict", zh: "判定" }, steps: [
          { no: "FOOTER", title: { en: "Emit one footer", zh: "输出一个 footer" }, desc: { en: "The final non-empty line is exactly one verdict footer.", zh: "最后一个非空行必须正好是一个 verdict footer。" }, gate: true, chips: ["APPROVE", "REQUEST_CHANGES", "UNCERTAIN"] }
        ] },
        { key: "verify", label: { en: "When unsure", zh: "不确定时" }, steps: [
          { no: "RULE", title: { en: "Prefer UNCERTAIN over weak approval", zh: "宁可 UNCERTAIN，不弱 approve" }, desc: { en: "Missing context or domain uncertainty should not become approval by silence.", zh: "缺上下文或领域不确定时，不能用沉默来 approve。" } }
        ] }
      ]
    }
  ],
  existing: [],
  overview: {
    title: { en: "Roll Skills System Map", zh: "Roll Skills 全景图" },
    sub: { en: "The skill layer as Roll's delivery control loop.", zh: "把 skill 层放回 Roll 的交付控制闭环里。" },
    lede: {
      en: "This map shows how Roll skills move work from Backlog wishes to main-branch truth, then feed evidence, alerts and owner decisions back into the next cycle.",
      zh: "这张图展示 Roll skills 如何把 Backlog 里的愿望推进到 main 上的真相，再把证据、告警与 owner 决策反哺到下一轮 cycle。"
    }
  }
};
