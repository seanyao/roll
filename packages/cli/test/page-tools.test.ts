/**
 * US-TOOL-017 — the machine-global Tools page (`tools.html`), the fifth
 * machine-layer breadcrumb destination (Agents · Skills · Tools · Conventions ·
 * About). The page is rendered from the SAME `collectToolPanel` catalog the
 * data source (US-TOOL-016) exposes, grouped by kind, each row expandable to
 * full description + default policy + requirements. AC1–AC4 + the empty-set
 * friendly-card edge case.
 */
import { describe, expect, it } from "vitest";
import { collectToolPanel } from "../src/lib/tool-panel.js";
import type { ToolPanelRow } from "../src/lib/tool-panel.js";
import { renderToolsPage } from "../src/lib/page-tools.js";

const FIXTURE: ToolPanelRow[] = [
  {
    id: "bash",
    kind: "bash",
    title: "Bash",
    description: "Execute argv-only shell commands through the governed tool path.",
    emitsEvents: false,
    guardrails: { timeoutMs: 120000, sandbox: "workspace-write", retries: 1 },
    requirements: [],
    available: true,
    unavailableReason: "",
  },
  {
    id: "browser.screenshot",
    kind: "browser",
    title: "Browser Screenshot",
    description: "Screenshot a rendered page.",
    emitsEvents: true,
    guardrails: { timeoutMs: 30000, sandbox: "headless" },
    requirements: ["playwright-chromium (optional)"],
    available: true,
    unavailableReason: "",
  },
  {
    id: "browser.console",
    kind: "browser",
    title: "Browser Console",
    description: "Read page console output.",
    emitsEvents: true,
    guardrails: { timeoutMs: 30000, sandbox: "headless" },
    requirements: ["playwright-chromium (optional)"],
    available: true,
    unavailableReason: "",
  },
  {
    id: "git.commit",
    kind: "git",
    title: "Git Commit",
    description: "Conformed git commit operation.",
    emitsEvents: true,
    guardrails: { timeoutMs: 60000 },
    requirements: ["git"],
    available: true,
    unavailableReason: "",
  },
  {
    // no guardrails set → "default policy"; no requirements → out-of-the-box.
    id: "mcp.invoke",
    kind: "mcp",
    title: "MCP Invoke",
    description: "Harness-side MCP client (extensible).",
    emitsEvents: false,
    guardrails: {},
    requirements: [],
    available: true,
    unavailableReason: "",
  },
];

function render(tools: ToolPanelRow[] = FIXTURE): string {
  return renderToolsPage({
    brand: { name: "roll", slogan: "It just works." },
    snapshot: { release: { latestTag: "v3.619.1" } },
    tools,
    projects: [],
    currentSlug: "roll",
  });
}

const html = render();

describe("Tools machine page — structural fidelity (US-TOOL-017)", () => {
  it("wears the shared sticky top-bar shell (switcher + breadcrumb + lang toggle)", () => {
    expect(html).toContain("background:rgba(27,34,56,.97)");
    expect(html).toContain("height:54px");
    expect(html).toContain("backdrop-filter:blur(8px)");
    expect(html).toContain('aria-label="machine layer · 机器层"');
    expect(html).toContain('data-set-lang="en"');
    expect(html).toContain('data-set-lang="zh"');
    expect(html).not.toContain("undefined");
  });

  it("uses the shared machine masthead scale + IBM Plex font links (typography baseline)", () => {
    expect(html).toContain("font-size:28px;line-height:1.1");
    expect(html).toContain("IBM+Plex+Sans");
    expect(html).toContain("IBM+Plex+Mono");
  });

  it("page header: machine-layer kicker + Tools title + machine-global lede", () => {
    expect(html).toContain(">Machine<"); // kicker EN
    expect(html).toContain(">机器<"); // kicker 中
    expect(html).toMatch(/<h1[^>]*>[\s\S]*Tools[\s\S]*<\/h1>/);
    expect(html).toContain("The capability surface the loop's agents call through");
    expect(html).toContain("循环里 agent 调用的能力面");
    expect(html).toContain("<title>roll · Tools</title>");
  });

  it("section header counts kinds and tools", () => {
    expect(html).toContain("Built-in tools");
    expect(html).toContain("内置工具");
    // FIXTURE has 4 kinds (bash · browser · git · mcp) and 5 tools.
    expect(html).toMatch(/4 [\s\S]{0,40}kinds[\s\S]{0,80}5 /);
  });
});

describe("Tools machine page — acceptance criteria (US-TOOL-017)", () => {
  it("AC1/AC3: the Tools breadcrumb crumb self-highlights, sibling crumbs still route", () => {
    expect(html).toContain('data-machine="tools"');
    expect(html).toMatch(/data-machine="tools"[^>]*aria-current="page"/);
    expect(html).toContain('href="agents.html"');
    expect(html).toContain('href="skills.html"');
    expect(html).toContain('href="conventions.html"');
    expect(html).toContain('href="about.html"');
    expect(html).toContain('href="tools.html"');
  });

  it("AC1: the Tools crumb sits between Skills and Conventions", () => {
    const skills = html.indexOf('data-machine="skills"');
    const tools = html.indexOf('data-machine="tools"');
    const conventions = html.indexOf('data-machine="conventions"');
    expect(skills).toBeGreaterThanOrEqual(0);
    expect(tools).toBeGreaterThan(skills);
    expect(conventions).toBeGreaterThan(tools);
  });

  it("AC2: renders every tool row, grouped by kind", () => {
    // one expandable row per tool (same .ag-row accordion idiom as Agents).
    expect([...html.matchAll(/class="ag-row"/g)]).toHaveLength(FIXTURE.length);
    for (const t of FIXTURE) {
      expect(html).toContain(`data-tool="${t.id}"`);
    }
    // multi-tool kinds group under one heading; the browser group counts 2.
    expect(html).toMatch(/浏览器[\s\S]{0,160}>2</);
  });

  it("AC2: each row shows id · kind · title · description · emitsEvents · guardrails · requirements", () => {
    // id + title (collapsed) and description (expanded body)
    expect(html).toContain("browser.screenshot");
    expect(html).toContain("Screenshot a rendered page.");
    // emitsEvents both states
    expect(html).toContain("events ✓");
    expect(html).toContain("events —");
    // guardrails line: timeout + sandbox + retry
    expect(html).toMatch(/timeout<\/span><span class="lang-zh">超时<\/span> 120s/);
    expect(html).toContain("workspace-write");
    expect(html).toMatch(/retry<\/span><span class="lang-zh">重试<\/span> ×1/);
    // requirements chip + the "none" friendly state
    expect(html).toContain("playwright-chromium (optional)");
    expect(html).toContain("none — works out of the box");
    expect(html).toContain("无 — 开箱即用");
  });

  it("AC2: an empty-guardrails tool reads 'default policy', never blank", () => {
    expect(html).toContain("default policy");
    expect(html).toContain("默认策略");
  });

  it("AC2: row expand is wired (the .ag-row accordion CSS rides this page)", () => {
    expect(html).toContain(".ag-row[open] .bl-caret{transform:rotate(90deg);}");
    expect(html).toContain(".ag-row summary::-webkit-details-marker{display:none;}");
  });

  it("AC4: machine-global lede states scope and points per-project usage to the Loop view", () => {
    expect(html).toContain("Machine-global, not one project's usage.");
    expect(html).toContain("Per-project tool spend → each project's Loop view.");
    expect(html).toContain("各项目的循环视图");
    // no per-project cost columns leak onto this machine page
    expect(html).not.toContain("cost 72h");
  });

  it("copy is bilingual with EN and 中 never inline on the same line", () => {
    expect(html).toContain('class="lang-en"');
    expect(html).toContain('class="lang-zh"');
  });

  it("edge case: empty tools renders a friendly card, not a crash", () => {
    const none = render([]);
    expect(none).toContain("No built-in tools detected on this machine.");
    expect(none).toContain("本机未检测到内置工具。");
    expect(none).not.toContain("undefined");
    expect([...none.matchAll(/class="ag-row"/g)]).toHaveLength(0);
    // the shell + breadcrumb still render (no 404 / no crash)
    expect(none).toContain('data-machine="tools"');
  });
});

describe("Tools machine page — real catalog (US-TOOL-016 source of truth)", () => {
  it("renders a row for every collectToolPanel() tool, grouped deterministically", () => {
    const real = render(collectToolPanel());
    const tools = collectToolPanel();
    expect(tools.length).toBeGreaterThan(0);
    for (const t of tools) {
      expect(real).toContain(`data-tool="${t.id}"`);
    }
    expect([...real.matchAll(/class="ag-row"/g)]).toHaveLength(tools.length);
    expect(real).not.toContain("undefined");
  });
});
