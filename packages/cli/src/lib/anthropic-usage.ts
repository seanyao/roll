import { execFileSync } from "node:child_process";
import type { UsageLimitSnapshot, UsageLimitWindow, UsageLimitWindowName } from "../commands/loop-go.js";

interface FetchResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

type FetchLike = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<FetchResponse>;

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const USAGE_TIMEOUT_MS = 10_000;
const KEYCHAIN_SERVICES = ["Claude Code", "claude-code", "Claude Code OAuth", "claude-code-oauth"] as const;

function envToken(): string | undefined {
  const token = (process.env["ANTHROPIC_AUTH_TOKEN"] ?? process.env["CLAUDE_CODE_OAUTH_TOKEN"] ?? "").trim();
  return token === "" ? undefined : token;
}

function keychainToken(): string | undefined {
  if (process.platform !== "darwin") return undefined;
  for (const service of KEYCHAIN_SERVICES) {
    try {
      const raw = execFileSync("security", ["find-generic-password", "-s", service, "-w"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      const token = tokenFromSecret(raw);
      if (token !== undefined) return token;
    } catch {
      /* try the next known service name */
    }
  }
  return undefined;
}

function tokenFromSecret(raw: string): string | undefined {
  if (raw === "") return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const key of ["access_token", "oauth_token", "token"]) {
      const value = parsed[key];
      if (typeof value === "string" && value.trim() !== "") return value.trim();
    }
  } catch {
    /* plain token */
  }
  return raw;
}

function fetchImpl(): FetchLike | undefined {
  return typeof fetch === "function" ? (fetch as FetchLike) : undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function resetSec(value: unknown): number | undefined {
  const n = num(value);
  if (n !== undefined) return n > 10_000_000_000 ? Math.floor(n / 1000) : Math.floor(n);
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : undefined;
}

function windowFromRecord(window: UsageLimitWindowName, record: Record<string, unknown>): UsageLimitWindow | undefined {
  const used = num(record["used"] ?? record["usage"] ?? record["current"] ?? record["consumed"]);
  const limit = num(record["limit"] ?? record["quota"] ?? record["cap"] ?? record["maximum"]);
  if (used === undefined || limit === undefined) return undefined;
  const resetAtSec = resetSec(record["resetAt"] ?? record["reset_at"] ?? record["resetsAt"] ?? record["resets_at"] ?? record["end"] ?? record["ends_at"]);
  return {
    window,
    used,
    limit,
    ...(resetAtSec !== undefined ? { resetAtSec } : {}),
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export function normalizeAnthropicUsagePayload(payload: unknown): UsageLimitSnapshot {
  const root = record(payload);
  if (root === undefined) return { status: "unknown", reason: "usage_api_unrecognized" };
  const usage = record(root["usage"]) ?? root;
  const candidates: Array<[UsageLimitWindowName, unknown]> = [
    ["five_hour", usage["five_hour"] ?? usage["fiveHour"] ?? usage["5h"] ?? usage["five_hour_window"]],
    ["weekly", usage["weekly"] ?? usage["week"] ?? usage["7d"] ?? usage["seven_day"]],
  ];
  const windows = candidates.flatMap(([window, value]) => {
    const r = record(value);
    const parsed = r === undefined ? undefined : windowFromRecord(window, r);
    return parsed === undefined ? [] : [parsed];
  });
  return windows.length > 0 ? { status: "known", windows } : { status: "unknown", reason: "usage_api_unrecognized" };
}

export async function readAnthropicUsageLimits(fetcher: FetchLike | undefined = fetchImpl()): Promise<UsageLimitSnapshot> {
  const token = envToken() ?? keychainToken();
  if (token === undefined) return { status: "unknown", reason: "usage_credentials_missing" };
  if (fetcher === undefined) return { status: "unknown", reason: "fetch_unavailable" };
  const controller = typeof AbortController === "function" ? new AbortController() : undefined;
  const timeout = controller === undefined ? undefined : setTimeout(() => controller.abort(), USAGE_TIMEOUT_MS);
  try {
    const res = await fetcher(USAGE_URL, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
      },
      ...(controller !== undefined ? { signal: controller.signal } : {}),
    });
    if (!res.ok) return { status: "unknown", reason: `usage_api_http_${res.status}` };
    return normalizeAnthropicUsagePayload(await res.json());
  } catch {
    return { status: "unknown", reason: "usage_api_unreachable" };
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
