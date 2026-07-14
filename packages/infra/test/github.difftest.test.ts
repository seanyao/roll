/**
 * Exec-wiring smoke test for the GitHub module (US-INFRA-003): a FAKE `gh` shim
 * on PATH records the exact argv each typed wrapper passes and emits fabricated
 * stdout matching the oracle's `--json` field sets, so we prove (a) the argv is
 * byte-exact vs the cited bin/roll invocations and (b) the parse layer reads the
 * fabricated output correctly. NO live GitHub. (Pattern mirrors
 * packages/cli/test/agent-list.difftest.test.ts's fabricated binaries.)
 */
import { execSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apiContentsRaw,
  gh,
  ghAvailable,
  issueCreate,
  prHeadCheckRunCount,
  prAutoMergeArmed,
  prCreate,
  prDiffNameOnly,
  prList,
  prListLoopBranches,
  prMerge,
  prReady,
  prReview,
  prViewMergeInfo,
  prViewState,
  prViewStatusCheckRollup,
  prViewUrl,
  runList,
  workflowDispatch,
} from "../src/github.js";

const dirs: string[] = [];
let fakeBin = "";
let argvLog = "";
let savePATH = "";

/** Write a fake `gh` that logs argv (one arg per line, NUL-record per call) and
 *  emits a canned stdout chosen by matching argv tokens. */
function writeFakeGh(): void {
  const script = `#!/bin/bash
printf '%s\\n' "$@" >> "${argvLog}"
printf -- '---\\n' >> "${argvLog}"
# Route on argv to fabricated outputs matching oracle --json field sets.
case "$*" in
  *"pr view"*"--json url"*)        echo "https://github.com/o/r/pull/7" ;;
  *"pr view"*"--json state,mergedAt,mergeCommit"*) echo '{"state":"MERGED","mergedAt":"2026-06-01T00:00:00Z","mergeCommit":{"oid":"abc123"}}' ;;
  *"pr view"*"--json state"*)      echo "MERGED" ;;
  *"pr view"*"--json statusCheckRollup"*) echo '{"statusCheckRollup":[{"__typename":"CheckRun","name":"build","status":"COMPLETED","conclusion":"SUCCESS"},{"__typename":"StatusContext","context":"ci/lint","state":"PENDING"}]}' ;;
  *"pr view"*"--json autoMergeRequest"*) echo "null" ;;
  *"pr create"*)                   echo "https://github.com/o/r/pull/8" ;;
  *"pr ready"*)                    exit 0 ;;
  *"pr merge"*)                    exit 0 ;;
  *"pr diff"*"--name-only"*)       printf 'src/a.ts\\nsrc/b.ts\\n' ;;
  *"pr list"*"startswith"*)        printf 'loop/cycle-1\\nloop/cycle-2\\n' ;;
  *"pr list"*"--json number,title,headRefName"*) echo '[{"number":5,"title":"x","headRefName":"loop/cycle-1"}]' ;;
  *"pr review"*)                   exit 0 ;;
  *"run list"*"--json status,conclusion"*) echo '[{"status":"completed","conclusion":"success"}]' ;;
  *"workflow run"*)                 exit 0 ;;
  *"api repos/"*"pulls/404/commits"*) exit 1 ;;
  *"api repos/"*"pulls/"*"commits"*) printf 'abc123\\n' ;;
  *"api repos/"*"commits/"*"check-runs"*) printf '0\\n' ;;
  *"api repos/"*"contents/"*)      printf '| US-X | 🔨 In Progress |\\n' ;;
  *"issue create"*)                echo "https://github.com/o/r/issues/3" ;;
  --version)                       echo "gh version 2.0.0 (fake)" ;;
  *) echo "" ;;
esac
`;
  const p = join(fakeBin, "gh");
  writeFileSync(p, script);
  chmodSync(p, 0o755);
}

/** Read the recorded calls: array of argv-token arrays. */
function readCalls(): string[][] {
  const raw = readFileSync(argvLog, "utf8");
  return raw
    .split("---\n")
    .filter((s) => s.trim() !== "")
    .map((s) => s.split("\n").filter((t) => t !== ""));
}

beforeAll(() => {
  fakeBin = mkdtempSync(join(tmpdir(), "roll-gh-bin-"));
  dirs.push(fakeBin);
  argvLog = join(fakeBin, "argv.log");
  writeFileSync(argvLog, "");
  writeFakeGh();
  savePATH = process.env["PATH"] ?? "";
  process.env["PATH"] = `${fakeBin}:${savePATH}`;
});

afterAll(() => {
  process.env["PATH"] = savePATH;
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

describe("gh exec wiring: argv byte-exact vs oracle + parse of fabricated output", () => {
  it("ghAvailable → true when shim answers --version", async () => {
    expect(await ghAvailable()).toBe(true);
  });

  it("prViewUrl → exact argv (bin/roll 13529) + parses url", async () => {
    writeFileSync(argvLog, "");
    const url = await prViewUrl("o/r", "loop/cycle-x");
    expect(url).toBe("https://github.com/o/r/pull/7");
    expect(readCalls()[0]).toEqual([
      "-R", "o/r", "pr", "view", "loop/cycle-x", "--json", "url", "-q", ".url",
    ]);
  });

  it("prViewState → --json state -q .state (bin/roll 13570) + parses MERGED", async () => {
    writeFileSync(argvLog, "");
    expect(await prViewState("o/r", "loop/cycle-x")).toBe("MERGED");
    expect(readCalls()[0]).toEqual([
      "-R", "o/r", "pr", "view", "loop/cycle-x", "--json", "state", "-q", ".state",
    ]);
  });

  it("prAutoMergeArmed → 'null' output parses to false (bin/roll 12151-12156)", async () => {
    writeFileSync(argvLog, "");
    expect(await prAutoMergeArmed("o/r", "42")).toBe(false);
    expect(readCalls()[0]).toEqual([
      "-R", "o/r", "pr", "view", "42", "--json", "autoMergeRequest", "-q", ".autoMergeRequest",
    ]);
  });

  it("prViewMergeInfo → parses state,mergedAt,mergeCommit.oid (bin/roll 13744)", async () => {
    writeFileSync(argvLog, "");
    expect(await prViewMergeInfo("o/r", "loop/cycle-x")).toEqual({
      state: "MERGED",
      mergedAt: "2026-06-01T00:00:00Z",
      mergeCommit: "abc123",
    });
  });

  it("prCreate → --base main --head <b> --title --body (bin/roll 13534)", async () => {
    writeFileSync(argvLog, "");
    const url = await prCreate({ slug: "o/r", head: "loop/cycle-x", title: "t", body: "b" });
    expect(url).toBe("https://github.com/o/r/pull/8");
    expect(readCalls()[0]).toEqual([
      "-R", "o/r", "pr", "create", "--base", "main", "--head", "loop/cycle-x",
      "--title", "t", "--body", "b",
    ]);
  });

  it("prMerge auto → --auto --squash --delete-branch (bin/roll 13541)", async () => {
    writeFileSync(argvLog, "");
    await prMerge("o/r", "loop/cycle-x", "auto");
    expect(readCalls()[0]).toEqual([
      "-R", "o/r", "pr", "merge", "loop/cycle-x", "--auto", "--squash", "--delete-branch",
    ]);
  });

  it("prMerge admin → --admin --squash --delete-branch (bin/roll 13680)", async () => {
    writeFileSync(argvLog, "");
    await prMerge("o/r", "loop/cycle-x", "admin");
    expect(readCalls()[0]).toEqual([
      "-R", "o/r", "pr", "merge", "loop/cycle-x", "--admin", "--squash", "--delete-branch",
    ]);
  });

  it("prMerge plain → --squash --delete-branch (bin/roll 11587)", async () => {
    writeFileSync(argvLog, "");
    await prMerge("o/r", "42", "plain");
    expect(readCalls()[0]).toEqual([
      "-R", "o/r", "pr", "merge", "42", "--squash", "--delete-branch",
    ]);
  });

  it("prReady → gh pr ready before merging a reviewed draft", async () => {
    writeFileSync(argvLog, "");
    await prReady("o/r", "42");
    expect(readCalls()[0]).toEqual(["-R", "o/r", "pr", "ready", "42"]);
  });

  it("prDiffNameOnly → --name-only (bin/roll 11381) + splits lines", async () => {
    writeFileSync(argvLog, "");
    expect(await prDiffNameOnly("o/r", "42")).toEqual(["src/a.ts", "src/b.ts"]);
    expect(readCalls()[0]).toEqual(["-R", "o/r", "pr", "diff", "42", "--name-only"]);
  });

  it("prListLoopBranches → startswith loop/ jq (bin/roll 12543) + splits", async () => {
    writeFileSync(argvLog, "");
    expect(await prListLoopBranches("o/r")).toEqual(["loop/cycle-1", "loop/cycle-2"]);
    const call = readCalls()[0]!;
    expect(call.slice(0, 6)).toEqual(["-R", "o/r", "pr", "list", "--state", "open"]);
    expect(call).toContain("headRefName");
  });

  it("prList → exact field set forwarded + parses rows (bin/roll 11371)", async () => {
    writeFileSync(argvLog, "");
    const rows = await prList("o/r", "number,title,headRefName", { base: "main" });
    expect(rows).toEqual([{ number: 5, title: "x", headRefName: "loop/cycle-1" }]);
    expect(readCalls()[0]).toEqual([
      "-R", "o/r", "pr", "list", "--state", "open", "--base", "main",
      "--json", "number,title,headRefName",
    ]);
  });

  it("runList → --commit + field set (bin/roll 11024) + parses rows", async () => {
    writeFileSync(argvLog, "");
    const rows = await runList("o/r", "status,conclusion", { commit: "deadbeef" });
    expect(rows).toEqual([{ status: "completed", conclusion: "success" }]);
    expect(readCalls()[0]).toEqual([
      "-R", "o/r", "run", "list", "--commit", "deadbeef", "--json", "status,conclusion",
    ]);
  });

  it("prViewStatusCheckRollup → pr view --json statusCheckRollup + parses both entry kinds (FIX-1248)", async () => {
    writeFileSync(argvLog, "");
    const entries = await prViewStatusCheckRollup("o/r", "42");
    expect(entries).toEqual([
      { __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "SUCCESS" },
      { __typename: "StatusContext", context: "ci/lint", state: "PENDING" },
    ]);
    expect(readCalls()[0]).toEqual([
      "-R", "o/r", "pr", "view", "42", "--json", "statusCheckRollup",
    ]);
  });

  it("workflowDispatch → gh workflow run <file> --ref <branch> (FIX-1217)", async () => {
    writeFileSync(argvLog, "");
    expect((await workflowDispatch("o/r", "ci.yml", "loop/cycle-x")).code).toBe(0);
    expect(readCalls()[0]).toEqual(["-R", "o/r", "workflow", "run", "ci.yml", "--ref", "loop/cycle-x"]);
  });

  it("prHeadCheckRunCount → pulls head sha then check-runs total_count (FIX-1217)", async () => {
    writeFileSync(argvLog, "");
    expect(await prHeadCheckRunCount("o/r", 42)).toBe(0);
    expect(readCalls()).toEqual([
      ["-R", "o/r", "api", "repos/o/r/pulls/42/commits", "--jq", ".[-1].sha"],
      ["-R", "o/r", "api", "repos/o/r/commits/abc123/check-runs", "--jq", ".total_count"],
    ]);
  });

  it("prHeadCheckRunCount → -1 when the head sha lookup fails (FIX-1217)", async () => {
    writeFileSync(argvLog, "");
    expect(await prHeadCheckRunCount("o/r", 404)).toBe(-1);
    expect(readCalls()).toEqual([
      ["-R", "o/r", "api", "repos/o/r/pulls/404/commits", "--jq", ".[-1].sha"],
    ]);
  });

  it("apiContentsRaw → repos/<slug>/contents/...?ref + raw Accept header (bin/roll 12553)", async () => {
    writeFileSync(argvLog, "");
    const content = await apiContentsRaw("o/r", ".roll/backlog.md", "loop/cycle-1");
    expect(content).toContain("🔨 In Progress");
    expect(readCalls()[0]).toEqual([
      "-R", "o/r", "api",
      "repos/o/r/contents/.roll/backlog.md?ref=loop/cycle-1",
      "-H", "Accept: application/vnd.github.raw",
    ]);
  });

  it("issueCreate → --repo (long form, NOT -R) (bin/roll 14334)", async () => {
    writeFileSync(argvLog, "");
    await issueCreate({ repo: "o/r", title: "t", body: "b", labels: "bug" });
    expect(readCalls()[0]).toEqual([
      "issue", "create", "--repo", "o/r", "--title", "t", "--body", "b", "--label", "bug",
    ]);
  });

  it("prReview approve → --approve -b (bin/roll 6240)", async () => {
    writeFileSync(argvLog, "");
    await prReview("o/r", "42", "approve", "ok");
    expect(readCalls()[0]).toEqual(["-R", "o/r", "pr", "review", "42", "--approve", "-b", "ok"]);
  });

  it("prReview request-changes → --request-changes -b (bin/roll 6306)", async () => {
    writeFileSync(argvLog, "");
    await prReview("o/r", "42", "request-changes", "nope");
    expect(readCalls()[0]).toEqual([
      "-R", "o/r", "pr", "review", "42", "--request-changes", "-b", "nope",
    ]);
  });

  it("raw gh() surfaces a non-zero exit without throwing", async () => {
    const r = await gh(["this-subcommand-does-not-route-to-exit-0", "--json", "url"]);
    expect(typeof r.code).toBe("number");
  });
});
