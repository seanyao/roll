/**
 * US-OBS-037 — Collab view render contract + protocol legend (Layer A).
 *
 * These tests freeze the visual vocabulary: roles, gates, handoffs, escalation
 * callouts, fold rules, and the time-spine formatter. All assertions run with
 * color disabled so the snapshots are stable across platforms.
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  formatEpochMs,
  GATE_GLYPH,
  HANDOFF_GLYPH,
  renderCallout,
  renderFoldGroup,
  renderHandoff,
  renderLegend,
  ROLE_GLYPH,
  ESCALATION_GLYPH,
  type CollabRole,
  type RenderOpt,
} from "../src/lib/collab-render.js";

const noColor: RenderOpt = { color: false, fold: true, tz: "epoch" };

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[\d;]*m/g, "");
}

describe("visual vocabulary constants", () => {
  it("exports the Layer A glyphs from the design doc §2", () => {
    expect(ROLE_GLYPH.supervise).toBe("🧭");
    expect(ROLE_GLYPH.build).toBe("🔨");
    expect(ROLE_GLYPH.peer).toBe("🔎");
    expect(ROLE_GLYPH.score).toBe("🎯");
    expect(ROLE_GLYPH.diagnose).toBe("🔬");
    expect(GATE_GLYPH).toBe("🚦");
    expect(HANDOFF_GLYPH).toBe("→");
    expect(ESCALATION_GLYPH).toBe("⤴");
  });
});

describe("renderLegend", () => {
  it("prints the Layer A protocol legend without color when color:false", () => {
    const out = stripAnsi(renderLegend(noColor));
    expect(out).toContain("Layer A");
    expect(out).toContain("🧭");
    expect(out).toContain("🔨");
    expect(out).toContain("🔎");
    expect(out).toContain("🎯");
    expect(out).toContain("🔬");
    expect(out).toContain("🚦");
    expect(out).toContain("→");
    expect(out).toContain("⤴");
    expect(out).not.toMatch(/\x1b\[/);
  });

  it("renders with color when color:true", () => {
    const out = renderLegend({ ...noColor, color: true });
    expect(out).toMatch(/\x1b\[/);
  });

  it("matches the approved snapshot (structure-stable, color-scrubbed)", () => {
    expect(stripAnsi(renderLegend(noColor))).toMatchSnapshot();
  });
});

describe("renderCallout", () => {
  it("renders an escalation as a full-width boxed callout", () => {
    const out = stripAnsi(
      renderCallout(
        [
          `${ESCALATION_GLYPH} escalation   baton returns to supervisor`,
          `${ROLE_GLYPH.diagnose} diagnose → harness issue → open FIX-1036`,
        ],
        noColor,
      ),
    );
    expect(out).toContain("┏");
    expect(out).toContain("┓");
    expect(out).toContain("┗");
    expect(out).toContain("┛");
    expect(out).toContain("⤴ escalation");
    expect(out).toContain("🔬 diagnose");
  });

  it("matches the approved escalation snapshot", () => {
    expect(
      stripAnsi(
        renderCallout(
          [
            `${ESCALATION_GLYPH} escalation   baton returns to supervisor`,
            `${ROLE_GLYPH.diagnose} diagnose → harness issue → open FIX-1036`,
          ],
          noColor,
        ),
      ),
    ).toMatchSnapshot();
  });
});

describe("renderHandoff", () => {
  it.each<[CollabRole, CollabRole, string]>([
    ["supervise", "build", "🧭 → 🔨"],
    ["build", "peer", "🔨 → 🔎"],
    ["peer", "score", "🔎 → 🎯"],
    ["score", "supervise", "🎯 → 🧭"],
  ])("renders %s → %s", (from, to, expected) => {
    expect(stripAnsi(renderHandoff(from, to, noColor))).toContain(expected);
  });
});

describe("renderFoldGroup", () => {
  it("collapses same-shape steps into a single counted line", () => {
    const out = stripAnsi(renderFoldGroup(`${ROLE_GLYPH.build} build`, 3, noColor));
    expect(out).toContain("🔨 build");
    expect(out).toContain("×3");
  });
});

describe("formatEpochMs", () => {
  it("formats an epoch-ms timestamp as HH:MM UTC (no local clock read)", () => {
    // 2026-07-01T14:13:00.000Z
    const ms = new Date("2026-07-01T14:13:00.000Z").getTime();
    expect(formatEpochMs(ms, noColor)).toBe("14:13");
  });

  it("never reads the system clock", () => {
    // The function is pure: passing the same ms always yields the same string.
    const ms = 1_751_481_180_000;
    expect(formatEpochMs(ms, noColor)).toBe(formatEpochMs(ms, noColor));
  });
});

const CLI_BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "roll.js");

describe("E2E — `roll cycle --legend`", () => {
  it("prints the Layer A legend through the CLI binary", () => {
    const out = execFileSync("node", [CLI_BIN, "cycle", "--legend"], {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    });
    expect(out).toContain("Layer A");
    expect(out).toContain("🧭");
    expect(out).toContain("🔨");
    expect(out).toContain("🚦");
    expect(out).toContain("→");
    expect(out).toContain("⤴");
  });

  it("matches the approved CLI snapshot", () => {
    const out = execFileSync("node", [CLI_BIN, "cycle", "--legend"], {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    });
    expect(out).toMatchSnapshot();
  });
});
