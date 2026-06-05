/**
 * US-ATTEST-005 — report renderer pins: the no-evidence red line (forced
 * Claimed + Discrepancies appendix), deletion-not-placeholder for screenshots,
 * single-file self-containment, and the 5-level badge ladder.
 */
import { describe, expect, it } from "vitest";
import { ansiPre } from "../src/attest/ansi-html.js";
import { enforceRedLine, renderReport, type AcReportItem } from "../src/attest/report.js";

function item(over: Partial<AcReportItem>): AcReportItem {
  return { id: "US-X-001:AC1", text: "默认 AC 文本", status: "pass", evidence: [], ...over };
}

const BASE = { storyId: "US-X-001", title: "示例 Story", generatedAt: "2026-06-06T00:00:00Z" };

describe("red line — no evidence can't stay pass", () => {
  it("pass/readonly/partial with zero evidence are forced to claimed", () => {
    for (const s of ["pass", "readonly", "partial"] as const) {
      const r = enforceRedLine(item({ status: s }));
      expect(r.item.status).toBe("claimed");
      expect(r.downgraded).toBe(true);
    }
  });

  it("missing/claimed stay as-is; evidence-backed pass survives", () => {
    expect(enforceRedLine(item({ status: "missing" })).downgraded).toBe(false);
    expect(enforceRedLine(item({ status: "claimed" })).downgraded).toBe(false);
    const backed = item({ evidence: [{ kind: "commit", label: "tcr: x" }] });
    expect(enforceRedLine(backed)).toEqual({ item: backed, downgraded: false });
  });

  it("downgraded items surface in the Discrepancies appendix with anchors", () => {
    const html = renderReport({ ...BASE, items: [item({ status: "pass" })] });
    expect(html).toContain("Discrepancies · 证据缺口");
    expect(html).toContain('href="#US-X-001:AC1"');
    expect(html).toContain("🟧 Claimed");
  });

  it("fully-evidenced report has NO Discrepancies section", () => {
    const html = renderReport({
      ...BASE,
      items: [item({ evidence: [{ kind: "test-pass", label: "suite green" }] })],
    });
    expect(html).not.toContain("Discrepancies");
  });
});

describe("deletion-not-placeholder", () => {
  it("screenshot figure renders only when the ref exists", () => {
    const w = renderReport({
      ...BASE,
      items: [item({ evidence: [{ kind: "screenshot", label: "首页", href: "./screenshots/a.png" }] })],
    });
    expect(w).toContain('<img src="./screenshots/a.png"');
    const wo = renderReport({ ...BASE, items: [item({ evidence: [{ kind: "commit", label: "c" }] })] });
    expect(wo).not.toContain("<figure");
    expect(wo).not.toMatch(/placeholder|占位/);
  });
});

describe("single-file self-containment", () => {
  it("no external loads: no <script src>, no <link rel>, images only relative", () => {
    const html = renderReport({
      ...BASE,
      items: [
        item({
          evidence: [
            { kind: "screenshot", label: "s", href: "./screenshots/a.png" },
            { kind: "ci", label: "CI run", href: "https://github.com/x/y/actions/runs/1" },
            { kind: "text", label: "vitest", inlineHtml: ansiPre("[32m✓ ok[0m") },
          ],
        }),
      ],
      facts: { tcrCount: 3, ciConclusion: "success", testPassAge: "90s" },
    });
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<link");
    expect(html).not.toMatch(/<img src="https?:/);
    expect(html).toContain(".ansi"); // ANSI_CSS embedded
    expect(html).toContain('<span class="a-fg32">✓ ok</span>'); // text evidence inline
    expect(html).toContain("TCR commits: <b>3</b>");
    expect(html).toContain("@media print");
  });

  it("HTML-escapes AC text and labels", () => {
    const html = renderReport({ ...BASE, items: [item({ text: "a <b> & c", evidence: [{ kind: "commit", label: "<x>" }] })] });
    expect(html).toContain("a &lt;b&gt; &amp; c");
    expect(html).toContain("&lt;x&gt;");
  });
});

describe("badge ladder", () => {
  it("summary counts every present status with bilingual badges", () => {
    const html = renderReport({
      ...BASE,
      items: [
        item({ id: "A:AC1", evidence: [{ kind: "commit", label: "c" }] }),
        item({ id: "A:AC2", status: "readonly", evidence: [{ kind: "deploy", label: "d" }] }),
        item({ id: "A:AC3", status: "partial", note: "缺移动端验证", evidence: [{ kind: "ci", label: "ci" }] }),
        item({ id: "A:AC4", status: "missing" }),
      ],
    });
    expect(html).toContain("✅ Pass 通过 × 1");
    expect(html).toContain("🟦 Read-only Pass 只读通过 × 1");
    expect(html).toContain("🟨 Partial 部分满足 × 1");
    expect(html).toContain("🟥 Missing 无证据 × 1");
    expect(html).toContain("缺移动端验证");
  });
});
