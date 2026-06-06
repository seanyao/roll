import type { BacklogItem } from "@roll/core";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composeBrief } from "@roll/core";
import { beforeAll, describe, expect, it } from "vitest";
import { briefCommand, renderBrief } from "../src/commands/brief.js";
import { renderState, stripAnsi } from "../src/render.js";

function item(id: string, status: string, desc = "the description"): BacklogItem {
  return { id, desc, status };
}

const ITEMS: BacklogItem[] = [
  item("US-A-001", "✅ Done"),
  item("US-A-002", "✅ Done"),
  item("FIX-001", "🔨 In Progress"),
  item("US-B-001", "📋 Todo"),
  item("FIX-002", "📋 Todo"),
  item("US-C-001", "🚫 Hold"),
  item("US-D-001", "🔒 Blocked"),
];

function plain(lines: string[]): string {
  return stripAnsi(lines.join("\n"));
}

describe("renderBrief", () => {
  // Render plain text so assertions key on content, not ANSI.
  beforeAll(() => {
    renderState.useColor = false;
  });

  it("default view folds the completed LIST (count only, no ids)", () => {
    const m = composeBrief(ITEMS, []);
    const out = plain(renderBrief(m, "en", { full: false }, "2026-06-06 15:00"));
    expect(out).toContain("2"); // completed count surfaces
    expect(out).not.toContain("US-A-001"); // but the list is folded away
  });

  it("--full expands the completed and queue lists", () => {
    const m = composeBrief(ITEMS, []);
    const out = plain(renderBrief(m, "en", { full: true }, "2026-06-06 15:00"));
    expect(out).toContain("US-A-001");
    expect(out).toContain("US-B-001"); // queued story listed too
  });

  it("always lists the owner's-call block (alerts + hold + blocked)", () => {
    const m = composeBrief(ITEMS, ["ALERT-roll-x.md"]);
    const out = plain(renderBrief(m, "en", { full: false }, "d"));
    expect(out).toContain("ALERT-roll-x.md");
    expect(out).toContain("US-C-001"); // hold
    expect(out).toContain("US-D-001"); // blocked
  });

  it("shows all-clear + release-ready when nothing needs the owner", () => {
    const m = composeBrief([item("US-X", "✅ Done")], []);
    const out = plain(renderBrief(m, "en", { full: false }, "d"));
    expect(out.toLowerCase()).toContain("all clear");
  });

  it("English output carries no CJK (single-language contract)", () => {
    const m = composeBrief(ITEMS, ["A.md"]);
    const out = plain(renderBrief(m, "en", { full: true }, "2026-06-06 15:00"));
    expect(out).not.toMatch(/[一-鿿]/);
  });

  it("Chinese output carries no English label words (single-language contract)", () => {
    const m = composeBrief(ITEMS, ["A.md"]);
    const out = plain(renderBrief(m, "zh", { full: true }, "2026-06-06 15:00"));
    // Story ids (US-/FIX-) are identifiers, not labels — allow them; assert no
    // English label words like "Completed"/"Pending"/"Shipped" leak through.
    expect(out).not.toMatch(/Completed|Pending|Shipped|In Progress|Attention/);
  });
});

describe("briefCommand (E2E golden path)", () => {
  function run(args: string[], backlog: string): { status: number; stdout: string } {
    const proj = mkdtempSync(join(tmpdir(), "roll-brief-proj-"));
    mkdirSync(join(proj, ".roll"), { recursive: true });
    writeFileSync(join(proj, ".roll", "backlog.md"), backlog, "utf8");
    const save = {
      NO_COLOR: process.env["NO_COLOR"],
      ROLL_LANG: process.env["ROLL_LANG"],
      SLUG: process.env["ROLL_MAIN_SLUG"],
    };
    process.env["NO_COLOR"] = "1";
    process.env["ROLL_LANG"] = "en";
    delete process.env["ROLL_MAIN_SLUG"]; // no ALERT lookup in the sandbox
    const saveCwd = process.cwd();
    process.chdir(proj);
    const outC: string[] = [];
    const rOut = process.stdout.write.bind(process.stdout);
    // @ts-expect-error capture-only
    process.stdout.write = (x: string | Uint8Array): boolean => (outC.push(String(x)), true);
    let status: number;
    try {
      status = briefCommand(args);
    } finally {
      process.stdout.write = rOut;
      process.chdir(saveCwd);
      rmSync(proj, { recursive: true, force: true });
      if (save.NO_COLOR === undefined) delete process.env["NO_COLOR"];
      else process.env["NO_COLOR"] = save.NO_COLOR;
      if (save.ROLL_LANG === undefined) delete process.env["ROLL_LANG"];
      else process.env["ROLL_LANG"] = save.ROLL_LANG;
      if (save.SLUG !== undefined) process.env["ROLL_MAIN_SLUG"] = save.SLUG;
    }
    return { status, stdout: stripAnsi(outC.join("")) };
  }

  const BACKLOG = [
    "| Story | Description | Status |",
    "|-------|-------------|--------|",
    "| US-A-001 | shipped one | ✅ Done (PR#1) |",
    "| FIX-001 | a live fix | 🔨 In Progress |",
    "| US-B-001 | queued story | 📋 Todo |",
    "| US-C-001 | parked | 🚫 Hold |",
    "",
  ].join("\n");

  it("reads .roll/backlog.md and renders the digest (exit 0)", () => {
    const r = run([], BACKLOG);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Completed (1 items)");
    expect(r.stdout).toContain("FIX-001"); // in-progress always listed
    expect(r.stdout).toContain("US-C-001"); // hold surfaces in the owner block
    expect(r.stdout).not.toContain("US-A-001"); // completed list folded by default
  });

  it("--full expands the folded lists", () => {
    const r = run(["--full"], BACKLOG);
    expect(r.stdout).toContain("US-A-001");
    expect(r.stdout).toContain("US-B-001");
  });

  it("errors when no backlog exists", () => {
    const proj = mkdtempSync(join(tmpdir(), "roll-brief-empty-"));
    const saveCwd = process.cwd();
    process.chdir(proj);
    try {
      expect(briefCommand([])).toBe(1);
    } finally {
      process.chdir(saveCwd);
      rmSync(proj, { recursive: true, force: true });
    }
  });
});
