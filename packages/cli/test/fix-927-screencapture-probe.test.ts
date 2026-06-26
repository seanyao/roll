/**
 * FIX-927 — the macOS Screen Recording probe must not re-fire (and block on) the
 * TCC prompt in a headless / unattended context. The probe is a real
 * `screencapture` (1×1 px); every `roll loop go` / `roll doctor` / `roll init`
 * used to re-run it, stacking TCC dialogs and stalling unattended cycles. The
 * fix skips the probe when non-TTY (`interactive === false`) or `ROLL_NO_SCREENCAP=1`.
 * Exercised through the exported `resolveRequirement`; an injected counting
 * `execFile` proves whether the real `screencapture` ran.
 */
import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { resolveRequirement, type ExternalToolDeps } from "../src/lib/external-tools.js";

const SCREENCAP = { kind: "executable", name: "screencapture", optional: true } as const;

interface Probe extends ExternalToolDeps {
  probeCount: number;
}

function makeDeps(over: Partial<ExternalToolDeps> & { probeCode?: number } = {}): Probe {
  const calls = { n: 0 };
  const deps = {
    platform: "darwin" as NodeJS.Platform,
    env: over.env ?? {},
    home: "/tmp/home",
    commandOnPath: over.commandOnPath ?? (() => true),
    execFile: (_cmd, args) => {
      calls.n += 1;
      const out = String(args[args.length - 1] ?? "");
      if ((over.probeCode ?? 0) === 0 && out !== "") writeFileSync(out, "PNGDATA");
      return { code: over.probeCode ?? 0, stdout: "", stderr: "" };
    },
    readDir: () => [],
    exists: () => false,
    interactive: over.interactive,
  } as ExternalToolDeps;
  return Object.defineProperty(deps as Probe, "probeCount", { get: () => calls.n });
}

describe("FIX-927 screencapture readiness probe", () => {
  it("AC2: headless (interactive=false) → skipped, never runs screencapture", () => {
    const deps = makeDeps({ interactive: false });
    expect(resolveRequirement(SCREENCAP, deps).status).toBe("stale");
    expect(deps.probeCount).toBe(0);
  });

  it("AC2: ROLL_NO_SCREENCAP=1 → skipped, never runs screencapture", () => {
    const deps = makeDeps({ interactive: true, env: { ROLL_NO_SCREENCAP: "1" } });
    expect(resolveRequirement(SCREENCAP, deps).status).toBe("stale");
    expect(deps.probeCount).toBe(0);
  });

  it("interactive + granted → ok (probe runs once)", () => {
    const deps = makeDeps({ interactive: true, probeCode: 0 });
    expect(resolveRequirement(SCREENCAP, deps).status).toBe("ok");
    expect(deps.probeCount).toBe(1);
  });

  it("interactive + denied → permission-missing", () => {
    const deps = makeDeps({ interactive: true, probeCode: 1 });
    expect(resolveRequirement(SCREENCAP, deps).status).toBe("permission-missing");
  });

  it("default interactive (undefined) preserves the original probe behaviour", () => {
    const deps = makeDeps({ probeCode: 0 }); // interactive undefined → still probes
    expect(resolveRequirement(SCREENCAP, deps).status).toBe("ok");
    expect(deps.probeCount).toBe(1);
  });

  it("non-darwin → stale, no probe", () => {
    const deps = makeDeps({ interactive: true });
    (deps as { platform: NodeJS.Platform }).platform = "linux";
    expect(resolveRequirement(SCREENCAP, deps).status).toBe("stale");
    expect(deps.probeCount).toBe(0);
  });

  it("screencapture not on PATH → missing, no probe", () => {
    const deps = makeDeps({ interactive: true, commandOnPath: () => false });
    expect(resolveRequirement(SCREENCAP, deps).status).toBe("missing");
    expect(deps.probeCount).toBe(0);
  });
});
