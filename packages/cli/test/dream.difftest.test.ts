import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { repoRoot } from "../src/bridge.js";
import { dreamCommand } from "../src/commands/dream.js";

async function capture(fn: () => number | Promise<number>): Promise<{ code: number; stdout: string; stderr: string }> {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  // @ts-expect-error capture-only
  process.stdout.write = (c: string | Uint8Array): boolean => (outChunks.push(String(c)), true);
  // @ts-expect-error capture-only
  process.stderr.write = (c: string | Uint8Array): boolean => (errChunks.push(String(c)), true);
  try {
    return { code: await fn(), stdout: outChunks.join(""), stderr: errChunks.join("") };
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
  }
}

describe("roll dream command wrapper", () => {
  afterEach(() => {
    delete process.env["NO_COLOR"];
  });

  it("delegates run-once to the v3 dream heart with remaining args", async () => {
    const seen: string[][] = [];
    const code = await dreamCommand(["run-once", "--x"], (args) => {
      seen.push(args);
      return 7;
    });
    expect(code).toBe(7);
    expect(seen).toEqual([["--x"]]);
  });

  it("freezes v2 unknown-command output for bare dream, without bash fallback", async () => {
    const r = await capture(() => dreamCommand([]));
    expect(r.code).toBe(1);
    expect(r.stderr).toBe("Usage: roll dream run-once\n");
    // US-PORT-021: the help version now comes from package.json (rollVersion),
    // not the frozen bin/roll VERSION= fossil — scrub it so the snapshot is
    // version-independent (it changes every release).
    const out = r.stdout.replace(/^(  roll · autonomous delivery for software teams).*$/m, "$1  [VERSION]");
    expect(out).toMatchInlineSnapshot(`""`);
  });

  // FIX-239: an unknown subcommand is NAMED (stderr + exit 1, real usage);
  // `dream --help` at the dispatch layer is bridge-intercepted (exit 0) — the
  // direct-call path here keeps the unknown-subcommand contract.
  it.each([["--help"], ["anything"]])("names the unknown subcommand for dream %s", async (arg) => {
    const r = await capture(() => dreamCommand([arg]));
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe(`[roll] unknown dream subcommand: ${arg}\nUsage: roll dream run-once\n`);
  });

  it("removes the dream bash fallback from the ported registry", () => {
    const src = readFileSync(`${repoRoot()}/packages/cli/src/commands/index.ts`, "utf8");
    expect(src).not.toContain('fallbackToBash(["dream"');
  });
});
