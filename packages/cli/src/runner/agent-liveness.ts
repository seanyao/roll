/**
 * FIX-363 (2/2) — distinguish a SLOW peer review from an externally BLOCKED agent.
 *
 * The pairing gate kills a reviewer at its wall-clock budget. But a "timeout" is
 * not always slowness — the owner's observation: an agent can hang because it is
 * NOT LOGGED IN (403 / "Please run /login") or the NETWORK is down (VPN off /
 * proxy dead). Raising the budget then makes it worse: we wait 5min for a call
 * that will NEVER return, then fail anyway, and after 3 such cycles the loop
 * auto-pauses with a MISLEADING "3 consecutive failures — resolve the root cause"
 * that sends the owner hunting a phantom code bug. The real fix is "re-login" or
 * "reconnect the VPN".
 *
 * Evidence this is real: the `pair:consult` history shows ALL 55 timeouts landing
 * at EXACTLY ~120004ms (hang-until-killed), not a spread — the signature of an
 * external block, not of slow generation. And this very session opened with two
 * `API Error: 403 Request not allowed / Please run /login`.
 *
 * Design (peer-reviewed with kimi + pi — both preferred attribution over a
 * per-cycle synchronous probe):
 *   1. {@link classifyBlockSignature} runs on output we ALREADY captured (zero
 *      cost). It catches the case where the blocked agent printed a 403 / login /
 *      ENOTFOUND / proxy message.
 *   2. {@link probeAgentReachable} is a FAILURE-PATH disambiguator: only when a
 *      review died as a SILENT timeout (killed, no signature in its output) do we
 *      spend one cheap trivial-prompt probe to tell "blocked" from "slow". A live
 *      agent answers a one-token echo in seconds; a blocked one errors fast or
 *      hangs to the (short) cap. This is a CONNECTIVITY/REACHABILITY check, NOT a
 *      readiness promise — `reachable` never guarantees the heavy review will
 *      complete (rate-limits / context limits surface only under real load).
 *
 * The signatures are HEURISTICS. They drive a heuristic (suppress the
 * code-failure counter, raise an actionable alert), never a hard correctness
 * gate — so a false positive degrades to "the owner gets a slightly-wrong hint",
 * never "a real delivery is dropped". And because the probe prompt is a fixed
 * echo (not arbitrary diff text), the broad CN/EN substrings cannot be tripped by
 * a diff that happens to mention "login" or "network".
 */
import type { AgentSpawn } from "./agent-spawn.js";

/** Why an agent could not be reached. `unknown` = hung/failed with no signature
 *  we can attribute (treated as soft — never drives the all-blocked alert). */
export type BlockCause = "auth" | "network" | "unknown";

export interface ReachResult {
  agent: string;
  reachable: boolean;
  cause: BlockCause | "live";
  detail: string;
}

// Auth-block signatures: the agent ran but is not authenticated.
const AUTH_SIGNATURES: RegExp[] = [
  /\/login\b/i,
  /\bplease\s+run\s+\/?login\b/i,
  /\blog ?in\s+(required|needed)\b/i,
  /\b(required|need|needs|must|please)\b.{0,40}\blog ?in\b/i,
  /\bsign ?in\s+(required|needed)\b/i,
  /\b(required|need|needs|must|please)\b.{0,40}\bsign ?in\b/i,
  /\b(?:API Error|HTTP)\b.{0,30}\b40[13]\b/i,
  /\b40[13]\b.{0,30}\b(?:request not allowed|unauthorized|forbidden|please run|login|proxy)\b/i,
  /unauthor/i,
  /not authenticated/i,
  /authentication (failed|required|error)/i,
  /\b(invalid|missing|expired|required)\b.{0,30}\bapi[_ -]?key\b/i,
  /\bapi[_ -]?key\b.{0,30}\b(invalid|missing|expired|required)\b/i,
  /request not allowed/i,
  /\bcredential(s)?\b.{0,30}\b(missing|required|invalid|expired|error|failed)\b/i,
  /\b(missing|required|invalid|expired|error|failed)\b.{0,30}\bcredential(s)?\b/i,
  /请.*登录|登录.*(失败|过期|后重试|必需|需要)/,
  /鉴权(失败|错误|过期)|认证失败|未授权/,
];

// Network-block signatures: cannot reach the API (VPN/proxy down, DNS, TLS).
const NETWORK_SIGNATURES: RegExp[] = [
  /ENOTFOUND/i,
  /ECONNREFUSED/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /EAI_AGAIN/i,
  /EHOSTUNREACH/i,
  /ENETUNREACH/i,
  /getaddrinfo/i,
  /fetch failed/i,
  /socket hang ?up/i,
  /\bproxy\b/i,
  /network (error|is )?(un)?reachable/i,
  /could not (resolve|connect)/i,
  /connection (refused|reset|timed out|error)/i,
  /\b(certificate|self-signed|tls|ssl) /i,
  /tunnel/i,
  /代理|网络(错误|不可达|连接)/,
];

/**
 * Classify a chunk of agent output for an external-block signature. AUTH wins
 * over NETWORK when both match (a 403 behind a working proxy is still an auth
 * problem). Returns null when nothing matches → treat as live/slow.
 */
export function classifyBlockSignature(text: string): "auth" | "network" | null {
  if (text === "") return null;
  if (AUTH_SIGNATURES.some((r) => r.test(text))) return "auth";
  if (NETWORK_SIGNATURES.some((r) => r.test(text))) return "network";
  return null;
}

export interface ProbeOptions {
  /** Working dir for the probe spawn (default process.cwd()). */
  cwd?: string;
  /** Hard cap (default 20s). A live agent answers a one-token echo in seconds;
   *  a blocked one errors fast or hangs to the cap. Generous enough to absorb a
   *  cold start (kimi/codex), short enough to not be "耗着". */
  timeoutMs?: number;
  /** The token the agent is asked to echo (default ROLL_LIVE_OK). */
  token?: string;
}

const DEFAULT_PROBE_TIMEOUT_MS = 20_000;
const PROBE_TOKEN = "ROLL_LIVE_OK";

/**
 * Cheap connectivity/auth probe — spawn the agent on a trivial echo prompt with a
 * short hard cap, then classify. Used ONLY on the review failure path (a silent
 * timeout with no signature) to tell a blocked agent from a slow one, so the loop
 * acts on the real cause instead of burning the (now longer) review budget on a
 * doomed call. Never throws.
 */
export async function probeAgentReachable(
  agent: string,
  spawn: AgentSpawn,
  opts: ProbeOptions = {},
): Promise<ReachResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const token = opts.token ?? PROBE_TOKEN;
  const cwd = opts.cwd ?? process.cwd();
  let res;
  try {
    res = await Promise.race([
      spawn(agent, { cwd, skillBody: `Reply with exactly: ${token}`, timeoutMs, bare: true }),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), timeoutMs).unref();
      }),
    ]);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    const sig = classifyBlockSignature(detail);
    return { agent, reachable: false, cause: sig ?? "unknown", detail: firstLine(detail) };
  }
  if (res === null || res.timedOut) {
    // Hung to the cap with no answer to a one-token prompt → almost certainly an
    // external block, but we can't say WHICH → unknown (soft).
    return { agent, reachable: false, cause: "unknown", detail: "probe hung (no response to echo)" };
  }
  const text = `${res.stdout}\n${res.stderr}`;
  const sig = classifyBlockSignature(text);
  if (sig !== null) return { agent, reachable: false, cause: sig, detail: firstLine(text) };
  if (res.exitCode !== 0) {
    return { agent, reachable: false, cause: "unknown", detail: `exit ${res.exitCode}: ${firstLine(text)}` };
  }
  // exit 0, no block signature → reachable. We do NOT require an exact token
  // match: some agents prepend reasoning; a clean non-error reply is enough.
  return { agent, reachable: true, cause: "live", detail: "ok" };
}

function firstLine(s: string): string {
  return (s.split("\n").find((l) => l.trim() !== "") ?? "").trim().slice(0, 200);
}
