/**
 * diff-test: TCRPipeline pure logic vs the frozen oracle.
 *
 * Three diff fronts:
 *   1. `_loop_tcr_count` (bin/roll:10885-10889) vs {@link countTcrFromOneline}:
 *      build a fixture git repo with a mix of `tcr:`/non-tcr commits, run the
 *      extracted bash fn and the TS over the same `git log --oneline` lines.
 *   2. `_loop_enforce_tcr` (bin/roll:11594-11629) vs {@link tcrVerdict}: on a
 *      fixture .roll/backlog.md + zero tcr: commits, assert the bash reverts the
 *      row + writes the ALERT, and that {@link renderTcrAlert} reproduces the
 *      ALERT body bytes (minus the live `date` line, injected on the TS side).
 *   3. the pre-commit 60s freshness gate (hooks/pre-commit) vs
 *      {@link freshnessVerdict}: run the REAL hook in a fixture repo across
 *      fresh / stale / tree-changed / docs-only / no-proof timestamps and assert
 *      allow/block parity.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  countTcrFromOneline,
  freshnessVerdict,
  renderTcrAlert,
  tcrVerdict,
} from "../src/index.js";

const REPO = resolve(__dirname, "../../..");
const ROLLBIN = `${REPO}/bin/roll`;
const HOOK = `${REPO}/hooks/pre-commit`;
const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) execFileSync("rm", ["-rf", d]);
});

/** Slice a `_fn()` body out of bin/roll for `eval`. */
function extract(fn: string): string {
  return `eval "$(sed -n '/^${fn}()/,/^}$/p' "${ROLLBIN}")"`;
}

function git(repo: string, args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
}

function initRepo(prefix: string): string {
  const repo = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(repo);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "t@t"]);
  git(repo, ["config", "user.name", "t"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  return repo;
}

function commit(repo: string, file: string, msg: string): void {
  writeFileSync(join(repo, file), `${msg}\n`, "utf8");
  git(repo, ["add", "-A"]);
  // Bypass any inherited hooks for the fixture commits.
  git(repo, ["-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", msg]);
}

describe("diff-test: _loop_tcr_count == countTcrFromOneline", () => {
  it("counts only tcr: commits in the since-window on both sides", () => {
    const repo = initRepo("roll-tcr-count-");
    commit(repo, "a", "Story 1: a");
    commit(repo, "b", "tcr: green b");
    commit(repo, "c", "tcr: green c");
    commit(repo, "d", "Refactor: d");

    // bash: extract _loop_tcr_count and run it with a wide --since window.
    const since = "10 years ago";
    const bashOut = execFileSync(
      "bash",
      [
        "-c",
        `${extract("_loop_tcr_count")}\ncd "$1" && _loop_tcr_count "$2"`,
        "bash",
        repo,
        since,
      ],
      { encoding: "utf8" },
    ).trim();

    // TS: feed the same git log --oneline lines.
    const lines = git(repo, ["log", "--all", "--oneline", `--since=${since}`]).split("\n");
    const ts = countTcrFromOneline(lines);

    expect(ts).toBe(Number(bashOut));
    expect(ts).toBe(2);
  });
});

describe("diff-test: _loop_enforce_tcr zero-tcr == tcrVerdict failure", () => {
  it("bash reverts the row + writes ALERT; TS verdict mirrors the body", () => {
    const repo = initRepo("roll-enforce-tcr-");
    mkdirSync(join(repo, ".roll"), { recursive: true });
    const backlog = join(repo, ".roll", "backlog.md");
    writeFileSync(
      backlog,
      "| [US-X](features/x.md) | desc | ✅ Done |\n| US-Y | other | 📋 Todo |\n",
      "utf8",
    );
    // No tcr: commits at all — only a base commit so `git log` works.
    commit(repo, "base", "Story 1: base");

    const alertPath = join(repo, ".roll", "ALERT.md");
    const script = [
      "_notify() { :; }", // suppress desktop notify
      `_LOOP_ALERT="${alertPath}"`,
      extract("_loop_tcr_count"),
      extract("_loop_enforce_tcr"),
      `cd "$1" && _loop_enforce_tcr "$2" "$3"; echo "rc=$?"`,
    ].join("\n");
    const out = execFileSync(
      "bash",
      ["-c", script, "bash", repo, "US-X", "10 years ago"],
      { encoding: "utf8" },
    );
    expect(out).toContain("rc=1"); // bash returns failure

    // bash reverted the US-X row ✅ Done → 📋 Todo; US-Y untouched.
    const reverted = readFileSync(backlog, "utf8");
    expect(reverted).toContain("| [US-X](features/x.md) | desc | 📋 Todo |");
    expect(reverted).toContain("| US-Y | other | 📋 Todo |");

    // bash wrote the ALERT file; compare its body (minus the live **Time** line)
    // against renderTcrAlert with the same started_at.
    const bashAlert = readFileSync(alertPath, "utf8");
    const tsAlert = renderTcrAlert("US-X", "IGNORED", "10 years ago");
    const stripTime = (s: string): string =>
      s
        .split("\n")
        .filter((l) => !l.startsWith("**Time**:"))
        .join("\n")
        .trimEnd();
    expect(stripTime(tsAlert)).toBe(stripTime(bashAlert));

    // And the TS verdict agrees this is a zero-tcr failure for US-X.
    const v = tcrVerdict({ storyId: "US-X", startedAt: "10 years ago", count: 0, nowStamp: "x" });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.revertStoryId).toBe("US-X");
  });

  it("bash with tcr: commits returns 0; TS verdict ok", () => {
    const repo = initRepo("roll-enforce-tcr-ok-");
    mkdirSync(join(repo, ".roll"), { recursive: true });
    writeFileSync(join(repo, ".roll", "backlog.md"), "| US-X | d | ✅ Done |\n", "utf8");
    commit(repo, "a", "tcr: green");

    const script = [
      "_notify() { :; }",
      `_LOOP_ALERT="${join(repo, ".roll", "ALERT.md")}"`,
      extract("_loop_tcr_count"),
      extract("_loop_enforce_tcr"),
      `cd "$1" && _loop_enforce_tcr "$2" "$3"; echo "rc=$?"`,
    ].join("\n");
    const out = execFileSync(
      "bash",
      ["-c", script, "bash", repo, "US-X", "10 years ago"],
      { encoding: "utf8" },
    );
    expect(out).toContain("rc=0");
    expect(tcrVerdict({ storyId: "US-X", startedAt: "10 years ago", count: 1, nowStamp: "x" }).ok).toBe(
      true,
    );
  });
});

describe("diff-test: pre-commit freshness gate == freshnessVerdict", () => {
  /**
   * Run the REAL hooks/pre-commit in a fixture repo whose core.hooksPath points
   * at the repo's hooks dir, with a fabricated .roll/last-test-pass. Returns
   * whether the commit was allowed.
   */
  function bashHookAllows(opts: {
    stagedFile: string;
    proofTsOffset?: number | null; // seconds before now; null = no proof file
    proofTreeMatches?: boolean;
    malformed?: boolean;
  }): { allowed: boolean; repo: string; currentTree: string; now: number; proofBody?: string } {
    const repo = initRepo("roll-fresh-");
    const hooksDir = join(repo, "hooks");
    mkdirSync(hooksDir, { recursive: true });
    // Copy the real hook in.
    execFileSync("cp", [HOOK, join(hooksDir, "pre-commit")]);
    execFileSync("chmod", ["+x", join(hooksDir, "pre-commit")]);
    git(repo, ["config", "core.hooksPath", "hooks"]);
    mkdirSync(join(repo, ".roll"), { recursive: true });

    // Base commit (hook bypassed) so write-tree is meaningful.
    commit(repo, "base", "tcr: base");

    // Stage the target file.
    const dir = join(repo, opts.stagedFile.includes("/") ? opts.stagedFile.split("/")[0]! : ".");
    if (opts.stagedFile.includes("/")) mkdirSync(dir, { recursive: true });
    writeFileSync(join(repo, opts.stagedFile), "change\n", "utf8");
    git(repo, ["add", opts.stagedFile]);

    const currentTree = git(repo, ["write-tree"]);
    const now = Math.floor(Date.now() / 1000);

    let proofBody: string | undefined;
    if (opts.proofTsOffset !== null && opts.proofTsOffset !== undefined) {
      const ts = now - opts.proofTsOffset;
      const tree = opts.malformed
        ? undefined
        : opts.proofTreeMatches === false
          ? "0000000000000000000000000000000000000000"
          : currentTree;
      proofBody = opts.malformed ? "{}" : `{"ts":${ts},"tree":"${tree}"}`;
      writeFileSync(join(repo, ".roll", "last-test-pass"), proofBody, "utf8");
    }

    let allowed: boolean;
    try {
      git(repo, ["commit", "-q", "-m", "attempt"]);
      allowed = true;
    } catch {
      allowed = false;
    }
    return { allowed, repo, currentTree, now, proofBody };
  }

  const CASES: Array<{
    name: string;
    stagedFile: string;
    proofTsOffset?: number | null;
    proofTreeMatches?: boolean;
    malformed?: boolean;
  }> = [
    { name: "docs-only (root md) → allowed", stagedFile: "NOTES.md", proofTsOffset: null },
    { name: "code + fresh matching proof → allowed", stagedFile: "lib/x.sh", proofTsOffset: 5 },
    { name: "code + no proof → blocked", stagedFile: "lib/x.sh", proofTsOffset: null },
    { name: "code + malformed proof → blocked", stagedFile: "lib/x.sh", proofTsOffset: 5, malformed: true },
    { name: "code + stale proof → blocked", stagedFile: "lib/x.sh", proofTsOffset: 120 },
    {
      name: "code + tree changed → blocked",
      stagedFile: "lib/x.sh",
      proofTsOffset: 5,
      proofTreeMatches: false,
    },
  ];

  for (const c of CASES) {
    it(c.name, () => {
      const r = bashHookAllows(c);
      const ts = freshnessVerdict({
        stagedFiles: [c.stagedFile],
        proofBody: r.proofBody,
        now: r.now,
        currentTree: r.currentTree,
      });
      expect(ts.allowed).toBe(r.allowed);
    });
  }
});
