/**
 * US-SHOW-001 — deterministic unit tests for the showcase orchestration core.
 *
 * These run in the NORMAL suite (no real agents, no sandbox, no network). They
 * prove the pure heart: casting heterogeneity validation (rejects a collapsed
 * trio), the casting agents.yaml override text, evidence-chain assembly from a
 * fixture run-result, and the pass/fail verdict (every link present ⇒ PASS, any
 * missing ⇒ FAIL). The non-deterministic real-agent step is NOT exercised here
 * — that is the ROLL_SHOWCASE=1-gated E2E.
 */
import { describe, expect, it } from "vitest";
import {
  assembleEvidenceChain,
  castingAgentsYaml,
  DEFAULT_SHOWCASE_CASTING,
  showcaseVerdict,
  validateCasting,
  type ShowcaseRunResult,
} from "../src/lib/showcase.js";

/** A run-result with every evidence link satisfied (a passing showcase). */
function goldenRun(): ShowcaseRunResult {
  return {
    casting: { ...DEFAULT_SHOWCASE_CASTING },
    loopExit: 0,
    tcrCommits: [
      { sha: "abc1234", subject: "tcr: pulse renders truth.json", testPass: true },
      { sha: "def5678", subject: "tcr: pulse --json same-source", testPass: true },
    ],
    branch: "story/US-DEMO-001",
    pr: { number: 42, url: "https://github.com/seanyao/roll/pull/42" },
    reviewRecord: { reviewer: "claude", scorer: "pi", recorded: true },
    screenshots: [
      { surface: "cli", path: "/tmp/pulse-cli.png", present: true },
      { surface: "web", path: "/tmp/overview.png", present: true },
    ],
    attest: { gate: "PASS", reportPath: "/tmp/report.html" },
    backlogStatus: "✅ Done",
    truthLadder: "attested",
    sameNumber: {
      backlog: "US-DEMO-001",
      report: "US-DEMO-001",
      truth: "US-DEMO-001",
      branch: "US-DEMO-001",
    },
  };
}

describe("validateCasting — heterogeneity", () => {
  it("accepts the default kimi/claude/pi trio (three distinct vendors)", () => {
    const r = validateCasting(DEFAULT_SHOWCASE_CASTING);
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it("rejects reviewer == builder (collapsed casting)", () => {
    const r = validateCasting({ builder: "kimi", reviewer: "kimi", scorer: "pi" });
    expect(r.ok).toBe(false);
    expect(r.violations.map((v) => v.code)).toContain("reviewer-equals-builder");
  });

  it("rejects scorer == builder (collapsed casting)", () => {
    const r = validateCasting({ builder: "kimi", reviewer: "claude", scorer: "kimi" });
    expect(r.ok).toBe(false);
    expect(r.violations.map((v) => v.code)).toContain("scorer-equals-builder");
  });

  it("rejects a same-vendor alias clash (codex vs openai are one vendor)", () => {
    // builder=codex, reviewer=openai → both vendor "openai" → NOT heterogeneous.
    const r = validateCasting({ builder: "codex", reviewer: "openai", scorer: "pi" });
    expect(r.ok).toBe(false);
    expect(r.violations.map((v) => v.code)).toContain("reviewer-not-hetero");
  });

  it("rejects an empty slot", () => {
    const r = validateCasting({ builder: "kimi", reviewer: "", scorer: "pi" });
    expect(r.ok).toBe(false);
    expect(r.violations.map((v) => v.code)).toContain("empty-slot");
  });
});

describe("castingAgentsYaml — builder routing override", () => {
  it("pins all three executor slots to the builder so the loop routes to it", () => {
    const yaml = castingAgentsYaml({ builder: "kimi", reviewer: "claude", scorer: "pi" });
    expect(yaml).toContain("schema: v3");
    expect(yaml).toContain("easy: { agent: kimi }");
    expect(yaml).toContain("default: { agent: kimi }");
    expect(yaml).toContain("hard: { agent: kimi }");
    // The reviewer/scorer are recorded in a comment, not as executor slots.
    expect(yaml).toContain("reviewer=claude scorer=pi");
  });
});

describe("assembleEvidenceChain — from a fixture run-result", () => {
  it("a golden run satisfies every link", () => {
    const chain = assembleEvidenceChain(goldenRun());
    expect(chain.links.every((l) => l.present)).toBe(true);
    expect(chain.sameNumber).toBe("US-DEMO-001");
  });

  it("a TCR commit without a test-pass proof does NOT satisfy the tcr link", () => {
    const run = goldenRun();
    run.tcrCommits = [{ sha: "x", subject: "tcr: code", testPass: false }];
    const chain = assembleEvidenceChain(run);
    expect(chain.links.find((l) => l.key === "tcr-commits")?.present).toBe(false);
  });

  it("a skipped CLI screenshot is recorded honestly (present:false, reason)", () => {
    const run = goldenRun();
    run.screenshots = [
      { surface: "cli", path: "/tmp/cli.png", present: false, skipped: "no GUI session" },
      { surface: "web", path: "/tmp/web.png", present: true },
    ];
    const chain = assembleEvidenceChain(run);
    const cli = chain.links.find((l) => l.key === "cli-screenshot");
    expect(cli?.present).toBe(false);
    expect(cli?.detail).toContain("no GUI session");
  });

  it("attest gate SKIP/FAIL does NOT satisfy the gate link (only PASS does)", () => {
    const run = goldenRun();
    run.attest = { gate: "SKIP" };
    const chain = assembleEvidenceChain(run);
    expect(chain.links.find((l) => l.key === "attest-gate")?.present).toBe(false);
  });

  it("a non-Done backlog status does NOT satisfy the done link", () => {
    const run = goldenRun();
    run.backlogStatus = "📋 Todo";
    const chain = assembleEvidenceChain(run);
    expect(chain.links.find((l) => l.key === "backlog-done")?.present).toBe(false);
  });

  it("truth ladder below attested does NOT satisfy the truth link", () => {
    const run = goldenRun();
    run.truthLadder = "merged";
    const chain = assembleEvidenceChain(run);
    expect(chain.links.find((l) => l.key === "truth-attested")?.present).toBe(false);
  });

  it("the same-number link fails when surfaces disagree", () => {
    const run = goldenRun();
    run.sameNumber = { backlog: "US-DEMO-001", report: "US-DEMO-002", truth: "US-DEMO-001" };
    const chain = assembleEvidenceChain(run);
    const sn = chain.links.find((l) => l.key === "same-number");
    expect(sn?.present).toBe(false);
    expect(sn?.detail).toContain("disagree");
    expect(chain.sameNumber).toBeUndefined();
  });

  it("the same-number link fails when fewer than two surfaces recorded a number", () => {
    const run = goldenRun();
    run.sameNumber = { backlog: "US-DEMO-001" };
    const chain = assembleEvidenceChain(run);
    expect(chain.links.find((l) => l.key === "same-number")?.present).toBe(false);
  });

  it("a collapsed casting fails the casting link", () => {
    const run = goldenRun();
    run.casting = { builder: "kimi", reviewer: "kimi", scorer: "pi" };
    const chain = assembleEvidenceChain(run);
    expect(chain.links.find((l) => l.key === "casting-heterogeneous")?.present).toBe(false);
  });
});

describe("showcaseVerdict", () => {
  it("PASS only when every link is present", () => {
    const v = showcaseVerdict(assembleEvidenceChain(goldenRun()));
    expect(v.pass).toBe(true);
    expect(v.missing).toEqual([]);
    expect(v.present).toBe(v.total);
    expect(v.summary).toContain("PASS");
  });

  it("FAIL with the missing link keys when any link is absent", () => {
    const run = goldenRun();
    run.attest = { gate: "FAIL" };
    run.backlogStatus = "📋 Todo";
    const v = showcaseVerdict(assembleEvidenceChain(run));
    expect(v.pass).toBe(false);
    expect(v.missing.map((m) => m.key)).toEqual(expect.arrayContaining(["attest-gate", "backlog-done"]));
    expect(v.summary).toContain("FAIL");
  });

  it("FAIL on an empty chain (defensive — never a vacuous PASS)", () => {
    const v = showcaseVerdict({ links: [], sameNumber: undefined });
    expect(v.pass).toBe(false);
  });
});
