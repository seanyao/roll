/**
 * US-DOSSIER-028 — projects.json registry generator + `roll ls`.
 *
 * Covers: the write-side upsert (other projects' rows survive, no duplicates,
 * deterministic sort), the missing/stale classifier (fail-loud, both still
 * listed), the bilingual table render (en/zh, header + legend separate lines),
 * and the command (--json echoes the file verbatim, empty registry, bad flags).
 * Time is PINNED everywhere (the +8 difftest false-green trap, MEMORY): the
 * render takes injected nowMs/staleMs and an injected pathExists, so the same
 * rows render byte-identically on any machine in any timezone.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_STALE_DAYS,
  lsCommand,
  projectStatus,
  renderProjectsTable,
  type ProjectStatus,
} from "../src/commands/ls.js";
import {
  collectProjectsRegistry,
  projectsRegistryPath,
  serializeProjectsRegistry,
  upsertProjectRow,
  writeProjectRow,
} from "../src/lib/projects-registry.js";
import type { ProjectRegistryEntry } from "../src/lib/truth-console.js";
import { stripAnsi } from "../src/render.js";

const homes: string[] = [];
afterEach(() => {
  for (const d of homes.splice(0)) rmSync(d, { recursive: true, force: true });
  delete process.env["ROLL_LANG"];
  delete process.env["NO_COLOR"];
  delete process.env["HOME"];
});

const NOW = Date.parse("2026-06-13T12:00:00Z");
const DAY = 86400000;

function freshHome(): string {
  const h = mkdtempSync(join(tmpdir(), "roll-ls-"));
  homes.push(h);
  return h;
}

const ALPHA: ProjectRegistryEntry = {
  name: "alpha",
  slug: "alpha-1",
  path: "/exists/alpha",
  releaseTag: "v3.1.0",
  verdict: "pass",
  lastIndexedAt: "2026-06-13T11:00:00Z",
};
const BETA: ProjectRegistryEntry = {
  name: "beta",
  slug: "beta-2",
  path: "/gone/beta",
  verdict: "fail",
  lastIndexedAt: "2026-05-01T00:00:00Z",
};

const existsOnly =
  (...present: string[]) =>
  (p: string): boolean =>
    present.includes(p);

describe("upsertProjectRow — AC1 shared machine file, no row dropped", () => {
  it("appends a new slug and re-sorts by name then slug", () => {
    const out = upsertProjectRow([ALPHA], BETA);
    expect(out.map((r) => r.slug)).toEqual(["alpha-1", "beta-2"]);
  });

  it("replaces the row with a matching slug (no duplicate), keeps others", () => {
    const start = upsertProjectRow([ALPHA], BETA);
    const updated = upsertProjectRow(start, { ...BETA, verdict: "warn", releaseTag: "v9" });
    expect(updated).toHaveLength(2);
    const beta = updated.find((r) => r.slug === "beta-2");
    expect(beta).toMatchObject({ verdict: "warn", releaseTag: "v9" });
    // alpha untouched
    expect(updated.find((r) => r.slug === "alpha-1")).toEqual(ALPHA);
  });
});

describe("writeProjectRow — atomic read-modify-write of ~/.roll/projects.json", () => {
  it("creates the file + ~/.roll dir on first write", () => {
    const home = freshHome();
    writeProjectRow(ALPHA, home);
    const text = readFileSync(projectsRegistryPath(home), "utf8");
    expect(text).toBe(serializeProjectsRegistry([ALPHA]));
  });

  it("AC1: a second project's index never drops the first project's row", () => {
    const home = freshHome();
    writeProjectRow(ALPHA, home);
    writeProjectRow(BETA, home);
    const rows = collectProjectsRegistry(home);
    expect(rows.map((r) => r.slug)).toEqual(["alpha-1", "beta-2"]);
  });

  it("re-indexing the SAME slug refreshes its row in place (last-writer-wins)", () => {
    const home = freshHome();
    writeProjectRow(BETA, home);
    writeProjectRow({ ...BETA, verdict: "pass", lastIndexedAt: NOW_ISO() }, home);
    const rows = collectProjectsRegistry(home);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ slug: "beta-2", verdict: "pass" });
  });
});

function NOW_ISO(): string {
  return new Date(NOW).toISOString();
}

describe("projectStatus — AC4 fail-loud classifier", () => {
  it("missing when the path no longer exists (wins over staleness)", () => {
    const s: ProjectStatus = projectStatus(BETA, NOW, 14 * DAY, existsOnly());
    expect(s).toBe("missing");
  });

  it("stale when lastIndexedAt is older than the horizon", () => {
    const s = projectStatus({ ...ALPHA, lastIndexedAt: "2026-05-01T00:00:00Z" }, NOW, 14 * DAY, existsOnly(ALPHA.path));
    expect(s).toBe("stale");
  });

  it("stale when lastIndexedAt is absent or unparseable", () => {
    expect(projectStatus({ name: "n", slug: "s", path: "/p" }, NOW, 14 * DAY, existsOnly("/p"))).toBe("stale");
    expect(projectStatus({ name: "n", slug: "s", path: "/p", lastIndexedAt: "nope" }, NOW, 14 * DAY, existsOnly("/p"))).toBe("stale");
  });

  it("ok when path exists and recently indexed", () => {
    expect(projectStatus(ALPHA, NOW, 14 * DAY, existsOnly(ALPHA.path))).toBe("ok");
  });
});

describe("renderProjectsTable — AC2/AC4/AC5", () => {
  const rows = [ALPHA, BETA];
  const present = existsOnly(ALPHA.path); // alpha exists, beta missing

  it("AC2: lists every project with name·tag·verdict·path", () => {
    const out = stripAnsi(renderProjectsTable(rows, "en", NOW, 14 * DAY, present));
    expect(out).toContain("alpha");
    expect(out).toContain("v3.1.0");
    expect(out).toContain("pass");
    expect(out).toContain("/exists/alpha");
    expect(out).toContain("beta");
  });

  it("AC4: missing + stale both flagged and BOTH still listed", () => {
    // alpha is path-present but stale (indexed 2026-06-13T11:00 vs now, horizon 0.001 day)
    const out = stripAnsi(renderProjectsTable(rows, "en", NOW, 0.001 * DAY, present));
    expect(out).toContain("[missing]"); // beta
    expect(out).toContain("[stale]"); // alpha
    expect(out).toContain("alpha");
    expect(out).toContain("beta");
    expect(out).toContain("[missing] path no longer exists");
    expect(out).toContain("[stale] not re-indexed in over");
  });

  it("AC5: zh legend localized, EN/中 never inline (legend lines are single-language)", () => {
    const out = stripAnsi(renderProjectsTable(rows, "zh", NOW, 0.001 * DAY, present));
    expect(out).toContain("[缺失] 路径已不存在");
    expect(out).toContain("[过期]");
    // no inline EN+中 on a legend line
    expect(out).not.toMatch(/missing.*缺失/);
  });

  it("empty registry prints an honest hint, not a blank table", () => {
    const en = renderProjectsTable([], "en", NOW, 14 * DAY, present);
    expect(en).toContain("registry is empty");
    const zh = renderProjectsTable([], "zh", NOW, 14 * DAY, present);
    expect(zh).toContain("注册表为空");
  });

  it("AC5: deterministic en/zh snapshots (color scrubbed, time pinned)", () => {
    expect(stripAnsi(renderProjectsTable(rows, "en", NOW, 14 * DAY, present))).toMatchSnapshot();
    expect(stripAnsi(renderProjectsTable(rows, "zh", NOW, 14 * DAY, present))).toMatchSnapshot();
  });

  it("DEFAULT_STALE_DAYS is the documented 14-day horizon", () => {
    expect(DEFAULT_STALE_DAYS).toBe(14);
  });
});

describe("lsCommand — AC2 command surface", () => {
  function captureStdout(fn: () => number): { code: number; out: string } {
    let out = "";
    const so = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string) => ((out += s), true)) as typeof process.stdout.write;
    try {
      return { code: fn(), out };
    } finally {
      process.stdout.write = so;
    }
  }

  it("AC2: --json echoes ~/.roll/projects.json VERBATIM (byte-for-byte)", () => {
    const home = freshHome();
    writeProjectRow(ALPHA, home);
    writeProjectRow(BETA, home);
    process.env["HOME"] = home;
    const fileText = readFileSync(projectsRegistryPath(home), "utf8");
    const { code, out } = captureStdout(() => lsCommand(["--json", "--no-color"]));
    expect(code).toBe(0);
    expect(out).toBe(fileText);
  });

  it("--json on an absent registry is an empty array, never an error", () => {
    process.env["HOME"] = freshHome();
    const { code, out } = captureStdout(() => lsCommand(["--json", "--no-color"]));
    expect(code).toBe(0);
    expect(out.trim()).toBe("[]");
  });

  it("--help returns 0 with bilingual usage on separate lines", () => {
    const { code, out } = captureStdout(() => lsCommand(["--help"]));
    expect(code).toBe(0);
    expect(out).toContain("Usage: roll ls");
    expect(out).toContain("列出跨项目注册表");
  });

  it("illegal --stale-days fails loud (exit 1)", () => {
    process.env["HOME"] = freshHome();
    let err = "";
    const se = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((s: string) => ((err += s), true)) as typeof process.stderr.write;
    try {
      expect(lsCommand(["--stale-days", "nope", "--no-color"])).toBe(1);
    } finally {
      process.stderr.write = se;
    }
    expect(err).toContain("illegal --stale-days");
  });

  it("unknown flag fails loud (exit 1)", () => {
    process.env["HOME"] = freshHome();
    let err = "";
    const se = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((s: string) => ((err += s), true)) as typeof process.stderr.write;
    try {
      expect(lsCommand(["--bogus", "--no-color"])).toBe(1);
    } finally {
      process.stderr.write = se;
    }
    expect(err).toContain("unknown flag");
  });
});
