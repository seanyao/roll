import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { STALE_CHECK_TTL_MS, checkBinaryStaleness, isOlderThan } from "../src/runner/binary-staleness.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "roll-staleness-"));
  dirs.push(d);
  return d;
}

describe("FIX-366 binary-staleness — isOlderThan", () => {
  it("only true when CONFIDENTLY behind (handles v-prefix, patch/minor/major)", () => {
    expect(isOlderThan("3.618.3", "v3.618.4")).toBe(true);
    expect(isOlderThan("3.618.3", "3.619.0")).toBe(true);
    expect(isOlderThan("2.0.0", "v3.0.0")).toBe(true);
    expect(isOlderThan("3.618.4", "3.618.4")).toBe(false); // equal
    expect(isOlderThan("3.619.0", "3.618.4")).toBe(false); // newer
  });
  it("an unparseable version is never flagged stale (no false alarm)", () => {
    expect(isOlderThan("dev", "3.0.0")).toBe(false);
    expect(isOlderThan("3.0.0", "garbage")).toBe(false);
  });
});

describe("FIX-366 binary-staleness — checkBinaryStaleness", () => {
  it("WARNS once and caches the latest when the binary is behind", async () => {
    const cachePath = join(tmp(), ".loop-version-check");
    const alerts: string[] = [];
    const fetchLatest = (): Promise<string> => Promise.resolve("v3.700.0");
    const r = await checkBinaryStaleness({ runningVersion: "3.618.3", cachePath, nowMs: 1000, fetchLatest, alert: (m) => alerts.push(m) });
    expect(r.stale).toBe(true);
    expect(r.latest).toBe("v3.700.0");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain("out of date");
    expect(alerts[0]).toContain("roll update");
    // the remote latest was cached for the day
    expect(existsSync(cachePath)).toBe(true);
    expect(JSON.parse(readFileSync(cachePath, "utf8")).latest).toBe("v3.700.0");
  });

  it("NEVER blocks/alerts when up to date", async () => {
    const cachePath = join(tmp(), ".loop-version-check");
    const alerts: string[] = [];
    const r = await checkBinaryStaleness({ runningVersion: "3.700.0", cachePath, nowMs: 1, fetchLatest: () => Promise.resolve("v3.700.0"), alert: (m) => alerts.push(m) });
    expect(r.stale).toBe(false);
    expect(alerts).toHaveLength(0);
  });

  it("uses the DAILY cache instead of a fresh network call (cost discipline)", async () => {
    const cachePath = join(tmp(), ".loop-version-check");
    writeFileSync(cachePath, JSON.stringify({ latest: "v3.700.0", fetchedAtMs: 5000 }), "utf8");
    let fetched = 0;
    const fetchLatest = (): Promise<string> => { fetched++; return Promise.resolve("v3.999.0"); };
    const r = await checkBinaryStaleness({ runningVersion: "3.618.3", cachePath, nowMs: 5000 + STALE_CHECK_TTL_MS - 1, fetchLatest, alert: () => {} });
    expect(fetched).toBe(0); // cache fresh → zero network calls
    expect(r.latest).toBe("v3.700.0");
  });

  it("re-fetches once the cache has aged past the TTL", async () => {
    const cachePath = join(tmp(), ".loop-version-check");
    writeFileSync(cachePath, JSON.stringify({ latest: "v3.700.0", fetchedAtMs: 5000 }), "utf8");
    let fetched = 0;
    const fetchLatest = (): Promise<string> => { fetched++; return Promise.resolve("v3.800.0"); };
    const r = await checkBinaryStaleness({ runningVersion: "3.618.3", cachePath, nowMs: 5000 + STALE_CHECK_TTL_MS + 1, fetchLatest, alert: () => {} });
    expect(fetched).toBe(1);
    expect(r.latest).toBe("v3.800.0");
  });

  it("a fetch miss (offline / curl absent) is a SILENT no-op — never throws, never alerts", async () => {
    const cachePath = join(tmp(), ".loop-version-check");
    const alerts: string[] = [];
    const r = await checkBinaryStaleness({ runningVersion: "3.618.3", cachePath, nowMs: 1, fetchLatest: () => Promise.resolve(""), alert: (m) => alerts.push(m) });
    expect(r.stale).toBe(false);
    expect(alerts).toHaveLength(0);
    expect(existsSync(cachePath)).toBe(false); // nothing to cache
  });
});
