/**
 * FIX-1047 — scoped `story.execute` (Builder) routing honors the Prime
 * assignment and exposes an auditable route trace.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  renderCastRoleRoute,
  resolveCastRoleRoute,
  castRoleRouteTrace,
  renderScopedExecuteRoute,
  resolveScopedStoryExecute,
  scopedExecuteRouteTrace,
} from "../src/runner/scoped-route.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const MACHINE = `schema: roll-agents/v1
scope: machine
agents:
  claude:
    capabilities: [supervise, execute, evaluate]
  agy:
    capabilities: [supervise, execute, evaluate]
  kimi:
    capabilities: [supervise, execute, evaluate]
  pi:
    capabilities: [supervise, execute, evaluate]
  reasonix:
    capabilities: [supervise, execute, evaluate]
  codex:
    capabilities: [supervise, execute, evaluate]
roles:
  supervise:
    kind: fixed
    agent: codex
`;

const PROJECT = `schema: roll-agents/v1
scope: project
inherits: machine
defaults:
  story:
    roles:
      execute:
        kind: select
        from: [claude, agy, kimi, pi, reasonix, codex]
        require: [execute]
        avoid: [supervise]
        strategy: least-recent
`;

/** Build a {rollHome, repoCwd} pair seeded with the machine + project layers. */
function fixture(): { rollHome: string; repoCwd: string } {
  const rollHome = mkdtempSync(join(tmpdir(), "roll-home-"));
  const repoCwd = mkdtempSync(join(tmpdir(), "roll-proj-"));
  dirs.push(rollHome, repoCwd);
  writeFileSync(join(rollHome, "agents.yaml"), MACHINE);
  mkdirSync(join(repoCwd, ".roll"), { recursive: true });
  writeFileSync(join(repoCwd, ".roll", "agents.yaml"), PROJECT);
  return { rollHome, repoCwd };
}

const ALL_INSTALLED = new Set(["claude", "agy", "kimi", "pi", "reasonix", "codex"]);

describe("resolveScopedStoryExecute (FIX-1047)", () => {
  it("excludes the assigned Prime (codex) from the Builder pool by identity", () => {
    const { rollHome, repoCwd } = fixture();
    const route = resolveScopedStoryExecute(repoCwd, { rollHome, installed: ALL_INSTALLED, recentUse: {} });
    expect(route).not.toBeNull();
    expect(route!.superviseAgent).toBe("codex");
    expect(route!.resolution.ok).toBe(true);
    if (route!.resolution.ok) {
      // codex is the Prime → skipped by assignment; least-recent with no recent
      // use picks the first never-used candidate (claude).
      expect(route!.resolution.resolved.agent).toBe("claude");
      expect(route!.resolution.resolved.skipped).toContainEqual({
        agent: "codex",
        reason: "assigned-to-avoided-role: supervise",
      });
    }
  });

  it("rotates fairly: a recently-used Builder yields to a never-used candidate", () => {
    const { rollHome, repoCwd } = fixture();
    // claude built most recently; pi/agy/etc never used → least-recent skips claude.
    const route = resolveScopedStoryExecute(repoCwd, {
      rollHome,
      installed: ALL_INSTALLED,
      recentUse: { claude: 1000, agy: 2000, kimi: 3000 },
    });
    expect(route!.resolution.ok).toBe(true);
    if (route!.resolution.ok) {
      // pi and reasonix were never used (codex is Prime, excluded) → first declared
      // never-used wins: pi.
      expect(route!.resolution.resolved.agent).toBe("pi");
    }
  });

  it("the never-Prime, supervise-capable agents stay eligible", () => {
    const { rollHome, repoCwd } = fixture();
    const route = resolveScopedStoryExecute(repoCwd, { rollHome, installed: ALL_INSTALLED, recentUse: {} });
    const trace = scopedExecuteRouteTrace(route!);
    // Only codex (the Prime) is skipped despite ALL agents having supervise cap.
    expect(trace.skipped).toEqual([{ agent: "codex", reason: "assigned-to-avoided-role: supervise" }]);
    expect(trace.candidates).toEqual(["claude", "agy", "kimi", "pi", "reasonix", "codex"]);
    expect(trace.supervise).toBe("codex");
  });

  it("returns null when no scoped agents.yaml is present", () => {
    const repoCwd = mkdtempSync(join(tmpdir(), "roll-bare-"));
    dirs.push(repoCwd);
    const route = resolveScopedStoryExecute(repoCwd, { rollHome: repoCwd, installed: ALL_INSTALLED });
    expect(route).toBeNull();
  });

  it("renders an auditable trace with candidates, skipped reasons, and selection", () => {
    const { rollHome, repoCwd } = fixture();
    const route = resolveScopedStoryExecute(repoCwd, { rollHome, installed: ALL_INSTALLED, recentUse: {} });
    const text = renderScopedExecuteRoute(scopedExecuteRouteTrace(route!));
    expect(text).toContain("Builder route — story.execute");
    expect(text).toContain("Prime (supervise): codex");
    expect(text).toContain("strategy: least-recent");
    expect(text).toContain("codex — assigned-to-avoided-role: supervise");
    expect(text).toContain("selected: claude");
  });
});

describe("resolveCastRoleRoute — US-AGENT-049", () => {
  it("ranks builder candidates from the open pool with scores and reasons", () => {
    const { rollHome, repoCwd } = fixture();
    const route = resolveCastRoleRoute(repoCwd, "builder", "US-OBS-042", { rollHome, installed: ALL_INSTALLED });
    expect(route).not.toBeNull();
    expect(route!.role).toBe("builder");
    expect(route!.storyId).toBe("US-OBS-042");
    expect(route!.candidates.length).toBe(6);
    const kimi = route!.candidates.find((c) => c.agent === "kimi");
    expect(kimi?.reasons).toContain("strong builder");
    expect(typeof kimi?.score).toBe("number");
  });

  it("does not select an auth-degraded agent ahead of healthy builders", () => {
    const { rollHome, repoCwd } = fixture();
    const runtimeDir = join(repoCwd, ".roll", "loop");
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(
      join(runtimeDir, "events.ndjson"),
      JSON.stringify({ type: "agent:blocked", agent: "agy", classification: "auth_block", severity: "error", detail: "login prompt", ts: Date.now() }) + "\n",
    );
    const route = resolveCastRoleRoute(repoCwd, "builder", "US-OBS-042", { rollHome, installed: ALL_INSTALLED });
    const agy = route!.candidates.find((c) => c.agent === "agy");
    expect(agy?.eligible).toBe(false);
    expect(route!.selected).not.toBe("agy");
  });

  it("renders the worked-sample route trace shape", () => {
    const { rollHome, repoCwd } = fixture();
    const route = resolveCastRoleRoute(repoCwd, "builder", "US-OBS-042", { rollHome, installed: ALL_INSTALLED });
    const text = renderCastRoleRoute(castRoleRouteTrace(route!));
    expect(text).toContain("builder candidates:");
    expect(text).toContain("selected:");
    expect(text).toMatch(/score\s+\d+/);
  });
});
