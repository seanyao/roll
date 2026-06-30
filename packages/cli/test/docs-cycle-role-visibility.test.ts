import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");

function doc(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

// US-OBS-036 — closing docs card for US-OBS-032..035. The shipped surfaces are
// the `summary.md` / `summary.json` role artifacts, the `roll cycle <id> --roles`
// view, the Execution Cast report block, and the peer/scorer parse-failure
// artifacts. These tests pin the user-facing docs to that reality.
describe("US-OBS-036 — cycle role visibility docs", () => {
  it("loop guides document the role artifacts, roles CLI, and Execution Cast (en+zh)", () => {
    const en = doc("guide/en/loop.md");
    expect(en).toContain("## Cycle Role Visibility");
    expect(en).toContain("summary.md");
    expect(en).toContain("summary.json");
    expect(en).toContain("roll cycle <id> --roles");
    expect(en).toContain("Execution Cast");
    // selected vs returned vs accepted vocabulary
    expect(en).toMatch(/selected[\s\S]{0,400}returned[\s\S]{0,400}accepted/);
    // only one evaluator/scorer is gate-accepted even when several were consulted
    expect(en).toMatch(/accepted evaluator/);

    const zh = doc("guide/zh/loop.md");
    expect(zh).toContain("## Cycle 角色可观测");
    expect(zh).toContain("summary.md");
    expect(zh).toContain("summary.json");
    expect(zh).toContain("roll cycle <id> --roles");
    expect(zh).toContain("Execution Cast");
    expect(zh).toContain("accepted evaluator");
  });

  it("loop guides explain that only one evaluator/scorer is gate-accepted (en+zh)", () => {
    const en = doc("guide/en/loop.md");
    expect(en).toMatch(/only one [\s\S]{0,80}(evaluator|scorer)[\s\S]{0,120}(gate-accepted|accepted by the gate)/i);
    const zh = doc("guide/zh/loop.md");
    expect(zh).toMatch(/只有一(位|个)[\s\S]{0,120}(评审员|评分|evaluator|scorer)/);
  });

  it("ai-agents guides point each role at its visibility surface (en+zh)", () => {
    const en = doc("guide/en/ai-agents.md");
    expect(en).toContain("roll cycle <id> --roles");
    expect(en).toMatch(/who was [\s\S]{0,40}Builder[\s\S]{0,80}Evaluator/i);
    const zh = doc("guide/zh/ai-agents.md");
    expect(zh).toContain("roll cycle <id> --roles");
    expect(zh).toMatch(/谁是?[\s\S]{0,40}(构建者|Builder)/);
  });

  it("peer guides describe parse-failure raw artifacts (en+zh)", () => {
    const en = doc("guide/en/peer.md");
    expect(en).toMatch(/unparseable|parse failure|raw artifact/i);
    const zh = doc("guide/zh/peer.md");
    expect(zh).toMatch(/解析失败|无法解析|原始产物|raw artifact/);
  });

  it("live-console documents unparseable score/review troubleshooting", () => {
    const lc = doc("docs/live-console.md");
    expect(lc).toMatch(/unparseable|无法解析|解析失败/);
    expect(lc).toMatch(/--roles/);
  });

  it("README and guide INDEX link to the role visibility surface", () => {
    expect(doc("README.md")).toMatch(/--roles|Cycle Role Visibility|Execution Cast/);
    const index = doc("guide/INDEX.md");
    expect(index).toContain("loop.md");
  });

  it("docs contain discoverable role visibility language (rg-equivalent sweep)", () => {
    const corpus = [
      doc("guide/en/loop.md"),
      doc("guide/zh/loop.md"),
      doc("guide/en/ai-agents.md"),
      doc("guide/zh/ai-agents.md"),
      doc("docs/live-console.md"),
    ].join("\n");
    for (const token of ["summary.md", "summary.json", "--roles", "Execution Cast", "accepted evaluator"]) {
      expect(corpus).toContain(token);
    }
  });
});
