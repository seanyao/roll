import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..", "..", "..");

function doc(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function expectAll(text: string, needles: string[]): void {
  for (const needle of needles) expect(text).toContain(needle);
}

describe("acceptance evidence documentation", () => {
  it("documents the three-stage evidence lifecycle in English and Chinese", () => {
    expectAll(doc("guide/en/acceptance-evidence.md"), [
      "Lifecycle in three stages",
      "1. Open the evidence frame",
      "2. Collect during execution",
      "3. Close with the hard attest gate",
      "ROLL_RUN_DIR",
      "ROLL_EVIDENCE_DIR",
      "ROLL_SCREENSHOTS_DIR",
    ]);

    expectAll(doc("guide/zh/acceptance-evidence.md"), [
      "三段式生命周期",
      "1. 立框",
      "2. 过程采集",
      "3. 收尾硬闸",
      "ROLL_RUN_DIR",
      "ROLL_EVIDENCE_DIR",
      "ROLL_SCREENSHOTS_DIR",
    ]);
  });

  it("documents hard-by-default gate policy in configuration and consistency guides", () => {
    for (const path of [
      "guide/en/configuration.md",
      "guide/zh/configuration.md",
      "guide/en/consistency.md",
      "guide/zh/consistency.md",
    ]) {
      const text = doc(path);
      expect(text).toContain("attest_gate");
      expect(text).toContain("hard");
      expect(text).toContain("soft");
    }
  });

  it("README files point readers to the refreshed evidence lifecycle pages", () => {
    expect(doc("README.md")).toContain("Evidence lifecycle");
    expect(doc("README_CN.md")).toContain("证据生命周期");
    expect(doc("guide/INDEX.md")).toContain("Evidence lifecycle");
    expect(doc("guide/INDEX.md")).toContain("证据生命周期");
  });

  it("documents the stricter physical_terminal evidence contract", () => {
    expectAll(doc("guide/en/acceptance-evidence.md"), [
      "physical_terminal:",
      "Terminal.app",
      "Headless stdout",
      "HTML replays",
      "cached under `ROLL_HOME`",
    ]);

    expectAll(doc("guide/zh/acceptance-evidence.md"), [
      "physical_terminal:",
      "Terminal.app",
      "headless stdout",
      "HTML replay",
      "ROLL_HOME",
    ]);
  });

  it("does not keep stale docs saying the frame is created only by attest or that the gate is soft by default", () => {
    const paths = [
      "guide/en/acceptance-evidence.md",
      "guide/zh/acceptance-evidence.md",
      "guide/en/configuration.md",
      "guide/zh/configuration.md",
      "guide/en/consistency.md",
      "guide/zh/consistency.md",
      "docs/verification.md",
      "README.md",
      "README_CN.md",
    ];

    for (const path of paths) {
      const text = doc(path);
      expect(text).not.toMatch(/soft[- ]gate default|default soft|soft by default/i);
      expect(text).not.toMatch(/attest (creates|opens) the evidence frame/i);
      expect(text).not.toMatch(/attest.*才(创建|建立|立).*证据/);
      expect(text).not.toMatch(/默认.*软闸/);
    }
  });
});
