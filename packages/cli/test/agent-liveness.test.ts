/**
 * FIX-363 (2/2) — agent-liveness: tell a BLOCKED agent (not logged in / network
 * down) from a SLOW one, so a "timeout" is attributed to the real cause instead
 * of burning the review budget on a doomed call.
 */
import { describe, expect, it } from "vitest";
import type { AgentSpawnResult } from "../src/runner/agent-spawn.js";
import { classifyBlockSignature, probeAgentReachable } from "../src/runner/agent-liveness.js";

const ok = (stdout: string): AgentSpawnResult => ({ stdout, stderr: "", exitCode: 0, timedOut: false });
const fail = (stderr: string, exitCode = 1): AgentSpawnResult => ({ stdout: "", stderr, exitCode, timedOut: false });
const hung = (): AgentSpawnResult => ({ stdout: "", stderr: "", exitCode: 0, timedOut: true });

describe("classifyBlockSignature — FIX-363 cause heuristics", () => {
  it("auth signatures (the 403 / login family we actually saw)", () => {
    expect(classifyBlockSignature("API Error: 403 Request not allowed")).toBe("auth");
    expect(classifyBlockSignature("Please run /login")).toBe("auth");
    expect(classifyBlockSignature("401 Unauthorized")).toBe("auth");
    expect(classifyBlockSignature("invalid api key")).toBe("auth");
    expect(classifyBlockSignature("请登录后重试")).toBe("auth");
  });

  it("network signatures (VPN/proxy/DNS/TLS down)", () => {
    expect(classifyBlockSignature("getaddrinfo ENOTFOUND api.anthropic.com")).toBe("network");
    expect(classifyBlockSignature("connect ECONNREFUSED 127.0.0.1:7897")).toBe("network");
    expect(classifyBlockSignature("fetch failed")).toBe("network");
    expect(classifyBlockSignature("proxy tunnel error")).toBe("network");
    expect(classifyBlockSignature("网络不可达")).toBe("network");
  });

  it("auth wins over network when both match (403 behind a working proxy is auth)", () => {
    expect(classifyBlockSignature("403 via proxy")).toBe("auth");
  });

  it("clean / unrelated output → null (treated as live or genuinely slow)", () => {
    expect(classifyBlockSignature("")).toBeNull();
    expect(classifyBlockSignature("VERDICT: agree")).toBeNull();
    expect(classifyBlockSignature("SCORE: 8\nVERDICT: good\nRATIONALE: solid")).toBeNull();
    expect(classifyBlockSignature("login flow delivered; credential handling verified")).toBeNull();
    expect(classifyBlockSignature("鉴权全程正常")).toBeNull();
  });

  it("auth failure wording still matches after false-positive tightening", () => {
    expect(classifyBlockSignature("login required")).toBe("auth");
    expect(classifyBlockSignature("credential missing")).toBe("auth");
    expect(classifyBlockSignature("鉴权失败")).toBe("auth");
    expect(classifyBlockSignature("认证失败")).toBe("auth");
  });

  // FIX-1033: bare 403/401 in non-auth context must not trigger auth classification
  it("incidental bare 403/401 strings (card IDs, test names, PR numbers) → null", () => {
    expect(classifyBlockSignature("FIX-403: realAgentSpawn injects agent-profile env")).toBeNull();
    expect(classifyBlockSignature("US-403")).toBeNull();
    expect(classifyBlockSignature("PR #403")).toBeNull();
    expect(classifyBlockSignature("test 403 regression")).toBeNull();
    expect(classifyBlockSignature("US-401")).toBeNull();
    expect(classifyBlockSignature("issue 401 is a known http code")).toBeNull();
  });

  // FIX-1033: real 403/401 in HTTP/auth context still returns auth
  it("real 403/401 in HTTP/auth context still returns auth", () => {
    expect(classifyBlockSignature("API Error: 403 Request not allowed")).toBe("auth");
    expect(classifyBlockSignature("HTTP 403 Unauthorized")).toBe("auth");
    expect(classifyBlockSignature("403 Please run /login")).toBe("auth");
    expect(classifyBlockSignature("403 Forbidden")).toBe("auth");
    expect(classifyBlockSignature("HTTP 401 Unauthorized")).toBe("auth");
    expect(classifyBlockSignature("API Error: 401 token expired")).toBe("auth");
    expect(classifyBlockSignature("401 Unauthorized")).toBe("auth");
  });

  // FIX-1033: auth still wins over network when both 403 and proxy appear
  it("auth still wins over network when both 403 proxy appear", () => {
    expect(classifyBlockSignature("403 via proxy")).toBe("auth");
    expect(classifyBlockSignature("HTTP 403 connection reset via proxy")).toBe("auth");
  });
});

describe("probeAgentReachable — FIX-363 failure-path disambiguator", () => {
  it("a clean reply → reachable (no exact-token match required)", async () => {
    const r = await probeAgentReachable("kimi", async () => ok("• thinking...\nROLL_LIVE_OK"), { timeoutMs: 1000 });
    expect(r.reachable).toBe(true);
    expect(r.cause).toBe("live");
  });

  it("a 403 in output → not reachable, cause auth", async () => {
    const r = await probeAgentReachable("claude", async () => fail("API Error: 403 Request not allowed"), { timeoutMs: 1000 });
    expect(r.reachable).toBe(false);
    expect(r.cause).toBe("auth");
  });

  it("a network error in output → not reachable, cause network", async () => {
    const r = await probeAgentReachable("codex", async () => fail("getaddrinfo ENOTFOUND api.openai.com"), { timeoutMs: 1000 });
    expect(r.reachable).toBe(false);
    expect(r.cause).toBe("network");
  });

  it("a SILENT hang to the cap → not reachable, cause unknown (soft — never drives a hard verdict)", async () => {
    const r = await probeAgentReachable("pi", async () => hung(), { timeoutMs: 50 });
    expect(r.reachable).toBe(false);
    expect(r.cause).toBe("unknown");
  });

  it("a non-zero exit with no signature → not reachable, cause unknown", async () => {
    const r = await probeAgentReachable("pi", async () => fail("some opaque crash", 2), { timeoutMs: 1000 });
    expect(r.reachable).toBe(false);
    expect(r.cause).toBe("unknown");
  });

  it("a thrown spawn → classified from the error message, never propagates", async () => {
    const r = await probeAgentReachable("pi", async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:7897");
    }, { timeoutMs: 1000 });
    expect(r.reachable).toBe(false);
    expect(r.cause).toBe("network");
  });

  it("the wall-clock cap resolves even if the spawn never settles (no 耗着)", async () => {
    const r = await probeAgentReachable("pi", () => new Promise<AgentSpawnResult>(() => { /* never resolves */ }), { timeoutMs: 30 });
    expect(r.reachable).toBe(false);
    expect(r.cause).toBe("unknown");
  });
});
