/**
 * US-ATTEST-005 — report renderer pins: the no-evidence red line (forced
 * Claimed + Discrepancies appendix), deletion-not-placeholder for screenshots,
 * single-file self-containment, and the 5-level badge ladder.
 */
import { describe, expect, it } from "vitest";
import { ansiPre } from "../src/attest/ansi-html.js";
import { enforceRedLine, renderReport, type AcReportItem } from "../src/attest/report.js";
import { bi } from "../src/html/chrome.js";

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
    expect(html).toContain(bi("Discrepancies", "证据缺口"));
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
  it("no external loads: no <script src>, no <link rel>, images only relative; chrome script is inline", () => {
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
    expect(html).not.toContain("<script src=");
    expect(html).not.toContain("<link");
    expect(html).not.toMatch(/<img src="https?:/);
    // the ONLY script is the inline lang/theme chrome — no fetches, no third-party code
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).toContain("localStorage");
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

describe("US-ATTEST-011 — Gate self-capture section", () => {
  it("renders a figure for an unattended terminal self-capture", () => {
    const html = renderReport({
      ...BASE,
      items: [item({ evidence: [{ kind: "commit", label: "c" }] })],
      selfCaptures: [{ kind: "screenshot", label: "terminal", href: "./screenshots/terminal.png" }],
    });
    expect(html).toContain(bi("Gate self-capture", "Gate 自产实拍"));
    expect(html).toContain('<img src="./screenshots/terminal.png"');
  });

  it("no self-captures ⇒ block skipped, no placeholder (deletion contract)", () => {
    const html = renderReport({ ...BASE, items: [item({ evidence: [{ kind: "commit", label: "c" }] })] });
    expect(html).not.toContain("Gate self-capture");
    const empty = renderReport({ ...BASE, items: [item({ evidence: [{ kind: "commit", label: "c" }] })], selfCaptures: [] });
    expect(empty).not.toContain("Gate self-capture");
  });
});

describe("US-ATTEST-013 — explicit layering order", () => {
  it("business body (context → badges → AC) precedes the closing (quality gate → evidence index)", () => {
    const html = renderReport({
      ...BASE,
      context: { oneLiner: "卡一句话" },
      items: [item({ id: "A:AC1", evidence: [{ kind: "test-pass", label: "suite green" }] })],
      facts: { tcrCount: 5, ciConclusion: "success", testPassAge: "30s" },
    });
    const ctxAt = html.indexOf("卡上下文");
    const acAt = html.indexOf('class="ac ');
    const gateAt = html.indexOf("质量门禁");
    const idxAt = html.indexOf("证据索引");
    // 主体 leads, 收口 trails — and the quality gate now lives in the closing,
    // after the AC body, not at the top.
    expect(ctxAt).toBeGreaterThan(-1);
    expect(ctxAt).toBeLessThan(acAt);
    expect(acAt).toBeLessThan(gateAt);
    expect(gateAt).toBeLessThan(idxAt);
    expect(html).toContain("TCR commits: <b>5</b>");
  });
});

describe("US-ATTEST-013 — card context leads the business body", () => {
  it("renders one-liner / epic / summary / backlog status / delivery chain before the AC sections", () => {
    const html = renderReport({
      ...BASE,
      context: {
        oneLiner: "报告分层且自含待办全貌",
        epic: "acceptance-evidence",
        summary: "报告原是工程师向 AC 堆，现按受众分层",
        backlogStatus: "🔨 In Progress",
        delivery: {
          prLinks: [{ label: "#486", href: "https://github.com/seanyao/roll/pull/486" }],
          cycleId: "cycle-20260606-092227-79062",
          timeline: "09:22 → 09:40",
          cost: "$0.42",
        },
      },
      items: [item({ evidence: [{ kind: "commit", label: "c" }] })],
    });
    expect(html).toContain(bi("Context", "卡上下文"));
    expect(html).toContain("报告分层且自含待办全貌");
    expect(html).toContain("acceptance-evidence");
    expect(html).toContain("🔨 In Progress");
    expect(html).toContain("cycle-20260606-092227-79062");
    expect(html).toContain('href="https://github.com/seanyao/roll/pull/486"');
    expect(html).toContain("$0.42");
    // context (business) precedes the first AC section
    expect(html.indexOf("卡上下文")).toBeLessThan(html.indexOf('class="ac '));
  });

  it("absent context ⇒ no context section (trim, no placeholder)", () => {
    const html = renderReport({ ...BASE, items: [item({ evidence: [{ kind: "commit", label: "c" }] })] });
    expect(html).not.toContain("卡上下文");
  });

  it("context with only empty sub-fields is trimmed away", () => {
    const html = renderReport({ ...BASE, context: { delivery: {} }, items: [item({ evidence: [{ kind: "commit", label: "c" }] })] });
    expect(html).not.toContain("卡上下文");
  });
});

describe("US-ATTEST-013 — evidence index closing section", () => {
  it("lists every evidence file in one table (AC + before/after + self-capture)", () => {
    const html = renderReport({
      ...BASE,
      items: [
        item({
          id: "A:AC1",
          evidence: [
            { kind: "screenshot", label: "首页", href: "./screenshots/a.png" },
            { kind: "ci", label: "CI run", href: "https://github.com/x/y/actions/runs/1" },
          ],
        }),
      ],
      beforeAfter: [
        {
          label: "首屏",
          before: { kind: "screenshot", label: "改前", href: "./screenshots/before.png" },
          after: { kind: "screenshot", label: "改后", href: "./screenshots/after.png" },
        },
      ],
      selfCaptures: [{ kind: "screenshot", label: "terminal", href: "./screenshots/terminal.png" }],
    });
    expect(html).toContain(bi("Evidence index", "证据索引"));
    expect(html).toContain("./screenshots/a.png");
    expect(html).toContain("./screenshots/before.png");
    expect(html).toContain("./screenshots/after.png");
    expect(html).toContain("./screenshots/terminal.png");
    expect(html).toContain("https://github.com/x/y/actions/runs/1");
  });

  it("no evidence at all ⇒ index skipped (no empty table)", () => {
    const html = renderReport({ ...BASE, items: [item({ status: "missing" })] });
    expect(html).not.toContain("证据索引");
  });
});

describe("US-ATTEST-013 — before/after comparison", () => {
  it("renders paired before/after figures side by side", () => {
    const html = renderReport({
      ...BASE,
      items: [item({ evidence: [{ kind: "commit", label: "c" }] })],
      beforeAfter: [
        {
          label: "报告首屏",
          before: { kind: "screenshot", label: "工程师向 AC 堆", href: "./screenshots/before-home.png" },
          after: { kind: "screenshot", label: "业务分层", href: "./screenshots/after-home.png" },
        },
      ],
    });
    expect(html).toContain(bi("Before / After", "对照实拍"));
    expect(html).toContain('<img src="./screenshots/before-home.png"');
    expect(html).toContain('<img src="./screenshots/after-home.png"');
    expect(html).toContain(bi("Before", "改前"));
    expect(html).toContain(bi("After", "改后"));
  });

  it("empty / absent before-after ⇒ section skipped (全新功能免出)", () => {
    const none = renderReport({ ...BASE, items: [item({ evidence: [{ kind: "commit", label: "c" }] })] });
    expect(none).not.toContain("对照实拍");
    const empty = renderReport({ ...BASE, items: [item({ evidence: [{ kind: "commit", label: "c" }] })], beforeAfter: [] });
    expect(empty).not.toContain("对照实拍");
  });
});

describe("US-ATTEST-013 — layered IA: technical evidence folds", () => {
  it("text/ANSI evidence sits inside a collapsed <details class=\"tech\">", () => {
    const html = renderReport({
      ...BASE,
      items: [
        item({
          evidence: [
            { kind: "screenshot", label: "首页", href: "./screenshots/a.png" },
            { kind: "text", label: "vitest", inlineHtml: ansiPre("plain log line") },
          ],
        }),
      ],
    });
    expect(html).toContain('<details class="tech"');
    // collapsed by default — no `open` attribute on the tech fold
    expect(html).not.toMatch(/<details class="tech" open/);
    // the ANSI pre is INSIDE the fold (business screenshot is outside, before it)
    const detailsAt = html.indexOf('<details class="tech"');
    const ansiAt = html.indexOf('<pre class="ansi">plain log line</pre>');
    const shotAt = html.indexOf('<img src="./screenshots/a.png"');
    expect(detailsAt).toBeGreaterThan(-1);
    expect(ansiAt).toBeGreaterThan(detailsAt); // ANSI after the fold opens
    expect(shotAt).toBeLessThan(detailsAt); // business screenshot before technical fold
  });

  it("no text evidence ⇒ no tech fold (deletion-not-placeholder)", () => {
    const html = renderReport({ ...BASE, items: [item({ evidence: [{ kind: "commit", label: "c" }] })] });
    expect(html).not.toContain('<details class="tech"');
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
    expect(html).toContain(`✅ ${bi("Pass", "通过")} × 1`);
    expect(html).toContain(`🟦 ${bi("Read-only Pass", "只读通过")} × 1`);
    expect(html).toContain(`🟨 ${bi("Partial", "部分满足")} × 1`);
    expect(html).toContain(`🟥 ${bi("Missing", "无证据")} × 1`);
    expect(html).toContain("缺移动端验证");
  });
});

describe("US-ATTEST-012 — fail / blocked status口径", () => {
  it("fail and blocked render with own badge (icon+text, not color-only) and section class", () => {
    const html = renderReport({
      ...BASE,
      items: [
        item({ id: "A:AC1", status: "fail", evidence: [{ kind: "test-pass", label: "red suite" }] }),
        item({ id: "A:AC2", status: "blocked", note: "等 iOS 真机", evidence: [{ kind: "commit", label: "c" }] }),
      ],
    });
    // distinct, non-color marker = icon + bilingual word
    expect(html).toContain(`❌ ${bi("Fail", "未通过")} × 1`);
    expect(html).toContain(`⛔ ${bi("Blocked", "受阻")} × 1`);
    // status colour classes present so the badge ladder is not color-only
    expect(html).toContain("s-fail");
    expect(html).toContain("s-blocked");
    expect(html).toContain(".s-fail { border-left:");
    expect(html).toContain(".s-blocked { border-left:");
  });

  it("fail/blocked are NOT a no-evidence red-line downgrade (verified-and-failed ≠ missing)", () => {
    expect(enforceRedLine(item({ status: "fail", evidence: [] })).downgraded).toBe(false);
    expect(enforceRedLine(item({ status: "blocked", evidence: [] })).downgraded).toBe(false);
    // and they never appear in the Discrepancies appendix
    const html = renderReport({ ...BASE, items: [item({ status: "blocked", evidence: [] })] });
    expect(html).not.toContain("Discrepancies");
  });
});

describe("US-ATTEST-009 — Self-Score fold", () => {
  it("renders a collapsed details block with entries", () => {
    const html = renderReport({
      ...BASE,
      items: [item({ evidence: [{ kind: "commit", label: "c" }] })],
      selfScores: [
        { skill: "roll-fix", score: 6, verdict: "ok", ts: "2026-06-03T18:32:04Z", note: "Empty flaky CI card" },
        { skill: "roll-build", score: 9, verdict: "good", ts: "2026-06-04T01:00:00Z", note: "" },
      ],
    });
    expect(html).toContain(`${bi("Self-Score", "自评")}（2）`);
    expect(html).toContain("<details");
    expect(html).toContain("<b>6</b>/10 · ok");
    expect(html).toContain("Empty flaky CI card");
  });

  it("no entries ⇒ whole block skipped (no placeholder)", () => {
    const html = renderReport({ ...BASE, items: [item({ evidence: [{ kind: "commit", label: "c" }] })] });
    expect(html).not.toContain("<details"); // the CSS rules may ship; the BLOCK must not
    expect(html).not.toContain("Self-Score");
  });
});

describe("US-ATTEST-014 — process trace inline", () => {
  const withEv = [item({ evidence: [{ kind: "commit", label: "c" }] })];

  it("loop-delivered: renders timeline + signal layer + folded transcript with original-path index", () => {
    const html = renderReport({
      ...BASE,
      items: withEv,
      process: {
        delivery: "loop",
        cycleId: "20260606-093000-12345",
        agent: "claude",
        timeline: [
          { offsetSec: 0, layer: "outline", marker: "cycle:start", label: "周期开始 · cycle start" },
          { offsetSec: 20, layer: "signal", marker: "tcr", label: "TCR abcdef123 · add extractor" },
          { offsetSec: 140, layer: "outline", marker: "cycle:end", label: "周期结束 · cycle end · delivered" },
        ],
        transcript: {
          inlineHtml: "<pre class=\"ansi\">log body</pre>",
          truncated: true,
          totalLen: 300000,
          shownLen: 48000,
          originalPath: ".roll/loop/cycle-logs/20260606-093000-12345.agent.log",
        },
      },
    });
    expect(html).toContain(bi("Process trace", "过程档案"));
    expect(html).toContain("20260606-093000-12345");
    expect(html).toContain("claude");
    // timeline entries with offsets
    expect(html).toContain("+00:00");
    expect(html).toContain("+02:20");
    expect(html).toContain("add extractor");
    // signal layer visually distinguished
    expect(html).toContain("tl-signal");
    expect(html).toContain("tl-outline");
    // transcript folded, with truncation note + original-path index
    expect(html).toContain("完整转录");
    expect(html).toContain("log body");
    expect(html).toContain(".roll/loop/cycle-logs/20260606-093000-12345.agent.log");
    expect(html).toMatch(/截断|truncated/);
  });

  it("manual delivery: shows conductor 手工交付, no transcript fold", () => {
    const html = renderReport({
      ...BASE,
      items: withEv,
      process: { delivery: "manual", missing: ["cycle", "transcript"] },
    });
    expect(html).toContain(bi("Process trace", "过程档案"));
    expect(html).toContain("手工交付");
    expect(html).not.toContain("完整转录");
    // degrade markers surface which segments are missing
    expect(html).toContain("transcript");
  });

  it("absent process ⇒ whole section trimmed (no placeholder)", () => {
    const html = renderReport({ ...BASE, items: withEv });
    expect(html).not.toContain("过程档案");
    expect(html).not.toContain("过程数据缺失");
  });

  it("escapes transcript original path and timeline labels", () => {
    const html = renderReport({
      ...BASE,
      items: withEv,
      process: {
        delivery: "loop",
        cycleId: "c1",
        timeline: [{ offsetSec: 0, layer: "signal", marker: "alert", label: "ALERT · <script>" }],
      },
    });
    // the raw label must never land unescaped (the only <script> is the chrome's own)
    expect(html).not.toContain("ALERT · <script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
