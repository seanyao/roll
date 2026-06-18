import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectToolEvidenceFromEventsPath } from "../src/lib/tool-display.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function eventsPath(): string {
  const root = mkdtempSync(join(tmpdir(), "roll-tool-display-"));
  dirs.push(root);
  const dir = join(root, ".roll", "loop");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "events.ndjson");
  writeFileSync(
    path,
    [
      JSON.stringify({ type: "tool:invoke", cycleId: "C1", invocation: { invocationId: "inv-bash", toolId: "bash", input: { command: "pnpm test" }, caller: { cycleId: "C1" }, policy: { enabled: true }, ts: 1 }, declaration: { id: "bash", kind: "bash", title: "Bash" }, ts: 1 }),
      JSON.stringify({ type: "tool:result", cycleId: "C1", invocationId: "inv-bash", toolId: "bash", result: { ok: true, output: { exitCode: 0, stdout: "tests passed", stderr: "warning: cached" }, meta: { invocationId: "inv-bash", toolId: "bash", caller: { cycleId: "C1" }, startedAt: 1000, endedAt: 2400, durationMs: 1400, attempt: 3 } }, ts: 2 }),
      JSON.stringify({ type: "tool:invoke", cycleId: "C1", invocation: { invocationId: "inv-shot", toolId: "browser.screenshot", input: { url: "https://app.test" }, caller: { cycleId: "C1" }, policy: { enabled: true }, ts: 3 }, declaration: { id: "browser.screenshot", kind: "browser", title: "Browser Screenshot" }, ts: 3 }),
      JSON.stringify({ type: "tool:result", cycleId: "C1", invocationId: "inv-shot", toolId: "browser.screenshot", result: { ok: true, output: { screenshotPath: ".roll/tool-dumps/inv-shot.png", finalUrl: "https://app.test", statusCode: 200 }, meta: { invocationId: "inv-shot", toolId: "browser.screenshot", caller: { cycleId: "C1" }, startedAt: 3000, endedAt: 5000, durationMs: 2000 } }, ts: 4 }),
      JSON.stringify({ type: "cycle:end", cycleId: "C1", cost: { toolCosts: [{ toolId: "bash", invocations: 1, durationMs: 1400, failures: 0, estimatedCost: 1.25, currency: "CNY" }] }, ts: 5 }),
    ].join("\n") + "\n",
  );
  return path;
}

describe("collectToolEvidenceFromEventsPath — US-TOOL-013 details", () => {
  it("carries stdout/stderr/exit/retry/dump and browser screenshot paths from tool results", () => {
    const evidence = collectToolEvidenceFromEventsPath(eventsPath());
    const rows = evidence.timelineByCycle.get("C1") ?? [];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      toolId: "bash",
      label: 'bash "pnpm test"',
      exitCode: 0,
      retryCount: 2,
      stdout: "tests passed",
      stderr: "warning: cached",
    });
    expect(rows[0]?.dumpPath).toMatch(/\.roll\/tool-dumps\/inv-bash\.log$/);
    expect(rows[1]).toMatchObject({
      toolId: "browser.screenshot",
      label: 'browser.screenshot "https://app.test"',
      screenshotPath: ".roll/tool-dumps/inv-shot.png",
    });
    expect(evidence.costsByCycle.get("C1")?.[0]).toMatchObject({ currency: "CNY", estimatedCost: 1.25 });
  });
});
