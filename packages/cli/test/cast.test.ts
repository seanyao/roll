/**
 * US-DOSSIER-037 — `roll cast`: role Casting table in the
 * terminal, computed from the SAME `collectCasting()` view-model the web grid
 * renders. Tests: slot resolution, empty-slot em-dash, scenario rows, JSON↔human
 * parity, and determinism (mirrors router Invariant I10).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { castCommand, renderCastTable } from "../src/commands/cast.js";
import { collectCasting, type CastingVM } from "../src/lib/casting.js";
import { stripAnsi } from "../src/render.js";

function capture(fn: () => number): { out: string; err: string; code: number } {
  let out = "";
  let err = "";
  const so = vi.spyOn(process.stdout, "write").mockImplementation((s: string | Uint8Array) => {
    out += String(s);
    return true;
  });
  const se = vi.spyOn(process.stderr, "write").mockImplementation((s: string | Uint8Array) => {
    err += String(s);
    return true;
  });
  const code = fn();
  so.mockRestore();
  se.mockRestore();
  return { out: stripAnsi(out), err: stripAnsi(err), code };
}

afterEach(() => {
  delete process.env["ROLL_LANG"];
  delete process.env["ROLL_AGENTS_CONFIG"];
  vi.restoreAllMocks();
});

const configured: CastingVM = collectCasting({
  readSlot: (slot) => ({ easy: "kimi", default: "codex", hard: "claude", fallback: "claude" })[slot],
  sparPair: () => ["claude", "kimi"],
});

describe("renderCastTable — US-DOSSIER-037", () => {
  it("AC2: renders the four legacy execute-source rows resolved from the shared collector", () => {
    const text = stripAnsi(renderCastTable(configured, "en"));
    expect(text).toContain("story.execute · legacy easy");
    expect(text).toContain("kimi");
    expect(text).toContain("story.execute · legacy default");
    expect(text).toContain("codex");
    expect(text).toContain("story.execute · legacy hard");
    expect(text).toContain("story.execute · legacy fallback");
  });

  it("AC2: an empty/unconfigured slot prints an em-dash, never a guessed agent", () => {
    const empty = collectCasting({ readSlot: () => undefined });
    const text = stripAnsi(renderCastTable(empty, "en"));
    // every complexity slot resolves to "—" and the table never invents an agent
    expect(text).toContain("story.execute · legacy easy");
    expect(text).toMatch(/story\.execute · legacy easy\s+—/);
    expect(text).not.toContain("kimi");
    expect(text).not.toContain("codex");
    // PR review reuses the (empty) default slot → also an em-dash
    expect(text).toMatch(/PR review\s+—/);
    // the unconfigured footer hint shows
    expect(text).toContain("No legacy routes configured");
  });

  it("AC2: the four scenario rows match the web grid (peer · PR review · spar · onboard)", () => {
    const text = stripAnsi(renderCastTable(configured, "en"));
    expect(text).toContain("Peer re-check");
    expect(text).toContain("fresh reviewer session");
    expect(text).toContain("PR review");
    expect(text).toContain("Adversarial TDD");
    expect(text).toContain("claude ⚔ kimi");
    expect(text).toContain("Onboard");
    expect(text).toContain("follows the active client");
  });

  it("AC5: the table renders in the active language (zh), separate-line headers", () => {
    const text = stripAnsi(renderCastTable(configured, "zh"));
    expect(text).toContain("执行角色 · legacy easy");
    expect(text).toContain("同伴复核 peer");
    expect(text).toContain("fresh reviewer session");
    // header row in zh, never an inline EN+中 mix on the row
    expect(text).toContain("角色");
    expect(text).not.toContain("Role  角色");
  });

  it("AC4/AC6: a route-resolve rationale surfaces where present; absent ⇒ nothing inferred", () => {
    const vm = collectCasting({
      readSlot: (slot) => ({ easy: "kimi", default: "codex", hard: "claude", fallback: "claude" })[slot],
      routeAudit: (slot) => (slot === "hard" ? "claude best in-tier (hit_rate 0.91)" : undefined),
    });
    const text = stripAnsi(renderCastTable(vm, "en"));
    expect(text).toContain("hit_rate 0.91");
  });
});

describe("castCommand — US-DOSSIER-037", () => {
  it("AC4: --json emits the SAME view-model the human table is rendered from", () => {
    process.env["ROLL_AGENTS_CONFIG"] = "/nonexistent-agents.yaml"; // empty → all em-dash
    const { out, code } = capture(() => castCommand(["--json", "--no-color"]) as number);
    expect(code).toBe(0);
    const parsed = JSON.parse(out) as CastingVM;
    // the JSON is the casting view-model verbatim — same row keys, same em-dashes
    expect(parsed.rows.map((r) => r.key)).toEqual([
      "easy",
      "default",
      "hard",
      "fallback",
      "peer",
      "review-pr",
      "spar",
      "onboard",
    ]);
    expect(parsed.rows.find((r) => r.key === "easy")?.agentEn).toBe("—");
    expect(parsed.configured).toBe(false);
  });

  it("AC4: JSON ↔ human parity — every JSON agent appears in the human table", () => {
    const dir = mkdtempSync(join(tmpdir(), "roll-cast-"));
    const tmp = join(dir, "agents.yaml");
    writeFileSync(tmp, "schema: v3\neasy: { agent: kimi }\ndefault: { agent: codex }\nhard: { agent: claude }\nfallback: { agent: claude }\n");
    process.env["ROLL_AGENTS_CONFIG"] = tmp;
    try {
      const json = capture(() => castCommand(["--json", "--no-color"]) as number).out;
      const human = capture(() => castCommand(["--no-color"]) as number).out;
      const vm = JSON.parse(json) as CastingVM;
      for (const r of vm.rows) {
        expect(human).toContain(r.agentEn);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("AC6: deterministic — two human renders of the same config are byte-identical", () => {
    process.env["ROLL_AGENTS_CONFIG"] = "/nonexistent-agents.yaml";
    const a = capture(() => castCommand(["--no-color"]) as number).out;
    const b = capture(() => castCommand(["--no-color"]) as number).out;
    expect(a).toBe(b);
  });

  it("rejects an unknown flag and prints usage; --help exits 0", () => {
    const bad = capture(() => castCommand(["--bogus", "--no-color"]) as number);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("unknown flag");
    const help = capture(() => castCommand(["--help"]) as number);
    expect(help.code).toBe(0);
    expect(help.out).toContain("roll cast");
  });
});
