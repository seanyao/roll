/** US-CLI-012 — `roll cycles`: first-class cycle ledger, failures never swallowed. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cyclesCommand, renderCyclesLedger } from "../src/commands/cycles.js";
import { collectCycleLedger } from "../src/lib/cycle-ledger.js";
import { stripAnsi } from "../src/render.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  delete process.env["ROLL_LANG"];
});

const NOW = Math.floor(Date.parse("2026-06-13T00:00:00Z") / 1000);

function project(): string {
  const p = mkdtempSync(join(tmpdir(), "roll-cycles-"));
  dirs.push(p);
  mkdirSync(join(p, ".roll", "loop"), { recursive: true });
  const rows = [
    { cycle_id: "20260612-x-0312", status: "reverted", story_id: "FIX-242", agent: "kimi", ts: "2026-06-12T20:00:00Z", duration_sec: 242, cost_usd: 0.03, tokens_in: 80000, tokens_out: 6000 },
    { cycle_id: "20260612-x-0311", status: "merged", outcome: "delivered", story_id: "FIX-241", agent: "claude", ts: "2026-06-12T19:00:00Z", duration_sec: 500, cost_usd: 0.05, tokens_in: 120000, tokens_out: 22000 },
    { cycle_id: "20260612-x-0310", status: "failed", story_id: "US-META-010", agent: "codex", ts: "2026-06-12T18:00:00Z", duration_sec: 191, cost_usd: 0.02, tokens_in: 60000, tokens_out: 4000 },
    { cycle_id: "20260612-x-0305", status: "blocked", story_id: "IDEA-001", agent: "claude", ts: "2026-06-12T17:00:00Z", duration_sec: 72, cost_usd: 0.01, tokens_in: 20000, tokens_out: 2000 },
    { cycle_id: "20260601-x-0001", status: "merged", outcome: "delivered", story_id: "OLD-1", agent: "pi", ts: "2026-06-01T00:00:00Z", duration_sec: 60, cost_usd: 9 },
  ];
  writeFileSync(join(p, ".roll", "loop", "runs.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return p;
}

function renderAt(p: string, since: string, lang: "en" | "zh"): string {
  return stripAnsi(renderCyclesLedger(collectCycleLedger(p), since, lang, NOW));
}

describe("roll cycles — US-CLI-012", () => {
  it("AC2/AC3: row format + summary where failed = failed+reverted+blocked", () => {
    const out = renderAt(project(), "3d", "en");
    expect(out).toContain("#0311");
    expect(out).toContain("delivered");
    expect(out).toContain("reverted");
    expect(out).toMatch(/4 cycles · 1 delivered · 3 failed\/reverted\/blocked · \$0\.11/);
  });

  it("AC1: window filter — all includes the old cycle, 3d does not", () => {
    const p = project();
    expect(renderAt(p, "all", "en")).toContain("OLD-1");
    expect(renderAt(p, "3d", "en")).not.toContain("OLD-1");
  });

  it("AC4: tail hint points at the newest cycle", () => {
    const out = renderAt(project(), "3d", "en");
    expect(out).toContain("→ roll cycle 0312");
  });

  it("AC5: en/zh snapshots (scrubbed of color)", () => {
    const p = project();
    expect(renderAt(p, "3d", "en")).toMatchSnapshot();
    expect(renderAt(p, "3d", "zh")).toMatchSnapshot();
  });

  it("AC1: illegal --since fails loud", async () => {
    const save = process.cwd();
    process.chdir(project());
    let err = "";
    const se = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((s: string) => ((err += s), true)) as typeof process.stderr.write;
    try {
      expect(cyclesCommand(["--since", "2w"])).toBe(1);
    } finally {
      process.stderr.write = se;
      process.chdir(save);
    }
    expect(err).toContain("illegal --since");
  });
});
