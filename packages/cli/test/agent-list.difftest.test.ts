/**
 * diff-test: TS `roll agent list` == bash `bin/roll agent list` (frozen v2
 * oracle), under a fabricated PATH/HOME/project so results are deterministic.
 */
import { execFileSync, execSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentListCommand } from "../src/commands/agent-list.js";

const REPO = resolve(__dirname, "../../..");
const dirs: string[] = [];
let home = "";
let proj = "";
let fakeBin = "";
let PATH = "";

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "roll-al-home-"));
  proj = mkdtempSync(join(tmpdir(), "roll-al-proj-"));
  fakeBin = mkdtempSync(join(tmpdir(), "roll-al-bin-"));
  dirs.push(home, proj, fakeBin);
  // installed: claude + kimi (via kimi-cli alias binary)
  for (const b of ["claude", "kimi-cli"]) {
    const p = join(fakeBin, b);
    writeFileSync(p, "#!/bin/sh\nexit 0\n");
    chmodSync(p, 0o755);
  }
  PATH = `${fakeBin}:/usr/bin:/bin`;
});

afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

function bashList(env: Record<string, string>): string {
  return execFileSync(join(REPO, "bin", "roll"), ["agent", "list"], {
    cwd: proj,
    encoding: "utf8",
    env: { PATH, HOME: home, ROLL_HOME: join(home, ".roll"), ...env },
  });
}

function tsList(env: Record<string, string>): string {
  const save: Record<string, string | undefined> = {};
  const keys = ["PATH", "HOME", "ROLL_HOME", "ROLL_LANG", "NO_COLOR", "LC_ALL", "LANG"];
  for (const k of keys) save[k] = process.env[k];
  process.env["PATH"] = PATH;
  process.env["HOME"] = home;
  process.env["ROLL_HOME"] = join(home, ".roll");
  delete process.env["NO_COLOR"];
  delete process.env["LC_ALL"];
  delete process.env["LANG"];
  delete process.env["ROLL_LANG"];
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const saveCwd = process.cwd();
  process.chdir(proj);
  const chunks: string[] = [];
  const real = process.stdout.write.bind(process.stdout);
  // @ts-expect-error capture-only
  process.stdout.write = (chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  };
  try {
    agentListCommand([]);
  } finally {
    process.stdout.write = real;
    process.chdir(saveCwd);
    for (const k of keys) {
      const v = save[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  return chunks.join("");
}

describe("diff-test: roll agent list == bash oracle", () => {
  it("default current (claude), colors on, en", () => {
    expect(tsList({ ROLL_LANG: "en" })).toBe(bashList({ ROLL_LANG: "en" }));
  });

  it("zh locale renders zh single-language", () => {
    expect(tsList({ ROLL_LANG: "zh" })).toBe(bashList({ ROLL_LANG: "zh" }));
  });

  it("NO_COLOR strips colors identically", () => {
    expect(tsList({ ROLL_LANG: "en", NO_COLOR: "1" })).toBe(
      bashList({ ROLL_LANG: "en", NO_COLOR: "1" }),
    );
  });

  it("project agent pref moves the (current) marker", () => {
    mkdirSync(join(proj, ".roll"), { recursive: true });
    writeFileSync(join(proj, ".roll", "local.yaml"), 'agent: "kimi"\n');
    try {
      const ts = tsList({ ROLL_LANG: "en", NO_COLOR: "1" });
      const bash = bashList({ ROLL_LANG: "en", NO_COLOR: "1" });
      expect(ts).toBe(bash);
      expect(ts).toContain("✓ kimi  (current)");
    } finally {
      execSync(`rm -f '${join(proj, ".roll", "local.yaml")}'`);
    }
  });
});
