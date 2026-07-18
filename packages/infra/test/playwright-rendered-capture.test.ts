/**
 * US-PHYSICAL-010 — Playwright rendered surface port unit tests.
 * Launch is injected so this suite never needs a real Chromium binary.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlaywrightRenderedSurfacePort } from "../src/playwright-rendered-capture.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempOut(): string {
  const dir = mkdtempSync(join(tmpdir(), "roll-pw-render-"));
  dirs.push(dir);
  return join(dir, "shot.png");
}

describe("US-PHYSICAL-010 createPlaywrightRenderedSurfacePort", () => {
  it("refuses a non-loopback URL before launching Chromium", async () => {
    const launch = vi.fn(async () => {
      throw new Error("launch must not be called");
    });
    const port = createPlaywrightRenderedSurfacePort({ launch });
    const result = await port.render({ url: "https://example.com/app", out: tempOut(), timeoutMs: 5_000 });
    expect(result).toEqual({
      status: "skipped",
      reason: "disallowed target: rendered capture only permits loopback HTTP(S) pages",
    });
    expect(launch).not.toHaveBeenCalled();
  });

  it("writes a PNG and reports the page finalUrl on a successful render", async () => {
    const out = tempOut();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const page = {
      setDefaultTimeout: vi.fn(),
      goto: vi.fn(async () => ({ status: () => 200 })),
      url: vi.fn(() => "http://127.0.0.1:9/team"),
      screenshot: vi.fn(async ({ path }: { path: string }) => {
        writeFileSync(path, png);
      }),
    };
    const browser = {
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined),
    };
    const port = createPlaywrightRenderedSurfacePort({ launch: async () => browser as never });
    const result = await port.render({ url: "http://127.0.0.1:9/team", out, timeoutMs: 5_000 });
    expect(result).toEqual({ status: "taken", screenshotPath: out, finalUrl: "http://127.0.0.1:9/team" });
    expect(readFileSync(out)).toEqual(png);
    expect(browser.close).toHaveBeenCalled();
  });

  it("surfaces a failed status when navigation throws", async () => {
    const page = {
      setDefaultTimeout: vi.fn(),
      goto: vi.fn(async () => {
        throw new Error("net::ERR_CONNECTION_REFUSED");
      }),
      url: vi.fn(),
      screenshot: vi.fn(),
    };
    const browser = {
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined),
    };
    const port = createPlaywrightRenderedSurfacePort({ launch: async () => browser as never });
    const result = await port.render({ url: "http://127.0.0.1:9/gone", out: tempOut(), timeoutMs: 1_000 });
    expect(result.status).toBe("failed");
    expect(result.status === "failed" && result.reason).toMatch(/ERR_CONNECTION_REFUSED/);
    expect(browser.close).toHaveBeenCalled();
  });
});
