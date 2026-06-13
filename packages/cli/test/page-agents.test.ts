/**
 * US-DOSSIER-031 — the machine-global Agents page (`agents.html`), reached from
 * the top-bar breadcrumb. Structural-fidelity: every agents-section component
 * the design reference (`Delivery Dossier.dc.html`) defines is present, rendered
 * from the SAME `collectAgentPanel` rows the Loop tab uses. AC1–AC7 + the AC3
 * "not-installed is gray, never red" hard rule.
 */
import { describe, expect, it } from "vitest";
import type { AgentPanelRow } from "../src/lib/agent-panel.js";
import { renderAgentsMachinePage } from "../src/lib/page-agents.js";

const AGENTS: AgentPanelRow[] = [
  {
    name: "claude",
    display: "claude",
    runner: "Claude Code",
    version: "2.1.0",
    installed: true,
    cycles72h: 6,
    costUsd72h: 0.24,
    files: [{ path: "/home/u/.claude/CLAUDE.md", kind: "CLAUDE.md", state: "sync" }],
    syncStale: false,
  },
  {
    // installed but idle (zero cycles) — AC2: still renders a row.
    name: "kimi",
    display: "kimi",
    runner: "Kimi CLI",
    version: "0.9.2",
    installed: true,
    cycles72h: 0,
    costUsd72h: 0,
    files: [{ path: "/home/u/.kimi/AGENTS.md", kind: "AGENTS.md", state: "stale" }],
    syncStale: true,
    setupCmd: "roll setup -f kimi",
  },
  {
    // not installed / not detected — AC3: gray "expected", never red.
    name: "glm",
    display: "glm",
    runner: "Zhipu CLI",
    version: "—",
    installed: false,
    cycles72h: 0,
    costUsd72h: 0,
    files: [],
    syncStale: false,
  },
];

function render(agents: AgentPanelRow[] = AGENTS): string {
  return renderAgentsMachinePage({
    brand: { name: "roll", slogan: "It just works." },
    snapshot: { release: { latestTag: "v3.612.2" } },
    agents,
    projects: [],
    currentSlug: "roll",
  });
}

const html = render();

/**
 * The agents-section components the design reference (`Delivery Dossier.dc.html`,
 * the "agents on this machine" block) defines for THIS surface. Each must be
 * present and laid out as in the `.dc.html` — not omitted, not flattened.
 */
describe("Agents machine page — structural fidelity (US-DOSSIER-031)", () => {
  it("wears the shared sticky top-bar shell (switcher + breadcrumb + lang toggle)", () => {
    // dark sticky 54px bar, same geometry as the console
    expect(html).toContain("background:rgba(27,34,56,.97)");
    expect(html).toContain("height:54px");
    expect(html).toContain("backdrop-filter:blur(8px)");
    // breadcrumb + lang toggle ride along (one shell)
    expect(html).toContain('aria-label="machine layer · 机器层"');
    expect(html).toContain('data-set-lang="en"');
    expect(html).toContain('data-set-lang="zh"');
    expect(html).not.toContain("undefined");
  });

  it("page header: machine-layer kicker + Agents title + bilingual lede", () => {
    expect(html).toContain(">Machine<"); // kicker EN
    expect(html).toContain(">机器<"); // kicker 中
    expect(html).toMatch(/<h1[^>]*>[\s\S]*Agents[\s\S]*<\/h1>/);
    expect(html).toContain("What this machine knows how to run");
    expect(html).toContain("这台机器会跑什么");
  });

  it("agents section header: 'Agents on this machine' + roll-doctor sub + hairline", () => {
    expect(html).toContain("Agents on this machine");
    expect(html).toContain("本机 agents");
    expect(html).toContain("detected by roll doctor — the loop dispatches to these");
    expect(html).toContain("roll doctor 检测——循环向它们派活");
    expect(html).toContain("height:1px;background:#dfe4ec"); // section hairline rule
  });

  it("agent row columns: runner / version / cycles 72h / cost 72h labels", () => {
    expect(html).toContain(">runner<");
    expect(html).toContain(">版本<");
    expect(html).toContain("cycles 72h");
    expect(html).toContain("近72h周期");
    expect(html).toContain("cost 72h");
  });

  it("expanded convention-file sync truth: ✓ in sync / ⟳ stale / − missing motif", () => {
    expect(html).toContain("convention files");
    expect(html).toContain("接入文件");
    expect(html).toContain("✓ in sync");
    expect(html).toContain("⟳ stale");
    // file rows carry path + kind
    expect(html).toContain("/home/u/.claude/CLAUDE.md");
    expect(html).toContain("/home/u/.kimi/AGENTS.md");
  });
});

describe("Agents machine page — acceptance criteria (US-DOSSIER-031)", () => {
  it("AC1: the Agents breadcrumb crumb self-highlights (machine destination)", () => {
    expect(html).toContain('data-machine="agents"');
    expect(html).toContain('aria-current="page"');
    // sibling crumbs still route (leaving returns to the prior console view)
    expect(html).toContain('href="skills.html"');
    expect(html).toContain('href="conventions.html"');
    expect(html).toContain('href="about.html"');
  });

  it("AC2: machine scope — every agent renders a row, incl. installed-but-idle", () => {
    // 3 expandable agent rows (one per <details class="ag-row">)
    expect([...html.matchAll(/class="ag-row"/g)]).toHaveLength(3);
    expect(html).toContain(">claude<");
    expect(html).toContain(">kimi<"); // installed but 0 cycles still present
    expect(html).toContain(">glm<"); // not installed still present
    // installed-count label states the machine roster + 72h window scope
    expect(html).toMatch(/2\/3[\s\S]{0,40}installed · 72h window/);
  });

  it("AC3: a not-installed agent is gray 'expected', never red", () => {
    expect(html).toContain("not detected");
    expect(html).toContain("未检测到");
    expect(html).toContain("opacity:.62"); // greyed, not errored
    // the not-installed row carries no drift/red palette
    expect(html).not.toContain("#c2402a");
    expect(html).not.toContain("#d23b3b");
  });

  it("AC4: stale agent → amber badge + copyable repair chip; in-sync agent → neither", () => {
    expect(html).toContain("convention stale");
    expect(html).toContain("约定过期");
    // copyable (clickable) repair chip, not a static <code>
    expect(html).toContain('class="copy-chip" data-copy="roll setup -f kimi"');
    // a fully in-sync agent has NO setup chip for itself (the `.copy-chip`
    // handler always lives in the shared script — assert the rendered chip element).
    const onlySync = render([AGENTS[0]!]);
    expect(onlySync).not.toContain("convention stale");
    expect(onlySync).not.toContain('class="copy-chip" data-copy="roll setup');
  });

  it("AC5: runner/version/72h cycles/72h cost from the panel; fixed-window label", () => {
    expect(html).toContain("Claude Code");
    expect(html).toContain("Kimi CLI");
    expect(html).toContain("2.1.0");
    expect(html).toContain(">6<"); // claude cycles72h
    expect(html).toContain("$0.24"); // claude cost72h
    // a zero-cycle agent shows an honest dash, not $0.00
    expect(html).toContain(">—<");
    expect(html).toContain("72h window");
    expect(html).toContain("72h 窗口");
  });

  it("AC6: row expand is wired (the .ag-row accordion CSS rides this page)", () => {
    expect(html).toContain(".ag-row[open] .bl-caret{transform:rotate(90deg);}");
    expect(html).toContain(".ag-row summary::-webkit-details-marker{display:none;}");
  });

  it("AC7: new copy is bilingual with EN and 中 never inline on the same line", () => {
    // each user-visible string pair lives in a lang-* span (separate lines via CSS)
    expect(html).toContain('class="lang-en"');
    expect(html).toContain('class="lang-zh"');
    // no EN and 中 jammed inside one text node (e.g. "Agents 本机")
    expect(html).not.toMatch(/Agents on this machine\s*本机 agents/);
  });

  it("empty machine: no agents detected renders an honest empty state, no error", () => {
    const none = render([]);
    expect(none).toContain("no agents detected on this machine");
    expect(none).toContain("本机未检测到 agent");
    expect(none).not.toContain("undefined");
    expect([...none.matchAll(/class="ag-row"/g)]).toHaveLength(0);
  });
});
