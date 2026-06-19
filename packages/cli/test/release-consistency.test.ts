/**
 * FIX-375 — release consistency gate hardening.
 *
 * Three deterministic, release-delta-scoped checks that the heuristic gate
 * previously lacked (the code-backlog dimension was vacuous; docs/site never
 * checked changelog coverage or dangling guide links):
 *   - code-backlog: every card merged since the latest tag owns a ✅ Done row
 *     with a merge ref (Done↔merge), not a vacuous pass.
 *   - docs: every release-delta card is in CHANGELOG or carries changelog_exempt.
 *   - site: no dangling guide references in site/roll-data.js.
 *
 * The delta is computed from real git (tag + log), so each scenario builds a
 * throwaway git repo with a tag and post-tag commits whose subjects carry the
 * card ids.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkDocs, checkFeaturesCatalog, checkSite } from "../src/lib/release-consistency.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

interface ProjectOpts {
  deltaSubjects: string[]; // commit subjects AFTER the tag → the release delta
  backlog?: string;
  changelog?: string;
  specs?: { epic: string; id: string; frontmatter: string }[];
  siteData?: string;
  guides?: string[]; // guide rel-paths to create on disk, e.g. "guide/en/loop.md"
}

function makeProject(opts: ProjectOpts): string {
  const dir = mkdtempSync(join(tmpdir(), "roll-relconsist-"));
  dirs.push(dir);
  const git = (...args: string[]): void => {
    execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" });
  };
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "Test");
  writeFileSync(join(dir, "seed.txt"), "seed\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  git("tag", "v1.0.0");
  for (const subject of opts.deltaSubjects) {
    git("commit", "-q", "--allow-empty", "-m", subject);
  }

  if (opts.backlog !== undefined) {
    mkdirSync(join(dir, ".roll"), { recursive: true });
    writeFileSync(join(dir, ".roll", "backlog.md"), opts.backlog);
  }
  if (opts.changelog !== undefined) writeFileSync(join(dir, "CHANGELOG.md"), opts.changelog);
  for (const s of opts.specs ?? []) {
    const specDir = join(dir, ".roll", "features", s.epic, s.id);
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, "spec.md"), `---\nid: ${s.id}\n${s.frontmatter}\n---\n\n# ${s.id}\n`);
  }
  if (opts.siteData !== undefined) {
    mkdirSync(join(dir, "site"), { recursive: true });
    writeFileSync(join(dir, "site", "roll-data.js"), opts.siteData);
  }
  for (const g of opts.guides ?? []) {
    const abs = join(dir, g);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, `# ${g}\n`);
  }
  return dir;
}

describe("checkFeaturesCatalog — code↔backlog Done↔merge (FIX-375)", () => {
  it("passes when every delta card has a ✅ Done row with a merge ref", () => {
    const dir = makeProject({
      deltaSubjects: ["Fix: FIX-901 thing (#1)"],
      backlog: "| [FIX-901](x) | thing | ✅ Done (#1) |\n",
    });
    expect(checkFeaturesCatalog(dir).status).toBe("pass");
  });

  it("fails when a merged delta card's row is not Done (claim/merge drift)", () => {
    const dir = makeProject({
      deltaSubjects: ["Fix: FIX-902 thing (#2)"],
      backlog: "| [FIX-902](x) | thing | 📋 Todo |\n",
    });
    const r = checkFeaturesCatalog(dir);
    expect(r.status).toBe("fail");
    expect(r.gaps.join("\n")).toContain("FIX-902");
    expect(r.gaps.join("\n")).toContain("not ✅ Done");
  });

  it("fails when a Done delta card's row carries no merge ref", () => {
    const dir = makeProject({
      deltaSubjects: ["Fix: FIX-903 thing"],
      backlog: "| [FIX-903](x) | thing | ✅ Done |\n",
    });
    const r = checkFeaturesCatalog(dir);
    expect(r.status).toBe("fail");
    expect(r.gaps.join("\n")).toContain("no merge ref");
  });

  it("no-ops (pass) when there is no release tag — git delta empty", () => {
    const dir = mkdtempSync(join(tmpdir(), "roll-relconsist-notag-"));
    dirs.push(dir);
    execFileSync("git", ["-C", dir, "init", "-q"], { stdio: "ignore" });
    mkdirSync(join(dir, ".roll"), { recursive: true });
    writeFileSync(join(dir, ".roll", "backlog.md"), "| [FIX-904](x) | thing | 📋 Todo |\n");
    expect(checkFeaturesCatalog(dir).status).toBe("pass");
  });
});

describe("checkDocs — changelog coverage of the release delta (FIX-375)", () => {
  const backlog = "| [FIX-901](x) | a | ✅ Done (#1) |\n| [US-FOO-1](x) | b | ✅ Done (#2) |\n";

  it("fails when a delta card has neither a CHANGELOG entry nor changelog_exempt", () => {
    const dir = makeProject({
      deltaSubjects: ["Fix: FIX-901 (#1)", "Story: US-FOO-1 (#2)"],
      backlog,
      changelog: "# Changelog\n\n## Unreleased\n\n- a fix (FIX-901) `[x]`\n",
      specs: [{ epic: "e", id: "US-FOO-1", frontmatter: "type: us" }],
    });
    const r = checkDocs(dir);
    expect(r.status).toBe("fail");
    expect(r.gaps.join("\n")).toContain("US-FOO-1");
    expect(r.gaps.join("\n")).not.toContain("FIX-901"); // FIX-901 IS in the changelog
  });

  it("passes when the uncovered card carries changelog_exempt with a reason", () => {
    const dir = makeProject({
      deltaSubjects: ["Fix: FIX-901 (#1)", "Story: US-FOO-1 (#2)"],
      backlog,
      changelog: "# Changelog\n\n## Unreleased\n\n- a fix (FIX-901) `[x]`\n",
      specs: [{ epic: "e", id: "US-FOO-1", frontmatter: "type: us\nchangelog_exempt: internal plumbing" }],
    });
    expect(checkDocs(dir).status).toBe("pass");
  });

  it("base-id match: a range note like (FIX-356 / 356a-d) covers FIX-356c", () => {
    const dir = makeProject({
      deltaSubjects: ["Fix: FIX-356c (#1)"],
      backlog: "| [FIX-356c](x) | a | ✅ Done (#1) |\n",
      changelog: "# Changelog\n\n## Unreleased\n\n- retire (FIX-356 / 356a-d) `[x]`\n",
    });
    expect(checkDocs(dir).status).toBe("pass");
  });
});

describe("checkSite — no dangling guide references (FIX-375)", () => {
  const backlog = "| [FIX-901](x) | a | ✅ Done (#1) |\n";
  const siteHead = 'const FEATURE_GROUPS = [{ name: "Delivery Dossier", desc: "x" }];\n';

  it("fails when site/roll-data.js links a guide that does not exist", () => {
    const dir = makeProject({
      deltaSubjects: ["Fix: FIX-901 (#1)"],
      backlog,
      siteData: siteHead + 'const NAV = [{ path: "guide/en/loop.md" }, { path: "guide/en/ghost.md" }];\n',
      guides: ["guide/en/loop.md"], // ghost.md intentionally absent
    });
    const r = checkSite(dir);
    expect(r.status).toBe("fail");
    expect(r.gaps.join("\n")).toContain("guide/en/ghost.md");
    expect(r.gaps.join("\n")).not.toContain("guide/en/loop.md");
  });

  it("passes when every linked guide exists", () => {
    const dir = makeProject({
      deltaSubjects: ["Fix: FIX-901 (#1)"],
      backlog,
      siteData: siteHead + 'const NAV = [{ path: "guide/en/loop.md" }, { path: "guide/zh/loop.md" }];\n',
      guides: ["guide/en/loop.md", "guide/zh/loop.md"],
    });
    expect(checkSite(dir).status).toBe("pass");
  });
});
