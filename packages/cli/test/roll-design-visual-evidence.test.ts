import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "../../..");

describe("roll-design visual evidence discipline", () => {
  it("makes visual evidence AC a hard design gate in the hub and full contract", () => {
    const hub = readFileSync(join(repoRoot, "skills/roll-design/SKILL.md"), "utf8");
    const fullContract = readFileSync(
      join(repoRoot, "skills/roll-design/references/full-contract.md"),
      "utf8",
    );

    expect(hub).toContain("Visual-evidence AC is mandatory for every story");
    expect(hub).toContain("INCOMPLETE");
    expect(hub).toContain("Missing screenshot AC = design flaw");

    expect(fullContract).toContain("Visual-Evidence AC Discipline");
    expect(fullContract).toContain("**[visual-evidence]**");
    expect(fullContract).toContain("**[visual-evidence — EXEMPT]**");
    expect(fullContract).toContain("A recorded exemption is **required**");
    expect(fullContract).toContain("If neither is present → the story spec is INCOMPLETE");
  });
});
