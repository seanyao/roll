import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectBrowserTimeline } from "../src/lib/browser-timeline-collect.js";
import { collectBrowserTruth } from "../src/lib/browser-truth-collect.js";

const dirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true });
});

function project(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "roll-browser-truth-")));
  dirs.push(dir);
  return dir;
}

describe("FIX-1263 — browser collectors honor the pinned render clock", () => {
  it("uses ROLL_RENDER_NOW for truth and timeline collection", () => {
    vi.stubEnv("ROLL_RENDER_NOW", "2030-01-02T03:04:05.678Z");
    const projectPath = project();

    expect(collectBrowserTruth({ projectPath }).collectedAt).toBe("2030-01-02T03:04:05.678Z");
    expect(collectBrowserTimeline({ projectPath }).collectedAt).toBe("2030-01-02T03:04:05.678Z");
  });
});
