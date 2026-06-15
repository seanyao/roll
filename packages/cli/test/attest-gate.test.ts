/**
 * FIX-207 — acceptance-report (attest) gate.
 *
 * Runtime mechanism (executor capture step), not skill text: agent-agnostic,
 * fires on every actual delivery. A delivery with no fresh acceptance report
 * leaves an auditable ALERT + `attest:gate` event. Hard by default; policy can
 * explicitly downgrade to soft for migration windows.
 */
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  readAttestGateMode,
  runAttestGate,
  screenshotExemption,
  storyHasAcBlock,
  storyRequiresScreenshot,
  verificationReportFresh,
  verificationReportHasContent,
  webCaptureTargetForStory,
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
function withReport(storyId: string, mtimeSec?: number, body = '<div class="ev ev-text">proof</div><figure class="shot"><img src="screenshots/p.png"></figure>'): string {
  const wt = tmp("wt");
  const storyDir = join(wt, ".roll", "features", "uncategorized", storyId);
  const dir = join(storyDir, "latest");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(storyDir, "ac-map.json"), "[]\n");
  const p = join(dir, `${storyId}-report.html`);
  writeFileSync(p, `<html><body><section class="ac s-pass" id="${storyId}:AC1">${body}</section></body></html>\n`);
  if (mtimeSec !== undefined) utimesSync(p, mtimeSec, mtimeSec);
  return wt;
}

function writeAcMap(wt: string, storyId: string, body: unknown): void {
  writeFileSync(join(wt, ".roll", "features", "uncategorized", storyId, "ac-map.json"), JSON.stringify(body, null, 2) + "\n");
}

function writeEvidenceJson(wt: string, storyId: string, body: unknown): void {
  writeFileSync(join(wt, ".roll", "features", "uncategorized", storyId, "latest", "evidence.json"), JSON.stringify(body, null, 2) + "\n");
}

function withSelfScore(wt: string, storyId: string, score: number, verdict: "good" | "ok" | "regression"): void {
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

  it("empty shell (parseable but zero AC, no ac-map) → NO content (FIX-214)", () => {
    const wt = withEmptyShell("FIX-321", 2000);
    expect(verificationReportHasContent(wt, "FIX-321")).toBe(false);
  });

  it("absent report → no content", () => {
    expect(verificationReportHasContent(tmp("none"), "FIX-322")).toBe(false);
  });

  it("pure claimed / zero evidence report → NO content", () => {
    const wt = withReport("FIX-323", 2000, "statement only");
    expect(verificationReportHasContent(wt, "FIX-323")).toBe(false);
  });

  it("interactive story requires screenshot evidence or a machine capture skip", () => {
    const noShot = withReport("FIX-CLI", 2000, '<div class="ev ev-text">text proof only</div>');
    writeFileSync(join(noShot, ".roll", "features", "uncategorized", "FIX-CLI", "spec.md"), "**AC:**\n- [ ] CLI shows output\n");
    expect(verificationReportHasContent(noShot, "FIX-CLI")).toBe(false);

    const withShot = withReport("FIX-WEB", 2000, '<figure class="shot"><img src="screenshots/home.png"></figure>');
    writeFileSync(join(withShot, ".roll", "features", "uncategorized", "FIX-WEB", "spec.md"), "**AC:**\n- [ ] web screen renders\n");
    expect(verificationReportHasContent(withShot, "FIX-WEB")).toBe(true);

    const withSkip = withReport("FIX-TUI", 2000, '<div class="ev ev-text">{"taken":false,"skipped":"no GUI session"}</div>');
    writeFileSync(join(withSkip, ".roll", "features", "uncategorized", "FIX-TUI", "spec.md"), "**AC:**\n- [ ] TUI can be inspected\n");
    writeEvidenceJson(withSkip, "FIX-TUI", {
      captures: [{ kind: "terminal", out: "screenshots/terminal.png", taken: false, skipped: "no GUI session" }],
    });
    expect(verificationReportHasContent(withSkip, "FIX-TUI")).toBe(true);
  });

  it("FIX-261/FIX-258: modern Acceptance Criteria makes CLI text-only reports fail the screenshot floor", () => {
    const noShot = withReport("FIX-MODERN", 2000, '<div class="ev ev-text">text proof only</div>');
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
    withSelfScore(wt, "FIX-310", 8, "good");
    const { alerts, events, s } = sinks();
    const r = runAttestGate(wt, "FIX-310", "c-1", "soft", 1000, s);
    expect(r.verdict).toBe("produced");
    expect(r.blocked).toBe(false);
    expect(alerts).toHaveLength(0);
    expect(events).toEqual([{ cycleId: "c-1", verdict: "produced", reasons: r.reasons }]);
  });

  it("US-EVID-013: missing self-score note is skipped and hard-blocked", () => {
    const wt = withReport("FIX-SCORE-MISSING", 2000);
    const { alerts, events, s } = sinks();
    const r = runAttestGate(wt, "FIX-SCORE-MISSING", "c-score-missing", "hard", 1000, s);
    expect(r.verdict).toBe("skipped");
    expect(r.blocked).toBe(true);
    expect(r.reasons[0]).toMatch(/self-score/i);
    expect(alerts[0]).toContain("BLOCKED");
    expect(events[0]?.verdict).toBe("skipped");
  });

  it("US-EVID-013: regression self-score is a hard gate failure", () => {
    const wt = withReport("FIX-SCORE-REG", 2000);
    withSelfScore(wt, "FIX-SCORE-REG", 3, "regression");
    const { alerts, events, s } = sinks();
    const r = runAttestGate(wt, "FIX-SCORE-REG", "c-score-reg", "hard", 1000, s);
    expect(r.verdict).toBe("skipped");
    expect(r.blocked).toBe(true);
    expect(r.reasons[0]).toContain("regression");
    expect(alerts[0]).toContain("self-score");
    expect(events[0]?.verdict).toBe("skipped");
  });

  it("US-EVID-013: low ok self-score is skipped with a discrepancy reason", () => {
    const wt = withReport("FIX-SCORE-LOW", 2000);
    withSelfScore(wt, "FIX-SCORE-LOW", 5, "ok");
    const { alerts, s } = sinks();
    const r = runAttestGate(wt, "FIX-SCORE-LOW", "c-score-low", "soft", 1000, s);
    expect(r.verdict).toBe("skipped");
    expect(r.blocked).toBe(false);
    expect(r.reasons[0]).toMatch(/low self-score.*partial.*Discrepancy/i);
    expect(alerts[0]).toContain("self-score");
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
    const wt = withReport("FIX-315", 2000, "claimed only");
    const { alerts, events, s } = sinks();
    const r = runAttestGate(wt, "FIX-315", "c-6", "hard", 1000, s);
    expect(r.verdict).toBe("skipped");
    expect(r.blocked).toBe(true);
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

  // ── FIX-295: a red assertion is a regression, never an env exception ─────────

  it("FIX-295 (AC-FIX2/AC-FIX3): a `fail` AC blocks in hard mode — a red check is a regression, not waivable", () => {
    // The FIX-284 shape: AC1-3 pass with evidence, AC4 ran the full suite and
    // went red. The cycle MUST fail — a red check on a cycle branch is a
    // regression (main is always green), never an "environmental" exception.
    const wt = withReport("FIX-RED", 2000, '<figure class="shot"><img src="screenshots/p.png"></figure>');
    withSelfScore(wt, "FIX-RED", 8, "good");
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
    withSelfScore(wt, "FIX-RED-SOFT", 8, "good");
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
    withSelfScore(wt, "FIX-BLOCKED", 8, "good");
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
    const wt = withSpec("FIX-FRAG", "---\nid: FIX-FRAG\ndeliverable_url: .roll/features/index.html#casting\n---\n# FIX-FRAG\n\n**AC:**\n- [ ] x\n");
    const t = webCaptureTargetForStory(wt, "FIX-FRAG");
    expect(t).toMatch(/^file:\/\//);
    expect(t).toContain("/.roll/features/index.html#casting"); // fragment preserved, not encoded into the path
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
    const wt = withReport("FIX-UNCAP", 2000, '<div class="ev ev-text">text proof only</div>');
    addSpec(wt, "FIX-UNCAP", "# FIX-UNCAP — Casting redesign\n\n## Acceptance Criteria\n\n- [ ] the casting layout is reworked\n");
    withSelfScore(wt, "FIX-UNCAP", 8, "good");
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
    const wt = withReport("FIX-CAP", 2000, '<figure class="shot"><img src="screenshots/casting.png"></figure>');
    addSpec(wt, "FIX-CAP", "# FIX-CAP — Casting redesign\n\n## Acceptance Criteria\n\n- [ ] the casting layout is reworked\n");
    withSelfScore(wt, "FIX-CAP", 8, "good");
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
    const wt = withReport("FIX-EXEMPT", 2000, '<div class="ev ev-text">text proof only</div>');
    addSpec(
      wt,
      "FIX-EXEMPT",
      "---\nid: FIX-EXEMPT\nscreenshot_exempt: pure data migration; no rendered surface\n---\n# FIX-EXEMPT\n\n## Acceptance Criteria\n\n- [ ] rows migrate\n",
    );
    withSelfScore(wt, "FIX-EXEMPT", 8, "good");
    expect(storyRequiresScreenshot(wt, "FIX-EXEMPT")).toBe(false);
    expect(verificationReportHasContent(wt, "FIX-EXEMPT")).toBe(true);
    const { alerts, events, s } = sinks();
    const r = runAttestGate(wt, "FIX-EXEMPT", "c-exempt", "hard", 1000, s);
    expect(r.verdict).toBe("produced");
    expect(r.blocked).toBe(false);
    expect(alerts).toHaveLength(0);
    expect(events[0]?.verdict).toBe("produced");
  });

  it("AC3: a required story with an HONEST recorded machine-skip PASSES (deletion-not-placeholder, not silent)", () => {
    const wt = withReport("FIX-SKIP309", 2000, '<div class="ev ev-text">{"taken":false,"skipped":"no GUI session"}</div>');
    addSpec(wt, "FIX-SKIP309", "# FIX-SKIP309 — TUI redesign\n\n## Acceptance Criteria\n\n- [ ] the TUI renders\n");
    withSelfScore(wt, "FIX-SKIP309", 8, "good");
    writeEvidenceJson(wt, "FIX-SKIP309", {
      captures: [{ kind: "terminal", out: "screenshots/terminal.png", taken: false, skipped: "no GUI session" }],
    });
    expect(storyRequiresScreenshot(wt, "FIX-SKIP309")).toBe(true);
    expect(verificationReportHasContent(wt, "FIX-SKIP309")).toBe(true);
    const { alerts, s } = sinks();
    const r = runAttestGate(wt, "FIX-SKIP309", "c-skip309", "hard", 1000, s);
    expect(r.verdict).toBe("produced");
    expect(alerts).toHaveLength(0);
  });
});
