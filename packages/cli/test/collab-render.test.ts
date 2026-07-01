/** US-OBS-037 — Collab view render contract + protocol legend (Layer A) */
import { describe, expect, it } from "vitest";
import { cycleCommand } from "../src/commands/cycle.js";
import {
  ESCALATION_GLYPH,
  GATE_GLYPH,
  HANDOFF_GLYPH,
  ROLE_GLYPH,
  TERMINUS_GLYPH,
  VERDICT_GLYPH,
  foldConsecutive,
  formatTimeSpine,
  renderCallout,
  renderEscalationCallout,
  renderHandoff,
  renderLegend,
  renderRole,
  type RenderOpt,
} from "../src/lib/collab-render.js";
import { stripAnsi } from "../src/render.js";

const colorOn: RenderOpt = { color: true, fold: true, width: 72 };
const colorOff: RenderOpt = { color: false, fold: true, width: 72 };

describe("Layer A constants", () => {
  it("exposes the canonical visual vocabulary", () => {
    expect(ROLE_GLYPH.supervise).toBe("🧭");
    expect(ROLE_GLYPH.plan).toBe("🧭");
    expect(ROLE_GLYPH.build).toBe("🔨");
    expect(ROLE_GLYPH.peer).toBe("🔎");
    expect(ROLE_GLYPH.score).toBe("🎯");
    expect(ROLE_GLYPH.diagnose).toBe("🔬");
    expect(GATE_GLYPH).toBe("🚦");
    expect(HANDOFF_GLYPH).toBe("→");
    expect(ESCALATION_GLYPH).toBe("⤴");
    expect(VERDICT_GLYPH.agree).toBe("▸agree");
    expect(VERDICT_GLYPH.good).toBe("▸good");
    expect(VERDICT_GLYPH.produced).toBe("▸produced");
    expect(VERDICT_GLYPH.ok).toBe("▸ok");
    expect(TERMINUS_GLYPH.walked_full).toBe("✓");
    expect(TERMINUS_GLYPH.split).toBe("✂");
    expect(TERMINUS_GLYPH.escalated).toBe("⤴");
    expect(TERMINUS_GLYPH.supervisor_fix).toBe("🧭");
  });
});

describe("renderRole", () => {
  it("returns the glyph in color mode", () => {
    expect(stripAnsi(renderRole("build", colorOn))).toBe("🔨");
  });

  it("returns the glyph without ANSI in no-color mode", () => {
    const out = renderRole("build", colorOff);
    expect(out).toBe("🔨");
    expect(stripAnsi(out)).toBe(out);
  });
});

describe("renderHandoff", () => {
  it("renders an inline handoff between two roles", () => {
    expect(stripAnsi(renderHandoff("supervise", "build", colorOn))).toBe("🧭 → 🔨");
  });
});

describe("renderEscalationCallout", () => {
  it("renders a full-width boxed callout that breaks the layout", () => {
    const out = stripAnsi(renderEscalationCallout(["builder commit rejected", "supervisor takes over"], colorOn));
    expect(out).toContain("┏");
    expect(out).toContain("┗");
    expect(out).toContain(ESCALATION_GLYPH);
    expect(out).toContain("builder commit rejected");
    expect(out).toContain("supervisor takes over");
  });
});

describe("renderCallout", () => {
  it("renders a non-escalation box", () => {
    const out = stripAnsi(renderCallout("note", ["line one", "line two"], colorOn));
    expect(out).toContain("┌");
    expect(out).toContain("└");
    expect(out).toContain("note");
    expect(out).toContain("line one");
  });
});

describe("formatTimeSpine", () => {
  it("formats an epoch-ms value as UTC time (no local clock read)", () => {
    // 2026-07-01T12:34:56Z = 1751373296000 ms
    const out = stripAnsi(formatTimeSpine(Date.UTC(2026, 6, 1, 12, 34, 56), colorOn));
    expect(out).toBe("12:34:56");
  });
});

describe("foldConsecutive", () => {
  it("collapses consecutive same-shape steps", () => {
    expect(foldConsecutive(["tcr", "tcr", "tcr", "peer", "peer", "score"])).toEqual([
      "tcr ×3",
      "peer ×2",
      "score",
    ]);
  });

  it("leaves unique steps unchanged", () => {
    expect(foldConsecutive(["build", "peer", "score", "gate"])).toEqual(["build", "peer", "score", "gate"]);
  });

  it("handles pair:score-failure noise groups", () => {
    expect(foldConsecutive(["pair:score-failure", "pair:score-failure", "pair:score"])).toEqual([
      "pair:score-failure ×2",
      "pair:score",
    ]);
  });
});

describe("renderLegend", () => {
  it("prints the Layer A protocol legend with all vocabulary", () => {
    const out = stripAnsi(renderLegend(colorOn));
    expect(out).toContain("Collab view — how to read");
    expect(out).toContain("supervise");
    expect(out).toContain("build");
    expect(out).toContain("peer");
    expect(out).toContain("score");
    expect(out).toContain("diagnose");
    expect(out).toContain(HANDOFF_GLYPH);
    expect(out).toContain(ESCALATION_GLYPH);
    expect(out).toContain(GATE_GLYPH);
    expect(out).toContain("Time spine uses a single epoch-ms axis");
  });

  it("color and no-color produce the same structure", () => {
    expect(stripAnsi(renderLegend(colorOn))).toBe(stripAnsi(renderLegend(colorOff)));
  });

  it("snapshot: legend is data-independent", () => {
    expect(stripAnsi(renderLegend(colorOff))).toMatchSnapshot();
  });
});

describe("roll cycle --legend", () => {
  it("emits the legend and returns 0", () => {
    const out: string[] = [];
    const so = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string) => (out.push(s), true)) as typeof process.stdout.write;
    let status: number;
    try {
      status = cycleCommand(["--legend", "--no-color"]);
    } finally {
      process.stdout.write = so;
    }
    expect(status).toBe(0);
    const rendered = out.join("");
    expect(stripAnsi(rendered)).toContain("Collab view — how to read");
    expect(stripAnsi(rendered)).toContain("🧭 supervise");
  });
});
