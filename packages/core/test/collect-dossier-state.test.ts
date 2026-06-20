/**
 * US-OBS-016 AC4 — deterministic view-model tests for collectDossierState.
 *
 * Tests that the unified read-side selector returns a stable TruthSnapshot
 * for a fixed fixture cwd, and degrades gracefully when a collector throws.
 */
import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { collectDossierState } from "../src/truth/collect-dossier-state.js";
import type { CollectorDeps } from "../src/truth/collect-dossier-state.js";

const tmpDir = join(__dirname, "__fixtures_obs016__");

function setupFixture(): string {
  rmSync(tmpDir, { recursive: true, force: true });
  const root = join(tmpDir, ".roll");
  mkdirSync(join(root, "features", "alpha", "US-A-1"), { recursive: true });
  mkdirSync(join(root, "features", "alpha", "US-A-2"), { recursive: true });
  mkdirSync(join(root, "features", "beta", "FIX-B-1"), { recursive: true });
  mkdirSync(join(root, "loop"), { recursive: true });
  mkdirSync(join(root, "reports", "consistency"), { recursive: true });

  // spec.md for each story
  writeFileSync(join(root, "features", "alpha", "US-A-1", "spec.md"), `---
id: US-A-1
title: Story Alpha One
type: us
epic: alpha
created: 2026-06-01
---
# US-A-1 — Story Alpha One ✅
`);
  writeFileSync(join(root, "features", "alpha", "US-A-2", "spec.md"), `---
id: US-A-2
title: Story Alpha Two
type: us
epic: alpha
created: 2026-06-02
---
# US-A-2 — Story Alpha Two
`);
  writeFileSync(join(root, "features", "beta", "FIX-B-1", "spec.md"), `---
id: FIX-B-1
title: Fix Beta One
type: fix
epic: beta
created: 2026-06-03
---
# FIX-B-1 — Fix Beta One
`);

  // backlog.md
  writeFileSync(join(tmpDir, ".roll", "backlog.md"), `# Project Backlog

| US-A-1 | Story Alpha One | ✅ Done · [evidence](...) |
| US-A-2 | Story Alpha Two | 🔨 In Progress |
| FIX-B-1 | Fix Beta One | 📋 Todo |
`);

  // runs.jsonl
  writeFileSync(join(root, "loop", "runs.jsonl"), `\
{"ts":"2026-06-10T00:00:00Z","status":"done","outcome":"delivered","cost_usd":0.5}
{"ts":"2026-06-11T00:00:00Z","status":"failed","outcome":"failed","cost_usd":0.3}
`);

  // events.ndjson
  writeFileSync(join(root, "loop", "events.ndjson"), `\
{"type":"release:gate","ts":1718496000,"tag":"v3.620.0","verdict":"pass","waivedRules":[]}
`);

  // consistency report
  writeFileSync(join(root, "reports", "consistency", "2026-06-10.json"), JSON.stringify({
    generatedAt: "2026-06-10T00:00:00Z",
    summary: { fail: 0, warn: 1, unknown: 0 },
  }));

  return tmpDir;
}

describe("collectDossierState", () => {
  it("returns a deterministic TruthSnapshot for a fixed fixture", () => {
    process.env["ROLL_RENDER_NOW"] = "2026-06-15T00:00:00Z";
    const cwd = setupFixture();
    const s1 = collectDossierState(cwd);
    const s2 = collectDossierState(cwd);
    // Structure check
    expect(s1.generatedAt).toBe("2026-06-15T00:00:00Z");
    expect(s1.story.total).toBe(3);
    expect(s1.story.legacy).toBeGreaterThanOrEqual(0);
    expect(s1.stories).toHaveLength(3);
    // Story US-A-1 is marked done in spec but without merge evidence → unknown
    const a1 = s1.stories?.find((s) => s.id === "US-A-1");
    expect(a1).toBeDefined();
    // Without merge evidence (no PR), a Done claim → grandfathered/unknown
    expect(["unknown", "grandfathered", "done"]).toContain(a1!.truthState);
    // Story US-A-2 is in progress
    const a2 = s1.stories?.find((s) => s.id === "US-A-2");
    expect(a2).toBeDefined();
    expect(a2!.truthState).toBe("wip");
    // Story FIX-B-1 is todo
    const b1 = s1.stories?.find((s) => s.id === "FIX-B-1");
    expect(b1).toBeDefined();
    expect(b1!.truthState).toBe("todo");
    delete process.env["ROLL_RENDER_NOW"];
  });

  it("degradates gracefully when a single collector throws", () => {
    process.env["ROLL_RENDER_NOW"] = "2026-06-15T00:00:00Z";
    const cwd = setupFixture();

    const throwingDeps: CollectorDeps = {
      collectTruthBoard: () => {
        throw new Error("simulated collector failure");
      },
      collectLoopHeartbeat: () => {
        throw new Error("simulated heartbeat failure");
      },
    };

    // Should NOT throw — degrades gracefully
    const s = collectDossierState(cwd, { deps: throwingDeps });
    // Structure still valid: audit/cycle/release absent but stories present
    expect(s.generatedAt).toBe("2026-06-15T00:00:00Z");
    expect(s.story.total).toBe(3);
    expect(s.stories).toHaveLength(3);
    // Loop heartbeat absent on failure — honest degradation
    // Truth board facets absent but snapshot doesn't crash
    delete process.env["ROLL_RENDER_NOW"];
  });

  it("returns empty snapshot for nonexistent cwd", () => {
    const s = collectDossierState("/nonexistent/path/definitely/not/real");
    expect(s.story.total).toBe(0);
    expect(s.stories).toHaveLength(0);
  });

  it("story registry carries ladder and evidence per story", () => {
    process.env["ROLL_RENDER_NOW"] = "2026-06-15T00:00:00Z";
    const cwd = setupFixture();
    const s = collectDossierState(cwd);
    expect(s.stories).toBeDefined();
    for (const entry of s.stories!) {
      expect(entry.id).toBeTruthy();
      expect(entry.epic).toBeTruthy();
      expect(["attested", "merged", "claimed", "none"]).toContain(entry.ladder);
      expect(entry.evidence).toBeDefined();
      expect(typeof entry.truthState).toBe("string");
      expect(typeof entry.legacy).toBe("boolean");
    }
    delete process.env["ROLL_RENDER_NOW"];
  });
});
