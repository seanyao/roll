/**
 * E2 — spec-frontmatter reader for the per-story `target_submodule:` field.
 *
 * A submodule story declares its target either in the backlog row tag
 * (`target-submodule:…`, parsed by core parseTargetSubmodule) OR in its
 * spec.md frontmatter (`target_submodule: …`). The runner resolves the picked
 * story's submodule by consulting BOTH; this covers the frontmatter reader.
 */
import { describe, expect, it } from "vitest";
import { targetSubmoduleFromSpecText } from "../src/lib/target-submodule.js";

describe("targetSubmoduleFromSpecText — E2 spec frontmatter", () => {
  it("returns undefined when there is no frontmatter", () => {
    expect(targetSubmoduleFromSpecText("# Just a body\n")).toBeUndefined();
  });

  it("returns undefined when frontmatter omits target_submodule", () => {
    const spec = "---\nepic: x\ndeliverable_url: https://a\n---\nbody\n";
    expect(targetSubmoduleFromSpecText(spec)).toBeUndefined();
  });

  it("reads a scalar target_submodule from frontmatter", () => {
    const spec = "---\nepic: contractor\ntarget_submodule: dukang-service-online\n---\nbody\n";
    expect(targetSubmoduleFromSpecText(spec)).toBe("dukang-service-online");
  });

  it("strips quotes and inline comments", () => {
    const spec = '---\ntarget_submodule: "dukang-service-online"  # the backend\n---\n';
    expect(targetSubmoduleFromSpecText(spec)).toBe("dukang-service-online");
  });

  it("ignores a target_submodule OUTSIDE the frontmatter block", () => {
    const spec = "---\nepic: x\n---\nbody target_submodule: not-this\n";
    expect(targetSubmoduleFromSpecText(spec)).toBeUndefined();
  });
});
