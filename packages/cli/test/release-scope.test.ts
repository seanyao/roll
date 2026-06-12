/** US-DOSSIER-016 — pending/shipped scope from merge truth + version history. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectHistory, collectReleaseScope } from "../src/lib/release-scope.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function project(opts: { changelog?: string; events?: object[] } = {}): string {
  const p = mkdtempSync(join(tmpdir(), "roll-scope-"));
  dirs.push(p);
  mkdirSync(join(p, ".roll", "loop"), { recursive: true });
  if (opts.changelog !== undefined) writeFileSync(join(p, "CHANGELOG.md"), opts.changelog);
  if (opts.events !== undefined) writeFileSync(join(p, ".roll", "loop", "events.ndjson"), opts.events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return p;
}

describe("collectReleaseScope", () => {
  it("splits pending (not done) vs shipped (done) and counts match the head arithmetic", () => {
    const p = project();
    const vm = collectReleaseScope(p, [
      { id: "US-A-1", epic: "alpha", title: "done one", state: "done", claim: "✅ Done (PR#638)" },
      { id: "US-A-2", epic: "alpha", title: "wip", state: "wip" },
      { id: "US-B-1", epic: "beta", title: "todo", state: "todo" },
      { id: "US-B-2", epic: "beta", title: "claimed done no truth", state: "unknown" },
    ]);
    expect(vm.shippedCount).toBe(1);
    expect(vm.pendingCount).toBe(3); // total - done: wip + todo + unknown
    expect(vm.shipped[0]?.items[0]?.prNumber).toBe(638); // merge truth from the PR# annotation
  });

  it("pr:merge events beat the claim annotation", () => {
    const p = project({ events: [{ type: "pr:merge", prNumber: 999, storyId: "US-A-1", ts: 1 }] });
    const vm = collectReleaseScope(p, [{ id: "US-A-1", epic: "a", title: "t", state: "done", claim: "✅ Done (PR#1)" }]);
    expect(vm.shipped[0]?.items[0]?.prNumber).toBe(999);
  });

  it("groups by epic, biggest groups first", () => {
    const p = project();
    const vm = collectReleaseScope(p, [
      { id: "1", epic: "small", title: "t", state: "todo" },
      { id: "2", epic: "big", title: "t", state: "todo" },
      { id: "3", epic: "big", title: "t", state: "wip" },
    ]);
    expect(vm.pending[0]?.epic).toBe("big");
  });
});

describe("collectHistory", () => {
  it("parses version sections with dates and bullet items; flags waived tags", () => {
    const p = project({
      changelog: "# Changelog\n\n## Unreleased\n\n- not a version\n\n## v3.612.2 — 2026-06-12\n\n### 稳定性\n\n- fixed `a thing` (FIX-1)\n- another **bold** item\n\n## v3.612.1 — 2026-06-12\n\n- old item\n",
      events: [{ type: "release:gate", tag: "v3.612.1", verdict: "waived", failCount: 0, waivedRules: ["truth-board"], ts: 1 }],
    });
    const h = collectHistory(p);
    expect(h.map((x) => x.tag)).toEqual(["v3.612.2", "v3.612.1"]);
    expect(h[0]?.items).toEqual(["fixed a thing (FIX-1)", "another bold item"]);
    expect(h[0]?.waived).toBe(false);
    expect(h[1]?.waived).toBe(true);
  });
});
