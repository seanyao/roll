---
template: introduction-v3
slug: roll-introduction-v3
title_en: "ROLL — AI Agent Engineering Delivery Framework"
title_zh: "ROLL — AI Agent 工程化交付框架"
total_slides: 18
created: 2026-05-21
---

## Slide 0
title_en: "Cover"
title_zh: "封面"
is_cover: true
body_en: |
  <div class="fade-in" style="margin-bottom: 16px;">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="60 40 280 140" width="280" height="140">
      <text x="200" y="130" font-family="'Helvetica Neue',Helvetica,Arial,sans-serif" font-size="96" font-weight="300" letter-spacing="-4" fill="currentColor" text-anchor="middle">roll</text>
      <text x="200" y="168" font-family="'Helvetica Neue',Helvetica,Arial,sans-serif" font-size="13" font-weight="300" letter-spacing="1" fill="var(--text-dim)" text-anchor="middle">it just works.</text>
    </svg>
  </div>
  <p class="subtitle fade-in" style="font-size: 22px; color: var(--text); font-weight: 500; margin-bottom: 6px;">AI Agent Engineering Delivery Framework</p>
  <p class="subtitle fade-in" style="font-size: 15px;">Roll out features with AI agents — move fast, no sprints.</p>
  <div class="fade-in" style="margin-top: 36px;">
    <p style="font-size: 12px; color: var(--text-dim);">@seanyao/roll · 2026</p>
  </div>
body_zh: |
  <div class="fade-in" style="margin-bottom: 16px;">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="60 40 280 140" width="280" height="140">
      <text x="200" y="130" font-family="'Helvetica Neue',Helvetica,Arial,sans-serif" font-size="96" font-weight="300" letter-spacing="-4" fill="currentColor" text-anchor="middle">roll</text>
      <text x="200" y="168" font-family="'Helvetica Neue',Helvetica,Arial,sans-serif" font-size="13" font-weight="300" letter-spacing="1" fill="var(--text-dim)" text-anchor="middle">it just works.</text>
    </svg>
  </div>
  <p class="subtitle fade-in" style="font-size: 22px; color: var(--text); font-weight: 500; margin-bottom: 6px;">AI Agent 工程化交付框架</p>
  <p class="subtitle fade-in" style="font-size: 15px;">用 AI Agent 把功能滚出来 — 快速交付，无须排迭代。</p>
  <div class="fade-in" style="margin-top: 36px;">
    <p style="font-size: 12px; color: var(--text-dim);">@seanyao/roll · 2026</p>
  </div>

## Slide 1
title_en: "A Shift Is Happening"
title_zh: "一场变化正在发生"
body_en: |
  <span class="tag fade-in">Context</span>
  <h2 class="fade-in">A Shift Is Happening</h2>
  <p class="section-desc fade-in">AI coding tools have evolved from "auto-completing a few lines" to "delivering whole features." The developer's role is shifting from <strong>writing code</strong> to <strong>directing AI</strong>.</p>
  <div class="cards cards-2 fade-in" style="margin-top: 8px;">
    <div class="card">
      <h3 style="font-size:16px;">Before: Humans Write Code</h3>
      <p>Developers write every line themselves. Quality depends on individual skill. Companies constrain people through <strong>architecture standards, code reviews, QA processes</strong>.</p>
    </div>
    <div class="card">
      <h3 style="font-size:16px;">Now: AI Writes Code, Humans Decide</h3>
      <p>AI handles the actual coding. With the same tool and the same model, <strong>different people get dramatically different results</strong>.</p>
    </div>
  </div>
  <div class="quote-block fade-in" style="margin-top: 16px;">
    <p>The problem isn't "which AI tool to use" — just pick one and standardize. The real question is: <strong>why does the same tool produce great results for some and garbage for others?</strong></p>
  </div>
body_zh: |
  <span class="tag fade-in">背景</span>
  <h2 class="fade-in">一场变化正在发生</h2>
  <p class="section-desc fade-in">AI 编程工具已经从「自动补几行」演化到「交付整个功能」。开发者的角色正在从<strong>写代码</strong>转向<strong>指挥 AI</strong>。</p>
  <div class="cards cards-2 fade-in" style="margin-top: 8px;">
    <div class="card">
      <h3 style="font-size:16px;">从前：人写代码</h3>
      <p>每一行都是人写的。质量取决于个人水平。公司靠<strong>架构规范、代码评审、QA 流程</strong>来约束人。</p>
    </div>
    <div class="card">
      <h3 style="font-size:16px;">现在：AI 写代码，人做决策</h3>
      <p>AI 负责实际编码。同一工具、同一模型，<strong>不同的人拿到天差地别的结果</strong>。</p>
    </div>
  </div>
  <div class="quote-block fade-in" style="margin-top: 16px;">
    <p>问题不在「该用哪款 AI 工具」——选一个并统一即可。真正的问题是：<strong>同一个工具，为什么有人产出精品，有人产出垃圾？</strong></p>
  </div>

## Slide 2
title_en: "The Constraint System Hasn't Caught Up"
title_zh: "约束体系没跟上"
body_en: |
  <span class="tag fade-in">Core Problem</span>
  <h2 class="fade-in">The Constraint System Hasn't Caught Up</h2>
  <p class="section-desc fade-in">We used to have an entire system to constrain <em>people</em> — architecture, processes, reviews. AI is the primary executor now, but <strong>the constraint system for AI is almost nonexistent</strong>.</p>
  <div class="cards cards-2 fade-in" style="margin-top: 8px;">
    <div class="card" style="border-left: 3px solid var(--accent-light);">
      <h3 style="font-size:15px;">1. Architecture Constraints</h3>
      <p>AI doesn't know your architecture conventions, module boundaries, or forbidden zones. <strong>Different prompts = different outputs.</strong></p>
    </div>
    <div class="card" style="border-left: 3px solid var(--green);">
      <h3 style="font-size:15px;">2. Methodology as Code</h3>
      <p>Constraints must be <strong>built into the project</strong> so AI follows them automatically — not documents people read once.</p>
    </div>
  </div>
  <div class="highlight-box fade-in" style="margin-top: 20px;">
    <p><strong>ROLL solves a <em>people</em> problem.</strong> By baking constraints and methodology into the project, output quality is consistent <strong>regardless of who's driving</strong>.</p>
  </div>
body_zh: |
  <span class="tag fade-in">核心问题</span>
  <h2 class="fade-in">约束体系没跟上</h2>
  <p class="section-desc fade-in">过去整套体系都在约束<em>人</em>——架构、流程、评审。现在 AI 是主要执行者，但<strong>面向 AI 的约束体系几乎是空白</strong>。</p>
  <div class="cards cards-2 fade-in" style="margin-top: 8px;">
    <div class="card" style="border-left: 3px solid var(--accent-light);">
      <h3 style="font-size:15px;">1. 架构约束</h3>
      <p>AI 不了解你的架构规范、模块边界、禁区。<strong>不同 prompt = 不同输出。</strong></p>
    </div>
    <div class="card" style="border-left: 3px solid var(--green);">
      <h3 style="font-size:15px;">2. 方法论即代码</h3>
      <p>约束必须<strong>内建到项目里</strong>，让 AI 自动遵守——而不是人读过一遍就遗忘的文档。</p>
    </div>
  </div>
  <div class="highlight-box fade-in" style="margin-top: 20px;">
    <p><strong>ROLL 本质上解决的是「人」的问题。</strong>把约束和方法论嵌入项目，无论谁来开车，<strong>产出质量都保持一致</strong>。</p>
  </div>

## Slide 3
title_en: "What ROLL Actually Is"
title_zh: "ROLL 到底是什么"
body_en: |
  <span class="tag fade-in">Solution</span>
  <h2 class="fade-in">What ROLL Actually Is</h2>
  <p class="section-desc fade-in">An <strong>autonomous delivery system</strong> for software teams. AI agents pick stories from your BACKLOG, execute them with encoded engineering discipline, and ship continuously while you focus on <em>what to build next</em>.</p>
  <div class="cards cards-2 fade-in" style="max-width:880px;">
    <div class="card" style="border-left:3px solid var(--green);">
      <div style="font-size:26px;margin-bottom:6px;">🔄</div>
      <h3 style="font-size:15px;">Autonomous Delivery</h3>
      <p><code>roll loop on</code> runs BACKLOG items hourly. Dream scans code health nightly. <strong>Humans retain sole release authority</strong>.</p>
    </div>
    <div class="card" style="border-left:3px solid var(--accent-light);">
      <div style="font-size:26px;margin-bottom:6px;">🔧</div>
      <h3 style="font-size:15px;">Skill-Driven Execution</h3>
      <p>23 skills encode TDD, TCR, DDD, INVEST as <strong>repeatable workflows any agent can follow</strong>. Works with Claude, Cursor, Codex, Antigravity — swap the tool, keep the discipline.</p>
    </div>
  </div>
  <div class="analogy fade-in">
    <div class="analogy-label">In One Sentence</div>
    <p>ROLL turns a BACKLOG into shipped code continuously. Engineering practices are encoded as executable skills — <strong>reliable enough for an agent to run unattended, disciplined enough to ship production code</strong>.</p>
  </div>
body_zh: |
  <span class="tag fade-in">解法</span>
  <h2 class="fade-in">ROLL 到底是什么</h2>
  <p class="section-desc fade-in">一套面向研发团队的<strong>自主交付系统</strong>。AI Agent 从 BACKLOG 拣选 Story，按内建的工程纪律执行，持续交付——让你专注在<em>下一个该做什么</em>上。</p>
  <div class="cards cards-2 fade-in" style="max-width:880px;">
    <div class="card" style="border-left:3px solid var(--green);">
      <div style="font-size:26px;margin-bottom:6px;">🔄</div>
      <h3 style="font-size:15px;">自主交付</h3>
      <p><code>roll loop on</code> 每小时执行 BACKLOG。Dream 夜间扫描代码健康。<strong>发布权始终在人手里</strong>。</p>
    </div>
    <div class="card" style="border-left:3px solid var(--accent-light);">
      <div style="font-size:26px;margin-bottom:6px;">🔧</div>
      <h3 style="font-size:15px;">技能驱动执行</h3>
      <p>23 个 Skill 把 TDD、TCR、DDD、INVEST 编码为<strong>任何 Agent 都能执行的可重复工作流</strong>。Claude、Cursor、Codex、Antigravity 通用——换工具，留纪律。</p>
    </div>
  </div>
  <div class="analogy fade-in">
    <div class="analogy-label">一句话</div>
    <p>ROLL 持续把 BACKLOG 变成上线代码。工程实践被编码为可执行 Skill——<strong>可靠到 Agent 无人值守也能跑，严谨到能上生产</strong>。</p>
  </div>

## Slide 4
title_en: "The Delivery Pipeline"
title_zh: "完整的交付流水线"
body_en: |
  <span class="tag fade-in">Pipeline</span>
  <h2 class="fade-in">The Delivery Pipeline</h2>
  <p class="section-desc fade-in">From raw idea to production — five stages, three loops, one continuous flow.</p>
  <div class="pipeline-bar fade-in">
    <div class="pipe-stage pipe-idea">
      <h4>Idea</h4>
      <p>Raw thought<br>Anyone can submit</p>
    </div>
    <div class="pipe-arrow">→</div>
    <div class="pipe-stage pipe-backlog">
      <h4>Backlog</h4>
      <p>AC ready<br>Feature doc done</p>
    </div>
    <div class="pipe-arrow">→</div>
    <div class="pipe-stage pipe-build">
      <h4>Build</h4>
      <p>TCR micro-steps<br>Spar · Review · CI</p>
    </div>
    <div class="pipe-arrow">→</div>
    <div class="pipe-stage pipe-verify">
      <h4>Verify</h4>
      <p>Deploy to Test/UAT<br>Live evidence</p>
    </div>
    <div class="pipe-arrow">→</div>
    <div class="pipe-stage pipe-release">
      <h4>Release</h4>
      <p>Deploy to Prod<br>Sentinel takes over</p>
    </div>
  </div>
  <div class="loops-row fade-in">
    <div class="loop-pill la">
      <h5>Loop A · Think It Through</h5>
      <p>Idea → Backlog</p>
    </div>
    <div class="loop-pill lb">
      <h5>Loop B · Build It Right</h5>
      <p>Backlog → Verify</p>
    </div>
    <div class="loop-pill lc">
      <h5>Loop C · Keep Watch</h5>
      <p>Verify → Release → Patrol</p>
    </div>
  </div>
  <div class="fade-in" style="margin-top:12px;padding:8px 16px;border:1.5px dashed var(--red);border-radius:8px;max-width:620px;">
    <p style="font-size:12px;color:var(--red-text);text-align:center;font-weight:600;">↩ Loop C finds an issue → auto-creates new Idea → back to Pipeline</p>
  </div>
body_zh: |
  <span class="tag fade-in">交付流水线</span>
  <h2 class="fade-in">完整的交付流水线</h2>
  <p class="section-desc fade-in">从一个想法到生产环境——五个阶段、三个 Loop、一条持续流动的主线。</p>
  <div class="pipeline-bar fade-in">
    <div class="pipe-stage pipe-idea">
      <h4>Idea</h4>
      <p>原始想法<br>任何人可提</p>
    </div>
    <div class="pipe-arrow">→</div>
    <div class="pipe-stage pipe-backlog">
      <h4>Backlog</h4>
      <p>验收标准就绪<br>Feature 文档完成</p>
    </div>
    <div class="pipe-arrow">→</div>
    <div class="pipe-stage pipe-build">
      <h4>Build</h4>
      <p>TCR 微步<br>Spar · Review · CI</p>
    </div>
    <div class="pipe-arrow">→</div>
    <div class="pipe-stage pipe-verify">
      <h4>Verify</h4>
      <p>部署到测试/UAT<br>采集活证据</p>
    </div>
    <div class="pipe-arrow">→</div>
    <div class="pipe-stage pipe-release">
      <h4>Release</h4>
      <p>部署到生产<br>Sentinel 接管</p>
    </div>
  </div>
  <div class="loops-row fade-in">
    <div class="loop-pill la">
      <h5>Loop A · 想清楚</h5>
      <p>想法 → 待办</p>
    </div>
    <div class="loop-pill lb">
      <h5>Loop B · 做扎实</h5>
      <p>待办 → 验证</p>
    </div>
    <div class="loop-pill lc">
      <h5>Loop C · 盯住了</h5>
      <p>验证 → 发布 → 巡逻</p>
    </div>
  </div>
  <div class="fade-in" style="margin-top:12px;padding:8px 16px;border:1.5px dashed var(--red);border-radius:8px;max-width:620px;">
    <p style="font-size:12px;color:var(--red-text);text-align:center;font-weight:600;">↩ Loop C 发现问题 → 自动创建新 Idea → 重新进入流水线</p>
  </div>

## Slide 5
title_en: "Human × AI: Who Drives Each Phase?"
title_zh: "人机协作：每个阶段谁来开车"
body_en: |
  <span class="tag fade-in">Collaboration</span>
  <h2 class="fade-in">Human × AI: Who Drives Each Phase?</h2>
  <p class="section-desc fade-in">The two ends need human judgment. The middle runs on autopilot.</p>
  <div class="hai-bar fade-in">
    <div class="hai-zone hai-human">
      <div class="emoji">🧑‍💻 → 🤖</div>
      <h4>Human Asks AI</h4>
      <p>"Help me research this, break it into Stories"</p>
      <p style="margin-top:6px;font-size:10px;color:var(--accent-light);">Idea → Backlog</p>
    </div>
    <div class="hai-zone hai-ai">
      <div class="emoji">🤖 ⚡</div>
      <h4>AI Self-Drives</h4>
      <p>ROLL Loop auto-delivers. No babysitting needed.</p>
      <p style="margin-top:6px;font-size:10px;color:var(--green-text);">Backlog → Build → Verify</p>
    </div>
    <div class="hai-zone hai-push">
      <div class="emoji">🤖 → 🧑‍💻</div>
      <h4>AI Nudges Human</h4>
      <p>"UAT passed. Ship it?"</p>
      <p style="margin-top:6px;font-size:10px;color:var(--orange-text);">Verify → Release</p>
    </div>
  </div>
  <div class="highlight-box fade-in" style="margin-top: 20px;">
    <p><strong>The more automated the middle is, the more humans can focus on the two ends</strong> — deciding <em>what</em> to build and <em>when</em> to ship. These are judgment calls AI shouldn't make alone.</p>
  </div>
body_zh: |
  <span class="tag fade-in">协作</span>
  <h2 class="fade-in">人机协作：每个阶段谁来开车</h2>
  <p class="section-desc fade-in">两端需要人的判断，中间自动运行。</p>
  <div class="hai-bar fade-in">
    <div class="hai-zone hai-human">
      <div class="emoji">🧑‍💻 → 🤖</div>
      <h4>人找 AI</h4>
      <p>「帮我调研这个，拆成 Story」</p>
      <p style="margin-top:6px;font-size:10px;color:var(--accent-light);">Idea → Backlog</p>
    </div>
    <div class="hai-zone hai-ai">
      <div class="emoji">🤖 ⚡</div>
      <h4>AI 自驱</h4>
      <p>ROLL Loop 自动交付，无须看守。</p>
      <p style="margin-top:6px;font-size:10px;color:var(--green-text);">Backlog → Build → Verify</p>
    </div>
    <div class="hai-zone hai-push">
      <div class="emoji">🤖 → 🧑‍💻</div>
      <h4>AI 催人</h4>
      <p>「UAT 已通过，发布吗？」</p>
      <p style="margin-top:6px;font-size:10px;color:var(--orange-text);">Verify → Release</p>
    </div>
  </div>
  <div class="highlight-box fade-in" style="margin-top: 20px;">
    <p><strong>中间越自动，人就越能聚焦两端</strong>——决定<em>做什么</em>、<em>什么时候上线</em>。这两个判断 AI 不应该单独做。</p>
  </div>

## Slide 6
title_en: "Loop A: Think It Through"
title_zh: "Loop A：想清楚"
body_en: |
  <span class="tag fade-in" style="background:rgba(99,102,241,0.12);color:var(--accent-light);">Loop A</span>
  <h2 class="fade-in">Loop A: Think It Through</h2>
  <p class="section-desc fade-in">From vague idea to executable Backlog — powered by DDD and structured design.</p>
  <div class="timeline fade-in">
    <div class="timeline-item">
      <h4>1. DDD Domain Modeling</h4>
      <p>Establish Bounded Contexts, Ubiquitous Language, Context Maps. Ensure engineering speaks the same language as business.</p>
    </div>
    <div class="timeline-item">
      <h4>2. Research — $roll-research</h4>
      <p>HV Analysis: vertical traces full lifecycle, horizontal compares competitors. Cross-axis produces insights. Output: PDF report.</p>
    </div>
    <div class="timeline-item">
      <h4>3. Design — $roll-design</h4>
      <p>Solution exploration with DDD modeling, architecture decisions, interface definitions, data models. Explores multiple options before committing.</p>
    </div>
    <div class="timeline-item">
      <h4>4. Decompose + AC</h4>
      <p>Break into INVEST-compliant User Stories with acceptance criteria. Write to BACKLOG + features/. Each Story independently deliverable.</p>
    </div>
  </div>
  <div class="fade-in" style="margin-top: 14px; display: flex; gap: 8px; flex-wrap: wrap; justify-content: center;">
    <span class="skill-tag">$roll-research</span>
    <span class="skill-tag">$roll-design</span>
    <span class="skill-tag">$roll-idea</span>
    <span class="skill-tag">$roll-propose</span>
    <span class="skill-tag">$roll-.clarify</span>
    <span class="skill-tag">$roll-.echo</span>
  </div>
body_zh: |
  <span class="tag fade-in" style="background:rgba(99,102,241,0.12);color:var(--accent-light);">Loop A</span>
  <h2 class="fade-in">Loop A：想清楚</h2>
  <p class="section-desc fade-in">从模糊的想法到可执行的 Backlog——靠 DDD 和结构化设计驱动。</p>
  <div class="timeline fade-in">
    <div class="timeline-item">
      <h4>1. DDD 领域建模</h4>
      <p>建立限界上下文、统一语言、上下文映射。让工程和业务说同一种话。</p>
    </div>
    <div class="timeline-item">
      <h4>2. 调研 — $roll-research</h4>
      <p>HV 分析：纵轴梳理全生命周期，横轴对比竞品，交叉产出洞察。输出 PDF 报告。</p>
    </div>
    <div class="timeline-item">
      <h4>3. 设计 — $roll-design</h4>
      <p>用 DDD 建模、架构决策、接口定义、数据模型来做方案探索。落定前先比较多个方案。</p>
    </div>
    <div class="timeline-item">
      <h4>4. 拆分 + 验收标准</h4>
      <p>拆成符合 INVEST 的 User Story，每个带验收标准。写入 BACKLOG + features/。每个 Story 都能独立交付。</p>
    </div>
  </div>
  <div class="fade-in" style="margin-top: 14px; display: flex; gap: 8px; flex-wrap: wrap; justify-content: center;">
    <span class="skill-tag">$roll-research</span>
    <span class="skill-tag">$roll-design</span>
    <span class="skill-tag">$roll-idea</span>
    <span class="skill-tag">$roll-propose</span>
    <span class="skill-tag">$roll-.clarify</span>
    <span class="skill-tag">$roll-.echo</span>
  </div>

## Slide 7
title_en: "Backlog: The Single Source of Truth"
title_zh: "Backlog：唯一真相源"
body_en: |
  <span class="tag fade-in">Backlog</span>
  <h2 class="fade-in">Backlog: The Single Source of Truth</h2>
  <p class="section-desc fade-in">Everything flows through BACKLOG.md — four work item types, each with different Loop A depth.</p>
  <div class="cards cards-4 fade-in">
    <div class="card" style="border-left: 3px solid var(--accent-light);">
      <h3 style="font-size:14px;color:var(--accent-light);">User Story</h3>
      <p>Business features. Full Loop A: DDD → Research → Design → AC. The heaviest investment.</p>
      <p style="margin-top:6px;font-size:11px;color:var(--accent-light);">ID: US-XXX</p>
    </div>
    <div class="card" style="border-left: 3px solid var(--cyan);">
      <h3 style="font-size:14px;color:var(--cyan-text);">Refactor</h3>
      <p>Tech debt, architecture cleanup. Often surfaced by $roll-.dream nightly scans. Medium Loop A.</p>
      <p style="margin-top:6px;font-size:11px;color:var(--cyan-text);">ID: REFACTOR-XXX</p>
    </div>
    <div class="card" style="border-left: 3px solid var(--red);">
      <h3 style="font-size:14px;color:var(--red-text);">Fix</h3>
      <p>Bug fixes, Sentinel alerts, user reports. Light Loop A: locate root cause → AC. Fast path.</p>
      <p style="margin-top:6px;font-size:11px;color:var(--red-text);">ID: FIX-XXX</p>
    </div>
    <div class="card" style="border-left: 3px solid var(--orange);">
      <h3 style="font-size:14px;color:var(--orange-text);">Spike</h3>
      <p>Exploratory research. Loop A only — output is knowledge, not code. May spawn Stories or Refactors.</p>
      <p style="margin-top:6px;font-size:11px;color:var(--orange-text);">ID: SPIKE-XXX</p>
    </div>
  </div>
  <div class="analogy fade-in">
    <div class="analogy-label">Priority Order</div>
    <p>FIX (bugs first) > US (user value) > REFACTOR (tech debt). Automated by <strong>$roll-loop</strong> — the autonomous executor scans BACKLOG hourly and routes each item to the right skill.</p>
  </div>
body_zh: |
  <span class="tag fade-in">待办</span>
  <h2 class="fade-in">Backlog：唯一真相源</h2>
  <p class="section-desc fade-in">一切流经 BACKLOG.md——四种工作项类型，对应不同深度的 Loop A。</p>
  <div class="cards cards-4 fade-in">
    <div class="card" style="border-left: 3px solid var(--accent-light);">
      <h3 style="font-size:14px;color:var(--accent-light);">User Story</h3>
      <p>业务功能。完整 Loop A：DDD → 调研 → 设计 → AC。前期投入最重。</p>
      <p style="margin-top:6px;font-size:11px;color:var(--accent-light);">ID: US-XXX</p>
    </div>
    <div class="card" style="border-left: 3px solid var(--cyan);">
      <h3 style="font-size:14px;color:var(--cyan-text);">Refactor</h3>
      <p>技术债、架构改良。常由 $roll-.dream 夜间扫描产出。中等 Loop A。</p>
      <p style="margin-top:6px;font-size:11px;color:var(--cyan-text);">ID: REFACTOR-XXX</p>
    </div>
    <div class="card" style="border-left: 3px solid var(--red);">
      <h3 style="font-size:14px;color:var(--red-text);">Fix</h3>
      <p>Bug 修复、Sentinel 告警、用户反馈。轻量 Loop A：定位根因 → AC。快速通道。</p>
      <p style="margin-top:6px;font-size:11px;color:var(--red-text);">ID: FIX-XXX</p>
    </div>
    <div class="card" style="border-left: 3px solid var(--orange);">
      <h3 style="font-size:14px;color:var(--orange-text);">Spike</h3>
      <p>探索性研究。只走 Loop A——产出的是知识不是代码。可能催生新的 Story 或 Refactor。</p>
      <p style="margin-top:6px;font-size:11px;color:var(--orange-text);">ID: SPIKE-XXX</p>
    </div>
  </div>
  <div class="analogy fade-in">
    <div class="analogy-label">优先级顺序</div>
    <p>FIX（先修 bug）> US（用户价值）> REFACTOR（技术债）。由 <strong>$roll-loop</strong> 自动执行——每小时扫描 BACKLOG，路由到对应的 Skill。</p>
  </div>

## Slide 8
title_en: "TDD + TCR: The Build Rhythm"
title_zh: "TDD + TCR：构建节拍"
body_en: |
  <span class="tag fade-in">Fundamentals</span>
  <h2 class="fade-in">TDD + TCR: The Build Rhythm</h2>
  <p class="section-desc fade-in"><strong>Test-Driven Development</strong> writes the standard first. <strong>TCR (Test && Commit || Revert)</strong> enforces it mechanically.</p>
  <div class="flow-row fade-in" style="margin-bottom: 16px;">
    <div class="flow-step" style="background:rgba(239,68,68,0.12);color:var(--red-text);">1. Write Test</div>
    <div class="flow-arrow">→</div>
    <div class="flow-step" style="background:rgba(99,102,241,0.12);color:var(--accent-light);">2. Write Code</div>
    <div class="flow-arrow">→</div>
    <div class="flow-step" style="background:rgba(127,127,127,0.08);color:var(--text);">3. Auto-Verify</div>
    <div class="flow-arrow">→</div>
    <div class="flow-branch">
      <div class="flow-step" style="background:rgba(34,197,94,0.12);color:var(--green-text);">✅ Pass → Auto-Commit</div>
      <div class="flow-step" style="background:rgba(239,68,68,0.12);color:var(--red-text);">❌ Fail → Auto-Revert</div>
    </div>
  </div>
  <div class="metric-row fade-in">
    <div class="metric" style="border-color:rgba(34,197,94,0.25);">
      <div class="number" style="color:var(--green-text);">2-5 min</div>
      <div class="label">Per micro-step · worst case lose 5 minutes</div>
    </div>
    <div class="metric" style="border-color:rgba(6,182,212,0.25);">
      <div class="number" style="color:var(--cyan-text);">100%</div>
      <div class="label">Every save verified · code always runnable</div>
    </div>
    <div class="metric" style="border-color:rgba(99,102,241,0.25);">
      <div class="number" style="color:var(--accent-light);font-size:24px;line-height:1.4;">Fully Auto</div>
      <div class="label">AI runs unattended · no babysitting</div>
    </div>
  </div>
body_zh: |
  <span class="tag fade-in">基本功</span>
  <h2 class="fade-in">TDD + TCR：构建节拍</h2>
  <p class="section-desc fade-in"><strong>测试驱动开发</strong>先写下标准。<strong>TCR（测过则提交，未过则回滚）</strong>把标准机械化地执行。</p>
  <div class="flow-row fade-in" style="margin-bottom: 16px;">
    <div class="flow-step" style="background:rgba(239,68,68,0.12);color:var(--red-text);">1. 先写测试</div>
    <div class="flow-arrow">→</div>
    <div class="flow-step" style="background:rgba(99,102,241,0.12);color:var(--accent-light);">2. 写代码</div>
    <div class="flow-arrow">→</div>
    <div class="flow-step" style="background:rgba(127,127,127,0.08);color:var(--text);">3. 自动验证</div>
    <div class="flow-arrow">→</div>
    <div class="flow-branch">
      <div class="flow-step" style="background:rgba(34,197,94,0.12);color:var(--green-text);">✅ 通过 → 自动提交</div>
      <div class="flow-step" style="background:rgba(239,68,68,0.12);color:var(--red-text);">❌ 失败 → 自动回滚</div>
    </div>
  </div>
  <div class="metric-row fade-in">
    <div class="metric" style="border-color:rgba(34,197,94,0.25);">
      <div class="number" style="color:var(--green-text);">2-5 min</div>
      <div class="label">每个微步 · 最坏丢 5 分钟</div>
    </div>
    <div class="metric" style="border-color:rgba(6,182,212,0.25);">
      <div class="number" style="color:var(--cyan-text);">100%</div>
      <div class="label">每次保存都验证 · 代码始终可运行</div>
    </div>
    <div class="metric" style="border-color:rgba(99,102,241,0.25);">
      <div class="number" style="color:var(--accent-light);font-size:24px;line-height:1.4;">完全自动</div>
      <div class="label">AI 自主执行 · 无须看守</div>
    </div>
  </div>

## Slide 9
title_en: "Loop B: Build It Right"
title_zh: "Loop B：做扎实"
body_en: |
  <span class="tag fade-in" style="background:rgba(34,197,94,0.12);color:var(--green-text);">Loop B</span>
  <h2 class="fade-in">Loop B: Build It Right</h2>
  <p class="section-desc fade-in">The full delivery pipeline — from Backlog item to verified deployment.</p>
  <div class="timeline fade-in">
    <div class="timeline-item">
      <h4>1. Read Story → Break into Actions (2-5 min each)</h4>
      <p>Decompose into minimal deliverable Actions. Independent Actions can run in parallel.</p>
    </div>
    <div class="timeline-item">
      <h4>2. TCR Micro-Loop (per Action)</h4>
      <p>RED test → GREEN code → self-review ($roll-.review) → auto-commit. Fail = auto-revert.</p>
    </div>
    <div class="timeline-item">
      <h4>3. Local CI Gate</h4>
      <p>Lint + type check + full test suite + build. All must pass before push.</p>
    </div>
    <div class="timeline-item">
      <h4>4. Push → Remote CI (Objective Arbiter)</h4>
      <p>CI re-verifies in a clean environment — the final ruling on "shippable."</p>
    </div>
    <div class="timeline-item">
      <h4>5. Deploy to Test/UAT → Live Evidence</h4>
      <p><strong>Screenshots, curl responses, test outputs</strong> required. "I checked, it works" doesn't count.</p>
    </div>
    <div class="timeline-item">
      <h4>6. Release — Human Approves</h4>
      <p>Human approves. BACKLOG status: ✅ Done. Sentinel takes over monitoring.</p>
    </div>
  </div>
body_zh: |
  <span class="tag fade-in" style="background:rgba(34,197,94,0.12);color:var(--green-text);">Loop B</span>
  <h2 class="fade-in">Loop B：做扎实</h2>
  <p class="section-desc fade-in">完整的交付流水线——从 Backlog 工作项到已验证的部署。</p>
  <div class="timeline fade-in">
    <div class="timeline-item">
      <h4>1. 读 Story → 拆成 Action（每个 2-5 分钟）</h4>
      <p>拆成最小可交付的 Action。独立 Action 可以并行。</p>
    </div>
    <div class="timeline-item">
      <h4>2. TCR 微循环（每个 Action）</h4>
      <p>写测试（RED）→ 写代码（GREEN）→ 自查（$roll-.review）→ 自动提交。失败 = 自动回滚。</p>
    </div>
    <div class="timeline-item">
      <h4>3. 本地 CI 闸门</h4>
      <p>Lint + 类型检查 + 全量测试 + 构建。全过才能 push。</p>
    </div>
    <div class="timeline-item">
      <h4>4. Push → 远端 CI（客观裁判）</h4>
      <p>CI 在干净环境再验证一次——是否「可发布」的最终裁决。</p>
    </div>
    <div class="timeline-item">
      <h4>5. 部署到 Test/UAT → 采集活证据</h4>
      <p>必须采集<strong>截图、curl 响应、测试输出</strong>。AI 说「我检查过了」不算数。</p>
    </div>
    <div class="timeline-item">
      <h4>6. 发布 — 人工审批</h4>
      <p>人审批通过。BACKLOG 状态变 ✅ Done。Sentinel 接手监控。</p>
    </div>
  </div>

## Slide 10
title_en: "Four Lines of Defense"
title_zh: "四道防线"
body_en: |
  <span class="tag fade-in" style="background:rgba(245,158,11,0.12);color:var(--orange-text);">Quality System</span>
  <h2 class="fade-in">Four Lines of Defense</h2>
  <p class="section-desc fade-in">Every layer is automated. None depend on human patience or memory.</p>
  <div class="cards cards-4 fade-in">
    <div class="card" style="border-left:3px solid var(--green);">
      <h3 style="font-size:14px;">L1: TCR Micro-Verification</h3>
      <p>Verify every 2-5 minutes. Define the standard before writing — auto-revert if it fails. <strong>Bugs eliminated the instant they appear.</strong></p>
      <p style="margin-top:6px;font-size:10px;font-family:monospace;color:var(--green-text);">$roll-build</p>
    </div>
    <div class="card" style="border-left:3px solid var(--red);">
      <h3 style="font-size:14px;">L2: Spar Adversarial Drill</h3>
      <p>For critical modules (payments, auth). One AI attacks, another defends. Up to 5 rounds of escalating intensity.</p>
      <p style="margin-top:6px;font-size:10px;font-family:monospace;color:var(--red-text);">$roll-spar</p>
    </div>
    <div class="card" style="border-left:3px solid var(--accent-light);">
      <h3 style="font-size:14px;">L3: Multi-Stage Review</h3>
      <p><strong>Self</strong> — per-commit 6-dim check.<br><strong>Peer</strong> — cross-agent negotiation.<br><strong>Dream</strong> — nightly code health scan.</p>
      <p style="margin-top:6px;font-size:10px;font-family:monospace;color:var(--accent-light);">$roll-.review · $roll-peer · $roll-.dream</p>
    </div>
    <div class="card" style="border-left:3px solid var(--orange);">
      <h3 style="font-size:14px;">L4: Sentinel Production Patrol</h3>
      <p>24/7 random-sample monitoring. Alerts only after 3 consecutive failures. Auto-creates Fix tasks.</p>
      <p style="margin-top:6px;font-size:10px;font-family:monospace;color:var(--orange-text);">$roll-sentinel</p>
    </div>
  </div>
body_zh: |
  <span class="tag fade-in" style="background:rgba(245,158,11,0.12);color:var(--orange-text);">质量体系</span>
  <h2 class="fade-in">四道防线</h2>
  <p class="section-desc fade-in">每一层都是自动化的。不依赖任何人的耐心或记性。</p>
  <div class="cards cards-4 fade-in">
    <div class="card" style="border-left:3px solid var(--green);">
      <h3 style="font-size:14px;">L1：TCR 微验证</h3>
      <p>每 2-5 分钟验证一次。先定标准再写代码——不过就回滚。<strong>Bug 一冒头就被消灭。</strong></p>
      <p style="margin-top:6px;font-size:10px;font-family:monospace;color:var(--green-text);">$roll-build</p>
    </div>
    <div class="card" style="border-left:3px solid var(--red);">
      <h3 style="font-size:14px;">L2：Spar 红蓝对抗</h3>
      <p>面向关键模块（支付、认证）。一边 AI 攻击，另一边防御。最多 5 轮逐级升级。</p>
      <p style="margin-top:6px;font-size:10px;font-family:monospace;color:var(--red-text);">$roll-spar</p>
    </div>
    <div class="card" style="border-left:3px solid var(--accent-light);">
      <h3 style="font-size:14px;">L3：多阶段评审</h3>
      <p><strong>Self</strong>——每次提交 6 维自查。<br><strong>Peer</strong>——跨 Agent 协商。<br><strong>Dream</strong>——夜间代码健康扫描。</p>
      <p style="margin-top:6px;font-size:10px;font-family:monospace;color:var(--accent-light);">$roll-.review · $roll-peer · $roll-.dream</p>
    </div>
    <div class="card" style="border-left:3px solid var(--orange);">
      <h3 style="font-size:14px;">L4：Sentinel 生产巡逻</h3>
      <p>7×24 抽样巡检。连续 3 次失败才告警（防误报）。自动创建 Fix 任务。</p>
      <p style="margin-top:6px;font-size:10px;font-family:monospace;color:var(--orange-text);">$roll-sentinel</p>
    </div>
  </div>

## Slide 11
title_en: "Loop C: Keep Watch"
title_zh: "Loop C：盯住了"
body_en: |
  <span class="tag fade-in" style="background:rgba(245,158,11,0.12);color:var(--orange-text);">Loop C</span>
  <h2 class="fade-in">Loop C: Keep Watch</h2>
  <p class="section-desc fade-in">Two complementary monitors: Sentinel watches runtime, Dream watches code structure.</p>
  <div class="cards cards-2 fade-in">
    <div class="card" style="border-top: 3px solid var(--orange);">
      <h3 style="font-size:15px;color:var(--orange-text);">$roll-sentinel — Runtime Patrol</h3>
      <p>Random-sample monitoring of production. Cost-controlled AI validation with intelligent spot-checking.</p>
      <p style="margin-top:8px;"><strong>Patrol Modes:</strong></p>
      <p>Light: 5/day · Intensive: 20/hr (post-release) · Full sweep: weekly</p>
      <p style="margin-top:8px;"><strong>Output:</strong> FIX-XXX entries in BACKLOG</p>
    </div>
    <div class="card" style="border-top: 3px solid var(--accent-light);">
      <h3 style="font-size:15px;color:var(--accent-light);">$roll-.dream — Nightly Health Scan</h3>
      <p>Runs at 3am. Six dimensions of code health:</p>
      <p style="margin-top:8px;">1. Dead Code · 2. Architectural Drift · 3. Pruning Candidates · 4. Emerging Patterns · 5. Doc Coverage · 6. Doc Freshness</p>
      <p style="margin-top:8px;"><strong>Output:</strong> REFACTOR-XXX entries in BACKLOG</p>
    </div>
  </div>
  <div class="highlight-box fade-in" style="margin-top: 16px;">
    <p><strong>Sentinel monitors behavior. Dream monitors structure.</strong> Together they detect both runtime degradation and code-quality decay — before users notice.</p>
  </div>
body_zh: |
  <span class="tag fade-in" style="background:rgba(245,158,11,0.12);color:var(--orange-text);">Loop C</span>
  <h2 class="fade-in">Loop C：盯住了</h2>
  <p class="section-desc fade-in">两位互补的守望者：Sentinel 盯运行时，Dream 盯代码结构。</p>
  <div class="cards cards-2 fade-in">
    <div class="card" style="border-top: 3px solid var(--orange);">
      <h3 style="font-size:15px;color:var(--orange-text);">$roll-sentinel — 运行时巡逻</h3>
      <p>对生产做抽样巡检。成本可控的 AI 验证 + 智能点检逻辑。</p>
      <p style="margin-top:8px;"><strong>巡检模式：</strong></p>
      <p>轻量：每天 5 次 · 密集：发布后每小时 20 次 · 全量扫描：每周一次</p>
      <p style="margin-top:8px;"><strong>输出：</strong> 在 BACKLOG 中生成 FIX-XXX 条目</p>
    </div>
    <div class="card" style="border-top: 3px solid var(--accent-light);">
      <h3 style="font-size:15px;color:var(--accent-light);">$roll-.dream — 夜间健康扫描</h3>
      <p>凌晨 3 点运行。代码健康的六个维度：</p>
      <p style="margin-top:8px;">1. 死代码 · 2. 架构漂移 · 3. 可裁剪项 · 4. 涌现模式 · 5. 文档覆盖 · 6. 文档新鲜度</p>
      <p style="margin-top:8px;"><strong>输出：</strong> 在 BACKLOG 中生成 REFACTOR-XXX 条目</p>
    </div>
  </div>
  <div class="highlight-box fade-in" style="margin-top: 16px;">
    <p><strong>Sentinel 盯行为，Dream 盯结构。</strong>两者合力，在用户发现之前就检出运行时退化和代码质量衰减。</p>
  </div>

## Slide 12
title_en: "Three-Layer Autonomous Model"
title_zh: "三层自治模型"
body_en: |
  <span class="tag fade-in" style="background:rgba(6,182,212,0.12);color:var(--cyan-text);">Autonomous</span>
  <h2 class="fade-in">Three-Layer Autonomous Model</h2>
  <p class="section-desc fade-in">ROLL operates at three levels of autonomy, each with clear boundaries.</p>
  <div class="auto-layers fade-in">
    <div class="auto-layer">
      <div class="al-icon">🧑‍💻</div>
      <h4>Human Layer</h4>
      <p>Set goals, review proposals, approve releases. The judgment calls.</p>
      <div class="al-skills">roll-propose</div>
    </div>
    <div class="auto-layer">
      <div class="al-icon">🔄</div>
      <h4>Loop Layer</h4>
      <p>Hourly BACKLOG scan. Auto-routes each item to the right skill. FIX > US > REFACTOR.</p>
      <div class="al-skills">roll-loop · roll-brief</div>
    </div>
    <div class="auto-layer">
      <div class="al-icon">🌙</div>
      <h4>Dream Layer</h4>
      <p>3am nightly code health scan. 6 dimensions. Generates REFACTOR entries autonomously.</p>
      <div class="al-skills">roll-.dream</div>
    </div>
    <div class="auto-layer">
      <div class="al-icon">🤝</div>
      <h4>Peer Layer</h4>
      <p>Cross-agent negotiation on high-risk decisions. Up to 3 rounds. No consensus → escalate to human.</p>
      <div class="al-skills">roll-peer</div>
    </div>
  </div>
  <div class="analogy fade-in">
    <div class="analogy-label">Design Principle</div>
    <p>Humans set direction and approve releases. Everything else — building, reviewing, monitoring, refactoring — can run autonomously. <strong>The system never ships to production without human approval.</strong></p>
  </div>
body_zh: |
  <span class="tag fade-in" style="background:rgba(6,182,212,0.12);color:var(--cyan-text);">自治</span>
  <h2 class="fade-in">三层自治模型</h2>
  <p class="section-desc fade-in">ROLL 在三个自治层级运转，每层边界清晰。</p>
  <div class="auto-layers fade-in">
    <div class="auto-layer">
      <div class="al-icon">🧑‍💻</div>
      <h4>人</h4>
      <p>定目标、审方案、批发布。判断类决策。</p>
      <div class="al-skills">roll-propose</div>
    </div>
    <div class="auto-layer">
      <div class="al-icon">🔄</div>
      <h4>Loop 层</h4>
      <p>每小时扫描 BACKLOG，自动路由到对应 Skill。FIX > US > REFACTOR。</p>
      <div class="al-skills">roll-loop · roll-brief</div>
    </div>
    <div class="auto-layer">
      <div class="al-icon">🌙</div>
      <h4>Dream 层</h4>
      <p>凌晨 3 点代码健康扫描，6 个维度，自动产出 REFACTOR 条目。</p>
      <div class="al-skills">roll-.dream</div>
    </div>
    <div class="auto-layer">
      <div class="al-icon">🤝</div>
      <h4>Peer 层</h4>
      <p>高风险决策由跨 Agent 协商，最多 3 轮。达不成共识 → 升级给人。</p>
      <div class="al-skills">roll-peer</div>
    </div>
  </div>
  <div class="analogy fade-in">
    <div class="analogy-label">设计原则</div>
    <p>人设方向、批发布。其他一切——构建、评审、监控、重构——都可以自主运行。<strong>没有人的审批，系统不会上生产。</strong></p>
  </div>

## Slide 13
title_en: "ROLL's Skills, At a Glance"
title_zh: "ROLL 技能全景"
body_en: |
  <span class="tag fade-in">Skill System</span>
  <h2 class="fade-in">ROLL's Skills, At a Glance</h2>
  <p class="section-desc fade-in" style="margin-bottom: 10px;">23 skills spanning design, build, check, autonomous, and support — each maps to a specific phase.</p>
  <table class="skill-table fade-in">
    <thead>
      <tr>
        <th>Skill</th>
        <th>Tier</th>
        <th>What It Does</th>
      </tr>
    </thead>
    <tbody>
      <tr><td class="skill-name">$roll-research</td><td><span class="phase-tag phase-design">Research</span></td><td>HV analysis — timeline + competitive landscape → PDF report</td></tr>
      <tr><td class="skill-name">$roll-design</td><td><span class="phase-tag phase-design">Design</span></td><td>DDD modeling, solution design, INVEST story breakdown</td></tr>
      <tr><td class="skill-name">$roll-idea</td><td><span class="phase-tag phase-design">Capture</span></td><td>Fast backlog capture — one-liner in, classified entry out</td></tr>
      <tr><td class="skill-name">$roll-propose</td><td><span class="phase-tag phase-design">Propose</span></td><td>Generate 1-3 structured US drafts → proposals.md for human review</td></tr>
      <tr><td class="skill-name">$roll-onboard</td><td><span class="phase-tag phase-design">Onboard</span></td><td>Interactive onboarding for legacy projects — 9 Qs → onboard-plan.yaml</td></tr>
      <tr><td class="skill-name">$roll-build</td><td><span class="phase-tag phase-build">Build</span></td><td>Universal entry: US/FIX/plain text → TCR delivery</td></tr>
      <tr><td class="skill-name">$roll-spar</td><td><span class="phase-tag phase-build">Adversarial</span></td><td>Red-blue drill: Attacker writes exploits, Defender patches</td></tr>
      <tr><td class="skill-name">$roll-fix</td><td><span class="phase-tag phase-build">Fix</span></td><td>Single-bug fix + mandatory regression test</td></tr>
      <tr><td class="skill-name">$roll-debug</td><td><span class="phase-tag phase-check">Diagnose</span></td><td>Black Box probe: Console/Network/DOM/Perf → root cause</td></tr>
      <tr><td class="skill-name">$roll-sentinel</td><td><span class="phase-tag phase-check">Patrol</span></td><td>Production random-sample monitoring, 3-strike alerting</td></tr>
      <tr><td class="skill-name">$roll-review-pr</td><td><span class="phase-tag phase-check">PR Review</span></td><td>Agent-agnostic PR review with 3-state verdict</td></tr>
      <tr><td class="skill-name">$roll-doc</td><td><span class="phase-tag phase-support">Document</span></td><td>Auto-scan, index, gap analysis, fill for project docs</td></tr>
      <tr><td class="skill-name">$roll-notes</td><td><span class="phase-tag phase-support">Journal</span></td><td>Project diary — records dev moments chronologically</td></tr>
      <tr><td class="skill-name">$roll-doctor</td><td><span class="phase-tag phase-support">Maintain</span></td><td>ROLL self-health check (skills/symlinks/config/templates)</td></tr>
      <tr><td class="skill-name" style="color:var(--cyan-text);">$roll-loop</td><td><span class="phase-tag phase-auto">Auto</span></td><td>Hourly BACKLOG executor — routes items to skills</td></tr>
      <tr><td class="skill-name" style="color:var(--cyan-text);">$roll-peer</td><td><span class="phase-tag phase-auto">Auto</span></td><td>Cross-agent peer review, up to 3 negotiation rounds</td></tr>
      <tr><td class="skill-name" style="color:var(--cyan-text);">$roll-brief</td><td><span class="phase-tag phase-auto">Auto</span></td><td>Owner-facing briefing: done, in-progress, queue, escalations</td></tr>
      <tr><td class="skill-name" style="color:var(--cyan-text);">$roll-.dream</td><td><span class="phase-tag phase-auto">Auto</span></td><td>Nightly 6-dimension code health scan → REFACTOR entries</td></tr>
      <tr><td class="skill-name" style="color:var(--text-dim);">$roll-.review</td><td><span class="phase-tag phase-support">Hidden</span></td><td>Per-commit self-review: correctness, security, maintainability</td></tr>
      <tr><td class="skill-name" style="color:var(--text-dim);">$roll-.changelog</td><td><span class="phase-tag phase-support">Hidden</span></td><td>Auto-generates CHANGELOG.md from completed stories</td></tr>
      <tr><td class="skill-name" style="color:var(--text-dim);">$roll-.qa</td><td><span class="phase-tag phase-support">Hidden</span></td><td>Test pyramid standards: unit/E2E/visual/smoke + CI gates</td></tr>
      <tr><td class="skill-name" style="color:var(--text-dim);">$roll-.echo</td><td><span class="phase-tag phase-support">Hidden</span></td><td>Passive intent clarification for vague inputs</td></tr>
      <tr><td class="skill-name" style="color:var(--text-dim);">$roll-.clarify</td><td><span class="phase-tag phase-support">Hidden</span></td><td>Scope clarification for under-specified Fly-mode inputs</td></tr>
    </tbody>
  </table>
body_zh: |
  <span class="tag fade-in">技能体系</span>
  <h2 class="fade-in">ROLL 技能全景</h2>
  <p class="section-desc fade-in" style="margin-bottom: 10px;">23 个 Skill，覆盖设计、构建、校验、自治、支持——每个对应一个具体阶段。</p>
  <table class="skill-table fade-in">
    <thead>
      <tr>
        <th>Skill</th>
        <th>分类</th>
        <th>做什么</th>
      </tr>
    </thead>
    <tbody>
      <tr><td class="skill-name">$roll-research</td><td><span class="phase-tag phase-design">调研</span></td><td>HV 分析——时间线 + 竞品 → PDF 报告</td></tr>
      <tr><td class="skill-name">$roll-design</td><td><span class="phase-tag phase-design">设计</span></td><td>DDD 建模、方案设计、INVEST Story 拆分</td></tr>
      <tr><td class="skill-name">$roll-idea</td><td><span class="phase-tag phase-design">捕获</span></td><td>快速收录——一句话进，分类条目出</td></tr>
      <tr><td class="skill-name">$roll-propose</td><td><span class="phase-tag phase-design">提案</span></td><td>生成 1-3 个结构化 US 草稿 → proposals.md 待人审</td></tr>
      <tr><td class="skill-name">$roll-onboard</td><td><span class="phase-tag phase-design">接入</span></td><td>老项目交互式接入——9 问 → onboard-plan.yaml</td></tr>
      <tr><td class="skill-name">$roll-build</td><td><span class="phase-tag phase-build">构建</span></td><td>通用入口：US / FIX / 自由文本 → TCR 交付</td></tr>
      <tr><td class="skill-name">$roll-spar</td><td><span class="phase-tag phase-build">对抗</span></td><td>红蓝对抗：攻方写漏洞测试，守方打补丁</td></tr>
      <tr><td class="skill-name">$roll-fix</td><td><span class="phase-tag phase-build">修复</span></td><td>单个 bug 修复 + 必备回归测试</td></tr>
      <tr><td class="skill-name">$roll-debug</td><td><span class="phase-tag phase-check">诊断</span></td><td>黑盒探针：Console/Network/DOM/Perf → 根因</td></tr>
      <tr><td class="skill-name">$roll-sentinel</td><td><span class="phase-tag phase-check">巡逻</span></td><td>生产抽样监控，连续三次失败才告警</td></tr>
      <tr><td class="skill-name">$roll-review-pr</td><td><span class="phase-tag phase-check">PR 评审</span></td><td>跨 Agent 的 PR 评审 · 三态结论</td></tr>
      <tr><td class="skill-name">$roll-doc</td><td><span class="phase-tag phase-support">文档</span></td><td>自动扫描、建索引、找缺口、补写项目文档</td></tr>
      <tr><td class="skill-name">$roll-notes</td><td><span class="phase-tag phase-support">日志</span></td><td>项目日记——按时间记录开发瞬间</td></tr>
      <tr><td class="skill-name">$roll-doctor</td><td><span class="phase-tag phase-support">体检</span></td><td>ROLL 自身健康检查（Skill/链接/配置/模板）</td></tr>
      <tr><td class="skill-name" style="color:var(--cyan-text);">$roll-loop</td><td><span class="phase-tag phase-auto">自治</span></td><td>每小时 BACKLOG 执行器——路由到对应 Skill</td></tr>
      <tr><td class="skill-name" style="color:var(--cyan-text);">$roll-peer</td><td><span class="phase-tag phase-auto">自治</span></td><td>跨 Agent 同行评审，最多 3 轮协商</td></tr>
      <tr><td class="skill-name" style="color:var(--cyan-text);">$roll-brief</td><td><span class="phase-tag phase-auto">自治</span></td><td>面向负责人的简报：已完成、进行中、队列、待升级</td></tr>
      <tr><td class="skill-name" style="color:var(--cyan-text);">$roll-.dream</td><td><span class="phase-tag phase-auto">自治</span></td><td>夜间 6 维代码健康扫描 → REFACTOR 条目</td></tr>
      <tr><td class="skill-name" style="color:var(--text-dim);">$roll-.review</td><td><span class="phase-tag phase-support">隐式</span></td><td>每次提交自查：正确性、安全、可维护性</td></tr>
      <tr><td class="skill-name" style="color:var(--text-dim);">$roll-.changelog</td><td><span class="phase-tag phase-support">隐式</span></td><td>从已完成 Story 自动生成 CHANGELOG.md</td></tr>
      <tr><td class="skill-name" style="color:var(--text-dim);">$roll-.qa</td><td><span class="phase-tag phase-support">隐式</span></td><td>测试金字塔标准：单元 / E2E / 视觉 / 冒烟 + CI 闸门</td></tr>
      <tr><td class="skill-name" style="color:var(--text-dim);">$roll-.echo</td><td><span class="phase-tag phase-support">隐式</span></td><td>面向模糊输入的被动意图澄清</td></tr>
      <tr><td class="skill-name" style="color:var(--text-dim);">$roll-.clarify</td><td><span class="phase-tag phase-support">隐式</span></td><td>Fly 模式下的范围澄清</td></tr>
    </tbody>
  </table>

## Slide 14
title_en: "Traditional QA vs. ROLL Auto-QA"
title_zh: "传统 QA vs. ROLL 自动 QA"
body_en: |
  <span class="tag fade-in" style="background:rgba(6,182,212,0.12);color:var(--cyan-text);">Comparison</span>
  <h2 class="fade-in">Traditional QA vs. ROLL Auto-QA</h2>
  <p class="section-desc fade-in">Quality assurance isn't removed — <strong>the implementation is upgraded</strong>.</p>
  <div class="compare fade-in">
    <div class="compare-col compare-before">
      <h3 style="color:var(--red-text);">Traditional QA</h3>
      <div class="compare-item"><span class="icon">🐌</span><span>Dev finishes → wait for QA availability</span></div>
      <div class="compare-item"><span class="icon">🐌</span><span>Bugs surface only in test phase</span></div>
      <div class="compare-item"><span class="icon">🐌</span><span>Manual regression — slow, error-prone</span></div>
      <div class="compare-item"><span class="icon">🐌</span><span>Post-ship issues found by user complaints</span></div>
      <div class="compare-item"><span class="icon">🐌</span><span>Quality depends on individual diligence</span></div>
    </div>
    <div class="compare-arrow">→</div>
    <div class="compare-col compare-after">
      <h3 style="color:var(--green-text);">ROLL Auto-QA</h3>
      <div class="compare-item"><span class="icon">⚡</span><span>Test while writing — bugs caught at birth</span></div>
      <div class="compare-item"><span class="icon">⚡</span><span>Fix cost approaches zero (max 5-min loss)</span></div>
      <div class="compare-item"><span class="icon">⚡</span><span>Auto regression + nightly Dream scans</span></div>
      <div class="compare-item"><span class="icon">⚡</span><span>Issues found before users notice (Sentinel)</span></div>
      <div class="compare-item"><span class="icon">⚡</span><span>Standards built into the system, not people</span></div>
    </div>
  </div>
body_zh: |
  <span class="tag fade-in" style="background:rgba(6,182,212,0.12);color:var(--cyan-text);">对比</span>
  <h2 class="fade-in">传统 QA vs. ROLL 自动 QA</h2>
  <p class="section-desc fade-in">质量保障没有被去掉——<strong>是实现方式被升级了</strong>。</p>
  <div class="compare fade-in">
    <div class="compare-col compare-before">
      <h3 style="color:var(--red-text);">传统 QA</h3>
      <div class="compare-item"><span class="icon">🐌</span><span>开发完成 → 等 QA 排期</span></div>
      <div class="compare-item"><span class="icon">🐌</span><span>Bug 在测试阶段才暴露</span></div>
      <div class="compare-item"><span class="icon">🐌</span><span>手工回归——慢、易错</span></div>
      <div class="compare-item"><span class="icon">🐌</span><span>上线问题靠用户投诉发现</span></div>
      <div class="compare-item"><span class="icon">🐌</span><span>质量取决于个人自觉</span></div>
    </div>
    <div class="compare-arrow">→</div>
    <div class="compare-col compare-after">
      <h3 style="color:var(--green-text);">ROLL 自动 QA</h3>
      <div class="compare-item"><span class="icon">⚡</span><span>边写边测——bug 出生即被抓</span></div>
      <div class="compare-item"><span class="icon">⚡</span><span>修复成本趋近零（最多损失 5 分钟）</span></div>
      <div class="compare-item"><span class="icon">⚡</span><span>自动回归 + 每晚 Dream 扫描</span></div>
      <div class="compare-item"><span class="icon">⚡</span><span>用户察觉前就被 Sentinel 发现</span></div>
      <div class="compare-item"><span class="icon">⚡</span><span>标准嵌进系统，不寄望于人</span></div>
    </div>
  </div>

## Slide 15
title_en: "What a ROLL-Managed Project Looks Like"
title_zh: "ROLL 接管的项目长什么样"
body_en: |
  <span class="tag fade-in">Structure</span>
  <h2 class="fade-in">What a ROLL-Managed Project Looks Like</h2>
  <p class="section-desc fade-in"><code>roll init</code> — one command, a few seconds.</p>
  <div class="tree fade-in">
    <span class="dir">my-project/</span><br>
    ├── <span class="file">AGENTS.md</span> <span class="comment">&nbsp;&nbsp;← Conventions shared across all AI tools</span><br>
    ├── <span class="dir">.roll/</span> <span class="comment">&nbsp;&nbsp;← Process & internal docs</span><br>
    │&nbsp;&nbsp;&nbsp;├── <span class="file">backlog.md</span> <span class="comment">← US / FIX / REFACTOR / SPIKE</span><br>
    │&nbsp;&nbsp;&nbsp;├── <span class="file">proposals.md</span> <span class="comment">← AI proposals awaiting human review</span><br>
    │&nbsp;&nbsp;&nbsp;├── <span class="dir">features/</span> <span class="comment">← Story details + AC</span><br>
    │&nbsp;&nbsp;&nbsp;├── <span class="dir">domain/</span> <span class="comment">← DDD context maps</span><br>
    │&nbsp;&nbsp;&nbsp;├── <span class="dir">decisions/</span> <span class="comment">← ADRs</span><br>
    │&nbsp;&nbsp;&nbsp;├── <span class="dir">dream/</span> <span class="comment">← Nightly health reports</span><br>
    │&nbsp;&nbsp;&nbsp;└── <span class="dir">briefs/</span> <span class="comment">← Owner-facing digests</span><br>
    ├── <span class="dir">.github/workflows/</span><br>
    │&nbsp;&nbsp;&nbsp;├── <span class="file">ci.yml</span> <span class="comment">← Quality gate on every commit</span><br>
    │&nbsp;&nbsp;&nbsp;└── <span class="file">sentinel.yml</span> <span class="comment">← Scheduled production patrols</span><br>
    └── <span class="comment">... source code</span>
  </div>
body_zh: |
  <span class="tag fade-in">项目结构</span>
  <h2 class="fade-in">ROLL 接管的项目长什么样</h2>
  <p class="section-desc fade-in"><code>roll init</code> — 一条命令，几秒钟。</p>
  <div class="tree fade-in">
    <span class="dir">my-project/</span><br>
    ├── <span class="file">AGENTS.md</span> <span class="comment">&nbsp;&nbsp;← 所有 AI 工具共用的约定</span><br>
    ├── <span class="dir">.roll/</span> <span class="comment">&nbsp;&nbsp;← 过程与内部文档</span><br>
    │&nbsp;&nbsp;&nbsp;├── <span class="file">backlog.md</span> <span class="comment">← US / FIX / REFACTOR / SPIKE</span><br>
    │&nbsp;&nbsp;&nbsp;├── <span class="file">proposals.md</span> <span class="comment">← 待人审的 AI 提案</span><br>
    │&nbsp;&nbsp;&nbsp;├── <span class="dir">features/</span> <span class="comment">← Story 详情与验收标准</span><br>
    │&nbsp;&nbsp;&nbsp;├── <span class="dir">domain/</span> <span class="comment">← DDD 上下文映射</span><br>
    │&nbsp;&nbsp;&nbsp;├── <span class="dir">decisions/</span> <span class="comment">← 架构决策记录</span><br>
    │&nbsp;&nbsp;&nbsp;├── <span class="dir">dream/</span> <span class="comment">← 夜间健康报告</span><br>
    │&nbsp;&nbsp;&nbsp;└── <span class="dir">briefs/</span> <span class="comment">← 面向负责人的简报</span><br>
    ├── <span class="dir">.github/workflows/</span><br>
    │&nbsp;&nbsp;&nbsp;├── <span class="file">ci.yml</span> <span class="comment">← 每次提交的质量闸门</span><br>
    │&nbsp;&nbsp;&nbsp;└── <span class="file">sentinel.yml</span> <span class="comment">← 定时生产巡逻</span><br>
    └── <span class="comment">... 源代码</span>
  </div>

## Slide 16
title_en: "One Command, Every AI Tool Aligned"
title_zh: "一条命令，所有 AI 工具对齐"
body_en: |
  <span class="tag fade-in">Configuration</span>
  <h2 class="fade-in">One Command, Every AI Tool Aligned</h2>
  <p class="section-desc fade-in"><code>roll setup</code> syncs conventions and skills to every AI tool simultaneously.</p>
  <div class="flow-row fade-in" style="margin-bottom: 18px;">
    <div class="flow-step" style="background:rgba(99,102,241,0.12);color:var(--accent-light);">
      ~/.roll/<br><span style="font-size:10px;">Unified config</span>
    </div>
    <div class="flow-arrow">→</div>
    <div class="flow-branch" style="gap:4px;">
      <div class="flow-step" style="background:rgba(127,127,127,0.06);color:var(--text);font-size:12px;padding:6px 12px;">~/.claude/ → CLAUDE.md + skills/</div>
      <div class="flow-step" style="background:rgba(127,127,127,0.06);color:var(--text);font-size:12px;padding:6px 12px;">~/.gemini/ → GEMINI.md + skills/</div>
      <div class="flow-step" style="background:rgba(127,127,127,0.06);color:var(--text);font-size:12px;padding:6px 12px;">~/.cursor/ → rules + skills/</div>
      <div class="flow-step" style="background:rgba(127,127,127,0.06);color:var(--text);font-size:12px;padding:6px 12px;">~/.codex/ ~/.kimi/ ...</div>
    </div>
  </div>
  <div class="cards cards-3 fade-in">
    <div class="card" style="padding:16px;">
      <h3 style="font-size:14px;">Zero Intrusion</h3>
      <p style="font-size:12px;">Never overwrites existing configs. Writes its own file and appends via @include.</p>
    </div>
    <div class="card" style="padding:16px;">
      <h3 style="font-size:14px;">Symlinked Skills</h3>
      <p style="font-size:12px;">Update ROLL, re-run setup — every AI tool upgrades in seconds.</p>
    </div>
    <div class="card" style="padding:16px;">
      <h3 style="font-size:14px;">3 CLI Commands</h3>
      <p style="font-size:12px;"><strong>roll setup</strong> · <strong>roll init</strong> · <strong>roll update</strong></p>
    </div>
  </div>
body_zh: |
  <span class="tag fade-in">配置</span>
  <h2 class="fade-in">一条命令，所有 AI 工具对齐</h2>
  <p class="section-desc fade-in"><code>roll setup</code> 把规范与 Skill 同步到所有 AI 工具。</p>
  <div class="flow-row fade-in" style="margin-bottom: 18px;">
    <div class="flow-step" style="background:rgba(99,102,241,0.12);color:var(--accent-light);">
      ~/.roll/<br><span style="font-size:10px;">统一配置</span>
    </div>
    <div class="flow-arrow">→</div>
    <div class="flow-branch" style="gap:4px;">
      <div class="flow-step" style="background:rgba(127,127,127,0.06);color:var(--text);font-size:12px;padding:6px 12px;">~/.claude/ → CLAUDE.md + skills/</div>
      <div class="flow-step" style="background:rgba(127,127,127,0.06);color:var(--text);font-size:12px;padding:6px 12px;">~/.gemini/ → GEMINI.md + skills/</div>
      <div class="flow-step" style="background:rgba(127,127,127,0.06);color:var(--text);font-size:12px;padding:6px 12px;">~/.cursor/ → rules + skills/</div>
      <div class="flow-step" style="background:rgba(127,127,127,0.06);color:var(--text);font-size:12px;padding:6px 12px;">~/.codex/ ~/.kimi/ ...</div>
    </div>
  </div>
  <div class="cards cards-3 fade-in">
    <div class="card" style="padding:16px;">
      <h3 style="font-size:14px;">零侵入</h3>
      <p style="font-size:12px;">不覆盖已有配置。写自己的文件，通过 @include 引入。</p>
    </div>
    <div class="card" style="padding:16px;">
      <h3 style="font-size:14px;">软链 Skill</h3>
      <p style="font-size:12px;">升级 ROLL 后重跑 setup，所有 AI 工具几秒内同步。</p>
    </div>
    <div class="card" style="padding:16px;">
      <h3 style="font-size:14px;">3 条 CLI 命令</h3>
      <p style="font-size:12px;"><strong>roll setup</strong> · <strong>roll init</strong> · <strong>roll update</strong></p>
    </div>
  </div>

## Slide 17
title_en: "A Feature's Complete Journey"
title_zh: "一个功能的完整旅程"
body_en: |
  <span class="tag fade-in">Walkthrough</span>
  <h2 class="fade-in">A Feature's Complete Journey</h2>
  <p class="section-desc fade-in" style="margin-bottom: 10px;">Example: shipping a "User Login" feature across all three loops.</p>
  <div class="timeline fade-in">
    <div class="timeline-item">
      <h4>9:00 AM — Idea enters the Pipeline</h4>
      <p>PM submits: "We need user login." $roll-design runs DDD modeling, decomposes into 3 Stories (password, OAuth, remember-me), writes AC.</p>
    </div>
    <div class="timeline-item">
      <h4>9:30 AM — $roll-loop picks up US-001</h4>
      <p>$roll-build starts TCR delivery. Verify + commit every 3 minutes. 12 tests passing in 30 min. 8 micro-commits.</p>
    </div>
    <div class="timeline-item">
      <h4>10:00 AM — $roll-spar auto-triggers</h4>
      <p>Auth module flagged as high-risk. Attacker tries SQL injection, brute force, session hijacking. Defender patches. 5 rounds, coverage: 71% → 93%.</p>
    </div>
    <div class="timeline-item">
      <h4>10:15 AM — $roll-peer reviews the design</h4>
      <p>Cross-agent negotiation flags a session management concern. 2 rounds of discussion. Consensus reached, implementation adjusted.</p>
    </div>
    <div class="timeline-item">
      <h4>10:30 AM — CI green → UAT → Evidence captured</h4>
      <p>Screenshots + curl responses captured. Verify stage complete. AI nudges: "UAT passed. Ready to release?"</p>
    </div>
    <div class="timeline-item">
      <h4>10:45 AM — Human approves → Release</h4>
      <p>Deployed. BACKLOG status: ✅ Done. $roll-sentinel begins monitoring.</p>
    </div>
    <div class="timeline-item">
      <h4>3:00 AM — $roll-.dream nightly scan</h4>
      <p>Detects an emerging pattern: 3 similar auth helpers could be extracted. Creates REFACTOR-015 in BACKLOG.</p>
    </div>
    <div class="timeline-item">
      <h4>Next Day — $roll-sentinel catches anomaly</h4>
      <p>OAuth endpoint response time degrading (3 consecutive failures). Auto-creates FIX-012. $roll-fix patches + regression test. Resolved before users notice.</p>
    </div>
  </div>
body_zh: |
  <span class="tag fade-in">完整走查</span>
  <h2 class="fade-in">一个功能的完整旅程</h2>
  <p class="section-desc fade-in" style="margin-bottom: 10px;">示例：把「用户登录」功能跑完三个 Loop。</p>
  <div class="timeline fade-in">
    <div class="timeline-item">
      <h4>9:00 — 想法进入流水线</h4>
      <p>PM 提需求：「要做用户登录」。$roll-design 做 DDD 建模，拆成 3 个 Story（密码、OAuth、记住我），写好 AC。</p>
    </div>
    <div class="timeline-item">
      <h4>9:30 — $roll-loop 拣起 US-001</h4>
      <p>$roll-build 启动 TCR 交付。每 3 分钟一次验证 + 提交。30 分钟跑过 12 个测试，8 次微提交。</p>
    </div>
    <div class="timeline-item">
      <h4>10:00 — $roll-spar 自动触发</h4>
      <p>认证模块被标记为高风险。攻方尝试 SQL 注入、暴力破解、会话劫持。守方打补丁。5 轮后覆盖率 71% → 93%。</p>
    </div>
    <div class="timeline-item">
      <h4>10:15 — $roll-peer 复核方案</h4>
      <p>跨 Agent 协商发现一个会话管理问题。讨论 2 轮达成共识，调整实现。</p>
    </div>
    <div class="timeline-item">
      <h4>10:30 — CI 全绿 → UAT → 采集活证据</h4>
      <p>截图 + curl 响应已采集，Verify 阶段完成。AI 提醒：「UAT 通过，准备发布？」</p>
    </div>
    <div class="timeline-item">
      <h4>10:45 — 人审批 → 发布</h4>
      <p>已发布。BACKLOG 状态变 ✅ Done。$roll-sentinel 接手监控。</p>
    </div>
    <div class="timeline-item">
      <h4>凌晨 3:00 — $roll-.dream 夜间扫描</h4>
      <p>检出涌现模式：3 处相似的认证辅助函数可抽取。创建 REFACTOR-015。</p>
    </div>
    <div class="timeline-item">
      <h4>次日 — $roll-sentinel 捕获异常</h4>
      <p>OAuth 端点响应变慢（连续 3 次失败）。自动创建 FIX-012。$roll-fix 修补 + 回归测试。用户察觉前已解决。</p>
    </div>
  </div>

## Slide 18
title_en: "ROLL's Core Logic"
title_zh: "ROLL 的核心逻辑"
body_en: |
  <span class="tag fade-in">Summary</span>
  <h2 class="fade-in" style="font-size: 32px;">ROLL's Core Logic</h2>
  <div class="highlight-box fade-in" style="margin-top: 18px; margin-bottom: 20px; max-width: 880px;">
    <p style="font-size: 16px; color: var(--text-bright); font-weight: 500; line-height: 1.7;">Take 20 years of proven engineering practices (TDD / TCR / CI / DDD / SRE)<br>and encode them as standardized AI Agent work instructions.<br>AI won't cut corners, won't get tired, won't "skip the tests this time" —<br><span style="color:var(--accent-light);">because that branch doesn't exist in its instructions.</span></p>
  </div>
  <div class="cards cards-3 fade-in" style="max-width: 880px;">
    <div class="card" style="text-align:center;border-top:3px solid var(--green);">
      <div style="font-size:24px;margin-bottom:6px;">⚡</div>
      <h3 style="color:var(--green-text);font-size:15px;">Fast · 快</h3>
      <p>Requirement to production: hours<br>Zero-rework micro-step delivery<br>New dev onboards in minutes</p>
    </div>
    <div class="card" style="text-align:center;border-top:3px solid var(--cyan);">
      <div style="font-size:24px;margin-bottom:6px;">🛡️</div>
      <h3 style="color:var(--cyan-text);font-size:15px;">Solid · 稳</h3>
      <p>Four automated lines of defense<br>Live-evidence verification<br>Sentinel + Dream 24/7 watch</p>
    </div>
    <div class="card" style="text-align:center;border-top:3px solid var(--orange);">
      <div style="font-size:24px;margin-bottom:6px;">🤝</div>
      <h3 style="color:var(--orange-text);font-size:15px;">Aligned · 齐</h3>
      <p>23 skills, one unified system<br>Three-layer autonomy<br>Human decides, AI delivers</p>
    </div>
  </div>
  <div class="fade-in" style="margin-top: 24px; text-align: center;">
    <p style="font-size: 13px; color: var(--text-dim);">@seanyao/roll · MIT · 23 skills · <code>npm install -g @seanyao/roll</code></p>
  </div>
body_zh: |
  <span class="tag fade-in">总结</span>
  <h2 class="fade-in" style="font-size: 32px;">ROLL 的核心逻辑</h2>
  <div class="highlight-box fade-in" style="margin-top: 18px; margin-bottom: 20px; max-width: 880px;">
    <p style="font-size: 16px; color: var(--text-bright); font-weight: 500; line-height: 1.7;">把 20 年沉淀的工程实践（TDD / TCR / CI / DDD / SRE）<br>编码为标准化的 AI Agent 工作指令。<br>AI 不会偷懒、不会疲惫、不会「这次先跳过测试」——<br><span style="color:var(--accent-light);">因为它的指令里根本没有那条分支。</span></p>
  </div>
  <div class="cards cards-3 fade-in" style="max-width: 880px;">
    <div class="card" style="text-align:center;border-top:3px solid var(--green);">
      <div style="font-size:24px;margin-bottom:6px;">⚡</div>
      <h3 style="color:var(--green-text);font-size:15px;">快</h3>
      <p>需求到生产：小时级<br>零返工的微步交付<br>新人几分钟上手</p>
    </div>
    <div class="card" style="text-align:center;border-top:3px solid var(--cyan);">
      <div style="font-size:24px;margin-bottom:6px;">🛡️</div>
      <h3 style="color:var(--cyan-text);font-size:15px;">稳</h3>
      <p>四道自动化防线<br>活证据验证<br>Sentinel + Dream 7×24 守望</p>
    </div>
    <div class="card" style="text-align:center;border-top:3px solid var(--orange);">
      <div style="font-size:24px;margin-bottom:6px;">🤝</div>
      <h3 style="color:var(--orange-text);font-size:15px;">齐</h3>
      <p>23 个 Skill，统一一套体系<br>三层自治模型<br>人来决策，AI 来交付</p>
    </div>
  </div>
  <div class="fade-in" style="margin-top: 24px; text-align: center;">
    <p style="font-size: 13px; color: var(--text-dim);">@seanyao/roll · MIT · 23 个 Skill · <code>npm install -g @seanyao/roll</code></p>
  </div>
