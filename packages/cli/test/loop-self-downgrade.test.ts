/**
 * US-AGENT-042 — `roll loop self-downgrade` command integration: split lands
 * (parent Hold + sub rows with inherited deps, never the umbrella), the chain
 * cap refuses + ALERTs, irreducible refuses, and an open parent PR is closed
 * (I3) via the injected port. Backlog/events writes go to ROLL_MAIN_PROJECT.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loopSelfDowngradeCommand, type SelfDowngradeDeps } from "../src/commands/loop-self-downgrade.js";

let cwd0: string;
let dir: string;
const savedEnv: Record<string, string | undefined> = {};
function setEnv(k: string, v: string): void {
  if (!(k in savedEnv)) savedEnv[k] = process.env[k];
  process.env[k] = v;
}
beforeEach(() => {
  cwd0 = process.cwd();
  dir = mkdtempSync(join(tmpdir(), "self-downgrade-"));
  mkdirSync(join(dir, ".roll", "loop"), { recursive: true });
  setEnv("ROLL_MAIN_PROJECT", dir);
  setEnv("ROLL_MAIN_SLUG", "proj-test"); // deterministic ALERT-<slug>.md path
  setEnv("NO_COLOR", "1");
});
afterEach(() => {
  process.chdir(cwd0);
  rmSync(dir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const k of Object.keys(savedEnv)) delete savedEnv[k];
});

const HEADER = "| ID | Description | Status |\n|----|----|----|\n";
function seedBacklog(rows: string): void {
  writeFileSync(join(dir, ".roll", "backlog.md"), HEADER + rows);
}
function seedSpec(epic: string, id: string, title: string, body = ""): void {
  const d = join(dir, ".roll", "features", epic, id);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "spec.md"), `---\nid: ${id}\ntitle: ${title}\n---\n\n${body}`);
}
function backlog(): string {
  return readFileSync(join(dir, ".roll", "backlog.md"), "utf8");
}
function events(): Record<string, unknown>[] {
  const p = join(dir, ".roll", "loop", "events.ndjson");
  try {
    return readFileSync(p, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  } catch {
    return [];
  }
}
function alertText(): string {
  try {
    return readFileSync(join(dir, ".roll", "loop", "ALERT-proj-test.md"), "utf8");
  } catch {
    return "";
  }
}

function capture(fn: () => Promise<number>): Promise<{ status: number; out: string; err: string }> {
  const o: string[] = [];
  const e: string[] = [];
  const wo = process.stdout.write.bind(process.stdout);
  const we = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((x: string | Uint8Array) => (o.push(String(x)), true)) as typeof process.stdout.write;
  process.stderr.write = ((x: string | Uint8Array) => (e.push(String(x)), true)) as typeof process.stderr.write;
  return fn()
    .then((status) => ({ status, out: o.join(""), err: e.join("") }))
    .finally(() => {
      process.stdout.write = wo;
      process.stderr.write = we;
    });
}

function fakeDeps(over: Partial<SelfDowngradeDeps> = {}): SelfDowngradeDeps {
  return {
    now: () => 1_780_000_000_000,
    repoSlug: async () => "seanyao/roll",
    closePr: async () => true,
    ...over,
  };
}

describe("roll loop self-downgrade — split", () => {
  it("parks the parent at Hold and appends sub rows (inherited deps, depth+1, never umbrella)", async () => {
    seedBacklog("| [FIX-356](.roll/features/skill-ecosystem/FIX-356/spec.md) | retire surfaces depends-on:US-AGENT-041 | 🔨 In Progress |\n");
    seedSpec("skill-ecosystem", "FIX-356", "retire surfaces", "");
    seedSpec("skill-ecosystem", "FIX-356a", "brief retire");
    seedSpec("skill-ecosystem", "FIX-356b", "sentinel retire");
    const r = await capture(() =>
      loopSelfDowngradeCommand(["FIX-356", "too big: 4 cuts", "FIX-356a,FIX-356b"], fakeDeps()),
    );
    expect(r.status).toBe(0);
    const b = backlog();
    expect(b).toContain("| retire surfaces depends-on:US-AGENT-041 | 🚫 Hold |");
    expect(b).toContain("| [FIX-356a](.roll/features/skill-ecosystem/FIX-356a/spec.md) | brief retire chain_depth:1 depends-on:US-AGENT-041 | 📋 Todo |");
    expect(b).toContain("| [FIX-356b](.roll/features/skill-ecosystem/FIX-356b/spec.md) | sentinel retire chain_depth:1 depends-on:US-AGENT-041 | 📋 Todo |");
    // child rows must NOT depend on the parked umbrella parent
    expect(b).not.toContain("depends-on:FIX-356 ");
    expect(b).not.toContain("depends-on:FIX-356,");
    expect(b).not.toMatch(/FIX-356a.*depends-on:FIX-356\b/);

    const split = events().find((e) => e["type"] === "story:split");
    expect(split).toMatchObject({
      type: "story:split",
      parentStoryId: "FIX-356",
      childStoryIds: ["FIX-356a", "FIX-356b"],
      chainDepth: 0,
      capped: false,
    });
    expect(r.out).toContain("🚫 Hold");
  });

  it("children of a depth-1 parent carry chain_depth:2", async () => {
    seedBacklog("| [US-X-a](.roll/features/ep/US-X-a/spec.md) | child chain_depth:1 | 🔨 In Progress |\n");
    seedSpec("ep", "US-X-a", "child");
    seedSpec("ep", "US-X-a-1", "g1");
    seedSpec("ep", "US-X-a-2", "g2");
    const r = await capture(() => loopSelfDowngradeCommand(["US-X-a", "still big", "US-X-a-1,US-X-a-2"], fakeDeps()));
    expect(r.status).toBe(0);
    expect(backlog()).toContain("| g1 chain_depth:2 | 📋 Todo |");
  });
});

describe("roll loop self-downgrade — cap + irreducible", () => {
  it("refuses a depth-2 chain (cap hit): Hold + ALERT + capped event, no children", async () => {
    seedBacklog("| [US-X-a-1](.roll/features/ep/US-X-a-1/spec.md) | deep chain_depth:2 | 🔨 In Progress |\n");
    seedSpec("ep", "US-X-a-1", "deep");
    const r = await capture(() =>
      loopSelfDowngradeCommand(["US-X-a-1", "still too big", "US-X-a-1-i,US-X-a-1-ii"], fakeDeps()),
    );
    expect(r.status).toBe(0);
    expect(backlog()).toContain("| deep chain_depth:2 | 🚫 Hold |");
    expect(backlog()).not.toContain("US-X-a-1-i"); // no children appended
    expect(alertText()).toContain("hit the self-downgrade chain cap");
    const split = events().find((e) => e["type"] === "story:split");
    expect(split).toMatchObject({ capped: true, childStoryIds: [] });
    expect(events().some((e) => e["type"] === "alert:notify")).toBe(true);
    expect(r.out).toContain("REFUSED");
  });

  it("refuses an irreducible story (<2 sub-ids): Hold + ALERT", async () => {
    seedBacklog("| [US-Y](.roll/features/ep/US-Y/spec.md) | tiny | 🔨 In Progress |\n");
    seedSpec("ep", "US-Y", "tiny");
    const r = await capture(() => loopSelfDowngradeCommand(["US-Y", "cannot split", "US-Y-only"], fakeDeps()));
    expect(r.status).toBe(0);
    expect(backlog()).toContain("| tiny | 🚫 Hold |");
    expect(alertText()).toContain("irreducible");
    expect(events().find((e) => e["type"] === "story:split")).toMatchObject({ capped: true });
  });
});

describe("roll loop self-downgrade — open PR closure (I3)", () => {
  it("closes the parent's open PR + emits pr:close", async () => {
    seedBacklog("| [US-Z](.roll/features/ep/US-Z/spec.md) | bigwork | 🔨 In Progress |\n");
    seedSpec("ep", "US-Z", "bigwork");
    seedSpec("ep", "US-Z-a", "za");
    seedSpec("ep", "US-Z-b", "zb");
    // a partial delivery opened PR #42 for US-Z, still open
    writeFileSync(
      join(dir, ".roll", "loop", "events.ndjson"),
      JSON.stringify({ type: "pr:open", prNumber: 42, storyId: "US-Z", ts: 1 }) + "\n",
    );
    const closed: number[] = [];
    const r = await capture(() =>
      loopSelfDowngradeCommand(
        ["US-Z", "reviewer: scope too large", "US-Z-a,US-Z-b"],
        fakeDeps({
          closePr: async ({ prNumber }) => {
            closed.push(prNumber);
            return true;
          },
        }),
      ),
    );
    expect(r.status).toBe(0);
    expect(closed).toEqual([42]);
    expect(events().some((e) => e["type"] === "pr:close" && e["prNumber"] === 42)).toBe(true);
    expect(r.out).toContain("closed PR #42");
  });

  it("a failed PR-close is non-fatal (downgrade still lands)", async () => {
    seedBacklog("| [US-W](.roll/features/ep/US-W/spec.md) | w | 🔨 In Progress |\n");
    seedSpec("ep", "US-W", "w");
    seedSpec("ep", "US-W-a", "wa");
    seedSpec("ep", "US-W-b", "wb");
    writeFileSync(
      join(dir, ".roll", "loop", "events.ndjson"),
      JSON.stringify({ type: "pr:open", prNumber: 7, storyId: "US-W", ts: 1 }) + "\n",
    );
    const r = await capture(() =>
      loopSelfDowngradeCommand(["US-W", "big", "US-W-a,US-W-b"], fakeDeps({ closePr: async () => false })),
    );
    expect(r.status).toBe(0);
    expect(backlog()).toContain("| w | 🚫 Hold |"); // downgrade landed
    expect(events().some((e) => e["type"] === "pr:close")).toBe(false); // no false record
  });
});

describe("roll loop self-downgrade — guards", () => {
  it("usage error (exit 2) when args missing", async () => {
    const r = await capture(() => loopSelfDowngradeCommand([], fakeDeps()));
    expect(r.status).toBe(2);
  });
  it("exit 1 when the parent has no backlog row", async () => {
    seedBacklog("| [US-OTHER](x) | y | 📋 Todo |\n");
    const r = await capture(() => loopSelfDowngradeCommand(["US-MISSING", "r", "a,b"], fakeDeps()));
    expect(r.status).toBe(1);
  });
});
