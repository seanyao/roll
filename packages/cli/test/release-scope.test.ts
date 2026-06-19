/**
 * US-DOSSIER-016 / FIX-372 — pending = the NEXT release's content (stories
 * merged to main SINCE the latest release tag), shipped = already inside a tag,
 * plus version history. The huge "all non-done" backlog count no longer appears
 * on Release — it belongs on the Backlog tab.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectHistory,
  collectReleaseScope,
  parseGitMergeLog,
  selectReleaseDelta,
  type ReleaseDeltaFacts,
  type ScopeStoryInput,
} from "../src/lib/release-scope.js";

describe("parseGitMergeLog (pure) — FIX-372 git-since-tag source", () => {
  it("extracts card id + commit ts + PR# from post-tag squash-merge subjects", () => {
    const log = [
      "1781870000\tStory: US-AGENT-042 — rebuild self-downgrade (#843)",
      "1781860000\tFix: FIX-356c — rewrite public docs (#847)",
      "1781850000\tStory: US-TOOL-016 — built-in tool catalog data source (#856)",
      "1781840000\tchore: no card id here",
    ].join("\n");
    const m = parseGitMergeLog(log);
    expect([...m.keys()].sort()).toEqual(["FIX-356c", "US-AGENT-042", "US-TOOL-016"]);
    expect(m.get("US-AGENT-042")).toEqual({ ts: 1781870000, prNumber: 843 });
    expect(m.get("FIX-356c")).toEqual({ ts: 1781860000, prNumber: 847 });
  });
  it("keeps the newest commit when an id appears twice (reverse-chron)", () => {
    const m = parseGitMergeLog("1781870000\tFix: FIX-368 — newest (#858)\n1781000000\tFix: FIX-368 — older");
    expect(m.get("FIX-368")?.ts).toBe(1781870000);
  });
  it("empty/garbage log → empty map", () => {
    expect(parseGitMergeLog("").size).toBe(0);
    expect(parseGitMergeLog("notanumber\tStory: FIX-1").size).toBe(0);
  });
});

describe("collectReleaseScope — git-sourced delta lands as pending (FIX-372)", () => {
  it("a Done story merged after the tag (per git facts) is pending, not the whole backlog", () => {
    const stories: ScopeStoryInput[] = [
      { id: "US-TOOL-016", epic: "tools-layer", title: "catalog", state: "done" },
      { id: "FIX-100", epic: "old", title: "shipped long ago", state: "done" },
      { id: "US-TODO-1", epic: "x", title: "open", state: "todo" },
    ];
    // inject facts as if from git: US-TOOL-016 merged after the tag, FIX-100 before.
    const facts: ReleaseDeltaFacts = {
      merges: new Map([
        ["US-TOOL-016", { ts: 2000, prNumber: 856 }],
        ["FIX-100", { ts: 500 }],
      ]),
      latestTagTime: 1000,
      latestTag: "v3.619.1",
    };
    const { pending, shipped } = selectReleaseDelta(stories, facts);
    expect(pending.map((s) => s.id)).toEqual(["US-TOOL-016"]); // only the post-tag merge
    expect(shipped.map((s) => s.id)).toEqual(["FIX-100"]); // pre-tag = already shipped
    // the open todo is NOT release scope at all
    expect([...pending, ...shipped].map((s) => s.id)).not.toContain("US-TODO-1");
  });
});

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

const TAG_TIME = 1_000_000;
function facts(over: Partial<ReleaseDeltaFacts> = {}): ReleaseDeltaFacts {
  return { merges: new Map(), latestTagTime: TAG_TIME, latestTag: "v3.619.1", ...over };
}

describe("selectReleaseDelta (pure) — FIX-372", () => {
  it("pending = Done stories merged AFTER the latest tag; already-tagged Done = shipped", () => {
    const stories: ScopeStoryInput[] = [
      { id: "FIX-NEW", epic: "rel", title: "merged after the tag", state: "done" },
      { id: "FIX-OLD", epic: "rel", title: "merged before the tag", state: "done" },
      { id: "FIX-NOTS", epic: "rel", title: "done, no merge ts known", state: "done" },
    ];
    const { pending, shipped } = selectReleaseDelta(
      stories,
      facts({
        merges: new Map([
          ["FIX-NEW", { prNumber: 900, ts: TAG_TIME + 50 }], // after the tag → pending
          ["FIX-OLD", { prNumber: 800, ts: TAG_TIME - 50 }], // before the tag → shipped
        ]),
      }),
    );
    expect(pending.map((s) => s.id)).toEqual(["FIX-NEW"]);
    expect(pending[0]?.prNumber).toBe(900);
    expect(shipped.map((s) => s.id).sort()).toEqual(["FIX-NOTS", "FIX-OLD"]);
  });

  it("non-Done stories are NOT release scope — the open backlog is dropped entirely", () => {
    const stories: ScopeStoryInput[] = [
      { id: "US-WIP", epic: "a", title: "wip", state: "wip" },
      { id: "US-TODO", epic: "a", title: "todo", state: "todo" },
      { id: "US-HOLD", epic: "a", title: "hold", state: "hold" },
      { id: "US-UNK", epic: "a", title: "claimed but unproven", state: "unknown" },
    ];
    const { pending, shipped } = selectReleaseDelta(stories, facts());
    expect(pending).toEqual([]);
    expect(shipped).toEqual([]);
  });

  it("when the latest-tag time is unknown, nothing is 'after' it → empty pending, not the whole backlog", () => {
    const stories: ScopeStoryInput[] = [{ id: "FIX-X", epic: "a", title: "t", state: "done" }];
    const { pending, shipped } = selectReleaseDelta(
      stories,
      facts({ latestTagTime: undefined, merges: new Map([["FIX-X", { prNumber: 1, ts: 9_999_999 }]]) }),
    );
    expect(pending).toEqual([]);
    expect(shipped.map((s) => s.id)).toEqual(["FIX-X"]);
  });

  it("a merge ts exactly AT the tag time counts as shipped (boundary), not pending", () => {
    const stories: ScopeStoryInput[] = [{ id: "FIX-B", epic: "a", title: "t", state: "done" }];
    const { pending, shipped } = selectReleaseDelta(stories, facts({ merges: new Map([["FIX-B", { prNumber: 2, ts: TAG_TIME }]]) }));
    expect(pending).toEqual([]);
    expect(shipped.map((s) => s.id)).toEqual(["FIX-B"]);
  });
});

describe("collectReleaseScope — FIX-372", () => {
  it("groups pending by epic (biggest first) and counts only the post-tag delta", () => {
    const p = project();
    const vm = collectReleaseScope(
      p,
      [
        { id: "FIX-1", epic: "big", title: "t", state: "done" },
        { id: "FIX-2", epic: "big", title: "t", state: "done" },
        { id: "FIX-3", epic: "small", title: "t", state: "done" },
        { id: "US-OPEN", epic: "small", title: "still open", state: "todo" }, // dropped — not scope
      ],
      facts({
        merges: new Map([
          ["FIX-1", { prNumber: 1, ts: TAG_TIME + 1 }],
          ["FIX-2", { prNumber: 2, ts: TAG_TIME + 2 }],
          ["FIX-3", { prNumber: 3, ts: TAG_TIME + 3 }],
        ]),
      }),
    );
    expect(vm.pendingCount).toBe(3);
    expect(vm.pending[0]?.epic).toBe("big"); // biggest group first
    expect(vm.latestTag).toBe("v3.619.1");
  });

  it("regression (spec AC5): with a tag set and a FIX merged after it, pending = that FIX only, not the whole backlog", () => {
    // 240 open backlog cards + 1 already-shipped Done + 1 Done merged after the tag.
    const open: ScopeStoryInput[] = Array.from({ length: 240 }, (_, i) => ({
      id: `US-OPEN-${i}`,
      epic: "legacy",
      title: "open wish",
      state: "todo",
    }));
    const stories: ScopeStoryInput[] = [
      ...open,
      { id: "FIX-SHIPPED", epic: "rel", title: "already in v3.619.1", state: "done" },
      { id: "FIX-372", epic: "release-management", title: "the next cut", state: "done" },
    ];
    const vm = collectReleaseScope(
      project(),
      stories,
      facts({
        merges: new Map([
          ["FIX-SHIPPED", { prNumber: 700, ts: TAG_TIME - 100 }],
          ["FIX-372", { prNumber: 841, ts: TAG_TIME + 100 }],
        ]),
      }),
    );
    expect(vm.pendingCount).toBe(1); // NOT ~241
    expect(vm.pending[0]?.items[0]?.id).toBe("FIX-372");
    expect(vm.shippedCount).toBe(1);
    expect(vm.shipped[0]?.items[0]?.id).toBe("FIX-SHIPPED");
  });

  it("reads merge facts from pr:merge events when no facts are injected (impure seam)", () => {
    // No latest-tag time resolvable on a fresh temp repo → everything Done is
    // shipped, pending is empty (the honest fresh-repo / no-git-tag case).
    const p = project({ events: [{ type: "pr:merge", prNumber: 999, storyId: "FIX-A", ts: 5 }] });
    const vm = collectReleaseScope(p, [{ id: "FIX-A", epic: "a", title: "t", state: "done", claim: "✅ Done (PR#1)" }]);
    expect(vm.pendingCount).toBe(0);
    expect(vm.shippedCount).toBe(1);
    // merge truth: the pr:merge event's PR number wins over the claim annotation.
    expect(vm.shipped[0]?.items[0]?.prNumber).toBe(999);
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
