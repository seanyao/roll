import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repo = resolve(__dirname, "../../..");

function read(path: string): string {
  return readFileSync(resolve(repo, path), "utf8");
}

describe("US-REVIEW-001 review-page terminology guard", () => {
  it("keeps review-page handoff surfaces on canonical names", () => {
    const designCatalog = read("packages/spec/src/i18n/catalog-v3.ts");
    const attestCommand = read("packages/cli/src/commands/attest.ts");
    const acceptanceDocs = [
      read("guide/en/acceptance-evidence.md"),
      read("guide/zh/acceptance-evidence.md"),
      read("README.md"),
      read("README_CN.md"),
    ].join("\n");

    expect(designCatalog).toContain("Design Review Page");
    expect(attestCommand).toContain("Acceptance Review Page");
    expect(acceptanceDocs).toContain("Acceptance Review Page");
    expect(acceptanceDocs).toContain("验收 Review Page");

    const reviewSurfaceText = [designCatalog, attestCommand, acceptanceDocs].join("\n");
    expect(reviewSurfaceText).not.toMatch(/\bopen the dossier\b/i);
    expect(reviewSurfaceText).not.toMatch(/\bAcceptance report written\b/);
  });
});
