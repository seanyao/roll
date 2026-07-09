/**
 * Unit tests for the PR-loop runtime tick adapter (loop-pr-inbox.ts, US-PORT-001).
 * The pure decisions live in core/pr-loop.ts (tested there); here we assert the
 * IMPERATIVE WALK: the idle-gate ladder routing, per-PR action dispatch, the
 * rebase circuit→recheck→merge chain, and the terminal tick — all with faked
 * gh/git/fs deps.
 */
import { existsSync, mkdirSync, mkdtempSync, realpathSync, utimesSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PrTick } from "@roll/core";
import {
  type PrInboxDeps,
  type PrViewFacts,
  attachEvidenceRepairToPrBranch,
  cleanupEvidenceRepairMarkers,
  evidenceRepairMarkerIsFresh,
  parseRollEvidenceTrailer,
  reducePrView,
  resolvePrEvidence,
  runPrInbox,
  upsertRebaseAttempts,
} from "../src/commands/loop-pr-inbox.js";
import { parseRebaseAttempts } from "@roll/core";

interface Recorder {
  ticks: PrTick[];
  alerts: string[];
  readied: string[];
  merged: string[];
  healed: string[];
  dispatchedCi: Array<{ num: string; headRef: string; slug: string }>;
  rebased: string[];
  repaired: string[];
  circuitCalls: string[];
  /** FIX-367: (num, headRef) pairs the durable merge-record hook saw. */
  mergedRecorded: Array<{ num: string; headRef: string }>;
}

function harness(overrides: Partial<PrInboxDeps> = {}): { deps: PrInboxDeps; rec: Recorder } {
  const rec: Recorder = {
    ticks: [],
    alerts: [],
    readied: [],
    merged: [],
    healed: [],
    dispatchedCi: [],
    rebased: [],
    repaired: [],
    circuitCalls: [],
    mergedRecorded: [],
  };
  const deps: PrInboxDeps = {
    ghAvailable: async () => true,
    resolveSlug: async () => "owner/repo",
    listOpenPrs: async () => ({ code: 0, stdout: "[]" }),
    viewPr: async () => ({ bot: "", ciState: "success", mergeable: "CLEAN" }),
    ready: async (_slug, num) => {
      rec.readied.push(num);
      return true;
    },
    merge: async (_slug, num) => {
      rec.merged.push(num);
      return true;
    },
    onMerged: async (_slug, num, headRef) => {
      rec.mergedRecorded.push({ num, headRef });
    },
    heal: async (num) => {
      rec.healed.push(num);
    },
    dispatchCi: async (num, headRef, slug) => {
      rec.dispatchedCi.push({ num, headRef, slug });
      return true;
    },
    rebaseCircuitAllowed: (num) => {
      rec.circuitCalls.push(num);
      return true;
    },
    rebaseStale: async (num) => {
      rec.rebased.push(num);
      return { bot: "", ciState: "success", mergeable: "CLEAN" };
    },
    repairEvidence: async (num) => {
      rec.repaired.push(num);
      return undefined;
    },
    alert: (line) => rec.alerts.push(line),
    writeTick: (t) => rec.ticks.push(t),
    info: () => {},
    warn: () => {},
    ...overrides,
  };
  return { deps, rec };
}

function listOf(prs: Array<{ number: number; headRefName: string }>): PrInboxDeps["listOpenPrs"] {
  return async () => ({ code: 0, stdout: JSON.stringify(prs) });
}

function tmpProject(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), "roll-pr-inbox-")));
}

function writeLocalEvidence(project: string, storyId: string): void {
  const card = join(project, ".roll", "features", "uncategorized", storyId);
  mkdirSync(join(card, "latest"), { recursive: true });
  mkdirSync(join(card, "screenshots"), { recursive: true });
  writeFileSync(join(card, "screenshots", "proof.png"), "png\n");
  writeFileSync(
    join(card, "ac-map.json"),
    JSON.stringify([{ ac: `${storyId}:AC1`, status: "pass", evidence: [{ kind: "screenshot", href: "screenshots/proof.png" }] }], null, 2) + "\n",
  );
  writeFileSync(join(card, "latest", `${storyId}-report.html`), "<html>proof</html>\n");
}

describe("reducePrView — last BOT/APP review + rollup reduction (bin/roll 11996-12007)", () => {
  it("picks the LAST bot/app review state", () => {
    const f = reducePrView({
      reviews: [
        { authorAssociation: "BOT", state: "CHANGES_REQUESTED" },
        { authorAssociation: "MEMBER", state: "APPROVED" },
        { authorAssociation: "APP", state: "APPROVED" },
      ],
      mergeStateStatus: "CLEAN",
      statusCheckRollup: [{ conclusion: "SUCCESS" }],
    });
    expect(f).toEqual({ bot: "APPROVED", ciState: "success", mergeable: "CLEAN", manualMerge: false });
  });
  it("no bot reviews → empty bot; empty rollup → '' ci", () => {
    const f = reducePrView({ reviews: [{ authorAssociation: "MEMBER", state: "APPROVED" }] });
    expect(f).toEqual({ bot: "", ciState: "", mergeable: "", manualMerge: false });
  });
  it("detects manual-merge marker from PR body or labels", () => {
    expect(reducePrView({ body: "fix\n\n[roll:manual-merge]" }).manualMerge).toBe(true);
    expect(reducePrView({ labels: [{ name: "manual-merge" }] }).manualMerge).toBe(true);
  });
  it("US-EVID-019: parses the Roll-Evidence trailer", () => {
    expect(parseRollEvidenceTrailer("body\n\nRoll-Evidence: US-EVID-019 roll-meta@abcdef123456 features/e/US/ac-map.json\n")).toEqual({
      storyId: "US-EVID-019",
      repo: "roll-meta",
      sha: "abcdef123456",
      acMapPath: "features/e/US/ac-map.json",
    });
    expect(parseRollEvidenceTrailer("no trailer")).toBeNull();
  });
  it("US-EVID-019 R2: missing trailer falls back to local roll-meta disk evidence", () => {
    const project = tmpProject();
    writeLocalEvidence(project, "US-EVID-019");
    expect(resolvePrEvidence(project, "loop/US-EVID-019", "no trailer")).toEqual({ ok: true, missing: [] });
  });
  it("FIX-1204: missing trailer resolves in-repo evidence from the PR head branch", () => {
    const project = tmpProject();
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: project });
    execFileSync("git", ["config", "user.email", "test@roll.local"], { cwd: project });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: project });
    writeFileSync(join(project, "README.md"), "base\n");
    execFileSync("git", ["add", "README.md"], { cwd: project });
    execFileSync("git", ["commit", "-q", "-m", "base"], { cwd: project });
    execFileSync("git", ["checkout", "-q", "-b", "loop/evidence"], { cwd: project });
    writeLocalEvidence(project, "FIX-1204");
    execFileSync("git", ["add", ".roll"], { cwd: project });
    execFileSync("git", ["commit", "-q", "-m", "evidence"], { cwd: project });
    execFileSync("git", ["checkout", "-q", "main"], { cwd: project });

    expect(resolvePrEvidence(project, "loop/evidence", "Delivers FIX-1204")).toEqual({ ok: true, missing: [] });
  });
  it("US-EVID-019 R2: PRs without a story id are outside the evidence gate", () => {
    const project = tmpProject();
    expect(resolvePrEvidence(project, "renovate/typescript", "dependency maintenance")).toEqual({ ok: true, missing: [] });
  });
  it("US-EVID-019 R2: story PRs without trailer or local evidence are unresolvable with remediation", () => {
    const project = tmpProject();
    const result = resolvePrEvidence(project, "loop/US-EVID-019", "no trailer");
    expect(result.ok).toBe(false);
    expect(result.missing.join("\n")).toContain("remediation");
    expect(result.missing.join("\n")).toContain("US-EVID-019");
  });
  it("any FAILURE → failure ci", () => {
    const f = reducePrView({ statusCheckRollup: [{ conclusion: "SUCCESS" }, { conclusion: "FAILURE" }] });
    expect(f.ciState).toBe("failure");
  });
});

describe("upsertRebaseAttempts — minimal YAML round-trip (bin/roll 11838-11871)", () => {
  it("creates pr_state from an empty body", () => {
    const out = upsertRebaseAttempts("", "5", "100 200");
    expect(out).toBe(`pr_state:\n  "5":\n    attempts_at: "100 200"\n`);
    expect(parseRebaseAttempts(out, "5")).toEqual([100, 200]);
  });
  it("appends a new pr alongside an existing one (no extra blank lines)", () => {
    let s = upsertRebaseAttempts("", "5", "100");
    s = upsertRebaseAttempts(s, "9", "300");
    expect(s).not.toMatch(/\n\n/); // no accreted blank lines
    expect(parseRebaseAttempts(s, "5")).toEqual([100]);
    expect(parseRebaseAttempts(s, "9")).toEqual([300]);
  });
  it("overwrites an existing pr's value, idempotent across repeats", () => {
    let s = upsertRebaseAttempts("", "5", "100");
    s = upsertRebaseAttempts(s, "5", "100 200");
    s = upsertRebaseAttempts(s, "5", "100 200 300");
    expect(parseRebaseAttempts(s, "5")).toEqual([100, 200, 300]);
    expect(s.match(/"5":/g)?.length).toBe(1); // exactly one entry, not duplicated
    expect(s).not.toMatch(/\n\n/);
  });
  it("preserves a leading non-pr_state field", () => {
    const s = upsertRebaseAttempts("status: idle\n", "7", "42");
    expect(s).toContain("status: idle");
    expect(parseRebaseAttempts(s, "7")).toEqual([42]);
  });
});

describe("FIX-1204 evidence repair side effects", () => {
  it("expires stale repair markers and removes markers for PRs no longer open", () => {
    const rt = tmpProject();
    const saved = process.env["ROLL_PROJECT_RUNTIME_DIR"];
    process.env["ROLL_PROJECT_RUNTIME_DIR"] = rt;
    try {
      const fresh = join(rt, ".pr-evidence-repair-1.attempted");
      const stale = join(rt, ".pr-evidence-repair-2.attempted");
      const closed = join(rt, ".pr-evidence-repair-3.attempted");
      writeFileSync(fresh, "fresh\n");
      writeFileSync(stale, "stale\n");
      writeFileSync(closed, "closed\n");
      const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
      utimesSync(stale, old, old);

      expect(evidenceRepairMarkerIsFresh(fresh)).toBe(true);
      expect(evidenceRepairMarkerIsFresh(stale)).toBe(false);
      cleanupEvidenceRepairMarkers(new Set(["1"]));

      expect(existsSync(fresh)).toBe(true);
      expect(existsSync(stale)).toBe(false);
      expect(existsSync(closed)).toBe(false);
    } finally {
      if (saved === undefined) delete process.env["ROLL_PROJECT_RUNTIME_DIR"];
      else process.env["ROLL_PROJECT_RUNTIME_DIR"] = saved;
    }
  });

  it("attaches repaired evidence on the PR branch and refreshes origin/headRef", () => {
    const project = tmpProject();
    const remote = tmpProject();
    const headRef = "loop/cycle-20260703-1204";
    execFileSync("git", ["init", "--bare", "-q"], { cwd: remote });
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: project });
    execFileSync("git", ["config", "user.email", "test@roll.local"], { cwd: project });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: project });
    execFileSync("git", ["remote", "add", "origin", remote], { cwd: project });
    writeFileSync(join(project, "README.md"), "base\n");
    writeFileSync(join(project, ".gitignore"), ".roll/\n");
    execFileSync("git", ["add", "README.md", ".gitignore"], { cwd: project });
    execFileSync("git", ["commit", "-q", "-m", "base"], { cwd: project });
    execFileSync("git", ["push", "-q", "origin", "main"], { cwd: project });
    execFileSync("git", ["checkout", "-q", "-b", headRef], { cwd: project });
    writeFileSync(join(project, "README.md"), "branch\n");
    execFileSync("git", ["commit", "-am", "branch", "-q"], { cwd: project });
    execFileSync("git", ["push", "-q", "origin", `HEAD:${headRef}`], { cwd: project });
    execFileSync("git", ["checkout", "-q", "main"], { cwd: project });
    writeLocalEvidence(project, "FIX-1204");

    const savedCwd = process.cwd();
    process.chdir(project);
    try {
      const result = attachEvidenceRepairToPrBranch("FIX-1204", headRef);
      if (!result.ok) throw new Error(JSON.stringify(result));
      expect(result).toMatchObject({ ok: true });
    } finally {
      process.chdir(savedCwd);
    }

    const acMap = execFileSync("git", ["show", `origin/${headRef}:.roll/features/uncategorized/FIX-1204/ac-map.json`], {
      cwd: project,
      encoding: "utf8",
    });
    expect(acMap).toContain("FIX-1204:AC1");
    expect(resolvePrEvidence(project, headRef, "Delivers FIX-1204")).toEqual({ ok: true, missing: [] });
  });
});

describe("runPrInbox — idle-gate ladder", () => {
  it("gh unavailable → idle gh_unavailable, no walk", async () => {
    const { deps, rec } = harness({ ghAvailable: async () => false });
    const t = await runPrInbox(deps);
    expect(t).toEqual({ loop: "pr", outcome: "idle", note: "gh_unavailable" });
    expect(rec.ticks).toEqual([t]);
    expect(rec.merged).toEqual([]);
  });
  it("no slug → idle gh_unavailable", async () => {
    const { deps } = harness({ resolveSlug: async () => undefined });
    expect((await runPrInbox(deps)).note).toBe("gh_unavailable");
  });
  it("list error → idle gh_error", async () => {
    const { deps } = harness({ listOpenPrs: async () => ({ code: 1, stdout: "" }) });
    expect((await runPrInbox(deps)).note).toBe("gh_error");
  });
  it("empty stdout → idle empty_response", async () => {
    const { deps } = harness({ listOpenPrs: async () => ({ code: 0, stdout: "   " }) });
    expect((await runPrInbox(deps)).note).toBe("empty_response");
  });
  it("'[]' → idle no_open_prs", async () => {
    const { deps } = harness({ listOpenPrs: async () => ({ code: 0, stdout: "[]" }) });
    expect((await runPrInbox(deps)).note).toBe("no_open_prs");
  });
});

describe("runPrInbox — per-PR action dispatch", () => {
  it("ready + clean → merge, then acted tick", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 7, headRefName: "loop/x" }]),
      viewPr: async () => ({ bot: "", ciState: "success", mergeable: "CLEAN" }),
    });
    const t = await runPrInbox(deps);
    expect(rec.merged).toEqual(["7"]);
    expect(t).toEqual({ loop: "pr", outcome: "acted", note: "inbox_done" });
  });
  it("US-LOOP-097: sweeps remote branches AFTER draining, with the open-PR heads", async () => {
    const order: string[] = [];
    let sweepHeads: string[] = [];
    const { deps } = harness({
      listOpenPrs: listOf([{ number: 7, headRefName: "loop/cycle-1" }]),
      drainPendingPrCreates: async () => {
        order.push("drain");
      },
      sweepRemoteBranches: async (_slug, heads) => {
        order.push("sweep");
        sweepHeads = [...heads];
      },
    });
    await runPrInbox(deps);
    expect(order).toEqual(["drain", "sweep"]); // GC runs strictly after the drain
    expect(sweepHeads).toContain("loop/cycle-1"); // so it can exclude open-PR heads
  });
  it("bot APPROVED + clean → merge", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 8, headRefName: "feat/y" }]),
      viewPr: async () => ({ bot: "APPROVED", ciState: "success", mergeable: "CLEAN" }),
    });
    await runPrInbox(deps);
    expect(rec.merged).toEqual(["8"]);
  });
  it("US-EVID-019: unresolvable evidence blocks eager auto-merge", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 81, headRefName: "loop/missing-evidence" }]),
      viewPr: async () => ({ bot: "", ciState: "success", mergeable: "CLEAN", evidenceResolvable: false }),
    });
    await runPrInbox(deps);
    expect(rec.merged).toEqual([]);
    expect(rec.repaired).toEqual(["81"]);
    expect(rec.alerts[0]).toContain("evidence_unresolvable");
  });
  it("FIX-1204: evidence_unresolvable repairs local evidence and then eager-merges", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 1204, headRefName: "loop/cycle-20260703-1204" }]),
      viewPr: async () => ({
        bot: "",
        ciState: "success",
        mergeable: "CLEAN",
        evidenceResolvable: false,
        evidenceMissing: ["features/loop-engine/FIX-1204/ac-map.json"],
      }),
      repairEvidence: async (num, _headRef, _slug, missing) => {
        rec.repaired.push(`${num}:${missing.join("|")}`);
        return { bot: "", ciState: "success", mergeable: "CLEAN", evidenceResolvable: true, evidenceMissing: [] };
      },
    });

    await runPrInbox(deps);

    expect(rec.repaired).toEqual(["1204:features/loop-engine/FIX-1204/ac-map.json"]);
    expect(rec.merged).toEqual(["1204"]);
    expect(rec.alerts).toEqual([]);
  });
  it("FIX-1204: failed evidence repair alerts once with the remaining missing evidence", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 1205, headRefName: "loop/cycle-20260703-1205" }]),
      viewPr: async () => ({
        bot: "",
        ciState: "success",
        mergeable: "CLEAN",
        evidenceResolvable: false,
        evidenceMissing: ["local ac-map unavailable"],
      }),
      repairEvidence: async (num) => {
        rec.repaired.push(num);
        return undefined;
      },
    });

    await runPrInbox(deps);

    expect(rec.repaired).toEqual(["1205"]);
    expect(rec.merged).toEqual([]);
    expect(rec.alerts).toHaveLength(1);
    expect(rec.alerts[0]).toContain("evidence_repair_failed");
    expect(rec.alerts[0]).toContain("local ac-map unavailable");
  });
  it("US-EVID-019: evidence block alert includes missing paths", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 83, headRefName: "loop/missing-list" }]),
      viewPr: async () => ({
        bot: "APPROVED",
        ciState: "success",
        mergeable: "CLEAN",
        evidenceResolvable: false,
        evidenceMissing: ["US-EVID-019:AC1 screenshots/missing.png"],
      }),
    });
    await runPrInbox(deps);
    expect(rec.merged).toEqual([]);
    expect(rec.alerts[0]).toContain("screenshots/missing.png");
  });
  it("FIX-1027: manual draft + bot APPROVED + clean → ready first, then merge", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 30, headRefName: "loop/manual-review" }]),
      viewPr: async () => ({
        bot: "APPROVED",
        ciState: "success",
        mergeable: "CLEAN",
        manualMerge: true,
        isDraft: true,
      }),
    });
    await runPrInbox(deps);
    expect(rec.readied).toEqual(["30"]);
    expect(rec.merged).toEqual(["30"]);
    expect(rec.mergedRecorded).toEqual([{ num: "30", headRef: "loop/manual-review" }]);
  });
  it("FIX-1027 guard: manual draft with green CI but no bot approve stays open", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 31, headRefName: "loop/manual-review" }]),
      viewPr: async () => ({
        bot: "",
        ciState: "success",
        mergeable: "CLEAN",
        manualMerge: true,
        isDraft: true,
      }),
    });
    await runPrInbox(deps);
    expect(rec.readied).toEqual([]);
    expect(rec.merged).toEqual([]);
  });
  it("US-EVID-019: unresolvable evidence blocks manual draft promotion", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 82, headRefName: "loop/manual-missing-evidence" }]),
      viewPr: async () => ({
        bot: "APPROVED",
        ciState: "success",
        mergeable: "CLEAN",
        manualMerge: true,
        isDraft: true,
        evidenceResolvable: false,
      }),
    });
    await runPrInbox(deps);
    expect(rec.readied).toEqual([]);
    expect(rec.merged).toEqual([]);
    expect(rec.alerts[0]).toContain("evidence_unresolvable");
  });
  it("FIX-1027 guard: failed ready leaves the PR unmerged for the next tick", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 32, headRefName: "loop/manual-review" }]),
      viewPr: async () => ({
        bot: "APPROVED",
        ciState: "success",
        mergeable: "CLEAN",
        manualMerge: true,
        isDraft: true,
      }),
      ready: async (_slug, num) => {
        rec.readied.push(num);
        return false;
      },
    });
    await runPrInbox(deps);
    expect(rec.readied).toEqual(["32"]);
    expect(rec.merged).toEqual([]);
  });
  it("bot CHANGES_REQUESTED → alert, no merge", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 9, headRefName: "loop/z" }]),
      viewPr: async () => ({ bot: "CHANGES_REQUESTED", ciState: "success", mergeable: "CLEAN" }),
    });
    await runPrInbox(deps);
    expect(rec.merged).toEqual([]);
    expect(rec.alerts[0]).toContain("PR #9");
    expect(rec.alerts[0]).toContain("CHANGES_REQUESTED");
  });
  it("ci_red → heal, no merge", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 10, headRefName: "loop/a" }]),
      viewPr: async () => ({ bot: "", ciState: "failure", mergeable: "CLEAN" }),
    });
    await runPrInbox(deps);
    expect(rec.healed).toEqual(["10"]);
    expect(rec.merged).toEqual([]);
  });
  it("FIX-1217: zero head check-runs after threshold → workflow_dispatch and ALERT", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 1217, headRefName: "loop/cycle-20260706-1217" }]),
      viewPr: async () => ({
        bot: "",
        ciState: "",
        mergeable: "CLEAN",
        prAgeMinutes: 30,
        headCheckRunCount: 0,
      }),
    });

    await runPrInbox(deps);

    expect(rec.dispatchedCi).toEqual([
      { num: "1217", headRef: "loop/cycle-20260706-1217", slug: "owner/repo" },
    ]);
    expect(rec.alerts).toHaveLength(1);
    expect(rec.alerts[0]).toContain("PR #1217");
    expect(rec.alerts[0]).toContain("CI event blackhole detected");
    expect(rec.merged).toEqual([]);
    expect(rec.healed).toEqual([]);
  });
  it("ready but not mergeable → skip (no merge)", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 11, headRefName: "loop/b" }]),
      viewPr: async () => ({ bot: "", ciState: "success", mergeable: "BLOCKED" }),
    });
    await runPrInbox(deps);
    expect(rec.merged).toEqual([]);
  });
  it("a failed pr view is skipped, walk continues", async () => {
    let first = true;
    const { deps, rec } = harness({
      listOpenPrs: listOf([
        { number: 1, headRefName: "loop/p" },
        { number: 2, headRefName: "loop/q" },
      ]),
      viewPr: async () => {
        if (first) {
          first = false;
          return undefined; // view failed for PR #1
        }
        return { bot: "", ciState: "success", mergeable: "CLEAN" };
      },
    });
    await runPrInbox(deps);
    expect(rec.merged).toEqual(["2"]);
  });

  // ── FIX-367: durably record merge truth the instant the PR-lane merges ───────
  it("FIX-367: an eager merge fires onMerged with the cycle headRef", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 7, headRefName: "loop/cycle-20260619-022646" }]),
      viewPr: async () => ({ bot: "", ciState: "success", mergeable: "CLEAN" }),
    });
    await runPrInbox(deps);
    expect(rec.merged).toEqual(["7"]);
    // The card's merge is recorded NOW (→ runs row credited → picker excludes it),
    // not only after the next `loop run-once` backfill — closes the re-pick window.
    expect(rec.mergedRecorded).toEqual([{ num: "7", headRef: "loop/cycle-20260619-022646" }]);
  });
  it("FIX-367: a FAILED merge does NOT record merge truth (no premature Done)", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 9, headRefName: "loop/cycle-x" }]),
      viewPr: async () => ({ bot: "", ciState: "success", mergeable: "CLEAN" }),
      merge: async (_slug, num) => {
        rec.merged.push(num);
        return false; // merge attempt failed → PR left open, nothing merged
      },
    });
    await runPrInbox(deps);
    expect(rec.mergedRecorded).toEqual([]);
  });
});

describe("runPrInbox — stale → rebase circuit → recheck → merge", () => {
  const staleView: PrViewFacts = { bot: "", ciState: "pending", mergeable: "BEHIND" };

  it("circuit allowed + recheck clean → rebase then eager merge", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 20, headRefName: "loop/r" }]),
      viewPr: async () => staleView,
      rebaseStale: async (num) => {
        rec.rebased.push(num);
        return { bot: "", ciState: "success", mergeable: "CLEAN" };
      },
    });
    await runPrInbox(deps);
    expect(rec.circuitCalls).toEqual(["20"]);
    expect(rec.rebased).toEqual(["20"]);
    expect(rec.merged).toEqual(["20"]);
    // FIX-367: the post-rebase merge path also records merge truth durably.
    expect(rec.mergedRecorded).toEqual([{ num: "20", headRef: "loop/r" }]);
  });

  it("US-EVID-019: unresolvable evidence blocks post-rebase eager merge", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 23, headRefName: "loop/u" }]),
      viewPr: async () => staleView,
      rebaseStale: async (num) => {
        rec.rebased.push(num);
        return { bot: "", ciState: "success", mergeable: "CLEAN", evidenceResolvable: false };
      },
    });
    await runPrInbox(deps);
    expect(rec.rebased).toEqual(["23"]);
    expect(rec.merged).toEqual([]);
    expect(rec.alerts[0]).toContain("evidence_unresolvable");
  });

  it("circuit TRIPPED → no rebase, no merge (honors the verdict)", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 21, headRefName: "loop/s" }]),
      viewPr: async () => staleView,
      rebaseCircuitAllowed: (num) => {
        rec.circuitCalls.push(num);
        return false; // tripped
      },
    });
    await runPrInbox(deps);
    expect(rec.rebased).toEqual([]);
    expect(rec.merged).toEqual([]);
  });

  it("rebase done but recheck still not clean → no merge", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 22, headRefName: "loop/t" }]),
      viewPr: async () => staleView,
      rebaseStale: async (num) => {
        rec.rebased.push(num);
        return { bot: "", ciState: "pending", mergeable: "BEHIND" };
      },
    });
    await runPrInbox(deps);
    expect(rec.rebased).toEqual(["22"]);
    expect(rec.merged).toEqual([]);
  });

  it("FIX-1214: drains the pending-pr-create queue after walking open PRs", async () => {
    const drained: Array<{ slug: string; openHeadRefs: string[] }> = [];
    const { deps } = harness({
      listOpenPrs: listOf([
        { number: 1, headRefName: "loop/already-open" },
        { number: 2, headRefName: "loop/other" },
      ]),
      drainPendingPrCreates: async (slug, openHeadRefs) => {
        drained.push({ slug, openHeadRefs: [...openHeadRefs] });
      },
    });
    await runPrInbox(deps);
    expect(drained).toEqual([
      { slug: "owner/repo", openHeadRefs: ["loop/already-open", "loop/other"] },
    ]);
  });

  it("FIX-1214: a drain failure does not break the regular inbox tick", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 3, headRefName: "loop/ok" }]),
      viewPr: async () => ({ bot: "", ciState: "success", mergeable: "CLEAN" }),
      drainPendingPrCreates: async () => {
        throw new Error("queue drain boom");
      },
    });
    await runPrInbox(deps);
    expect(rec.merged).toEqual(["3"]);
    expect(rec.ticks[rec.ticks.length - 1]?.note).toBe("inbox_done");
  });
});
