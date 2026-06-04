/**
 * diff-test: PRLifecycle pure helpers vs the frozen bash oracle (bin/roll).
 *
 * The entangled publish SEQUENCE (`_loop_publish_pr` / `_loop_publish_doc_pr`)
 * and the cycle-end fallback ladder (bin/roll:9200-9341) drive real `git push` /
 * `gh` against GitHub and emit worktree/event side effects, so they are
 * behaviour-tested (pr.test.ts) and DOCUMENTED-not-difftested (see pr.ts header).
 * What IS byte-diffable here:
 *
 *   - the claimed-story id extraction awk (`_loop_pr_claimed_stories`,
 *     bin/roll:12551-12557) vs {@link parseClaimedIdsFromBacklog} +
 *     {@link dedupeSortedIds} (the trailing `awk 'NF' | sort -u`).
 *   - the `${branch#loop/}` title-suffix parameter expansion vs
 *     {@link branchTitleSuffix}.
 *   - the `_loop_emit_pr_final` state→outcome `case` (bin/roll:13564-13569) vs
 *     {@link prStateToOutcome}.
 *   - the cycle-branch merged/open label (`_loop_branches`, bin/roll:13069-13072)
 *     via `git merge-base --is-ancestor` on a fixture repo vs
 *     {@link cycleBranchStatus}.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  branchTitleSuffix,
  cycleBranchStatus,
  dedupeSortedIds,
  parseClaimedIdsFromBacklog,
  prStateToOutcome,
} from "../src/index.js";

const REPO = resolve(__dirname, "../../..");
const ROLLBIN = `${REPO}/bin/roll`;
const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) execFileSync("rm", ["-rf", d]);
});

function bash(script: string, args: string[] = []): string {
  return execFileSync("bash", ["-c", script, "bash", ...args], {
    encoding: "utf8",
    env: { ...process.env, ROLLBIN },
  });
}

describe("diff-test: claimed-id awk == parseClaimedIdsFromBacklog + sort -u", () => {
  // The exact awk body lifted from _loop_pr_claimed_stories (bin/roll:12551-12557),
  // then the trailing `awk 'NF' | sort -u`.
  const AWK = String.raw`awk -F'|' '/🔨 In Progress/ {
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", $2)
      sub(/^\[/, "", $2)
      sub(/\].*$/, "", $2)
      if ($2 != "") print $2
    }'`;

  function bashClaimed(backlog: string): string[] {
    const out = bash(`printf '%s' "$1" | ${AWK} | awk 'NF' | sort -u`, [backlog]);
    return out.split("\n").filter((s) => s.length > 0);
  }

  const CASES: string[] = [
    [
      "| [US-A](features/a.md) | desc | 🔨 In Progress |",
      "| FIX-9 | bare id | 🔨 In Progress |",
      "| US-B | not in progress | 📋 Todo |",
      "| [US-C](url) | done | ✅ Done |",
    ].join("\n"),
    [
      "| [US-Z](z) | z | 🔨 In Progress |",
      "| [US-A](a) | a | 🔨 In Progress |",
      "| [US-Z](z2) | dup | 🔨 In Progress |",
    ].join("\n"),
    "|  | empty id | 🔨 In Progress |",
    "no rows at all",
  ];

  for (const [i, content] of CASES.entries()) {
    it(`case ${i}: TS == bash`, () => {
      const ts = dedupeSortedIds(parseClaimedIdsFromBacklog(content));
      expect(ts).toEqual(bashClaimed(content));
    });
  }
});

describe("diff-test: branchTitleSuffix == bash ${branch#loop/}", () => {
  for (const b of ["loop/cycle-abc", "worktree-agent-x", "claude/foo", "loop/loop/x"]) {
    it(`branch='${b}'`, () => {
      const out = bash('echo "${1#loop/}"', [b]).trim();
      expect(branchTitleSuffix(b)).toBe(out);
    });
  }
});

describe("diff-test: prStateToOutcome == _loop_emit_pr_final case", () => {
  // Mirror the bash `case "$state"` mapping (bin/roll:13564-13569).
  const CASE = String.raw`case "$1" in
    MERGED) echo merged ;;
    CLOSED) echo closed ;;
    OPEN)   echo open   ;;
    *)      echo open   ;;
  esac`;
  for (const s of ["MERGED", "CLOSED", "OPEN", "UNKNOWN", "weird"]) {
    it(`state='${s}'`, () => {
      expect(prStateToOutcome(s)).toBe(bash(CASE, [s]).trim());
    });
  }
});

describe("diff-test: cycleBranchStatus == git merge-base --is-ancestor on fixture", () => {
  it("merged branch → merged on both sides; diverged → open", () => {
    const repo = mkdtempSync(join(tmpdir(), "roll-pr-gc-"));
    dirs.push(repo);
    const git = (args: string[]): string =>
      execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
    git(["init", "-q", "-b", "main"]);
    git(["config", "user.email", "t@t"]);
    git(["config", "user.name", "t"]);
    // base commit on main
    execFileSync("bash", ["-c", `echo a > "${join(repo, "a")}"`]);
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "base"]);
    // merged branch: points at an ancestor of main (the base commit), then main advances
    git(["branch", "loop/cycle-merged"]);
    execFileSync("bash", ["-c", `echo b > "${join(repo, "b")}"`]);
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "advance main"]);
    // diverged branch: a commit not on main
    git(["checkout", "-q", "-b", "loop/cycle-open"]);
    execFileSync("bash", ["-c", `echo c > "${join(repo, "c")}"`]);
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "diverge"]);
    git(["checkout", "-q", "main"]);

    const isAncestor = (branch: string): boolean => {
      try {
        execFileSync("git", ["-C", repo, "merge-base", "--is-ancestor", branch, "main"]);
        return true;
      } catch {
        return false;
      }
    };

    for (const b of ["loop/cycle-merged", "loop/cycle-open"]) {
      const anc = isAncestor(b);
      const bashLabel = anc ? "merged" : "open";
      expect(cycleBranchStatus(anc)).toBe(bashLabel);
    }
    // sanity: the merged branch IS an ancestor, the open one is NOT.
    expect(isAncestor("loop/cycle-merged")).toBe(true);
    expect(isAncestor("loop/cycle-open")).toBe(false);
  });
});
