/**
 * Frozen-expectation test: quality-gate.ts.
 *
 * `gateVerdict` + `formatFindings` were proven equal to the python oracle
 * `lib/test_quality_gate.py` under diff-test (same exit verdict + same
 * `path:lineno: kind snippet` lines). Per US-PORT-009b the oracle is retired:
 * the `python3` spawn AND the temp-file fixtures are dropped. `gateVerdict` is a
 * pure function over (path string, file text) — so we feed FIXED `/fix/<name>`
 * paths (no `mkdtemp`, no machine-specific tmp prefix) and assert the frozen
 * verdict + finding lines captured while the oracle agreed. Fixed paths keep the
 * frozen output portable (macOS `/private/tmp` vs Linux `/tmp` would not be).
 *
 * Fixtures exercise the source's dimensions (lib/test_quality_gate.py 29-46): ❼
 * inline external-tool, ❽ outside-repo path, plus every skip rule (heredoc /
 * comment / @test / test-quality:allow / BATS_TMPDIR), --skip, and missing-file.
 */
import { describe, expect, it } from "vitest";
import { type GateInput, formatFindings, gateVerdict } from "../src/loop/quality-gate.js";

const CONTENT: Record<string, string> = {
  clean: ["@test 'login works' {", "  run login", '  [ "$status" -eq 0 ]', "  echo ok | grep -q ok", "}", ""].join("\n"),
  tool_sed: ["@test 'x' {", "  echo a | sed 's/a/b/'", "}", ""].join("\n"),
  tool_many: ["@test 'many' {", "  echo x | awk '{print $1}'", "  echo x | grep -oE 'a'", "  echo x | cut -f1", "  echo x | tr -d 'a'", "  find . -name '*.ts'", "}", ""].join("\n"),
  outside: ["@test 'paths' {", "  cat ~/.codex/config", "  cat /etc/hosts", "  ls /usr/local", "  ls /var/log", "}", ""].join("\n"),
  bats_tmpdir: ["@test 'tmp' {", '  cp /etc/x "$BATS_TMPDIR/y"', "}", ""].join("\n"),
  comment_skip: ["# this comment mentions sed 's/a/b/' and ~/.kimi", "@test 'sed s/a/b/ and ~/.roll in name' {", "  true", "}", ""].join("\n"),
  allow_marker: ["@test 'x' {", "  echo a | sed 's/a/b/' # test-quality:allow", "}", ""].join("\n"),
  heredoc: ["@test 'hd' {", "  cat <<'EOF'", "  sed 's/a/b/' and ~/.codex live here but are data", "EOF", "  echo x | tr -d 'z'", "}", ""].join("\n"),
  both_kinds: ["@test 'x' {", "  cat ~/.kimi/f | sed 's/a/b/'", "}", ""].join("\n"),
};

describe("frozen: quality-gate verdict + output == python oracle", () => {
  const CASES: Array<{ name: string; path: string; key: string; pass: boolean; lines: string[] }> = [
    { name: "clean → pass", path: "/fix/clean.bats", key: "clean", pass: true, lines: [] },
    { name: "❼ sed substitution", path: "/fix/tool_sed.bats", key: "tool_sed", pass: false, lines: ["/fix/tool_sed.bats:2: ❼ echo a | sed 's/a/b/'"] },
    {
      name: "❼ awk/grep -oE/cut/tr/find", path: "/fix/tool_awk_grepo_cut_tr_find.bats", key: "tool_many", pass: false,
      lines: [
        "/fix/tool_awk_grepo_cut_tr_find.bats:2: ❼ echo x | awk '{print $1}'",
        "/fix/tool_awk_grepo_cut_tr_find.bats:3: ❼ echo x | grep -oE 'a'",
        "/fix/tool_awk_grepo_cut_tr_find.bats:4: ❼ echo x | cut -f1",
        "/fix/tool_awk_grepo_cut_tr_find.bats:5: ❼ echo x | tr -d 'a'",
        "/fix/tool_awk_grepo_cut_tr_find.bats:6: ❼ find . -name '*.ts'",
      ],
    },
    {
      name: "❽ outside-repo paths", path: "/fix/outside_paths.bats", key: "outside", pass: false,
      lines: [
        "/fix/outside_paths.bats:2: ❽ cat ~/.codex/config",
        "/fix/outside_paths.bats:3: ❽ cat /etc/hosts",
        "/fix/outside_paths.bats:4: ❽ ls /usr/local",
        "/fix/outside_paths.bats:5: ❽ ls /var/log",
      ],
    },
    { name: "❽ suppressed by BATS_TMPDIR on the line", path: "/fix/bats_tmpdir_allow.bats", key: "bats_tmpdir", pass: true, lines: [] },
    { name: "comment + @test line never flag", path: "/fix/comment_and_attest_skip.bats", key: "comment_skip", pass: true, lines: [] },
    { name: "test-quality:allow suppresses the line", path: "/fix/allow_marker.bats", key: "allow_marker", pass: true, lines: [] },
    { name: "heredoc body skipped; after terminator flags", path: "/fix/heredoc_body_skip.bats", key: "heredoc", pass: false, lines: ["/fix/heredoc_body_skip.bats:5: ❼ echo x | tr -d 'z'"] },
    {
      name: "single line yields BOTH ❼ and ❽", path: "/fix/both_kinds_one_line.bats", key: "both_kinds", pass: false,
      lines: [
        "/fix/both_kinds_one_line.bats:2: ❼ cat ~/.kimi/f | sed 's/a/b/'",
        "/fix/both_kinds_one_line.bats:2: ❽ cat ~/.kimi/f | sed 's/a/b/'",
      ],
    },
  ];

  for (const c of CASES) {
    it(c.name, () => {
      const v = gateVerdict([{ path: c.path, text: CONTENT[c.key] }]);
      expect(v.pass).toBe(c.pass);
      expect(formatFindings(v)).toEqual(c.lines);
    });
  }

  it("multiple files aggregate in input order", () => {
    const inputs: GateInput[] = [
      { path: "/fix/a.bats", text: CONTENT.tool_sed },
      { path: "/fix/b.bats", text: CONTENT.outside },
    ];
    const v = gateVerdict(inputs);
    expect(v.pass).toBe(false);
    expect(formatFindings(v)).toEqual([
      "/fix/a.bats:2: ❼ echo a | sed 's/a/b/'",
      "/fix/b.bats:2: ❽ cat ~/.codex/config",
      "/fix/b.bats:3: ❽ cat /etc/hosts",
      "/fix/b.bats:4: ❽ ls /usr/local",
      "/fix/b.bats:5: ❽ ls /var/log",
    ]);
  });

  it("--skip short-circuits to pass (no output)", () => {
    const v = gateVerdict([{ path: "/fix/dirty.bats", text: CONTENT.tool_sed }], true);
    expect(v.pass).toBe(true);
    expect(formatFindings(v)).toEqual([]);
  });

  it("missing file → not-found finding, fail", () => {
    const v = gateVerdict([{ path: "/fix/missing.bats", text: undefined }]);
    expect(v.pass).toBe(false);
    expect(formatFindings(v)).toEqual(["/fix/missing.bats:0: ? file not found: /fix/missing.bats"]);
  });
});
