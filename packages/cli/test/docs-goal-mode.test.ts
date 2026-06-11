import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");

function doc(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("FIX-256 — goal mode docs and site wording", () => {
  it("English and Chinese loop guides document goal mode versus scheduled mode", () => {
    const en = doc("guide/en/loop.md");
    expect(en).toContain("### Goal Mode vs Scheduled Mode");
    expect(en).toContain("go.lock");
    expect(en).toMatch(/scheduled .*yield/i);
    expect(en).toMatch(/scheduler .*off/i);
    expect(en).toMatch(/paused.*resume/i);

    const zh = doc("guide/zh/loop.md");
    expect(zh).toContain("### Goal Mode 与定时模式");
    expect(zh).toContain("go.lock");
    expect(zh).toContain("定时");
    expect(zh).toContain("off");
    expect(zh).toContain("paused");
    expect(zh).toContain("resume");
  });

  it("READMEs summarize the off/pause distinction near roll loop go", () => {
    expect(doc("README.md")).toMatch(/roll loop go[\s\S]{0,500}scheduler is off/i);
    expect(doc("README.md")).toMatch(/roll loop go[\s\S]{0,700}paused[\s\S]{0,120}resume/i);
    expect(doc("README_CN.md")).toMatch(/roll loop go[\s\S]{0,500}off/);
    expect(doc("README_CN.md")).toMatch(/roll loop go[\s\S]{0,700}paused[\s\S]{0,120}resume/);
  });

  it("site exposes goal mode and no longer advertises loop / dream / brief as active lanes", () => {
    const site = doc("site/roll-data.js");
    expect(site).toContain("roll loop go");
    expect(site).toContain("goal mode");
    expect(site).not.toContain("loop / dream / brief");
    expect(site).not.toContain("loop, dream and brief");
    expect(site).toContain("loop / pr / dream");
  });
});
