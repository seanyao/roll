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
  verificationReportFresh,
  verificationReportHasContent,
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
 */
function withReport(storyId: string, mtimeSec?: number, body = '<div class="ev ev-text">proof</div>'): string {
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

  it("interactive story requires screenshot evidence or honest-skip text", () => {
    const noShot = withReport("FIX-CLI", 2000);
    writeFileSync(join(noShot, ".roll", "features", "uncategorized", "FIX-CLI", "spec.md"), "**AC:**\n- [ ] CLI shows output\n");
    expect(verificationReportHasContent(noShot, "FIX-CLI")).toBe(false);

    const withShot = withReport("FIX-WEB", 2000, '<figure class="shot"><img src="screenshots/home.png"></figure>');
    writeFileSync(join(withShot, ".roll", "features", "uncategorized", "FIX-WEB", "spec.md"), "**AC:**\n- [ ] web screen renders\n");
    expect(verificationReportHasContent(withShot, "FIX-WEB")).toBe(true);

    const withSkip = withReport("FIX-TUI", 2000, '<div class="ev ev-text">{"taken":false,"skipped":"no GUI session"}</div>');
    writeFileSync(join(withSkip, ".roll", "features", "uncategorized", "FIX-TUI", "spec.md"), "**AC:**\n- [ ] TUI can be inspected\n");
    expect(verificationReportHasContent(withSkip, "FIX-TUI")).toBe(true);
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
    const { alerts, events, s } = sinks();
    const r = runAttestGate(wt, "FIX-310", "c-1", "soft", 1000, s);
    expect(r.verdict).toBe("produced");
    expect(r.blocked).toBe(false);
    expect(alerts).toHaveLength(0);
    expect(events).toEqual([{ cycleId: "c-1", verdict: "produced", reasons: r.reasons }]);
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
});
