/**
 * US-REL-007 — `roll release` is the ONLY release command: the transaction's
 * step order, every gate's abort, the removed routes' rejection, and the
 * no-stray-surface cleanup guard.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ReleaseStep } from "@roll/core";
import { releaseCommand, runReleaseFlow, type ReleaseFlowDeps } from "../src/commands/release.js";

function fakeDeps(over: Partial<ReleaseFlowDeps> = {}): { deps: ReleaseFlowDeps; steps: ReleaseStep[]; writes: string[] } {
  const steps: ReleaseStep[] = [];
  const writes: string[] = [];
  const deps: ReleaseFlowDeps = {
    version: () => "3.612.2",
    branch: () => "main",
    clean: () => true,
    synced: () => true,
    tagExists: () => false,
    readChangelog: () => "# C\n\n## Unreleased\n\n- thing one\n\n## v3.612.2 — 2026-06-12\n\n- old\n",
    writeChangelog: (_c, text) => void writes.push(`changelog:${text.length}`),
    bumpVersion: (_c, v) => void writes.push(`bump:${v}`),
    packageGate: () => true,
    commitPush: (_c, b) => void writes.push(`push:${b}`),
    openPr: () => "https://github.com/x/y/pull/1",
    waitMerged: () => true,
    syncMain: () => true,
    consistencyGate: () => true,
    tag: (_c, t2) => void writes.push(`tag:${t2}`),
    pushTag: (_c, t2) => void writes.push(`pushTag:${t2}`),
    confirm: () => true,
    now: () => new Date("2026-06-13T08:00:00Z"),
    onStep: (s) => void steps.push(s),
  };
  return { deps: { ...deps, ...over }, steps, writes };
}

describe("runReleaseFlow — the one transaction", () => {
  it("happy path executes every step in the gated order and ends at tag-push", async () => {
    const { deps, steps, writes } = fakeDeps();
    const res = await runReleaseFlow("/repo", deps, { dryRun: false, yes: true });
    expect(res.status).toBe("released");
    expect(res.tag).toBe("v3.613.1");
    expect(steps).toEqual([
      "plan",
      "fold-changelog",
      "bump-version",
      "package-gate",
      "commit-push",
      "open-pr",
      "wait-merge",
      "sync-main",
      "consistency-gate",
      "tag-push",
    ]);
    expect(writes.at(-1)).toBe("pushTag:v3.613.1");
  });

  it("same-day rerun bumps the sequence (calver third segment)", async () => {
    const { deps } = fakeDeps({ version: () => "3.613.1", readChangelog: () => "## Unreleased\n\n- more\n" });
    const res = await runReleaseFlow("/repo", deps, { dryRun: true, yes: true });
    expect(res.tag).toBe("v3.613.2");
  });

  const aborts: Array<[string, Partial<ReleaseFlowDeps>, ReleaseStep, RegExp]> = [
    ["dirty tree", { clean: () => false }, "plan", /dirty/],
    ["not on main", { branch: () => "feat/x" }, "plan", /not on main/],
    ["stale main", { synced: () => false }, "plan", /behind origin/],
    ["existing tag", { tagExists: () => true }, "plan", /already exists/],
    ["empty changelog", { readChangelog: () => "# C\n\n## Unreleased\n\n## v1 — d\n\n- old\n" }, "fold-changelog", /empty/],
    ["package gate", { packageGate: () => false }, "package-gate", /pack/],
    ["pr not merged", { waitMerged: () => false }, "wait-merge", /not merged/],
    ["ff failure", { syncMain: () => false }, "sync-main", /fast-forward/],
    ["consistency gate", { consistencyGate: () => false }, "consistency-gate", /no waiver path/],
  ];
  for (const [name, over, atStep, reason] of aborts) {
    it(`aborts fail-loud at ${name} with no partial release`, async () => {
      const { deps, writes } = fakeDeps(over);
      const res = await runReleaseFlow("/repo", deps, { dryRun: false, yes: true });
      expect(res.status).toBe("aborted");
      expect(res.step).toBe(atStep);
      expect(res.reason).toMatch(reason);
      expect(writes.some((w) => w.startsWith("tag:") || w.startsWith("pushTag:"))).toBe(false); // never a stray tag
    });
  }

  it("tag race after the gate still aborts before pushing", async () => {
    let calls = 0;
    const { deps, writes } = fakeDeps({ tagExists: () => calls++ > 0 }); // free at plan, taken at tag-push
    const res = await runReleaseFlow("/repo", deps, { dryRun: false, yes: true });
    expect(res.status).toBe("aborted");
    expect(res.step).toBe("tag-push");
    expect(writes.some((w) => w.startsWith("pushTag:"))).toBe(false);
  });

  it("dry-run computes the plan and mutates NOTHING", async () => {
    const { deps, writes } = fakeDeps();
    const res = await runReleaseFlow("/repo", deps, { dryRun: true, yes: true });
    expect(res.status).toBe("dry-run");
    expect(writes).toEqual([]);
  });

  it("declined confirm aborts before any mutation", async () => {
    const { deps, writes } = fakeDeps({ confirm: () => false });
    const res = await runReleaseFlow("/repo", deps, { dryRun: false, yes: false });
    expect(res.status).toBe("aborted");
    expect(writes).toEqual([]);
  });
});

describe("removed routes — AC2: the old surface is gone, not redirected", () => {
  for (const route of ["ship", "waiver", "changelog", "consistency", "tag"]) {
    it(`roll release ${route} exits non-zero through the unknown-route error`, async () => {
      let err = "";
      const se = process.stderr.write.bind(process.stderr);
      process.stderr.write = ((s: string) => ((err += s), true)) as typeof process.stderr.write;
      try {
        expect(await releaseCommand([route])).toBe(1);
      } finally {
        process.stderr.write = se;
      }
      expect(err).toContain("removed");
      expect(err).toContain("roll release");
    });
  }
});

describe("cleanup guard — AC8: no active source re-advertises the removed surface", () => {
  const ROOT = join(__dirname, "..", "..", "..");
  const BANNED = [/roll release ship/, /roll release waiver/, /roll release changelog/, /roll release consistency check/, /releaseShipCommand/, /releaseWaiverCommand/];
  const scan = (dir: string, hits: string[]): void => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (e === "node_modules" || e === "dist" || e === ".git" || e === ".roll" || e === "skills") continue;
      const st = statSync(p);
      if (st.isDirectory()) scan(p, hits);
      else if (/\.(ts|md|yml)$/.test(e) && !p.includes(join("cli", "test")) && e !== "catalog.generated.json") {
        const text = readFileSync(p, "utf8");
        for (const re of BANNED) if (re.test(text)) hits.push(`${p}: ${re}`);
      }
    }
  };
  it("source, docs, workflows are clean of the removed command strings", () => {
    const hits: string[] = [];
    for (const sub of ["packages/cli/src", "packages/core/src", "packages/spec/src", "guide", ".github", "docs"]) {
      scan(join(ROOT, sub), hits);
    }
    const readme = readFileSync(join(ROOT, "README.md"), "utf8") + readFileSync(join(ROOT, "README_CN.md"), "utf8");
    for (const re of BANNED) expect(readme).not.toMatch(re);
    expect(hits).toEqual([]);
  });
});
