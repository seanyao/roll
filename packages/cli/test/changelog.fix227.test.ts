/**
 * FIX-227 regression — `changelog generate --write` must NOT let already-shipped
 * stories accumulate in `## Unreleased`.
 *
 * Root cause: the since-tag window re-includes a version that was changelogged
 * but never tagged, and the merge writer only ever ADDS lines — so a story that
 * already shipped in a `## vX` section kept reappearing/persisting in Unreleased.
 *
 * Fix: both the draft filter and the merge writer prune any entry whose story id
 * already appears in a released `## vX` section. PR-only / manual bullets (no
 * shipped story id) are preserved.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { generateDraft, type GitProbe } from "../src/commands/changelog.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

const BACKLOG = [
  "| Story | Description | Status |",
  "|-------|-------------|--------|",
  "| US-SHIPPED-001 | 已经随上个版本发布的故事 | ✅ Done |",
  "| US-NEW-002 | 这个版本真正的新增 | ✅ Done |",
  "",
].join("\n");

// since-tag window still spans the shipped story (its version was changelogged
// but never tagged) — both ids show up in the log.
const PROBE: GitProbe = (args) => {
  if (args[0] === "describe") return "v1.0.0";
  if (args[0] === "log") return "tcr: US-SHIPPED-001 ship\ntcr: US-NEW-002 build";
  return null;
};

const CHANGELOG = [
  "# Changelog",
  "",
  "## Unreleased",
  "",
  "- 旧的已发故事不该留在这里（US-SHIPPED-001）",
  "- site: 纯 PR 条目不带 story id（PR#900）",
  "",
  "## v1.0.0 — 2026-01-01",
  "",
  "- 首发就带了这个故事（US-SHIPPED-001）",
  "",
].join("\n");

function project(): { backlog: string; changelog: string } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "roll-f227-")));
  dirs.push(dir);
  const backlog = join(dir, "backlog.md");
  const changelog = join(dir, "CHANGELOG.md");
  writeFileSync(backlog, BACKLOG);
  writeFileSync(changelog, CHANGELOG);
  return { backlog, changelog };
}

describe("FIX-227 — changelog generate prunes already-shipped from Unreleased", () => {
  it("drops the shipped story from Unreleased, keeps the PR-only line, adds the new story", () => {
    const { backlog, changelog } = project();
    generateDraft({ backlog, changelog, write: true, gitProbe: PROBE });
    const text = readFileSync(changelog, "utf8");
    const unreleased = text.slice(text.indexOf("## Unreleased"), text.indexOf("## v1.0.0"));

    // shipped story pruned from Unreleased (still present in the v1.0.0 section).
    expect(unreleased).not.toContain("US-SHIPPED-001");
    expect(text).toContain("首发就带了这个故事（US-SHIPPED-001）");
    // PR-only / manual bullet (no shipped story id) survives the regen.
    expect(unreleased).toContain("PR#900");
    // the genuinely-new story is drafted in.
    expect(unreleased).toContain("US-NEW-002");
  });

  it("is idempotent — a second run does not re-add the shipped story", () => {
    const { backlog, changelog } = project();
    generateDraft({ backlog, changelog, write: true, gitProbe: PROBE });
    generateDraft({ backlog, changelog, write: true, gitProbe: PROBE });
    const text = readFileSync(changelog, "utf8");
    const unreleased = text.slice(text.indexOf("## Unreleased"), text.indexOf("## v1.0.0"));
    expect(unreleased).not.toContain("US-SHIPPED-001");
    expect(unreleased).toContain("US-NEW-002");
  });
});
