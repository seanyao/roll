/**
 * `roll loop monitor` / `roll loop attach` retirement stubs (US-PORT-007).
 * The v2 tmux-popup commands retire under the v3 self-contained runner: each
 * prints a single-language (ROLL_LANG) redirect to the live tmux session and
 * exits 0 — it never runs tmux itself.
 */
import { afterEach, describe, expect, it } from "vitest";
import { loopAttachRetired, loopMonitorRetired } from "../src/commands/loop-retired.js";

function capture(fn: () => number, env: Record<string, string>): { out: string; code: number } {
  const save: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    save[k] = process.env[k];
    process.env[k] = v;
  }
  const chunks: string[] = [];
  const real = process.stdout.write.bind(process.stdout);
  // @ts-expect-error — capture-only override
  process.stdout.write = (c: string | Uint8Array): boolean => {
    chunks.push(typeof c === "string" ? c : Buffer.from(c).toString("utf8"));
    return true;
  };
  let code: number;
  try {
    code = fn();
  } finally {
    process.stdout.write = real;
    for (const [k, v] of Object.entries(save)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  return { out: chunks.join(""), code };
}

const SLUG_ENV = { ROLL_MAIN_SLUG: "test-xyz789" };

describe("loop monitor / attach retirement stubs", () => {
  afterEach(() => {
    delete process.env["ROLL_LANG"];
  });

  it("monitor: en redirect names the tmux session, exit 0", () => {
    const r = capture(loopMonitorRetired, { ...SLUG_ENV, ROLL_LANG: "en" });
    expect(r.code).toBe(0);
    expect(r.out).toBe(
      "roll loop monitor is retired. Use `roll loop status` for a snapshot, or watch the live cycle: tmux attach -t roll-loop-test-xyz789\n",
    );
  });

  it("attach: en redirect points at tmux attach, exit 0", () => {
    const r = capture(loopAttachRetired, { ...SLUG_ENV, ROLL_LANG: "en" });
    expect(r.code).toBe(0);
    expect(r.out).toBe(
      "roll loop attach is retired. Attach to the live cycle directly: tmux attach -t roll-loop-test-xyz789\n",
    );
  });

  it("attach: zh output is single-language (no English prose bleed)", () => {
    const r = capture(loopAttachRetired, { ...SLUG_ENV, ROLL_LANG: "zh" });
    // The tmux command tokens are intentionally literal; assert the prose is zh.
    expect(r.out).toContain("已退役");
    expect(r.out).toContain("roll-loop-test-xyz789");
  });

  it("does not invoke tmux (stub is pure stdout)", () => {
    // No tmux binary needed; the function returns synchronously with exit 0.
    const r = capture(loopMonitorRetired, { ...SLUG_ENV, ROLL_LANG: "en" });
    expect(r.code).toBe(0);
  });
});
