/**
 * Unit tests for PolicyEngine (US-CORE-010): policy.yaml parser, first-match
 * routing, safety thresholds, repo-compliance verdict.
 *
 * The parser fixture is the architecture §5.1/§6.1 example policy.yaml verbatim,
 * so the test pins the v3 spec shape.
 *
 * On the bash guard diff-test: v2's structural guard is the FIX-065 tripwire
 * (bin/roll:7917-7934), inlined into `_loop_event` and gated on HOME / BATS /
 * PWD sandbox env — it is NOT a cleanly extractable standalone function (it
 * mutates / inspects loop runtime state). So {@link repoComplianceVerdict} MIRRORS
 * its INTENT ("never operate on a stray, non-roll checkout") as a pure structural
 * check and is unit-tested against fixtures here rather than byte-diffed.
 */
import { describe, expect, it } from "vitest";
import {
  type Policy,
  parsePolicy,
  repoComplianceVerdict,
  resolvePolicyRoute,
} from "../src/index.js";

// architecture.md §5.1 + §6.1 example, verbatim.
const SPEC_POLICY = `
model_routing:
  - match: { level: "epic|feature" }
    agent: claude
    model: opus
    fallback: { agent: claude, model: sonnet }
    rationale: "拆分错误传播范围大，不可逆性高"
  - match: { level: "story", type: "US-*" }
    agent: claude
    model: sonnet
    fallback: { agent: kimi, model: default }
  - match: { level: "story", type: "FIX-*|REFACTOR-*" }
    agent: deepseek
    model: default
    fallback: { agent: kimi, model: default }
  - match: { level: "action" }
    agent: deepseek
    model: default
  - match: { level: "*" }
    agent: claude
    model: default

loop_safety:
  max_consecutive_failures: 3
  action_on_breach: pause_and_notify
  max_story_failures: 3
  action_on_story_breach: hold
  correction_oscillation_threshold: 3
  correction_signal_threshold: 4
  correction_signal_window_sec: 21600
  correction_actuator: auto
  budget:
    daily_usd: 20
    weekly_usd: 100
    metric: effective_cost
    on_approach:
      action: downgrade
    on_breach:
      action: pause_and_notify
    upgrade_hint:
      when: { revert_rate_gt: 0.4 }
      action: suggest_upgrade
`;

describe("parsePolicy — v3 spec shape round-trip", () => {
  const policy = parsePolicy(SPEC_POLICY);

  it("parses all five routing rules in order", () => {
    expect(policy.modelRouting).toHaveLength(5);
    expect(policy.modelRouting[0]).toEqual({
      match: { level: "epic|feature" },
      agent: "claude",
      model: "opus",
      fallback: { agent: "claude", model: "sonnet" },
      rationale: "拆分错误传播范围大，不可逆性高",
    });
    expect(policy.modelRouting[1]).toMatchObject({ match: { level: "story", type: "US-*" }, agent: "claude", model: "sonnet" });
    expect(policy.modelRouting[2]?.match.type).toBe("FIX-*|REFACTOR-*");
    expect(policy.modelRouting[4]?.match.level).toBe("*");
  });

  it("parses loop_safety and IGNORES a stale nested budget block (cost gate removed)", () => {
    expect(policy.loopSafety.maxConsecutiveFailures).toBe(3);
    expect(policy.loopSafety.actionOnBreach).toBe("pause_and_notify");
    expect(policy.loopSafety.correctionSignalThreshold).toBe(4);
    expect(policy.loopSafety.correctionSignalWindowSec).toBe(21600);
    expect(policy.loopSafety.correctionActuator).toBe("auto");
    expect((policy.loopSafety as Record<string, unknown>)["maxStoryFailures"]).toBeUndefined();
    expect((policy.loopSafety as Record<string, unknown>)["actionOnStoryBreach"]).toBeUndefined();
    // The retired budget ceiling is no longer parsed — a stale `budget:` block in
    // a user policy.yaml is silently ignored (forward-compatible), never surfaced.
    expect((policy.loopSafety as Record<string, unknown>)["budget"]).toBeUndefined();
  });

  it("falls back to v2-aligned defaults for an empty/absent policy", () => {
    const p = parsePolicy("");
    expect(p.modelRouting).toHaveLength(0);
    expect(p.loopSafety).toEqual({
      maxConsecutiveFailures: 3,
      actionOnBreach: "pause_and_notify",
      correctionSignalThreshold: 3,
      correctionSignalWindowSec: 43200,
      correctionActuator: "conservative",
      cycleWallTimeoutSec: 2700,
      cycleNoProgressSec: 900,
      autoRepairEvidence: true,
      builderNoConsecutiveRepeat: true,
    });
    expect(p.pick.semanticRanking).toBe("on");
  });

  it("FIX-1267: builder_no_consecutive_repeat is default-on; only explicit false disables", () => {
    expect(parsePolicy("").loopSafety.builderNoConsecutiveRepeat).toBe(true);
    expect(parsePolicy("loop_safety:\n  builder_no_consecutive_repeat: false\n").loopSafety.builderNoConsecutiveRepeat).toBe(false);
    expect(parsePolicy("loop_safety:\n  builder_no_consecutive_repeat: true\n").loopSafety.builderNoConsecutiveRepeat).toBe(true);
    // Garbage / unrecognized value leaves the constraint ON (稳字纪律 for a safety gate).
    expect(parsePolicy("loop_safety:\n  builder_no_consecutive_repeat: maybe\n").loopSafety.builderNoConsecutiveRepeat).toBe(true);
  });

  it("parses pick.semantic_ranking with default-on semantics", () => {
    expect(parsePolicy("pick:\n  semantic_ranking: off\n").pick.semanticRanking).toBe("off");
    expect(parsePolicy("pick:\n  semantic_ranking: on\n").pick.semanticRanking).toBe("on");
    expect(parsePolicy("pick:\n  semantic_ranking: maybe\n").pick.semanticRanking).toBe("on");
  });

  it("FIX-907: parses loop_safety cycle timeout thresholds; absent ⇒ 45min wall / 15min no-progress", () => {
    expect(parsePolicy("").loopSafety.cycleWallTimeoutSec).toBe(2700);
    expect(parsePolicy("").loopSafety.cycleNoProgressSec).toBe(900);
    const tuned = parsePolicy(`
loop_safety:
  cycle_wall_timeout_sec: 3600
  cycle_no_progress_sec: 600
`);
    expect(tuned.loopSafety.cycleWallTimeoutSec).toBe(3600);
    expect(tuned.loopSafety.cycleNoProgressSec).toBe(600);
    // 0 / negative DISABLES that criterion (operator escape hatch) — passed through.
    const disabled = parsePolicy(`
loop_safety:
  cycle_wall_timeout_sec: 0
  cycle_no_progress_sec: -1
`);
    expect(disabled.loopSafety.cycleWallTimeoutSec).toBe(0);
    expect(disabled.loopSafety.cycleNoProgressSec).toBe(-1);
    // junk → default.
    const junk = parsePolicy("loop_safety:\n  cycle_wall_timeout_sec: soon\n");
    expect(junk.loopSafety.cycleWallTimeoutSec).toBe(2700);
  });

  it("parses loop_safety.correction_actuator; absent/junk stays conservative", () => {
    expect(parsePolicy("").loopSafety.correctionActuator).toBe("conservative");
    expect(parsePolicy("loop_safety:\n  correction_actuator: auto\n").loopSafety.correctionActuator).toBe("auto");
    expect(parsePolicy("loop_safety:\n  correction_actuator: maybe\n").loopSafety.correctionActuator).toBe("conservative");
  });

  it("parses loop_safety.attest_gate (FIX-207); absent ⇒ undefined (soft)", () => {
    expect(parsePolicy("").loopSafety.attestGate).toBeUndefined();
    const hard = parsePolicy(`
loop_safety:
  attest_gate: hard
`);
    expect(hard.loopSafety.attestGate).toBe("hard");
    const soft = parsePolicy(`
loop_safety:
  attest_gate: soft
`);
    expect(soft.loopSafety.attestGate).toBe("soft");
    // junk value → ignored (stays undefined ⇒ soft default)
    const junk = parsePolicy(`
loop_safety:
  attest_gate: maybe
`);
    expect(junk.loopSafety.attestGate).toBeUndefined();
  });

  it("parses loop_safety.peer_gate (FIX-293); absent ⇒ undefined (the reader defaults hard)", () => {
    expect(parsePolicy("").loopSafety.peerGate).toBeUndefined();
    expect(parsePolicy(`
loop_safety:
  peer_gate: hard
`).loopSafety.peerGate).toBe("hard");
    expect(parsePolicy(`
loop_safety:
  peer_gate: soft
`).loopSafety.peerGate).toBe("soft");
    // junk value → ignored (undefined ⇒ readPeerGateMode treats it as hard)
    expect(parsePolicy(`
loop_safety:
  peer_gate: maybe
`).loopSafety.peerGate).toBeUndefined();
  });

  it("parses loop_safety.proxy_enable_cmd (FIX-298); absent/empty ⇒ undefined", () => {
    expect(parsePolicy("").loopSafety.proxyEnableCmd).toBeUndefined();
    // a non-empty string is the configured network-guard recovery hook (the
    // user's own proxy-on command — nothing is hardcoded).
    expect(parsePolicy(`
loop_safety:
  proxy_enable_cmd: proxy rule
`).loopSafety.proxyEnableCmd).toBe("proxy rule");
    // empty value ⇒ undefined (no auto-enable; the guard halts-and-tells).
    expect(parsePolicy(`
loop_safety:
  proxy_enable_cmd:
`).loopSafety.proxyEnableCmd).toBeUndefined();
  });

  it("parses loop_safety.probe_url + skip_network_check (FIX-1025)", () => {
    // defaults: absent ⇒ undefined / off.
    expect(parsePolicy("").loopSafety.probeUrl).toBeUndefined();
    expect(parsePolicy("").loopSafety.skipNetworkCheck).toBeUndefined();
    // probe_url: a non-empty string points the precheck at a host the work needs.
    expect(parsePolicy(`
loop_safety:
  probe_url: api.deepseek.com:443
`).loopSafety.probeUrl).toBe("api.deepseek.com:443");
    // empty probe_url ⇒ undefined (fall back to the default host).
    expect(parsePolicy(`
loop_safety:
  probe_url:
`).loopSafety.probeUrl).toBeUndefined();
    // skip_network_check: only explicit `true` opts out.
    expect(parsePolicy(`
loop_safety:
  skip_network_check: true
`).loopSafety.skipNetworkCheck).toBe(true);
    expect(parsePolicy(`
loop_safety:
  skip_network_check: false
`).loopSafety.skipNetworkCheck).toBeUndefined();
  });

  it("parses loop_safety.prebuild_dist (FIX-338); DEFAULT-OFF unless explicit true", () => {
    // absent ⇒ undefined (the reader treats it as OFF — deploy no-op, 稳字纪律).
    expect(parsePolicy("").loopSafety.prebuildDist).toBeUndefined();
    // an explicit `true` is the ONLY thing that turns it on.
    expect(parsePolicy(`
loop_safety:
  prebuild_dist: true
`).loopSafety.prebuildDist).toBe(true);
    // explicit false ⇒ undefined (stays OFF).
    expect(parsePolicy(`
loop_safety:
  prebuild_dist: false
`).loopSafety.prebuildDist).toBeUndefined();
    // garbage ⇒ undefined (fail-safe OFF; never accidentally enabled).
    expect(parsePolicy(`
loop_safety:
  prebuild_dist: maybe
`).loopSafety.prebuildDist).toBeUndefined();
  });

  it("parses loop_safety.project_map (FIX-338 杠杆2); DEFAULT-OFF unless explicit true", () => {
    // absent ⇒ undefined (the reader treats it as OFF — deploy no-op, 稳字纪律).
    expect(parsePolicy("").loopSafety.projectMap).toBeUndefined();
    // an explicit `true` is the ONLY thing that turns it on.
    expect(parsePolicy(`
loop_safety:
  project_map: true
`).loopSafety.projectMap).toBe(true);
    // explicit false ⇒ undefined (stays OFF).
    expect(parsePolicy(`
loop_safety:
  project_map: false
`).loopSafety.projectMap).toBeUndefined();
    // garbage ⇒ undefined (fail-safe OFF; never accidentally enabled).
    expect(parsePolicy(`
loop_safety:
  project_map: maybe
`).loopSafety.projectMap).toBeUndefined();
  });

  it("parses loop_safety.session_reuse (lever-4 warm-context); DEFAULT-OFF unless explicit true", () => {
    // absent ⇒ undefined (the reader treats it as OFF — deploy no-op, 稳字纪律).
    expect(parsePolicy("").loopSafety.sessionReuse).toBeUndefined();
    // an explicit `true` is the ONLY thing that turns it on.
    expect(parsePolicy(`
loop_safety:
  session_reuse: true
`).loopSafety.sessionReuse).toBe(true);
    // explicit false ⇒ undefined (stays OFF).
    expect(parsePolicy(`
loop_safety:
  session_reuse: false
`).loopSafety.sessionReuse).toBeUndefined();
    // garbage ⇒ undefined (fail-safe OFF; never accidentally enabled).
    expect(parsePolicy(`
loop_safety:
  session_reuse: maybe
`).loopSafety.sessionReuse).toBeUndefined();
  });

  it("parses loop_safety.resume_scope; absent or invalid behaves as off", () => {
    expect(parsePolicy("").loopSafety.resumeScope).toBeUndefined();
    expect(parsePolicy(`
loop_safety:
  session_reuse: true
`).loopSafety.resumeScope).toBeUndefined();
    expect(parsePolicy(`
loop_safety:
  session_reuse: true
  resume_scope: same-story
`).loopSafety.resumeScope).toBe("same-story");
    expect(parsePolicy(`
loop_safety:
  session_reuse: true
  resume_scope: cross-card
`).loopSafety.resumeScope).toBeUndefined();
  });

  it("ignores comments and unknown keys (forward-compatible)", () => {
    const p = parsePolicy(`
# leading comment
model_routing:
  - match: { level: "action" }  # inline comment
    agent: deepseek
    model: default
    unknown_key: ignored
loop_safety:
  max_consecutive_failures: 5
  future_field: whatever
`);
    expect(p.modelRouting).toHaveLength(1);
    expect(p.modelRouting[0]?.agent).toBe("deepseek");
    expect(p.loopSafety.maxConsecutiveFailures).toBe(5);
  });
});

describe("resolvePolicyRoute — first-match precedence (D1/I10)", () => {
  const policy = parsePolicy(SPEC_POLICY);

  it("epic/feature → opus (rule 0)", () => {
    expect(resolvePolicyRoute(policy, { level: "epic", type: "US" })).toMatchObject({ model: "opus", ruleIndex: 0 });
    expect(resolvePolicyRoute(policy, { level: "feature", type: "FIX" })).toMatchObject({ model: "opus", ruleIndex: 0 });
  });

  it("story + US-* → sonnet (rule 1), before the FIX rule", () => {
    expect(resolvePolicyRoute(policy, { level: "story", type: "US-AUTH-001" })).toMatchObject({
      agent: "claude",
      model: "sonnet",
      ruleIndex: 1,
    });
  });

  it("story + FIX-* / REFACTOR-* → deepseek (rule 2)", () => {
    expect(resolvePolicyRoute(policy, { level: "story", type: "FIX-9" })).toMatchObject({ agent: "deepseek", ruleIndex: 2 });
    expect(resolvePolicyRoute(policy, { level: "story", type: "REFACTOR-3" })).toMatchObject({ agent: "deepseek", ruleIndex: 2 });
  });

  it("action → deepseek (rule 3)", () => {
    expect(resolvePolicyRoute(policy, { level: "action", type: "US" })).toMatchObject({ ruleIndex: 3 });
  });

  it("anything else → wildcard default (rule 4)", () => {
    expect(resolvePolicyRoute(policy, { level: "story", type: "IDEA-1" })).toMatchObject({ model: "default", ruleIndex: 4 });
  });

  it("returns null when nothing matches (no wildcard rule)", () => {
    const p: Policy = { modelRouting: [{ match: { level: "epic" }, agent: "a", model: "m" }], loopSafety: parsePolicy("").loopSafety };
    expect(resolvePolicyRoute(p, { level: "story", type: "US" })).toBeNull();
  });

  it("is deterministic — same input, same route", () => {
    const a = resolvePolicyRoute(policy, { level: "story", type: "US-1" });
    const b = resolvePolicyRoute(policy, { level: "story", type: "US-1" });
    expect(a).toEqual(b);
  });
});

describe("repoComplianceVerdict — 防误伤非本项目仓", () => {
  it("compliant when git repo + .roll/ + backlog all present", () => {
    expect(repoComplianceVerdict({ isGitRepo: true, hasRollDir: true, hasBacklog: true })).toEqual({ compliant: true });
  });

  it("declines a non-git repo", () => {
    const v = repoComplianceVerdict({ isGitRepo: false, hasRollDir: true, hasBacklog: true });
    expect(v.compliant).toBe(false);
    if (!v.compliant) expect(v.missing).toContain("git-repo");
  });

  it("parses auto_repair_evidence (FIX-1260); default on, only explicit false disables", () => {
    // Default: absent ⇒ true (auto-repair is on).
    expect(parsePolicy("").loopSafety.autoRepairEvidence).toBe(true);
    // Explicit false ⇒ off.
    expect(parsePolicy(`
loop_safety:
  auto_repair_evidence: false
`).loopSafety.autoRepairEvidence).toBe(false);
    // Explicit true ⇒ on (though this is the default).
    expect(parsePolicy(`
loop_safety:
  auto_repair_evidence: true
`).loopSafety.autoRepairEvidence).toBe(true);
    // Garbage value ⇒ stays on (conservative: only explicit false disables).
    expect(parsePolicy(`
loop_safety:
  auto_repair_evidence: maybe
`).loopSafety.autoRepairEvidence).toBe(true);
  });

  it("declines a repo with no .roll/ (a stray checkout)", () => {
    const v = repoComplianceVerdict({ isGitRepo: true, hasRollDir: false, hasBacklog: false });
    expect(v.compliant).toBe(false);
    if (!v.compliant) expect(v.missing).toEqual([".roll/", ".roll/backlog.md"]);
  });
});
