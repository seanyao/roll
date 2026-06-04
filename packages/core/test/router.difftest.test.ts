/**
 * diff-test: TS AgentRouter pure logic vs the frozen python oracle
 * lib/loop_pick_agent.py.
 *
 * The python is itself pure and ships a CLI:
 *   - `--est-min N` prints "<tier> est_min=N → tier=<tier>" (field 1 = tier).
 *   - `--nudge --slot-agent A --story-type T --candidates c1,c2 [--disabled]`
 *     reads a hit-rates JSON on stdin and prints "<agent>\t<rationale>".
 * We compare TS classifyComplexity / nudgeWithinTier field-for-field, including
 * the exact rationale strings (the audit text the loop logs verbatim).
 *
 * The `\x1f`-delimited hit-rate keys are built in JS and JSON-encoded so the
 * literal unit-separator survives the pipe to python.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyComplexity,
  hitRateKey,
  nudgeWithinTier,
  type HitRates,
} from "../src/index.js";

const REPO = resolve(__dirname, "../../..");
const PY = `${REPO}/lib/loop_pick_agent.py`;

function pyClassify(est: string): { tier: string; line: string } {
  const out = execFileSync("python3", [PY, "--est-min", est], { encoding: "utf8" }).trim();
  return { tier: out.split(" ")[0] ?? "", line: out };
}

function pyNudge(
  slot: string,
  storyType: string,
  candidates: string[],
  hitRates: HitRates,
  disabled: boolean,
): { agent: string; rationale: string } {
  const args = [
    PY,
    "--nudge",
    "--slot-agent",
    slot,
    "--story-type",
    storyType,
    "--candidates",
    candidates.join(","),
  ];
  if (disabled) args.push("--disabled");
  const out = execFileSync("python3", args, {
    encoding: "utf8",
    input: JSON.stringify(hitRates),
  }).trim();
  const tab = out.indexOf("\t");
  return { agent: out.slice(0, tab), rationale: out.slice(tab + 1) };
}

describe("diff-test: classifyComplexity == python --est-min", () => {
  // Includes boundaries and the illegal/missing cases the python defaults.
  for (const est of ["0", "8", "9", "20", "21", "100", "-3", "foo", ""]) {
    it(`est_min='${est}'`, () => {
      const py = pyClassify(est);
      // Python prints "<tier> est_min=<raw> → tier=<tier>"; TS only owns the tier.
      expect(classifyComplexity(est)).toBe(py.tier);
    });
  }
});

describe("diff-test: nudgeWithinTier == python --nudge (agent + rationale bytes)", () => {
  const CASES: Array<{
    name: string;
    slot: string;
    storyType: string;
    candidates: string[];
    hitRates: HitRates;
    disabled: boolean;
  }> = [
    { name: "disabled identity", slot: "claude", storyType: "US", candidates: ["kimi"], hitRates: {}, disabled: true },
    {
      name: "below sample floor → keep slot",
      slot: "claude",
      storyType: "US",
      candidates: ["kimi"],
      hitRates: { [hitRateKey("kimi", "US")]: { hit_rate: 0.99, sample_n: 3 } },
      disabled: false,
    },
    {
      name: "candidate wins",
      slot: "claude",
      storyType: "US",
      candidates: ["kimi"],
      hitRates: {
        [hitRateKey("claude", "US")]: { hit_rate: 0.8, sample_n: 10 },
        [hitRateKey("kimi", "US")]: { hit_rate: 0.95, sample_n: 12 },
      },
      disabled: false,
    },
    {
      name: "tie → slot kept",
      slot: "claude",
      storyType: "FIX",
      candidates: ["kimi", "qwen"],
      hitRates: {
        [hitRateKey("claude", "FIX")]: { hit_rate: 0.9, sample_n: 10 },
        [hitRateKey("kimi", "FIX")]: { hit_rate: 0.9, sample_n: 10 },
        [hitRateKey("qwen", "FIX")]: { hit_rate: 0.9, sample_n: 10 },
      },
      disabled: false,
    },
    {
      name: "slot best in-tier",
      slot: "claude",
      storyType: "US",
      candidates: ["kimi"],
      hitRates: {
        [hitRateKey("claude", "US")]: { hit_rate: 0.97, sample_n: 9 },
        [hitRateKey("kimi", "US")]: { hit_rate: 0.5, sample_n: 9 },
      },
      disabled: false,
    },
    {
      name: "empty hit-rates → keep slot",
      slot: "pi",
      storyType: "REFACTOR",
      candidates: [],
      hitRates: {},
      disabled: false,
    },
  ];

  for (const c of CASES) {
    it(c.name, () => {
      const py = pyNudge(c.slot, c.storyType, c.candidates, c.hitRates, c.disabled);
      const ts = nudgeWithinTier(c.slot, c.candidates, c.storyType, c.hitRates, {
        enabled: !c.disabled,
      });
      expect(ts.agent).toBe(py.agent);
      expect(ts.rationale).toBe(py.rationale);
    });
  }
});
