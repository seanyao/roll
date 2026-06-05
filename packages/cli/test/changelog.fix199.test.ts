/**
 * FIX-199 regression — `changelog generate` must NOT drift between two
 * consecutive runs on the same HEAD/backlog.
 *
 * Root cause: `commitLogSinceLastRelease()` ran `git log <tag>..HEAD` through a
 * probe that swallowed ANY failure into `null`; the caller treated `null` as
 * "no release tag" and silently swapped the changelog filter from the tag-aware
 * window branch to the no-tag dedup branch. Under concurrent git activity
 * during release prep the probe failed intermittently → the observed
 * `stories_drafted` 17→2 drift with no signal distinguishing the two runs.
 *
 * Fix: a transient probe failure is RETRIED away (so repeat runs are
 * byte-identical); a persistent failure WARNs loudly to stderr and degrades to
 * the dedup branch instead of silently swapping into it. The git probe is
 * injectable so both failure modes are deterministically reproducible.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
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
  "| US-A-001 | 新增导出报表命令 | ✅ Done |",
  "| FIX-A-002 | 修复时间区间偏移 | ✅ Done |",
  "| US-A-003 | 上线批量导入 | ✅ Done |",
  "",
].join("\n");

/** Write a throwaway backlog file and return its path (no chdir needed). */
function backlogFile(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "roll-f199-")));
  dirs.push(dir);
  const p = join(dir, "backlog.md");
  writeFileSync(p, BACKLOG);
  return p;
}

/**
 * Fake git probe. `describe` yields the tag (or null when tagless); the
 * `--pretty=format:%s` window log fails `failFirst` times then succeeds, or
 * fails forever when `failAll`. The `%H %s` (gap-detection) log returns ""
 * → no merged PRs → gap path inert regardless of whether real `gh` is present.
 */
function makeProbe(cfg: {
  tag?: string;
  windowLog: string;
  failFirst?: number;
  failAll?: boolean;
}): GitProbe {
  let windowHits = 0;
  return (args: string[]): string | null => {
    const a = args.join(" ");
    if (a.startsWith("describe")) return cfg.tag === undefined ? null : `${cfg.tag}\n`;
    if (a.includes("--pretty=format:%s")) {
      windowHits++;
      if (cfg.failAll) return null;
      if (cfg.failFirst && windowHits <= cfg.failFirst) return null;
      return cfg.windowLog;
    }
    if (a.includes("--pretty=format:%H %s")) return "";
    return null;
  };
}

// The window log names only US-A-001 + FIX-A-002 → those are the in-window set;
// US-A-003 is intentionally absent so a branch swap is observable.
const WINDOW = "US-A-001: export\nFIX-A-002: tz fix";

describe("FIX-199 — changelog generate does not drift on transient git failure", () => {
  it("healthy probe → tag-window filter keeps exactly the in-window stories", () => {
    const backlog = backlogFile();
    const probe = makeProbe({ tag: "v1.0.0", windowLog: WINDOW });
    const r = generateDraft({ backlog, json: true, gitProbe: probe });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('"id": "US-A-001"');
    expect(r.stdout).toContain('"id": "FIX-A-002"');
    expect(r.stdout).not.toContain('"id": "US-A-003"'); // out of window
    expect(r.stderr).toBe(""); // no warning on the happy path
  });

  it("transient failure is retried away — output matches the healthy run, no warn", () => {
    const healthy = generateDraft({
      backlog: backlogFile(),
      json: true,
      gitProbe: makeProbe({ tag: "v1.0.0", windowLog: WINDOW }),
    });
    // First two window-log probes fail, the third succeeds (within retry budget).
    const flaky = generateDraft({
      backlog: backlogFile(),
      json: true,
      gitProbe: makeProbe({ tag: "v1.0.0", windowLog: WINDOW, failFirst: 2 }),
    });
    expect(flaky.stdout).toBe(healthy.stdout); // the blip did NOT change the set
    expect(flaky.stderr).toBe(""); // recovered silently, no false alarm
  });

  it("persistent failure WARNs to stderr instead of silently swapping branch", () => {
    const backlog = backlogFile();
    const r = generateDraft({
      backlog,
      json: true,
      gitProbe: makeProbe({ tag: "v1.0.0", windowLog: WINDOW, failAll: true }),
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("warn:");
    expect(r.stderr).toContain("v1.0.0..HEAD");
  });

  it("persistent failure is itself deterministic — two runs are byte-identical", () => {
    const run = (): { stdout: string; stderr: string } => {
      const r = generateDraft({
        backlog: backlogFile(),
        json: true,
        gitProbe: makeProbe({ tag: "v1.0.0", windowLog: WINDOW, failAll: true }),
      });
      return { stdout: r.stdout, stderr: r.stderr };
    };
    expect(run()).toEqual(run());
  });

  it("no release tag → no warning (legitimate first-release dedup branch)", () => {
    const backlog = backlogFile();
    const r = generateDraft({
      backlog,
      json: true,
      gitProbe: makeProbe({ windowLog: WINDOW }), // tag undefined → describe null
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe(""); // a missing tag is normal, not an error
  });

  it("same input, two consecutive real-git runs → byte-identical stdout", () => {
    const proj = realpathSync(mkdtempSync(join(tmpdir(), "roll-f199-real-")));
    dirs.push(proj);
    const git = (cmd: string): void => execSync(`git ${cmd}`, { cwd: proj, stdio: "pipe" });
    git("init -q");
    git("config user.email roll@test.local");
    git("config user.name roll-test");
    git("config commit.gpgsign false");
    execSync("mkdir -p .roll", { cwd: proj });
    writeFileSync(join(proj, ".roll", "backlog.md"), BACKLOG);
    writeFileSync(join(proj, "seed.txt"), "seed\n");
    git("add -A");
    git('commit -q -m "seed"');
    git("tag v1.0.0");
    writeFileSync(join(proj, "a.txt"), "a\n");
    git("add -A");
    git('commit -q -m "US-A-001: export"');
    writeFileSync(join(proj, "b.txt"), "b\n");
    git("add -A");
    git('commit -q -m "FIX-A-002: tz fix"');

    const save = process.cwd();
    process.chdir(proj);
    try {
      const first = generateDraft({ json: true });
      const second = generateDraft({ json: true });
      expect(first.stdout).toBe(second.stdout);
      expect(first.stderr).toBe(second.stderr);
    } finally {
      process.chdir(save);
    }
  });
});
