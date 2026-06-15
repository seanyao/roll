/**
 * FIX-334 — the dossier generator must parse a FIX-format spec (no As-a/I-want
 * narrative, AC under a `## Acceptance Criteria` heading, fix approach in
 * `**Problem**`/`**Root Cause**`/`**Solution**` bold lines) so a delivered FIX
 * card's Definition / Acceptance / Design stations are FILLED, not the empty
 * "未记录故事原语 / No AC in spec / 尚未设计" placeholders the US-only parser left.
 *
 * Sampled against the real FIX-307 spec body (the FIX-307 实证 from the card),
 * but asserted on parse SHAPE — so the fix is general for ANY FIX card.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  collectStoryDossierInput,
  parseFixDesign,
  parseFixWish,
  renderStoryDossier,
} from "../src/lib/story-dossier.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) execFileSync("rm", ["-rf", d]);
});

// The real FIX-307 spec body shape (FIX format): YAML frontmatter, an H1,
// **Problem**/**Root Cause**/**Solution** bold primitives, a **Files:** list,
// and AC under a `## Acceptance Criteria` markdown heading.
const FIX_307_SPEC = [
  "---",
  "id: FIX-307",
  "title: 档案页头显示每个项目的真实名称,不再硬编码为 roll",
  "type: fix",
  "epic: delivery-dossier",
  "created: 2026-06-14",
  "---",
  "",
  "# FIX-307 — 项目名按项目派生,不再硬编码 roll",
  "",
  "**Fixed**: 2026-06-15",
  "",
  "**Problem**: 验收档案页头把未设置 ROLL_BRAND_NAME 的项目都显示成 roll。",
  "**Root Cause**: index/init 直接用 process.env ?? roll,没按项目派生真实名。",
  "**Solution**: 新增 resolveProjectName(cwd),按环境变量/git remote/顶层目录/cwd 顺序解析。",
  "",
  "**Files:**",
  "- packages/cli/src/lib/projects-registry.ts",
  "- packages/cli/src/commands/index-gen.ts",
  "",
  "## 背景(2026-06-14 调查实证)",
  "页头标签对每个项目都硬编码显示 roll。",
  "",
  "## Acceptance Criteria",
  "- [ ] 新增 resolveProjectName(cwd):解析顺序 ROLL_BRAND_NAME → git remote 仓名 → 顶层目录 → cwd",
  "- [ ] index-gen/init 全改用 resolveProjectName(cwd),不再用裸 ?? roll 字面量",
  "- [ ] 在 APE-PR 跑 roll index 后,页头显示 APE-PR",
  "- [ ] resolveProjectName 单测覆盖四条解析路径与回落",
  "",
].join("\n");

function projectWithFix307(): string {
  const p = realpathSync(mkdtempSync(join(tmpdir(), "roll-dossier-fix334-")));
  dirs.push(p);
  const dir = join(p, ".roll", "features", "delivery-dossier", "FIX-307");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "spec.md"), FIX_307_SPEC);
  return p;
}

describe("FIX-334 — dossier parses FIX-format spec primitives & AC", () => {
  it("parseFixWish prefers **Problem**, falls back to **Solution** then H1", () => {
    expect(parseFixWish(FIX_307_SPEC)).toContain("验收档案页头");
    // No Problem → Solution; no Solution → H1; bare → "".
    expect(parseFixWish("# Just a title\n\n**Solution**: do the thing\n")).toBe("do the thing");
    expect(parseFixWish("# Only a title here\n")).toBe("Only a title here");
    expect(parseFixWish("plain prose, no primitives\n")).toBe("");
  });

  it("parseFixDesign turns **Root Cause** + **Solution** into labelled bullets", () => {
    const design = parseFixDesign(FIX_307_SPEC);
    expect(design.length).toBe(2);
    expect(design.some((b) => /index\/init 直接用/.test(b))).toBe(true);
    expect(design.some((b) => /resolveProjectName\(cwd\)/.test(b))).toBe(true);
    expect(parseFixDesign("# bare\n")).toEqual([]);
  });

  it("collectStoryDossierInput fills definition (wish), AC items, and design from a FIX spec", () => {
    const p = projectWithFix307();
    const got = collectStoryDossierInput(p, {
      id: "FIX-307",
      epic: "delivery-dossier",
      type: "FIX",
      delivered: true,
      created: "2026-06-14",
    });
    // Definition station: a FIX card has no As-a narrative, but the wish is now
    // derived from **Problem** rather than left empty.
    expect(got.narrative).toBeUndefined();
    expect(got.wish).toBeDefined();
    expect(got.wish).toContain("验收档案页头");
    // Acceptance station: all four `- [ ]` items under `## Acceptance Criteria`.
    expect(got.acItems).toBeDefined();
    expect(got.acItems?.length).toBe(4);
    expect(got.acItems?.[0]?.text).toContain("resolveProjectName(cwd)");
    expect(got.acItems?.every((a) => a.checked === false)).toBe(true);
    // The trailing `**Files:**` list and `## 背景` bullets are NOT AC items.
    expect(got.acItems?.some((a) => /projects-registry/.test(a.text))).toBe(false);
    // Design station: derived from the **Root Cause**/**Solution** primitives.
    expect(got.design).toBeDefined();
    expect(got.design?.length).toBe(2);
  });

  it("the rendered dossier carries NO empty-state placeholders for a FIX card", () => {
    const p = projectWithFix307();
    const got = collectStoryDossierInput(p, {
      id: "FIX-307",
      epic: "delivery-dossier",
      type: "FIX",
      delivered: true,
      created: "2026-06-14",
    });
    const html = renderStoryDossier(got);
    // The exact placeholders the US-only parser produced on a FIX card.
    expect(html).not.toContain("未记录故事原语");
    expect(html).not.toContain("No story primitive");
    expect(html).not.toContain("spec.md 未记录 AC");
    expect(html).not.toContain("No AC in spec");
    expect(html).not.toContain("尚未设计");
    expect(html).not.toContain("Not yet designed");
    // And the real content is present.
    expect(html).toContain("验收档案页头");
    expect(html).toContain("ac-checklist");
    expect(html).toContain("resolveProjectName(cwd)");
  });
});
