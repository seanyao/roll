/**
 * diff-test: TS configGet / yamlReadNested vs the frozen bash oracle
 * `config_get` (bin/roll 794-818) and `_yaml_read_nested` (778-792).
 *
 * Harness mirrors packages/spec/test/project.difftest.test.ts: extract the bash
 * function(s) with `sed`, `eval` them, run against fixture yaml in a temp dir,
 * compare stdout to the TS port. `config_get` reads the global `$ROLL_CONFIG`
 * and expands `~` against `$HOME`, so both are set per invocation.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { configGet, yamlReadNested } from "../src/index.js";

const REPO = resolve(__dirname, "../../..");
const HOME = "/home/fixtureuser";
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) execFileSync("rm", ["-rf", d]);
});

function fixture(content: string): string {
  const d = mkdtempSync(join(tmpdir(), "roll-cfg-dt-"));
  dirs.push(d);
  const f = join(d, "config.yaml");
  writeFileSync(f, content, "utf8");
  return f;
}

/** Extract + run bash `config_get key [default]` against a config file. */
function bashConfigGet(file: string, key: string, def = ""): string {
  const script = [
    `eval "$(sed -n '/^_yaml_read_nested()/,/^}$/p' '${REPO}/bin/roll')"`,
    `eval "$(sed -n '/^config_get()/,/^}$/p' '${REPO}/bin/roll')"`,
    `ROLL_CONFIG='${file}'`,
    `HOME='${HOME}'`,
    `config_get "$1" "$2"`,
  ].join("\n");
  return execFileSync("bash", ["-c", script, "bash", key, def], { encoding: "utf8" });
}

/** Extract + run bash `_yaml_read_nested file parent child`. */
function bashYamlNested(file: string, parent: string, child: string): string {
  const script = [
    `eval "$(sed -n '/^_yaml_read_nested()/,/^}$/p' '${REPO}/bin/roll')"`,
    `_yaml_read_nested "$1" "$2" "$3"`,
  ].join("\n");
  return execFileSync("bash", ["-c", script, "bash", file, parent, child], { encoding: "utf8" });
}

describe("diff-test: configGet == bash config_get", () => {
  const flat = ["loop_dream_hour: 5   # comment", "ai_claude: ~/.claude", "quoted: hello world", ""].join("\n");
  const nested = ["loop_schedule:", "  period_minutes: 30  # half hour", "  offset_minute: 7", "other:", "  x: 1", ""].join("\n");

  it("flat key, comment stripped", () => {
    const f = fixture(flat);
    expect(configGet("loop_dream_hour", "", f) + "\n").toBe(bashConfigGet(f, "loop_dream_hour"));
  });
  it("flat key with leading-tilde expansion", () => {
    const f = fixture(flat);
    expect(configGet("ai_claude", "", f).replace(process.env["HOME"] ?? "", HOME) + "\n").toBe(
      bashConfigGet(f, "ai_claude"),
    );
  });
  it("flat value with embedded spaces preserved", () => {
    const f = fixture(flat);
    expect(configGet("quoted", "", f) + "\n").toBe(bashConfigGet(f, "quoted"));
  });
  it("missing flat key → default (tilde-expanded)", () => {
    const f = fixture(flat);
    expect(configGet("absent", "~/fallback", f).replace(process.env["HOME"] ?? "", HOME) + "\n").toBe(
      bashConfigGet(f, "absent", "~/fallback"),
    );
  });
  it("missing flat key → empty default", () => {
    const f = fixture(flat);
    expect(configGet("absent", "", f) + "\n").toBe(bashConfigGet(f, "absent"));
  });
  it("dotted nested key, set", () => {
    const f = fixture(nested);
    expect(configGet("loop_schedule.period_minutes", "60", f) + "\n").toBe(
      bashConfigGet(f, "loop_schedule.period_minutes", "60"),
    );
  });
  it("dotted nested key, absent → default", () => {
    const f = fixture(nested);
    expect(configGet("loop_schedule.missing", "99", f) + "\n").toBe(
      bashConfigGet(f, "loop_schedule.missing", "99"),
    );
  });
  it("dotted key, parent block absent → default", () => {
    const f = fixture(flat);
    expect(configGet("noblock.child", "def", f) + "\n").toBe(bashConfigGet(f, "noblock.child", "def"));
  });
});

describe("diff-test: yamlReadNested == bash _yaml_read_nested", () => {
  const nested = ["loop_schedule:", "  period_minutes: 30  # c", "  offset_minute: 0", "after:", "  y: 2", ""].join("\n");
  for (const [parent, child] of [
    ["loop_schedule", "period_minutes"],
    ["loop_schedule", "offset_minute"],
    ["loop_schedule", "absent"],
    ["after", "y"],
    ["missing", "x"],
  ] as const) {
    it(`${parent}.${child}`, () => {
      const f = fixture(nested);
      const bash = bashYamlNested(f, parent, child);
      const ts = yamlReadNested(f, parent, child);
      // bash prints a trailing newline only when it printed a value.
      expect(ts === "" ? "" : ts + "\n").toBe(bash);
    });
  }
});
