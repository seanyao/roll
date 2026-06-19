(function () {
  const DATA = window.RollSkillDiagrams;
  const COLORS = {
    plan: "var(--plan)",
    build: "var(--build)",
    ship: "var(--ship)",
    verify: "var(--verify)",
    gate: "var(--gate)"
  };

  function lang() {
    return document.documentElement.getAttribute("data-lang") === "zh" ? "zh" : "en";
  }

  function t(value) {
    if (!value) return "";
    if (typeof value === "string") return value;
    return value[lang()] || value.en || "";
  }

  function setLang(next) {
    const l = next === "zh" ? "zh" : "en";
    document.documentElement.setAttribute("data-lang", l);
    document.documentElement.setAttribute("lang", l === "zh" ? "zh-CN" : "en");
    try { localStorage.setItem("roll-ig-lang", l); } catch (e) { /* noop */ }
    document.querySelectorAll(".chrome button").forEach((button) => {
      button.classList.toggle("on", button.getAttribute("data-set") === l);
    });
    render();
  }

  function html(strings, ...values) {
    return strings.reduce((out, chunk, i) => out + chunk + (values[i] ?? ""), "");
  }

  function chipList(chips, colorKey) {
    if (!chips || chips.length === 0) return "";
    return chips.map((chip) => `<span class="chip" style="--c:${COLORS[colorKey] || COLORS.plan}">${chip}</span>`).join("");
  }

  function renderHeader(skill) {
    const isOverview = !skill.name;
    return html`
      <header>
        <div class="topbar">
          <div>
            <p class="kicker">${isOverview ? "roll skills" : "roll skill"}</p>
            <h1>${skill.name || t(skill.title)}
              ${skill.name ? `<span class="sub">${t(skill.title)} · ${t(skill.sub)}</span>` : `<span class="sub">${t(skill.sub)}</span>`}
            </h1>
            <p class="lede">${t(skill.lede)}</p>
            <div class="actions">
              <a class="btn" href="../index.html#skills">${lang() === "zh" ? "回到首页" : "Back to home"}</a>
              ${isOverview ? "" : `<a class="btn" href="roll-skills-map.html">${lang() === "zh" ? "查看全景图" : "View system map"}</a>`}
            </div>
          </div>
        </div>
      </header>
      <div class="rule"></div>
    `;
  }

  function renderModes(skill) {
    if (!skill.modes) return "";
    return html`
      <div class="funnel">
        ${skill.modes.map((mode) => html`
          <div class="mode">
            <h3><span class="tag">${mode.tag}</span> ${t(mode.title)}</h3>
            <p>${t(mode.body)}</p>
          </div>
        `).join("")}
      </div>
      <div class="merge">${t(skill.merge)}</div>
    `;
  }

  function renderLegend() {
    const labels = lang() === "zh"
      ? [["plan", "规划"], ["build", "执行"], ["ship", "落地"], ["verify", "验证"]]
      : [["plan", "Plan"], ["build", "Execute"], ["ship", "Land"], ["verify", "Verify"]];
    return html`
      <div class="legend">
        ${labels.map(([key, label]) => `<span><i class="dot" style="background:${COLORS[key]}"></i>${label}</span>`).join("")}
        <span><i class="gatekey" style="background:var(--gate)">G</i>${lang() === "zh" ? "硬闸" : "Hard gate"}</span>
      </div>
    `;
  }

  function renderSpine(skill) {
    return html`
      <div class="spine">
        ${skill.bands.map((band) => html`
          <div class="band" style="--c:${COLORS[band.key] || COLORS.plan}">${t(band.label)}</div>
          ${band.steps.map((step) => html`
            <div class="step${step.gate ? " gate" : ""}${step.loop ? " loop" : ""}" style="--c:${step.gate ? COLORS.gate : (COLORS[band.key] || COLORS.plan)}">
              <div class="card">
                <div class="no">${step.no}</div>
                <div class="ttl">${t(step.title)} ${chipList(step.chips, step.gate ? "gate" : band.key)}</div>
                <p class="desc">${t(step.desc)}</p>
              </div>
            </div>
          `).join("")}
        `).join("")}
      </div>
    `;
  }

  function renderFoot(skill) {
    if (!skill.foot) return "";
    return html`
      <div class="foot">
        ${skill.foot.map((box) => html`
          <div class="box${box.hard ? " hard" : ""}">
            <h4>${t(box.title)}</h4>
            <ul>${(box.items?.[lang()] || box.items?.en || []).map((item) => `<li>${item}</li>`).join("")}</ul>
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderSkill(skill) {
    document.title = `${skill.id} · Roll skill`;
    return renderHeader(skill) + renderModes(skill) + renderLegend() + renderSpine(skill) + renderFoot(skill);
  }

  function overviewSkills() {
    const generated = DATA.skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      href: `${skill.id}-skill.html`,
      title: skill.title,
      text: {
        en: tWith("en", skill.lede).replace(/<[^>]+>/g, ""),
        zh: tWith("zh", skill.lede).replace(/<[^>]+>/g, "")
      },
      flow: {
        en: skill.bands.map((band) => tWith("en", band.label).toLowerCase()).join(" -> "),
        zh: skill.bands.map((band) => tWith("zh", band.label)).join(" -> ")
      }
    }));
    return [...generated.slice(0, 1), ...DATA.existing, ...generated.slice(1)];
  }

  function skillById(id) {
    return DATA.skills.find((skill) => skill.id === id);
  }

  function skillSummary(id) {
    const skill = skillById(id);
    if (!skill) return "";
    return t(skill.lede).replace(/<[^>]+>/g, "");
  }

  function skillFlow(id) {
    const skill = skillById(id);
    if (!skill?.bands) return "";
    return skill.bands.map((band) => t(band.label)).join(" -> ");
  }

  function localizedRelations(l) {
    const text = {
      en: {
        onboardIdea: ".roll scaffold creates the backlog and feature-card homes",
        ideaDesign: "discussion-worthy IDEA rows become design input",
        ideaFix: "bug-like captures become FIX rows",
        designBuild: "signed-off INVEST stories enter one-cycle delivery",
        designPeer: "direction, context-map, and aggregate choices can ask for dissent",
        buildPeer: "risky cycle plans can ask for a fresh external perspective",
        buildReview: "delivery PRs receive diff-grounded review",
        fixReview: "repair PRs receive diff-grounded review",
        debugFix: "source-traced owned root cause enters focused repair",
        docDesign: "documentation gaps restore design context and ubiquitous language",
        doctorBuild: "skill and convention health protects cycle execution",
        peerDesign: "REFINE / OBJECT returns to design",
        peerBuild: "REFINE / OBJECT can return to delivery planning",
        doctorOnboard: "broken install/convention state can block onboarding"
      },
      zh: {
        onboardIdea: ".roll 脚手架建立 backlog 与 feature card 的落点",
        ideaDesign: "值得讨论的 IDEA 行进入设计输入",
        ideaFix: "缺陷类捕获成为 FIX 行",
        designBuild: "已签字 INVEST stories 进入单 cycle 交付",
        designPeer: "方向、Context Map、Aggregate 选择可请求异议",
        buildPeer: "高风险 cycle 方案可请求外部新视角",
        buildReview: "交付 PR 进入基于 diff 的 review",
        fixReview: "修复 PR 进入基于 diff 的 review",
        debugFix: "可追溯到源码的项目自有根因进入聚焦修复",
        docDesign: "文档缺口补回设计上下文和统一语言",
        doctorBuild: "skill 与 convention 健康守住 cycle 执行面",
        peerDesign: "REFINE / OBJECT 回到设计",
        peerBuild: "REFINE / OBJECT 可回到交付规划",
        doctorOnboard: "安装 / 约定异常可能阻断接入"
      }
    }[l];
    return [
      ["roll-onboard", "roll-idea", "artifact", text.onboardIdea],
      ["roll-idea", "roll-design", "handoff", text.ideaDesign],
      ["roll-idea", "roll-fix", "handoff", text.ideaFix],
      ["roll-design", "roll-build", "handoff", text.designBuild],
      ["roll-design", "roll-peer", "gate", text.designPeer],
      ["roll-build", "roll-peer", "gate", text.buildPeer],
      ["roll-build", "roll-review-pr", "gate", text.buildReview],
      ["roll-fix", "roll-review-pr", "gate", text.fixReview],
      ["roll-debug", "roll-fix", "control", text.debugFix],
      ["roll-doc-audit", "roll-design", "control", text.docDesign],
      ["roll-doctor", "roll-build", "control", text.doctorBuild],
      ["roll-doctor", "roll-onboard", "control", text.doctorOnboard],
      ["roll-peer", "roll-design", "control", text.peerDesign],
      ["roll-peer", "roll-build", "control", text.peerBuild]
    ];
  }

  function renderMapNode(id, tone, feeds) {
    const skill = skillById(id);
    if (!skill) return "";
    return html`
      <a class="map-node ${tone || ""}" href="${id}-skill.html" data-skill-node="${id}">
        <span class="map-node-name">${skill.name}</span>
        <span class="map-node-title">${t(skill.title)}</span>
        <span class="map-node-copy">${skillSummary(id)}</span>
        <span class="map-node-flow">${skillFlow(id)}</span>
        ${feeds ? `<span class="map-node-feeds">${feeds}</span>` : ""}
      </a>
    `;
  }

  function renderSkillMap() {
    const l = lang();
    const stages = [
      {
        key: "design",
        title: { en: "Loop A · Design", zh: "Loop A · 设计" },
        flow: { en: "Intent -> Backlog -> Design contract", zh: "意图 → Backlog → 设计契约" },
        body: { en: "Raw intent becomes backlog claims, DDD-backed design, AC, and INVEST stories.", zh: "原始意图变成 backlog 声明、DDD 设计、AC 和 INVEST stories。" },
        context: "BDD / Scrum / DDD",
        anchors: [".roll/backlog.md", ".roll/features/*", ".roll/domain/*"],
        nodes: [
          ["roll-onboard", "entry", l === "zh" ? ".roll/onboard-plan.yaml -> roll init --apply" : ".roll/onboard-plan.yaml -> roll init --apply"],
          ["roll-idea", "entry", l === "zh" ? "IDEA/FIX row -> .roll/backlog.md" : "IDEA/FIX row -> .roll/backlog.md"],
          ["roll-design", "shape", l === "zh" ? ".roll/features + AC -> cycle" : ".roll/features + AC -> cycle"]
        ]
      },
      {
        key: "build",
        title: { en: "Loop B · Implementation & Iteration", zh: "Loop B · 实现与迭代" },
        flow: { en: "Story -> Cycle/TCR -> PR/CI -> main", zh: "Story → Cycle/TCR → PR/CI → main" },
        body: { en: "One story enters an isolated cycle, moves through TCR, PR, review, CI, and merge.", zh: "一个 story 进入隔离 cycle，经 TCR、PR、review、CI 和 merge 落到主干。" },
        context: "TDD / TCR / CI-CD",
        anchors: ["Cycle", "TCR commit", "Delivery PR", "Review Score"],
        nodes: [
          ["roll-build", "change", l === "zh" ? "TCR commits + evidence -> PR" : "TCR commits + evidence -> PR"],
          ["roll-fix", "change", l === "zh" ? "regression signal -> focused TCR" : "regression signal -> focused TCR"],
          ["roll-peer", "assure", l === "zh" ? "AGREE / REFINE / OBJECT / ESCALATE" : "AGREE / REFINE / OBJECT / ESCALATE"],
          ["roll-review-pr", "assure", l === "zh" ? "APPROVE / REQUEST_CHANGES / UNCERTAIN" : "APPROVE / REQUEST_CHANGES / UNCERTAIN"]
        ]
      },
      {
        key: "operate",
        title: { en: "Loop C · Observability & Maintenance", zh: "Loop C · 可观测与维护" },
        flow: { en: "Truth + signals -> Backlog", zh: "真相 + 信号 → Backlog" },
        body: { en: "Production, docs, tool health, and owner context feed anomalies and drift back to the backlog.", zh: "生产、文档、工具链健康和 owner context 把异常与漂移送回 backlog。" },
        context: "SRE / Patrol / Docs",
        anchors: ["Doc gaps", "Tool health"],
        nodes: [
          ["roll-debug", "operate", l === "zh" ? "diagnostics -> FIX / source patch" : "diagnostics -> FIX / source patch"],
          ["roll-doc-audit", "operate", l === "zh" ? "docs/product drift -> docs / design context" : "docs/product drift -> docs / design context"],
          ["roll-doctor", "operate", l === "zh" ? "convention/skill health -> roll setup" : "convention/skill health -> roll setup"]
        ]
      }
    ];
    const relations = localizedRelations(l);
    return html`
      <section class="map-system" aria-label="${l === "zh" ? "技能连接全景图" : "Connected skill map"}">
        <div class="map-canvas">
          <div class="map-board">
            ${stages.map((stage, i) => html`
              <section class="map-stage ${stage.key}">
                <div class="map-stage-head">
                  <span class="map-context-label">${stage.context}</span>
                  <span class="map-stage-index">${t(stage.title)}</span>
                  <span class="map-stage-flow">${t(stage.flow)}</span>
                  <p>${t(stage.body)}</p>
                  <div class="map-anchor-row">
                    ${stage.anchors.map((anchor) => `<span>${anchor}</span>`).join("")}
                  </div>
                </div>
                <div class="map-stage-nodes">
                  ${stage.nodes.map(([id, tone, feeds]) => renderMapNode(id, tone, feeds)).join("")}
                </div>
                ${i < stages.length - 1 ? `<span class="map-forward" aria-hidden="true">-></span>` : ""}
              </section>
            `).join("")}
          </div>
          <div class="map-return-line">
            <span>${l === "zh" ? "Truth / Control rail: backlog claim ↔ main + attest + TerminalOutcome；control signals 只生成待确认反馈，不自动改目标。" : "Truth / Control rail: backlog claim ↔ main + attest + TerminalOutcome; control signals create confirmable feedback, not automatic goal changes."}</span>
          </div>
        </div>
        <div class="map-relations sr-only">
          <div class="map-relation-grid">
            ${relations.map(([from, to, type, why]) => html`
              <div class="map-relation" data-loop-from="${from}" data-loop-to="${to}" data-relation-type="${type}">
                <span class="kind">${type}</span>
                <span class="from">${from}</span>
                <span class="arrow">-></span>
                <span class="to">${to}</span>
                <span class="why">${why}</span>
              </div>
            `).join("")}
          </div>
        </div>
      </section>
    `;
  }

  function installMapInteractions(root) {
    const system = root.querySelector(".map-system");
    if (!system) return;
    const nodes = Array.from(system.querySelectorAll("[data-skill-node]"));
    const loops = Array.from(system.querySelectorAll("[data-loop-from]"));
    const setActive = (id) => {
      system.classList.add("is-filtering");
      nodes.forEach((node) => node.classList.toggle("is-active", node.dataset.skillNode === id));
      loops.forEach((loop) => {
        const from = loop.dataset.loopFrom || "";
        const to = loop.dataset.loopTo || "";
        const hit = from === id || to === id;
        loop.classList.toggle("is-active", hit);
        if (hit) {
          nodes.forEach((node) => {
            const nodeId = node.dataset.skillNode;
            if (from === nodeId || to === nodeId) {
              node.classList.add("is-active");
            }
          });
        }
      });
    };
    const clearActive = () => {
      system.classList.remove("is-filtering");
      nodes.forEach((node) => node.classList.remove("is-active"));
      loops.forEach((loop) => loop.classList.remove("is-active"));
    };
    nodes.forEach((node) => {
      node.addEventListener("mouseenter", () => setActive(node.dataset.skillNode));
      node.addEventListener("focus", () => setActive(node.dataset.skillNode));
      node.addEventListener("mouseleave", clearActive);
      node.addEventListener("blur", clearActive);
    });
  }

  function tWith(l, value) {
    if (!value) return "";
    if (typeof value === "string") return value;
    return value[l] || value.en || "";
  }

  function renderOverview() {
    const overview = DATA.overview;
    document.title = "Roll skills map";
    return html`
      ${renderHeader({
        title: overview.title,
        sub: overview.sub,
        lede: overview.lede
      })}
      ${renderSkillMap()}
    `;
  }

  function render() {
    const root = document.getElementById("skill-root");
    if (!root) return;
    const id = root.getAttribute("data-skill");
    if (id === "overview") {
      root.innerHTML = renderOverview();
    } else {
      const skill = DATA.skills.find((item) => item.id === id);
      if (!skill) {
        root.innerHTML = `<p class="lede">Unknown skill: ${id}</p>`;
      } else {
        root.innerHTML = renderSkill(skill);
      }
    }
    root.insertAdjacentHTML("beforeend", html`
      <footer>
        <span>Roll · ${id === "overview" ? "skills map" : id}</span>
        <span>${lang() === "zh" ? "可视化 skill 契约" : "visual skill contract"}</span>
      </footer>
    `);
    if (id === "overview") installMapInteractions(root);
  }

  function init() {
    let initial;
    try { initial = localStorage.getItem("roll-ig-lang"); } catch (e) { /* noop */ }
    if (!initial) {
      const requested = new URLSearchParams(location.search).get("lang");
      initial = requested === "zh" || requested === "en"
        ? requested
        : ((navigator.language || "").toLowerCase().startsWith("zh") ? "zh" : "en");
    }
    document.querySelectorAll(".chrome button").forEach((button) => {
      button.addEventListener("click", () => setLang(button.getAttribute("data-set")));
    });
    setLang(initial);
  }

  init();
})();
