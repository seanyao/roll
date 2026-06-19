/**
 * FIX-368 — the dossier's "latest released version" is reconciled from reality
 * (newest v* git tag / package version / CHANGELOG top), never frozen at a
 * stale `release:gate` event cache.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  reconcileLatestRelease,
  reconcileReleaseForProject,
  type ReleaseFacts,
  type ReleaseFactsReader,
} from "../src/lib/release-truth.js";

describe("reconcileLatestRelease — pure version reconciliation (FIX-368)", () => {
  it("prefers the newest v* git tag over a stale event-stream gate tag", () => {
    // THE regression for THIS bug: the gate cache froze at v3.612.2 while the
    // newest real tag moved on to v3.619.1. Reality must win.
    const facts: ReleaseFacts = {
      tags: ["v3.618.3", "v3.619.1", "v3.617.2"],
      packageVersion: "3.619.1",
      gateTag: "v3.612.2",
    };
    expect(reconcileLatestRelease(facts)).toEqual({ latestTag: "v3.619.1", prevTag: "v3.618.3" });
  });

  it("is correct with NO release:gate event at all — derives from tags alone", () => {
    expect(reconcileLatestRelease({ tags: ["v3.619.1", "v3.618.3"], packageVersion: "3.619.1" })).toEqual({
      latestTag: "v3.619.1",
      prevTag: "v3.618.3",
    });
  });

  it("filters legacy-scheme tags by the running major so they cannot masquerade as latest", () => {
    // A former calver scheme left `v2026.*` / `v2.*` tags whose numeric major
    // dwarfs v3 — they must NOT outrank the live v3 release.
    const facts: ReleaseFacts = {
      tags: ["v2026.601.4", "v2.9.9", "v3.619.1", "v3.618.3"],
      packageVersion: "3.619.1",
    };
    expect(reconcileLatestRelease(facts)).toEqual({ latestTag: "v3.619.1", prevTag: "v3.618.3" });
  });

  it("orders by calver seq, not lexicographically (v3.619.10 > v3.619.2)", () => {
    expect(reconcileLatestRelease({ tags: ["v3.619.2", "v3.619.10"], packageVersion: "3.619.1" })).toEqual({
      latestTag: "v3.619.10",
      prevTag: "v3.619.2",
    });
  });

  it("the CHANGELOG history and package version are candidates too (defense in depth)", () => {
    // No git tags at all (a fresh clone without fetched tags) — the package
    // version and the CHANGELOG history still pin latest+prev, never the stale gate.
    expect(reconcileLatestRelease({ packageVersion: "3.619.1", changelogTags: ["v3.618.3", "v3.617.2"], gateTag: "v3.612.2" })).toEqual({
      latestTag: "v3.619.1",
      prevTag: "v3.618.3",
    });
  });

  it("falls back to the gate tag only when nothing else is known", () => {
    expect(reconcileLatestRelease({ gateTag: "v3.612.2" })).toEqual({ latestTag: "v3.612.2" });
  });

  it("returns empty when there is no signal at all", () => {
    expect(reconcileLatestRelease({})).toEqual({});
  });

  it("de-dupes the same version arriving from tag + changelog + package", () => {
    const out = reconcileLatestRelease({
      tags: ["v3.619.1"],
      changelogTags: ["v3.619.1"],
      packageVersion: "3.619.1",
    });
    expect(out).toEqual({ latestTag: "v3.619.1" }); // single distinct version → no prevTag
  });
});

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("reconcileReleaseForProject — injectable reader (FIX-368)", () => {
  it("uses the injected reader (no real git/fs needed)", () => {
    const reader: ReleaseFactsReader = () => ({ tags: ["v3.619.1", "v3.618.3"], packageVersion: "3.619.1", gateTag: "v3.612.2" });
    expect(reconcileReleaseForProject("/whatever", reader)).toEqual({ latestTag: "v3.619.1", prevTag: "v3.618.3" });
  });

  it("the default reader reads CHANGELOG top + package version off disk", () => {
    const p = mkdtempSync(join(tmpdir(), "roll-reltruth-"));
    dirs.push(p);
    writeFileSync(join(p, "package.json"), JSON.stringify({ version: "3.619.1" }));
    writeFileSync(join(p, "CHANGELOG.md"), "# Changelog\n\n## Unreleased\n\n- wip\n\n## v3.619.1 — 2026-06-19\n\n- shipped\n\n## v3.618.3 — 2026-06-18\n\n- prev\n");
    // No git tags in an OS-tmp dir → reconciliation rests on changelog/package.
    expect(reconcileReleaseForProject(p)).toEqual({ latestTag: "v3.619.1", prevTag: "v3.618.3" });
  });
});

describe("releaseTruthBoard integration — dossier renders the real latest, not the stale gate (FIX-368)", () => {
  function project(opts: { events?: object[]; changelog?: string; version?: string } = {}): string {
    const p = mkdtempSync(join(tmpdir(), "roll-reltruth-int-"));
    dirs.push(p);
    mkdirSync(join(p, ".roll", "loop"), { recursive: true });
    if (opts.events !== undefined) {
      writeFileSync(join(p, ".roll", "loop", "events.ndjson"), opts.events.map((e) => JSON.stringify(e)).join("\n") + "\n");
    }
    if (opts.changelog !== undefined) writeFileSync(join(p, "CHANGELOG.md"), opts.changelog);
    if (opts.version !== undefined) writeFileSync(join(p, "package.json"), JSON.stringify({ version: opts.version }));
    return p;
  }

  it("a stream whose newest release:gate is v3.612.2 but with v3.619.1 released → #release shows v3.619.1", async () => {
    const p = project({
      events: [{ type: "release:gate", tag: "v3.612.2", verdict: "pass", failCount: 0, waivedRules: [], ts: 1781233743 }],
      version: "3.619.1",
      changelog: "# Changelog\n\n## v3.619.1 — 2026-06-19\n\n- shipped\n\n## v3.618.3 — 2026-06-18\n\n- prev\n",
    });
    const { collectTruthBoardInput } = await import("../src/commands/index-gen.js");
    const truth = collectTruthBoardInput(p, Date.parse("2026-06-19T06:00:00Z") / 1000);
    expect(truth.release?.latestTag).toBe("v3.619.1"); // NOT the stale v3.612.2
    // The verdict is honestly "unknown" because the newest gate fact predates the
    // shown release — it is never the stale gate's "pass".
    expect(truth.release?.verdict).toBe("unknown");
  });

  it("when the gate fact matches the latest tag, its verdict is carried through", async () => {
    const p = project({
      events: [{ type: "release:gate", tag: "v3.619.1", verdict: "pass", failCount: 0, waivedRules: [], ts: 1781233743 }],
      version: "3.619.1",
      changelog: "# Changelog\n\n## v3.619.1 — 2026-06-19\n\n- shipped\n",
    });
    const { collectTruthBoardInput } = await import("../src/commands/index-gen.js");
    const truth = collectTruthBoardInput(p, Date.parse("2026-06-19T06:00:00Z") / 1000);
    expect(truth.release?.latestTag).toBe("v3.619.1");
    expect(truth.release?.verdict).toBe("pass");
  });

  it("collectReleasePanel prevTag reconciles from reality even when the gate stream is stale", async () => {
    const p = project({
      events: [{ type: "release:gate", tag: "v3.612.2", verdict: "pass", failCount: 0, waivedRules: [], ts: 1781233743 }],
      version: "3.619.1",
      changelog: "# Changelog\n\n## v3.619.1 — 2026-06-19\n\n- a\n\n## v3.618.3 — 2026-06-18\n\n- b\n",
    });
    const { collectReleasePanel } = await import("../src/lib/release-panel.js");
    const vm = collectReleasePanel(p);
    expect(vm.prevTag).toBe("v3.618.3"); // the real second-newest, not v3.612.x
  });
});
