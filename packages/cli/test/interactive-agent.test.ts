/** US-ONBOARD-NUDGE-006 — isPrimaryValid + selectPrimaryAgent behaviour contract. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isPrimaryValid, selectPrimaryAgent, type PrimarySelectionOptions, type PrimarySelectionResult } from "../src/lib/interactive-agent.js";
import { replacePrimaryAgent } from "../src/commands/setup-shared.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function mkHome(): string {
  const h = mkdtempSync(join(tmpdir(), "roll-006-"));
  dirs.push(h);
  mkdirSync(join(h, ".roll"), { recursive: true });
  return h;
}

function mkConfig(home: string, primary: string | null, extraLines: string[] = []): string {
  const cfgPath = join(home, ".roll", "config.yaml");
  const lines = ["# Roll config", "lang: en"];
  if (primary !== null) lines.push(`primary_agent: ${primary}`);
  lines.push(...extraLines);
  writeFileSync(cfgPath, lines.join("\n") + "\n");
  return cfgPath;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function select(opts: Partial<PrimarySelectionOptions> & {
  home: string;
  primary?: string | null;
}): PrimarySelectionResult {
  const home = opts.home;
  process.env["ROLL_HOME"] = join(home, ".roll");
  try {
    return selectPrimaryAgent({
      installed: opts.installed ?? [],
      primary: opts.primary ?? null,
      isTTY: opts.isTTY ?? false,
      reselect: opts.reselect ?? false,
      readLine: opts.readLine ?? (() => null),
    });
  } finally {
    delete process.env["ROLL_HOME"];
  }
}

// ---------------------------------------------------------------------------
// isPrimaryValid
// ---------------------------------------------------------------------------

describe("isPrimaryValid", () => {
  it("returns true when primary is in installed set", () => {
    expect(isPrimaryValid("claude", ["claude", "pi"])).toBe(true);
  });

  it("returns false when primary is not in installed set", () => {
    expect(isPrimaryValid("claude", ["pi", "kimi"])).toBe(false);
  });

  it("returns false for null primary", () => {
    expect(isPrimaryValid(null, ["claude"])).toBe(false);
  });

  it("returns false for empty string primary", () => {
    expect(isPrimaryValid("", ["claude"])).toBe(false);
  });

  it("returns false for empty installed set", () => {
    expect(isPrimaryValid("claude", [])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// selectPrimaryAgent — AC1: available >1, TTY, no valid primary
// ---------------------------------------------------------------------------

describe("selectPrimaryAgent — AC1: interactive selection", () => {
  it("prompts user and returns chosen agent", () => {
    const home = mkHome();
    const { selected, guidance } = select({
      home,
      installed: ["claude", "pi", "kimi"],
      primary: null,
      isTTY: true,
      reselect: false,
      readLine: () => "2",
    });
    expect(selected).toBe("pi");
    expect(guidance).toBeNull();
  });

  it("returns null when user input is null (EOF)", () => {
    const home = mkHome();
    const { selected, guidance } = select({
      home,
      installed: ["claude", "pi"],
      primary: null,
      isTTY: true,
      reselect: false,
      readLine: () => null,
    });
    expect(selected).toBeNull();
    expect(guidance).toBeNull();
  });

  it("returns null for invalid number choice", () => {
    const home = mkHome();
    const { selected, guidance } = select({
      home,
      installed: ["claude", "pi", "kimi"],
      primary: null,
      isTTY: true,
      reselect: false,
      readLine: () => "5",
    });
    expect(selected).toBeNull();
    expect(guidance).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// selectPrimaryAgent — AC2: available == 1, auto-set
// ---------------------------------------------------------------------------

describe("selectPrimaryAgent — AC2: auto-set single agent", () => {
  it("auto-selects the only installed agent when no primary exists", () => {
    const home = mkHome();
    const { selected, guidance } = select({
      home,
      installed: ["claude"],
      primary: null,
      isTTY: true,
      reselect: false,
      readLine: () => null,
    });
    expect(selected).toBe("claude");
    expect(guidance).toBeTruthy();
    expect(guidance).toContain("claude");
  });

  it("auto-selects the only installed agent in non-TTY mode", () => {
    const home = mkHome();
    const { selected, guidance } = select({
      home,
      installed: ["pi"],
      primary: null,
      isTTY: false,
      reselect: false,
      readLine: () => null,
    });
    expect(selected).toBe("pi");
    expect(guidance).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// selectPrimaryAgent — AC3: available == 0 → no selection, guidance
// ---------------------------------------------------------------------------

describe("selectPrimaryAgent — AC3: no agents installed", () => {
  it("returns null selection with install guidance", () => {
    const home = mkHome();
    const { selected, guidance } = select({
      home,
      installed: [],
      primary: null,
      isTTY: true,
      reselect: false,
      readLine: () => null,
    });
    expect(selected).toBeNull();
    expect(guidance).toBeTruthy();
    expect(guidance).toContain("roll agent use");
  });
});

// ---------------------------------------------------------------------------
// selectPrimaryAgent — AC4: valid primary, silently keep
// ---------------------------------------------------------------------------

describe("selectPrimaryAgent — AC4: silent keep when primary valid", () => {
  it("returns null selection and null guidance (silent)", () => {
    const home = mkHome();
    const { selected, guidance } = select({
      home,
      installed: ["claude", "pi", "kimi"],
      primary: "claude",
      isTTY: true,
      reselect: false,
      readLine: () => null,
    });
    expect(selected).toBeNull();
    expect(guidance).toBeNull(); // AC4: silent, no output
  });

  it("silently keeps when available >1 and TTY", () => {
    // Even with multiple agents and interactive TTY, if primary is valid,
    // no prompt should appear (zero-disturbance rerun).
    const home = mkHome();
    const { selected, guidance } = select({
      home,
      installed: ["claude", "pi", "kimi"],
      primary: "pi",
      isTTY: true,
      reselect: false,
      readLine: () => null,
    });
    expect(selected).toBeNull();
    expect(guidance).toBeNull();
  });

  it("reselects when --reselect flag is set (overrides AC4)", () => {
    const home = mkHome();
    const { selected } = select({
      home,
      installed: ["claude", "pi"],
      primary: "claude",
      isTTY: true,
      reselect: true,
      readLine: () => "2",
    });
    expect(selected).toBe("pi");
  });
});

// ---------------------------------------------------------------------------
// selectPrimaryAgent — AC5: non-TTY → deterministic first
// ---------------------------------------------------------------------------

describe("selectPrimaryAgent — AC5: non-TTY deterministic first", () => {
  it("selects first installed agent in registry order when non-TTY", () => {
    const home = mkHome();
    const { selected, guidance } = select({
      home,
      installed: ["claude", "pi", "kimi"],
      primary: null,
      isTTY: false,
      reselect: false,
      readLine: () => null,
    });
    expect(selected).toBe("claude"); // first in order
    expect(guidance).toBeNull(); // No prompt → no guidance needed
  });

  it("deterministic: same input always same output", () => {
    const home = mkHome();
    const opts = {
      home,
      installed: ["pi", "kimi", "claude"],
      primary: null as string | null,
      isTTY: false,
      reselect: false,
      readLine: () => null as string | null,
    };
    const r1 = select(opts);
    const r2 = select({ ...opts, home: mkHome() });
    expect(r1.selected).toBe(r2.selected);
  });
});

// ---------------------------------------------------------------------------
// selectPrimaryAgent — AC6: primary points to removed agent
// ---------------------------------------------------------------------------

describe("selectPrimaryAgent — AC6: removed/uninstalled primary", () => {
  it("re-selects when primary is no longer in installed set (single)", () => {
    const home = mkHome();
    const { selected, guidance } = select({
      home,
      installed: ["claude"],
      primary: "pi", // pi was uninstalled
      isTTY: false,
      reselect: false,
      readLine: () => null,
    });
    expect(selected).toBe("claude");
    expect(guidance).toBeTruthy();
  });

  it("prompts when primary is removed and multiple available (TTY)", () => {
    const home = mkHome();
    const { selected } = select({
      home,
      installed: ["claude", "kimi"],
      primary: "pi", // pi was uninstalled
      isTTY: true,
      reselect: false,
      readLine: () => "1",
    });
    expect(selected).toBe("claude");
  });

  it("uses deterministic first when primary removed and non-TTY", () => {
    const home = mkHome();
    const { selected } = select({
      home,
      installed: ["kimi", "claude"],
      primary: "pi",
      isTTY: false,
      reselect: false,
      readLine: () => null,
    });
    expect(selected).toBe("kimi"); // first in provided order
  });
});

// ---------------------------------------------------------------------------
// AC7: Atomic write is tested via setup-shared replacePrimaryAgent
// (tested in setup.difftest.test.ts — config is written atomically)
// ---------------------------------------------------------------------------

describe("replacePrimaryAgent — AC7: atomic write", () => {
  it("preserves unknown config fields and writes atomically", () => {
    const home = mkHome();
    const cfgPath = join(home, ".roll", "config.yaml");
    writeFileSync(cfgPath, [
      "# My config",
      "lang: zh",
      "primary_agent: claude",
      "custom_field: keep_me",
      "# a comment",
    ].join("\n") + "\n");

    const saveHome = process.env["ROLL_HOME"];
    process.env["ROLL_HOME"] = join(home, ".roll");
    try {
      replacePrimaryAgent("pi");

      const cfg = readFileSync(cfgPath, "utf8");
      expect(cfg).toContain("primary_agent: pi");
      expect(cfg).toContain("custom_field: keep_me");
      expect(cfg).toContain("# My config");
      expect(cfg).toContain("lang: zh");
      expect(cfg).not.toContain("primary_agent: claude");

      // No tmp file left behind
      const dotRollFiles = readdirSync(join(home, ".roll"));
      const tmpFiles = dotRollFiles.filter((f) => f.startsWith("config.yaml.tmp-"));
      expect(tmpFiles.length).toBe(0);
    } finally {
      if (saveHome === undefined) delete process.env["ROLL_HOME"];
      else process.env["ROLL_HOME"] = saveHome;
    }
  });
});

// ---------------------------------------------------------------------------
// AC8: Consumer reads primary correctly
// (tested in design.test.ts — reads primary_agent from config)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// AC9: Coverage summary
// AC1 — interactive selection with >1 agents (TTY) ✓
// AC2 — auto-set single agent ✓
// AC3 — empty installed → guidance ✓
// AC4 — silent keep when primary valid ✓
// AC5 — non-TTY deterministic first ✓
// AC6 — removed primary triggers re-selection ✓
// AC7 — atomic write (covered by setup difftest) ✓
// AC8 — consumer reads primary (covered by design test) ✓
// ---------------------------------------------------------------------------
