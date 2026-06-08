/**
 * US-REL-SHIP — `roll release ship` CLI: gate → confirm → tag + push.
 * Injected deps: no real git, no real network, no real publish.
 */
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { readLineSyncFromFd, releaseShipCommand, type ShipDeps } from "../src/commands/release-ship.js";

function happyDeps(over: Partial<ShipDeps> = {}): { deps: ShipDeps; calls: string[] } {
  const calls: string[] = [];
  const deps: ShipDeps = {
    version: () => "3.608.1",
    branch: () => "main",
    clean: () => true,
    synced: () => true,
    tagExists: () => false,
    consistency: () => true,
    tag: (_c, t) => calls.push(`tag:${t}`),
    pushTag: (_c, t) => calls.push(`push:${t}`),
    confirm: () => true,
    ...over,
  };
  return { deps, calls };
}

let out = "";
let err = "";
let ow: typeof process.stdout.write;
let oe: typeof process.stderr.write;
beforeEach(() => {
  out = "";
  err = "";
  ow = process.stdout.write.bind(process.stdout);
  oe = process.stderr.write.bind(process.stderr);
  // @ts-expect-error capture
  process.stdout.write = (s: string): boolean => ((out += String(s)), true);
  // @ts-expect-error capture
  process.stderr.write = (s: string): boolean => ((err += String(s)), true);
});
afterEach(() => {
  process.stdout.write = ow;
  process.stderr.write = oe;
});

describe("readLineSyncFromFd — FIX-228 (no EOF-wait hang)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ship-confirm-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function fdWith(content: string): number {
    const p = join(dir, "in");
    writeFileSync(p, content);
    return openSync(p, "r");
  }

  it("stops at the first newline (interactive `y`⏎) and does not read the rest", () => {
    const fd = fdWith("y\nleftover that must not be read");
    try {
      expect(readLineSyncFromFd(fd)).toBe("y");
    } finally {
      closeSync(fd);
    }
  });

  it("returns the buffered answer on EOF with no trailing newline (piped `echo -n y`)", () => {
    const fd = fdWith("yes");
    try {
      expect(readLineSyncFromFd(fd)).toBe("yes");
    } finally {
      closeSync(fd);
    }
  });

  it("strips a CR so CRLF input still matches y/N", () => {
    const fd = fdWith("y\r\n");
    try {
      expect(readLineSyncFromFd(fd)).toBe("y");
    } finally {
      closeSync(fd);
    }
  });
});

describe("roll release ship", () => {
  it("all gates pass + confirm → tags v<version> and pushes it", () => {
    const { deps, calls } = happyDeps();
    const code = releaseShipCommand(["--no-color"], deps);
    expect(code).toBe(0);
    expect(calls).toEqual(["tag:v3.608.1", "push:v3.608.1"]);
    expect(out).toContain("v3.608.1");
  });

  it("NEVER publishes — no publish seam exists in the happy path", () => {
    const { deps, calls } = happyDeps();
    releaseShipCommand(["--yes", "--no-color"], deps);
    expect(calls.some((c) => c.includes("publish"))).toBe(false);
  });

  it("--dry-run: gates pass but nothing is tagged or pushed", () => {
    const { deps, calls } = happyDeps();
    const code = releaseShipCommand(["--dry-run", "--no-color"], deps);
    expect(code).toBe(0);
    expect(calls).toEqual([]);
    expect(out).toContain("v3.608.1");
  });

  it("--yes skips the confirm prompt", () => {
    let confirmed = false;
    const { deps, calls } = happyDeps({ confirm: () => ((confirmed = true), true) });
    releaseShipCommand(["--yes", "--no-color"], deps);
    expect(confirmed).toBe(false);
    expect(calls).toEqual(["tag:v3.608.1", "push:v3.608.1"]);
  });

  it("declining the confirm aborts — no tag, no push", () => {
    const { deps, calls } = happyDeps({ confirm: () => false });
    const code = releaseShipCommand(["--no-color"], deps);
    expect(code).toBe(1);
    expect(calls).toEqual([]);
  });

  it.each([
    ["off main", { branch: () => "feat/x" }, "main 分支"],
    ["dirty tree", { clean: () => false }, "未提交"],
    ["out of sync", { synced: () => false }, "同步"],
    ["tag exists", { tagExists: () => true }, "已存在"],
    ["consistency red", { consistency: () => false }, "一致性"],
  ])("blocks when %s — nothing tagged", (_label, over, zhFrag) => {
    const { deps, calls } = happyDeps(over as Partial<ShipDeps>);
    const prev = process.env["ROLL_LANG"];
    process.env["ROLL_LANG"] = "zh";
    try {
      const code = releaseShipCommand(["--no-color"], deps);
      expect(code).toBe(1);
      expect(calls).toEqual([]);
      expect(err).toContain(zhFrag);
    } finally {
      if (prev === undefined) delete process.env["ROLL_LANG"];
      else process.env["ROLL_LANG"] = prev;
    }
  });

  it("missing package.json version → exit 1, no git touched", () => {
    const { deps, calls } = happyDeps({ version: () => "" });
    expect(releaseShipCommand(["--no-color"], deps)).toBe(1);
    expect(calls).toEqual([]);
  });
});
