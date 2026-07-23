/**
 * FIX-1475 — specPathFromBacklogLine reads the spec link from the row whose
 * FIRST id cell is EXACTLY `[id](link)`, never a whole-line match that a
 * description link to `[id](other.md)` on another row could hijack.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { specPathFromBacklogLine } from "../src/runner/pick-ranking.js";

describe("specPathFromBacklogLine (FIX-1475 exact id-cell)", () => {
  const CWD = "/proj";

  it("returns the spec link from the EXACT id-cell row, not another row that links to [id] in its description", () => {
    const backlog = [
      "| ID | Description | Status |",
      "|----|----|----|",
      "| [US-9](.roll/features/x/US-9/spec.md) | supersedes [FIX-300](docs/legacy.md) | 📋 Todo |",
      "| [FIX-300](.roll/features/loop-engine/FIX-300/spec.md) | the real card | 📋 Todo |",
      "",
    ].join("\n");
    expect(specPathFromBacklogLine(CWD, backlog, "FIX-300")).toBe(
      join(CWD, ".roll/features/loop-engine/FIX-300/spec.md"),
    );
  });

  it("does not confuse a `<id>-` descendant id cell for the exact id", () => {
    const backlog = [
      "| [FIX-300-legacy](.roll/features/x/FIX-300-legacy/spec.md) | descendant | ✅ Done |",
      "| [FIX-300](.roll/features/loop-engine/FIX-300/spec.md) | real | 📋 Todo |",
      "",
    ].join("\n");
    expect(specPathFromBacklogLine(CWD, backlog, "FIX-300")).toBe(
      join(CWD, ".roll/features/loop-engine/FIX-300/spec.md"),
    );
  });

  it("absolute spec links are returned verbatim; a missing id yields undefined", () => {
    const backlog = "| [FIX-7](/abs/spec.md) | x | 📋 Todo |\n";
    expect(specPathFromBacklogLine(CWD, backlog, "FIX-7")).toBe("/abs/spec.md");
    expect(specPathFromBacklogLine(CWD, backlog, "FIX-999")).toBeUndefined();
  });
});
