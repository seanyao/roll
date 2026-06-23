/**
 * FIX-246 — ac-map omission remediation.
 *
 * Observed 2026-06-10: every delivered cycle died at the attest gate because
 * agents consistently skip skill step 10.6 (write `ac-map.json`) even when the
 * delivery itself is real — the gate then classifies the fresh report as an
 * empty shell and the correction breaker pauses the loop. The remediation is a
 * single surgical second pass: when a real delivery has no ac-map, spawn the
 * SAME agent once with an explicit write-the-ac-map prompt, then render attest.
 * The honesty red line is untouched — the prompt demands `claimed` for any AC
 * without real evidence; the render layer still downgrades fabricated passes.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  acMapPath,
  autoAttachScreenshotToAcMap,
  buildAcMapRemediationPrompt,
  capturedScreenshotRef,
  needsAcMapRemediation,
} from "../src/runner/attest-remediation.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

function tmp(tag: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `roll-246-${tag}-`)));
  dirs.push(d);
  return d;
}

/** Worktree fixture: a card-layout story spec WITH an AC block, no ac-map. */
function withStory(storyId: string, spec?: string): string {
  const wt = tmp("wt");
  const dir = join(wt, ".roll", "features", "uncategorized", storyId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "spec.md"),
    spec ?? `# ${storyId}\n\n**AC:**\n- [ ] AC1 it works\n- [ ] AC2 it stays working\n`,
  );
  return wt;
}

describe("needsAcMapRemediation", () => {
  it("real story with an AC block and NO ac-map → remediation needed", () => {
    const wt = withStory("FIX-900");
    expect(needsAcMapRemediation(wt, "FIX-900")).toBe(true);
  });

  it("ac-map already present → no remediation", () => {
    const wt = withStory("FIX-901");
    // A confirmed ac-map with real statuses (pass/claimed/etc.) — not a harness draft.
    writeFileSync(acMapPath(wt, "FIX-901"), JSON.stringify([{ ac: "FIX-901:AC1", status: "pass" }]) + "\n");
    expect(needsAcMapRemediation(wt, "FIX-901")).toBe(false);
  });

  it("story without an AC block → nothing to map, no remediation", () => {
    const wt = withStory("FIX-902", "# FIX-902\n\njust prose, no acceptance criteria\n");
    expect(needsAcMapRemediation(wt, "FIX-902")).toBe(false);
  });

  it("empty story id → no remediation (idle cycle)", () => {
    const wt = tmp("idle");
    expect(needsAcMapRemediation(wt, "")).toBe(false);
  });
});

describe("acMapPath", () => {
  it("resolves to the card archive home (same path the gate reads)", () => {
    const wt = withStory("FIX-903");
    expect(acMapPath(wt, "FIX-903")).toBe(
      join(wt, ".roll", "features", "uncategorized", "FIX-903", "ac-map.json"),
    );
  });
});

describe("buildAcMapRemediationPrompt", () => {
  it("carries the absolute ac-map path, the story id, the schema template, and the honesty red line", () => {
    const wt = withStory("FIX-904");
    const p = buildAcMapRemediationPrompt(wt, "FIX-904", "/frame/run-dir");
    expect(p).toContain(acMapPath(wt, "FIX-904")); // exact write target, no guessing
    expect(p).toContain("FIX-904:AC1"); // schema template anchored to this story
    expect(p).toContain('"claimed"'); // honesty red line: no-evidence ACs stay claimed
    expect(p).toContain("../evidence/"); // run-dir-relative evidence convention
    expect(p).toMatch(/never fabricate|绝不伪造/); // bilingual red line present
    expect(p).toMatch(/do not commit/i); // surgical scope: file write only
  });
});

// ── FIX-317: harness↔attest screenshot bridge ──────────────────────────────

/** A cycle run dir (era) under the card archive, with a captures manifest +
 *  optional screenshot files actually on disk. */
function withRunDir(
  wt: string,
  storyId: string,
  captures: Array<{ out: string; taken: boolean }>,
  filesOnDisk: string[],
): string {
  const runDir = join(dirname(acMapPath(wt, storyId)), "2026-06-15T00-00-00");
  mkdirSync(join(runDir, "screenshots"), { recursive: true });
  for (const f of filesOnDisk) writeFileSync(join(runDir, "screenshots", f), "PNGDATA");
  writeFileSync(join(runDir, "evidence.json"), JSON.stringify({ captures }));
  return runDir;
}

/** A pass/claimed/… AC the agent wired with TEXT-only evidence (the bug shape). */
const textAc = (id: string, status: string): unknown => ({
  ac: id,
  status,
  evidence: [{ kind: "text", label: "vitest", textFile: "../evidence/vitest.txt" }],
});

describe("FIX-317 capturedScreenshotRef (honesty + path safety)", () => {
  it("real capture (taken:true) + file on disk → run-dir-relative ref", () => {
    const wt = withStory("FIX-905");
    const rd = withRunDir(wt, "FIX-905", [{ out: "/abs/era/screenshots/web.png", taken: true }], ["web.png"]);
    expect(capturedScreenshotRef(rd)).toBe("screenshots/web.png");
  });
  it("recorded machine-skip (taken:false) → null (never fabricate)", () => {
    const wt = withStory("FIX-906");
    const rd = withRunDir(wt, "FIX-906", [{ out: "x/web.png", taken: false }], ["web.png"]);
    expect(capturedScreenshotRef(rd)).toBeNull();
  });
  it("taken:true but PNG missing on disk → null (disk is the honesty guard)", () => {
    const wt = withStory("FIX-907");
    const rd = withRunDir(wt, "FIX-907", [{ out: "x/web.png", taken: true }], []);
    expect(capturedScreenshotRef(rd)).toBeNull();
  });
  it("absent / unreadable evidence.json → null", () => {
    const wt = withStory("FIX-908");
    const rd = join(dirname(acMapPath(wt, "FIX-908")), "no-frame");
    mkdirSync(rd, { recursive: true });
    expect(capturedScreenshotRef(rd)).toBeNull();
  });
  it("prefers web.png over terminal.png when both were genuinely captured", () => {
    const wt = withStory("FIX-909");
    const rd = withRunDir(
      wt, "FIX-909",
      [{ out: "x/terminal.png", taken: true }, { out: "x/web.png", taken: true }],
      ["web.png", "terminal.png"],
    );
    expect(capturedScreenshotRef(rd)).toBe("screenshots/web.png");
  });
});

describe("FIX-317 autoAttachScreenshotToAcMap", () => {
  it("attaches the captured screenshot to every pass AC lacking visual evidence (the FIX-284 shape)", () => {
    const wt = withStory("FIX-910");
    writeFileSync(acMapPath(wt, "FIX-910"), JSON.stringify([textAc("FIX-910:AC1", "pass"), textAc("FIX-910:AC2", "pass")]));
    const rd = withRunDir(wt, "FIX-910", [{ out: "x/web.png", taken: true }], ["web.png"]);
    expect(autoAttachScreenshotToAcMap(wt, "FIX-910", rd)).toEqual({ href: "screenshots/web.png", count: 2 });
    const map = JSON.parse(readFileSync(acMapPath(wt, "FIX-910"), "utf8")) as Array<{ evidence: Array<{ kind: string; href?: string }> }>;
    for (const e of map) {
      expect(e.evidence.some((ev) => ev.kind === "screenshot" && ev.href === "screenshots/web.png")).toBe(true);
      expect(e.evidence.some((ev) => ev.kind === "text")).toBe(true); // agent's text evidence preserved
    }
  });
  it("is idempotent — a second call makes no change (byte-identical)", () => {
    const wt = withStory("FIX-911");
    writeFileSync(acMapPath(wt, "FIX-911"), JSON.stringify([textAc("FIX-911:AC1", "pass")]));
    const rd = withRunDir(wt, "FIX-911", [{ out: "x/web.png", taken: true }], ["web.png"]);
    expect(autoAttachScreenshotToAcMap(wt, "FIX-911", rd)).not.toBeNull();
    const after1 = readFileSync(acMapPath(wt, "FIX-911"), "utf8");
    expect(autoAttachScreenshotToAcMap(wt, "FIX-911", rd)).toBeNull();
    expect(readFileSync(acMapPath(wt, "FIX-911"), "utf8")).toBe(after1);
  });
  it("touches pass ACs ONLY — claimed/partial are left untouched", () => {
    const wt = withStory("FIX-912");
    writeFileSync(acMapPath(wt, "FIX-912"), JSON.stringify([textAc("FIX-912:AC1", "pass"), textAc("FIX-912:AC2", "claimed")]));
    const rd = withRunDir(wt, "FIX-912", [{ out: "x/web.png", taken: true }], ["web.png"]);
    expect(autoAttachScreenshotToAcMap(wt, "FIX-912", rd)).toEqual({ href: "screenshots/web.png", count: 1 });
    const map = JSON.parse(readFileSync(acMapPath(wt, "FIX-912"), "utf8")) as Array<{ status: string; evidence: Array<{ kind: string }> }>;
    const claimed = map.find((e) => e.status === "claimed");
    expect(claimed?.evidence.some((ev) => ev.kind === "screenshot")).toBe(false);
  });
  it("no honest screenshot (taken:false) → no attach, ac-map untouched (skip path stays in charge)", () => {
    const wt = withStory("FIX-913");
    writeFileSync(acMapPath(wt, "FIX-913"), JSON.stringify([textAc("FIX-913:AC1", "pass")]));
    const before = readFileSync(acMapPath(wt, "FIX-913"), "utf8");
    const rd = withRunDir(wt, "FIX-913", [{ out: "x/web.png", taken: false }], ["web.png"]);
    expect(autoAttachScreenshotToAcMap(wt, "FIX-913", rd)).toBeNull();
    expect(readFileSync(acMapPath(wt, "FIX-913"), "utf8")).toBe(before);
  });
  it("a pass AC the agent already wired with a screenshot → no duplicate", () => {
    const wt = withStory("FIX-914");
    writeFileSync(
      acMapPath(wt, "FIX-914"),
      JSON.stringify([{ ac: "FIX-914:AC1", status: "pass", evidence: [{ kind: "screenshot", href: "screenshots/manual.png" }] }]),
    );
    const rd = withRunDir(wt, "FIX-914", [{ out: "x/web.png", taken: true }], ["web.png"]);
    expect(autoAttachScreenshotToAcMap(wt, "FIX-914", rd)).toBeNull();
  });
});

// ── FIX-912: ac-map draft auto-generation ───────────────────────────────────

import { ACMAP_DRAFT_STATUS, ACMAP_PASS_WITH_EVIDENCE, generateAcMapDraft, writeAcMapDraftEvidenceFiles, type DraftEvidence } from "../src/runner/attest-remediation.js";

const FIX_912_SPEC = `---
id: FIX-912
title: ac-map auto-draft
---

# FIX-912 — ac-map auto-draft

## Acceptance Criteria

- [ ] AC1 cycle 收尾自动产 ac-map.json 草稿:含 spec 全部 AC 行
- [ ] AC2 状态保守:仅有明确证据 → pass-with-evidence;否则 needs-confirmation
- [ ] AC3 builder 改为确认/更正草稿状态而非从零写
- [ ] AC4 attest 闸行为不变
- [ ] AC5 单测:给 spec + 提交桩 + 测试结果桩 → 产出草稿
- [ ] AC6 端到端:builder 跳过 10.6 的 cycle 不再 empty_acceptance_report
`;

const emptyEvidence: DraftEvidence = { commitLines: [], diffStatLines: [], changedFilenames: [] };

describe("FIX-912 generateAcMapDraft", () => {
  it("empty story id → null (no draft for idle cycles)", () => {
    expect(generateAcMapDraft(FIX_912_SPEC, "", emptyEvidence)).toBeNull();
  });

  it("spec with no AC block → null (nothing to map)", () => {
    expect(generateAcMapDraft("# no ac\n\njust prose", "FIX-NONE", emptyEvidence)).toBeNull();
  });

  it("AC1: produces a row for every AC with stable ids (AC5)", () => {
    const json = generateAcMapDraft(FIX_912_SPEC, "FIX-912", emptyEvidence);
    expect(json).not.toBeNull();
    const entries = JSON.parse(json!) as Array<{ ac: string; status: string }>;
    expect(entries).toHaveLength(6);
    expect(entries.map((e) => e.ac)).toEqual([
      "FIX-912:AC1",
      "FIX-912:AC2",
      "FIX-912:AC3",
      "FIX-912:AC4",
      "FIX-912:AC5",
      "FIX-912:AC6",
    ]);
  });

  it("AC2: all-needs-confirmation when no evidence (conservative default)", () => {
    const json = generateAcMapDraft(FIX_912_SPEC, "FIX-912", emptyEvidence);
    const entries = JSON.parse(json!) as Array<{ ac: string; status: string }>;
    for (const e of entries) {
      expect(e.status).toBe(ACMAP_DRAFT_STATUS);
    }
  });

  it("AC2: pass-with-evidence when a test file named after AC appears in changed files", () => {
    const evidence: DraftEvidence = {
      commitLines: [],
      diffStatLines: [],
      changedFilenames: [
        "packages/cli/test/fix-912-ac5.test.ts",
        "packages/cli/src/runner/attest-remediation.ts",
      ],
    };
    const json = generateAcMapDraft(FIX_912_SPEC, "FIX-912", evidence);
    const entries = JSON.parse(json!) as Array<{ ac: string; status: string; evidence?: Array<{ kind: string }> }>;
    // AC5 has a test file named after it → pass-with-evidence
    const ac5 = entries.find((e) => e.ac === "FIX-912:AC5")!;
    expect(ac5.status).toBe(ACMAP_PASS_WITH_EVIDENCE);
    // AC1-AC4, AC6 stay needs-confirmation
    for (const e of entries) {
      if (e.ac === "FIX-912:AC5") continue;
      expect(e.status).toBe(ACMAP_DRAFT_STATUS);
    }
  });

  it("commits mentioning AC ordinals are linked in evidence", () => {
    const evidence: DraftEvidence = {
      commitLines: [
        "abc1234 tcr: add AC1 draft generation logic",
        "def5678 tcr: implement AC2 conservative status",
        "ghi9012 tcr: wire attest gate",
      ],
      diffStatLines: [],
      changedFilenames: [],
    };
    const json = generateAcMapDraft(FIX_912_SPEC, "FIX-912", evidence);
    const entries = JSON.parse(json!) as Array<{ ac: string; evidence?: Array<{ label: string; kind: string }> }>;
    const ac1 = entries.find((e) => e.ac === "FIX-912:AC1")!;
    const ac2 = entries.find((e) => e.ac === "FIX-912:AC2")!;
    const ac4 = entries.find((e) => e.ac === "FIX-912:AC4")!;
    expect(ac1.evidence?.some((ev) => ev.label.includes("abc1234"))).toBe(true);
    expect(ac2.evidence?.some((ev) => ev.label.includes("def5678"))).toBe(true);
    // AC4 has no matching commit → no commit evidence
    expect(ac4.evidence?.some((ev) => ev.label.includes("commit:"))).toBeFalsy();
  });

  it("AC5: produces valid JSON parseable by the attest gate", () => {
    const evidence: DraftEvidence = {
      commitLines: ["abc1234 tcr: fix AC1 and AC5"],
      diffStatLines: [],
      changedFilenames: ["packages/cli/test/fix-912-ac5.test.ts"],
    };
    const json = generateAcMapDraft(FIX_912_SPEC, "FIX-912", evidence);
    // Must be valid JSON
    const entries = JSON.parse(json!);
    expect(Array.isArray(entries)).toBe(true);
    // Every entry has ac and status
    for (const e of entries) {
      expect(typeof e.ac).toBe("string");
      expect(typeof e.status).toBe("string");
      expect(
        [ACMAP_DRAFT_STATUS, ACMAP_PASS_WITH_EVIDENCE].includes(e.status),
      ).toBe(true);
    }
  });

  it("writes the evidence text files referenced by the generated draft", () => {
    const wt = withStory("FIX-912", FIX_912_SPEC);
    const evidence: DraftEvidence = {
      commitLines: ["abc1234 tcr: fix AC1 and AC5"],
      diffStatLines: [" packages/cli/src/runner/attest-remediation.ts | 12 +++"],
      changedFilenames: [
        "packages/cli/test/fix-912-ac5.test.ts",
        "packages/cli/src/runner/attest-remediation.ts",
      ],
    };
    writeAcMapDraftEvidenceFiles(wt, "FIX-912", evidence);
    const evidenceDir = join(dirname(acMapPath(wt, "FIX-912")), "evidence");
    for (const name of ["commits-FIX-912.txt", "changed-files-FIX-912.txt", "test-output-FIX-912.txt"]) {
      expect(existsSync(join(evidenceDir, name))).toBe(true);
    }
    expect(readFileSync(join(evidenceDir, "commits-FIX-912.txt"), "utf8")).toContain("abc1234");
    expect(readFileSync(join(evidenceDir, "changed-files-FIX-912.txt"), "utf8")).toContain("attest-remediation.ts");
    expect(readFileSync(join(evidenceDir, "test-output-FIX-912.txt"), "utf8")).toContain("fix-912-ac5.test.ts");
  });

  it("AC5: NEVER writes bare 'pass' — only pass-with-evidence or needs-confirmation", () => {
    // Even with lots of evidence, never auto-write a bare "pass"
    const evidence: DraftEvidence = {
      commitLines: [
        "abc1234 tcr: deliver AC1 AC2 AC3 AC4 AC5 AC6",
      ],
      diffStatLines: [],
      changedFilenames: [
        "packages/cli/test/fix-912-ac1.test.ts",
        "packages/cli/test/fix-912-ac2.test.ts",
        "packages/cli/test/fix-912-ac3.test.ts",
        "packages/cli/test/fix-912-ac4.test.ts",
        "packages/cli/test/fix-912-ac5.test.ts",
        "packages/cli/test/fix-912-ac6.test.ts",
      ],
    };
    const json = generateAcMapDraft(FIX_912_SPEC, "FIX-912", evidence);
    const entries = JSON.parse(json!) as Array<{ ac: string; status: string }>;
    for (const e of entries) {
      expect(e.status).not.toBe("pass");
      // pass-with-evidence is the harness claim, not a bare pass
      if (e.status === ACMAP_PASS_WITH_EVIDENCE) continue;
      expect(e.status).toBe(ACMAP_DRAFT_STATUS);
    }
  });

  it("changed non-test source files appear in evidence for ALL ACs", () => {
    const evidence: DraftEvidence = {
      commitLines: [],
      diffStatLines: [],
      changedFilenames: [
        "packages/cli/src/runner/attest-remediation.ts",
        "packages/cli/src/runner/executor.ts",
      ],
    };
    const json = generateAcMapDraft(FIX_912_SPEC, "FIX-912", evidence);
    const entries = JSON.parse(json!) as Array<{ ac: string; evidence?: Array<{ label: string }> }>;
    for (const e of entries) {
      expect(e.evidence?.some((ev) => ev.label.includes("attest-remediation.ts"))).toBe(true);
      expect(e.evidence?.some((ev) => ev.label.includes("executor.ts"))).toBe(true);
    }
  });

  it("deduplicates evidence entries (same file, same commit)", () => {
    const evidence: DraftEvidence = {
      commitLines: ["abc1234 tcr: fix AC1 AC2"],
      diffStatLines: [],
      changedFilenames: ["packages/cli/test/fix-912-ac1.test.ts"],
    };
    const json = generateAcMapDraft(FIX_912_SPEC, "FIX-912", evidence);
    const entries = JSON.parse(json!) as Array<{ ac: string; evidence?: Array<{ label: string }> }>;
    // AC1 has both commit + test file evidence but no duplicate commit refs
    const ac1 = entries.find((e) => e.ac === "FIX-912:AC1")!;
    const labels = (ac1.evidence ?? []).map((ev) => ev.label);
    const uniqueLabels = new Set(labels);
    expect(uniqueLabels.size).toBe(labels.length);
  });

  it("dist/ and node_modules/ files are excluded from evidence", () => {
    const evidence: DraftEvidence = {
      commitLines: [],
      diffStatLines: [],
      changedFilenames: [
        "packages/cli/dist/runner/attest-remediation.js",
        "node_modules/.cache/something",
        "packages/cli/src/runner/attest-remediation.ts",
      ],
    };
    const json = generateAcMapDraft(FIX_912_SPEC, "FIX-912", evidence);
    const entries = JSON.parse(json!) as Array<{ ac: string; evidence?: Array<{ label: string }> }>;
    for (const e of entries) {
      const labels = (e.evidence ?? []).map((ev) => ev.label);
      expect(labels.some((l) => l.includes("/dist/"))).toBe(false);
      expect(labels.some((l) => l.includes("node_modules"))).toBe(false);
      expect(labels.some((l) => l.includes("attest-remediation.ts"))).toBe(true);
    }
  });
});
