/**
 * diff-test: TS `roll prices` == bash oracle (show renders the frozen
 * lib/prices snapshots — fully deterministic on the frozen branch).
 */
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { pricesCommand } from "../src/commands/prices.js";

const REPO = resolve(__dirname, "../../..");

function bashPrices(args: string[], env: Record<string, string> = {}): {
  status: number;
  stdout: string;
  stderr: string;
} {
  try {
    const stdout = execFileSync(join(REPO, "bin", "roll"), ["prices", ...args], {
      cwd: REPO,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", ROLL_LANG: "en", ...env },
    });
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

function tsPrices(args: string[], env: Record<string, string> = {}): {
  status: number;
  stdout: string;
  stderr: string;
} {
  const keys = ["NO_COLOR", "ROLL_LANG"];
  const save: Record<string, string | undefined> = {};
  for (const k of keys) save[k] = process.env[k];
  process.env["NO_COLOR"] = "1";
  process.env["ROLL_LANG"] = "en";
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  // @ts-expect-error capture-only
  process.stdout.write = (c: string | Uint8Array): boolean => (outChunks.push(String(c)), true);
  // @ts-expect-error capture-only
  process.stderr.write = (c: string | Uint8Array): boolean => (errChunks.push(String(c)), true);
  let status: number | null;
  try {
    status = pricesCommand(args);
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
    for (const k of keys) {
      const v = save[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  return { status: status ?? -1, stdout: outChunks.join(""), stderr: errChunks.join("") };
}

describe("diff-test: roll prices == bash oracle", () => {
  it("show renders the snapshot table byte-for-byte", () => {
    const b = bashPrices(["show"]);
    const t = tsPrices(["show"]);
    expect(t.status).toBe(b.status);
    expect(t.stdout).toBe(b.stdout);
  });

  it("bare/help renders usage byte-for-byte", () => {
    for (const args of [[], ["--help"], ["help"]] as string[][]) {
      const b = bashPrices(args);
      const t = tsPrices(args);
      expect(t.status, args.join(" ")).toBe(b.status);
      expect(t.stdout, args.join(" ")).toBe(b.stdout);
    }
  });

  it("unknown subcommand: bilingual stderr + help + exit 1 (en/zh)", () => {
    for (const lang of ["en", "zh"]) {
      const b = bashPrices(["bogus"], { ROLL_LANG: lang });
      const t = tsPrices(["bogus"], { ROLL_LANG: lang });
      expect(t.status, lang).toBe(b.status);
      expect(t.stdout, lang).toBe(b.stdout);
      expect(t.stderr, lang).toBe(b.stderr);
    }
  });

  it("refresh routes to bash fallback (returns null)", () => {
    expect(pricesCommand(["refresh", "--url", "x"])).toBeNull();
  });
});
