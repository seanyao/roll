import { describe, expect, it } from "vitest";
import {
  parseWorkspaceInteractionArgs,
  type WorkspaceInteractionCapabilities,
} from "../src/lib/workspace-interaction.js";

const noCapability: WorkspaceInteractionCapabilities = {
  stdinTTY: false,
  stderrTTY: false,
  agentQuestionCapable: false,
};

describe("US-WS-030 direct Workspace interaction capability", () => {
  it("keeps interaction capability independent from JSON format", () => {
    expect(parseWorkspaceInteractionArgs(["--json"], {
      stdinTTY: true,
      stderrTTY: true,
      agentQuestionCapable: false,
    })).toEqual({ ok: true, mode: "interactive", args: ["--json"] });
    expect(parseWorkspaceInteractionArgs(["--json", "--no-input"], {
      stdinTTY: true,
      stderrTTY: true,
      agentQuestionCapable: false,
    })).toEqual({ ok: true, mode: "non_interactive", args: ["--json"] });
    expect(parseWorkspaceInteractionArgs(["--json"], noCapability)).toEqual({
      ok: true,
      mode: "non_interactive",
      args: ["--json"],
    });
  });

  it("requires a real direct TTY pair or an agent question capability when forced", () => {
    expect(parseWorkspaceInteractionArgs(["--interactive"], noCapability)).toEqual({
      ok: false,
      code: "interaction_unavailable",
      args: [],
    });
    expect(parseWorkspaceInteractionArgs(["--interactive"], {
      ...noCapability,
      agentQuestionCapable: true,
    })).toEqual({ ok: true, mode: "interactive", args: [] });
    expect(parseWorkspaceInteractionArgs(["--interactive"], {
      ...noCapability,
      stdinTTY: true,
      stderrTTY: true,
    })).toEqual({ ok: true, mode: "interactive", args: [] });
  });

  it("lets --no-input force non-interactive handling without changing other argv bytes", () => {
    expect(parseWorkspaceInteractionArgs([
      "list",
      "--no-input",
      "--json",
      "--workspace",
      "roll",
    ], {
      stdinTTY: true,
      stderrTTY: true,
      agentQuestionCapable: true,
    })).toEqual({
      ok: true,
      mode: "non_interactive",
      args: ["list", "--json", "--workspace", "roll"],
    });
  });
});
