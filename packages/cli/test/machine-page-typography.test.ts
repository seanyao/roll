import { describe, expect, it } from "vitest";
import type { TruthSnapshot } from "@roll/spec";
import type { AgentPanelRow } from "../src/lib/agent-panel.js";
import { collectAbout, renderAboutPage } from "../src/lib/page-about.js";
import { renderAgentsMachinePage } from "../src/lib/page-agents.js";
import { collectConventions, renderConventionsPage } from "../src/lib/page-conventions.js";
import { renderSkillsPage } from "../src/lib/page-skills.js";
import { renderToolsPage } from "../src/lib/page-tools.js";
import { collectToolPanel } from "../src/lib/tool-panel.js";
import type { SkillsPanelVM } from "../src/lib/skills-panel.js";

const BRAND = { name: "roll", slogan: "It just works." };
const SNAP: TruthSnapshot = {
  generatedAt: "2026-06-16T00:00:00Z",
  story: { total: 0, spectrum: { done: 0, wip: 0, hold: 0, todo: 0, fail: 0, unknown: 0 }, legacy: 0 },
  release: { latestTag: "v3.615.1", verdict: "pass" },
};

const AGENTS: AgentPanelRow[] = [
  { name: "claude", display: "claude", runner: "Claude Code", version: "2.1.0", installed: true, cycles72h: 1, costUsd72h: 0, files: [], syncStale: false },
];

const SKILLS: SkillsPanelVM = {
  summary: { skills: 0, violations: 0, hubLines: 0, auditRan: true },
  groups: [],
};

function pages(): Record<string, string> {
  return {
    agents: renderAgentsMachinePage({ brand: BRAND, snapshot: SNAP, agents: AGENTS }),
    skills: renderSkillsPage({ brand: BRAND, snapshot: SNAP, skills: SKILLS }),
    conventions: renderConventionsPage({
      brand: BRAND,
      snapshot: SNAP,
      vm: collectConventions({
        agents: AGENTS,
        readConfig: () => "",
        readDoc: () => "# Conventions",
        render: (md) => `<p>${md}</p>`,
      }),
    }),
    about: renderAboutPage({ brand: BRAND, snapshot: SNAP, vm: collectAbout({ docExists: () => true }) }),
    tools: renderToolsPage({ brand: BRAND, snapshot: SNAP, tools: collectToolPanel() }),
  };
}

describe("machine pages — FIX-287 typography baseline", () => {
  it("uses the console Charter masthead scale on all machine pages", () => {
    for (const [name, html] of Object.entries(pages())) {
      expect(html, name).toContain("font-size:28px;line-height:1.1");
      expect(html, name).not.toContain("font-size:33px;line-height:1.1");
      expect(html, name).not.toContain("font-size:30px;line-height:1.15");
      expect(html, name).not.toContain("font-size:15.5px;line-height:1.6");
    }
  });

  it("loads the same IBM Plex font links as the console on all machine pages", () => {
    for (const [name, html] of Object.entries(pages())) {
      expect(html, name).toContain("fonts.googleapis.com");
      expect(html, name).toContain("IBM+Plex+Sans");
      expect(html, name).toContain("IBM+Plex+Mono");
    }
  });
});
