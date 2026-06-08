/**
 * US-ATTEST-012 — render smoke: after a report is written it must be parseable,
 * every <img> it references must resolve to a file that exists, and it must load
 * NO external asset (CDN). A broken reference is a defect → non-zero exit upstream.
 * `<a href="https://…">` (CI / deploy links) is legitimate and must NOT trip it.
 */
import { describe, expect, it } from "vitest";
import { smokeCheckReport } from "../src/attest/report-smoke.js";

const GOOD = `<!doctype html><html><head></head><body>
<img src="./screenshots/a.png" alt="x">
<a href="https://github.com/x/y/actions/runs/1">CI run</a>
</body></html>`;

describe("smokeCheckReport", () => {
  it("clean report with present img + external <a> link → ok", () => {
    const r = smokeCheckReport(GOOD, (rel) => rel === "screenshots/a.png");
    expect(r.ok).toBe(true);
    expect(r.problems).toEqual([]);
  });

  it("img referencing a missing file → broken-img problem, not ok", () => {
    const r = smokeCheckReport(GOOD, () => false);
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => /broken img|screenshots\/a\.png/.test(p))).toBe(true);
  });

  it("external <img src=http> (CDN) → problem even if the local check would pass", () => {
    const html = `<html><body><img src="https://cdn.example.com/x.png"></body></html>`;
    const r = smokeCheckReport(html, () => true);
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => /external|cdn/i.test(p))).toBe(true);
  });

  it("external <script src> / <link href> (CDN asset loads) → problem", () => {
    const s = smokeCheckReport(`<html><head><script src="https://cdn/x.js"></script></head><body></body></html>`, () => true);
    expect(s.ok).toBe(false);
    const l = smokeCheckReport(`<html><head><link rel="stylesheet" href="https://cdn/x.css"></head><body></body></html>`, () => true);
    expect(l.ok).toBe(false);
  });

  it("unparseable / empty html → problem", () => {
    expect(smokeCheckReport("", () => true).ok).toBe(false);
    expect(smokeCheckReport("just some text, no tags", () => true).ok).toBe(false);
  });

  it("img path is resolved relative to the run dir (leading ./ stripped)", () => {
    const seen: string[] = [];
    smokeCheckReport(`<html><body><img src="./screenshots/terminal.png"></body></html>`, (rel) => {
      seen.push(rel);
      return true;
    });
    expect(seen).toContain("screenshots/terminal.png");
  });

  it("video sources are local assets and must resolve", () => {
    const seen: string[] = [];
    const ok = smokeCheckReport(`<html><body><video controls src="./screenshots/flow.mp4"></video></body></html>`, (rel) => {
      seen.push(rel);
      return rel === "screenshots/flow.mp4";
    });
    expect(ok.ok).toBe(true);
    expect(seen).toContain("screenshots/flow.mp4");

    const broken = smokeCheckReport(`<html><body><video><source src="screenshots/missing.webm"></video></body></html>`, () => false);
    expect(broken.ok).toBe(false);
    expect(broken.problems.some((p) => /broken video|screenshots\/missing\.webm/.test(p))).toBe(true);
  });

  it("external video sources are rejected as offline-breaking assets", () => {
    const r = smokeCheckReport(`<html><body><video src="https://cdn.example.com/flow.mp4"></video></body></html>`, () => true);
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => /external video|cdn/i.test(p))).toBe(true);
  });
});
