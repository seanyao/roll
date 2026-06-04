/**
 * diff-test: quality-gate.ts == lib/test_quality_gate.py (the frozen oracle).
 *
 * The python gate is a standalone CLI, so we spawn it directly on fixture files
 * and assert the TS port produces (a) the SAME exit verdict and (b) the SAME
 * per-finding output lines. Fixtures are derived from the source's actual
 * dimensions (lib/test_quality_gate.py 29-46): ❼ inline external-tool, ❽
 * outside-repo path, plus every skip rule (heredoc / comment / @test /
 * test-quality:allow / BATS_TMPDIR) and the --skip / missing-file paths.
 *
 * CLI contract (py 117-139):
 *   python3 lib/test_quality_gate.py [--skip] <file>...
 *   exit 0 clean|--skip · 1 ≥1 finding · 2 no files · stdout `f:n: kind snippet`
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { type GateInput, formatFindings, gateVerdict } from "../src/loop/quality-gate.js";

const REPO = resolve(__dirname, "../../..");
const ORACLE = `${REPO}/lib/test_quality_gate.py`;

/** Run the python oracle; return its stdout lines + exit code. */
function runOracle(args: string[]): { lines: string[]; code: number } {
  const r = spawnSync("python3", [ORACLE, ...args], { encoding: "utf8" });
  const lines = r.stdout.split("\n").filter((l) => l.length > 0);
  return { lines, code: r.status ?? -1 };
}

/** Write fixtures to a temp dir and return their absolute paths. */
function withFixtures<T>(files: Record<string, string>, fn: (paths: Record<string, string>) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "qg-"));
  try {
    const paths: Record<string, string> = {};
    for (const [name, content] of Object.entries(files)) {
      const p = join(dir, name);
      writeFileSync(p, content, "utf8");
      paths[name] = p;
    }
    return fn(paths);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The fixtures: each exercises a specific oracle branch.
const FIXTURES: Record<string, { content: string; note: string }> = {
  "clean.bats": {
    note: "lone grep -q + plain assertions → no findings (pass)",
    content: ["@test 'login works' {", "  run login", '  [ "$status" -eq 0 ]', "  echo ok | grep -q ok", "}", ""].join("\n"),
  },
  "tool_sed.bats": {
    note: "❼ sed substitution",
    content: ["@test 'x' {", "  echo a | sed 's/a/b/'", "}", ""].join("\n"),
  },
  "tool_awk_grepo_cut_tr_find.bats": {
    note: "❼ awk-script, grep -oE, cut -f, tr -d, find -name",
    content: [
      "@test 'many' {",
      "  echo x | awk '{print $1}'",
      "  echo x | grep -oE 'a'",
      "  echo x | cut -f1",
      "  echo x | tr -d 'a'",
      "  find . -name '*.ts'",
      "}",
      "",
    ].join("\n"),
  },
  "outside_paths.bats": {
    note: "❽ ~/.dotdir + /etc /usr /var",
    content: [
      "@test 'paths' {",
      "  cat ~/.codex/config",
      "  cat /etc/hosts",
      "  ls /usr/local",
      "  ls /var/log",
      "}",
      "",
    ].join("\n"),
  },
  "bats_tmpdir_allow.bats": {
    note: "❽ suppressed when BATS_TMPDIR on the line",
    content: ["@test 'tmp' {", '  cp /etc/x "$BATS_TMPDIR/y"', "}", ""].join("\n"),
  },
  "comment_and_attest_skip.bats": {
    note: "comment + @test line never flag even with patterns",
    content: ["# this comment mentions sed 's/a/b/' and ~/.kimi", "@test 'sed s/a/b/ and ~/.roll in name' {", "  true", "}", ""].join("\n"),
  },
  "allow_marker.bats": {
    note: "test-quality:allow suppresses the whole line",
    content: ["@test 'x' {", "  echo a | sed 's/a/b/' # test-quality:allow", "}", ""].join("\n"),
  },
  "heredoc_body_skip.bats": {
    note: "patterns inside heredoc body are skipped; after terminator they flag",
    content: [
      "@test 'hd' {",
      "  cat <<'EOF'",
      "  sed 's/a/b/' and ~/.codex live here but are data",
      "EOF",
      "  echo x | tr -d 'z'",
      "}",
      "",
    ].join("\n"),
  },
  "both_kinds_one_line.bats": {
    note: "a single line yields BOTH ❼ and ❽",
    content: ["@test 'x' {", "  cat ~/.kimi/f | sed 's/a/b/'", "}", ""].join("\n"),
  },
};

describe("diff-test: quality-gate verdict + output == python oracle", () => {
  it("python3 + oracle are available", () => {
    const v = execFileSync("python3", ["--version"], { encoding: "utf8" });
    expect(v).toMatch(/Python 3/);
  });

  for (const [name, { content, note }] of Object.entries(FIXTURES)) {
    it(`${name} — ${note}`, () => {
      withFixtures({ [name]: content }, (paths) => {
        const p = paths[name] as string;
        const oracle = runOracle([p]);
        const verdict = gateVerdict([{ path: p, text: content }]);
        const tsLines = formatFindings(verdict);
        // exit code: oracle 0 clean / 1 findings ; TS pass ⇒ code 0.
        expect(verdict.pass).toBe(oracle.code === 0);
        // output lines must match exactly (path:lineno: kind snippet).
        expect(tsLines).toEqual(oracle.lines);
      });
    });
  }

  it("multiple files aggregate in input order", () => {
    withFixtures(
      { "a.bats": FIXTURES["tool_sed.bats"]!.content, "b.bats": FIXTURES["outside_paths.bats"]!.content },
      (paths) => {
        const inputs: GateInput[] = [
          { path: paths["a.bats"] as string, text: FIXTURES["tool_sed.bats"]!.content },
          { path: paths["b.bats"] as string, text: FIXTURES["outside_paths.bats"]!.content },
        ];
        const oracle = runOracle([paths["a.bats"] as string, paths["b.bats"] as string]);
        const verdict = gateVerdict(inputs);
        expect(verdict.pass).toBe(oracle.code === 0);
        expect(formatFindings(verdict)).toEqual(oracle.lines);
      },
    );
  });

  it("--skip short-circuits to pass (exit 0, no output)", () => {
    withFixtures({ "dirty.bats": FIXTURES["tool_sed.bats"]!.content }, (paths) => {
      const p = paths["dirty.bats"] as string;
      const oracle = runOracle(["--skip", p]);
      const verdict = gateVerdict([{ path: p, text: FIXTURES["tool_sed.bats"]!.content }], true);
      expect(verdict.pass).toBe(true);
      expect(oracle.code).toBe(0);
      expect(formatFindings(verdict)).toEqual(oracle.lines);
    });
  });

  it("missing file → not-found finding, exit 1 (py 112-113)", () => {
    const missing = join(tmpdir(), "qg-does-not-exist-xyz.bats");
    const oracle = runOracle([missing]);
    const verdict = gateVerdict([{ path: missing, text: undefined }]);
    expect(verdict.pass).toBe(false);
    expect(oracle.code).toBe(1);
    expect(formatFindings(verdict)).toEqual(oracle.lines);
  });
});
