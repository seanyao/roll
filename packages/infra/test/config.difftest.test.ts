/**
 * diff-test (frozen): configGet / yamlReadNested == bash `config_get`
 * (bin/roll 794-818) and `_yaml_read_nested` (778-792).
 *
 * Per the US-PORT-009a freeze paradigm (docs/difftest-freeze-paradigm.md): the
 * v2 oracle outputs were captured once — while bin/roll was still present and
 * proven byte-for-byte equal — and frozen below. The test no longer `sed`-
 * extracts the bash functions from bin/roll.
 *
 * Outputs are deterministic given the fixture yaml. The only volatile substring
 * is the tilde expansion (`~` → `$HOME`), which differs per machine; we
 * normalize the live `homedir()` back to a fixed token before asserting, so the
 * frozen literals stay portable across machines/CI.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { configGet, yamlReadNested } from "../src/index.js";

const HOME = "/home/fixtureuser";
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fixture(content: string): string {
  const d = mkdtempSync(join(tmpdir(), "roll-cfg-dt-"));
  dirs.push(d);
  const f = join(d, "config.yaml");
  writeFileSync(f, content, "utf8");
  return f;
}

/** Normalize the machine's home to the fixed fixture token. */
const sub = (s: string): string => s.replace(homedir(), HOME);

describe("diff-test: configGet == frozen bash config_get", () => {
  const flat = ["loop_dream_hour: 5   # comment", "ai_claude: ~/.claude", "quoted: hello world", ""].join("\n");
  const nested = ["loop_schedule:", "  period_minutes: 30  # half hour", "  offset_minute: 7", "other:", "  x: 1", ""].join("\n");

  it("flat key, comment stripped", () => {
    expect(configGet("loop_dream_hour", "", fixture(flat))).toBe("5");
  });
  it("flat key with leading-tilde expansion", () => {
    expect(sub(configGet("ai_claude", "", fixture(flat)))).toBe("/home/fixtureuser/.claude");
  });
  it("flat value with embedded spaces preserved", () => {
    expect(configGet("quoted", "", fixture(flat))).toBe("hello world");
  });
  it("missing flat key → default (tilde-expanded)", () => {
    expect(sub(configGet("absent", "~/fallback", fixture(flat)))).toBe("/home/fixtureuser/fallback");
  });
  it("missing flat key → empty default", () => {
    expect(configGet("absent", "", fixture(flat))).toBe("");
  });
  it("dotted nested key, set", () => {
    expect(configGet("loop_schedule.period_minutes", "60", fixture(nested))).toBe("30");
  });
  it("dotted nested key, absent → default", () => {
    expect(configGet("loop_schedule.missing", "99", fixture(nested))).toBe("99");
  });
  it("dotted key, parent block absent → default", () => {
    expect(configGet("noblock.child", "def", fixture(flat))).toBe("def");
  });
});

describe("diff-test: yamlReadNested == frozen bash _yaml_read_nested", () => {
  const nested = ["loop_schedule:", "  period_minutes: 30  # c", "  offset_minute: 0", "after:", "  y: 2", ""].join("\n");
  const frozen: Record<string, string> = {
    "loop_schedule.period_minutes": "30",
    "loop_schedule.offset_minute": "0",
    "loop_schedule.absent": "",
    "after.y": "2",
    "missing.x": "",
  };
  for (const [parent, child] of [
    ["loop_schedule", "period_minutes"],
    ["loop_schedule", "offset_minute"],
    ["loop_schedule", "absent"],
    ["after", "y"],
    ["missing", "x"],
  ] as const) {
    it(`${parent}.${child}`, () => {
      expect(yamlReadNested(fixture(nested), parent, child)).toBe(frozen[`${parent}.${child}`]);
    });
  }
});
