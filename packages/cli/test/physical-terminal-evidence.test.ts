import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { EvidenceRun, ShotRun } from "@roll/infra";
import { attestCommand } from "../src/commands/attest.js";
import {
  declaresPhysicalTerminal,
  validateStoryVisualEvidence,
  visualSurface,
} from "../src/lib/design-visual-evidence.js";
import {
  declaresAnySurface,
  physicalTerminalForStory,
  verificationReportHasContent,
} from "../src/runner/attest-gate.js";

const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

const T0 = new Date("2026-06-06T01:02:03");
const quietRun: EvidenceRun = () => Promise.resolve({ code: 0, stdout: "", stderr: "" });

function tmp(tag: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `roll-physical-terminal-${tag}-`)));
  dirs.push(d);
  return d;
}

function inDir<T>(proj: string, fn: () => Promise<T>): Promise<T> {
  const save = process.cwd();
  process.chdir(proj);
  return fn().finally(() => process.chdir(save));
}

function silenced<T>(fn: () => Promise<T>): Promise<T> {
  const o = process.stdout.write.bind(process.stdout);
  const e = process.stderr.write.bind(process.stderr);
  // @ts-expect-error capture-only
  process.stdout.write = (): boolean => true;
  // @ts-expect-error capture-only
  process.stderr.write = (): boolean => true;
  return fn().finally(() => {
    process.stdout.write = o;
    process.stderr.write = e;
  });
}

function physicalSpec(id: string): string {
  return physicalSpecWithOptions(id, false);
}

function physicalSpecWithOptions(id: string, includeDeliverableCmd: boolean): string {
  return [
    "---",
    `id: ${id}`,
    ...(includeDeliverableCmd ? ["deliverable_cmd: roll doctor --tools"] : []),
    "physical_terminal:",
    "  app: Terminal.app",
    "  command: roll doctor --tools",
    "  evidence: screenshot",
    "---",
    "",
    `# ${id} — Physical Terminal evidence`,
    "",
    "## Acceptance Criteria",
    "",
    "- [ ] [visual-evidence] real physical Terminal.app screenshot proves the CLI output",
    "",
  ].join("\n");
}

function withPhysicalReport(id: string, captureKind: string): string {
  const wt = tmp("gate");
  const cardDir = join(wt, ".roll", "features", "uncategorized", id);
  const latest = join(cardDir, "latest");
  mkdirSync(latest, { recursive: true });
  writeFileSync(join(cardDir, "spec.md"), physicalSpec(id));
  writeFileSync(
    join(latest, `${id}-report.html`),
    `<html><body><section class="ac s-pass" id="${id}:AC1"><figure class="shot"><img src="screenshots/terminal.png"></figure></section></body></html>\n`,
  );
  writeFileSync(
    join(cardDir, "ac-map.json"),
    JSON.stringify(
      [{ ac: `${id}:AC1`, status: "pass", evidence: [{ kind: "screenshot", label: "physical terminal", href: "screenshots/terminal.png" }] }],
      null,
      2,
    ) + "\n",
  );
  writeFileSync(
    join(latest, "evidence.json"),
    JSON.stringify({ captures: [{ kind: captureKind, out: "screenshots/terminal.png", taken: true }] }, null, 2) + "\n",
  );
  return wt;
}

describe("US-INIT-003 physical Terminal.app evidence contract", () => {
  it("physical_terminal frontmatter declares a terminal visual surface", () => {
    const spec = physicalSpec("US-PHYS-1");

    expect(declaresPhysicalTerminal(spec)).toBe(true);
    expect(visualSurface(spec)).toBe("terminal");
    expect(validateStoryVisualEvidence(spec).ok).toBe(true);
    expect(declaresAnySurface(spec)).toBe(true);
  });

  it("attest gate accepts a taken physical-terminal capture for physical_terminal stories", () => {
    const wt = withPhysicalReport("US-PHYS-2", "physical-terminal");

    expect(physicalTerminalForStory(wt, "US-PHYS-2")).toEqual({
      app: "Terminal.app",
      command: "roll doctor --tools",
      evidence: "screenshot",
    });
    expect(verificationReportHasContent(wt, "US-PHYS-2")).toBe(true);
  });

  it("a physical_terminal capture satisfies a matching deliverable_cmd without demanding a duplicate terminal capture", () => {
    const wt = withPhysicalReport("US-PHYS-2B", "physical-terminal");
    writeFileSync(
      join(wt, ".roll", "features", "uncategorized", "US-PHYS-2B", "spec.md"),
      physicalSpecWithOptions("US-PHYS-2B", true),
    );

    expect(verificationReportHasContent(wt, "US-PHYS-2B")).toBe(true);
  });

  it("attest gate rejects ordinary terminal/text replay as evidence for physical_terminal stories", () => {
    const wt = withPhysicalReport("US-PHYS-3", "terminal");

    expect(verificationReportHasContent(wt, "US-PHYS-3")).toBe(false);
  });

  it("roll attest does not promote headless stdout fallback to physical Terminal.app evidence", async () => {
    const proj = tmp("attest");
    mkdirSync(join(proj, ".roll", "features", "demo", "US-PHYS-4"), { recursive: true });
    writeFileSync(join(proj, ".roll", "features", "demo", "US-PHYS-4", "spec.md"), physicalSpec("US-PHYS-4"));
    const headlessNoGui: ShotRun = (cmd) => {
      if (cmd === "sh") return Promise.resolve({ code: 0, stdout: "doctor tools output\n", stderr: "" });
      if (cmd === "launchctl") return Promise.resolve({ code: 0, stdout: "Background\n", stderr: "" });
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    };

    await silenced(() =>
      inDir(proj, () =>
        attestCommand(["US-PHYS-4", "--capture-command", "roll doctor --tools"], {
          now: () => T0,
          run: quietRun,
          ghProbe: () => Promise.resolve(false),
          capture: { run: headlessNoGui, platform: "darwin", env: {} },
        }),
      ),
    );

    const runDir = join(proj, ".roll", "features", "demo", "US-PHYS-4", "2026-06-06T01-02-03");
    expect(existsSync(join(runDir, "screenshots", "terminal-headless.txt"))).toBe(false);
    const evidence = JSON.parse(readFileSync(join(runDir, "evidence.json"), "utf8")) as {
      captures?: Array<{ kind?: string; taken?: boolean; skipped?: string }>;
    };
    expect(evidence.captures?.[0]).toMatchObject({
      kind: "physical-terminal",
      taken: false,
    });
    expect(evidence.captures?.[0]?.skipped).toMatch(/no GUI|screen|permission|macOS|Terminal/i);
  });
});
