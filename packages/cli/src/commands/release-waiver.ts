/**
 * US-TRUTH-005 — `roll release waiver`: the recorded owner bypass.
 *
 * The ONLY sanctioned way past a fail-level drift at the release gate: a
 * waiver with reason, scope, expiry, operator and timestamp, appended to the
 * event stream where every later audit can see it (release_waiver anchor —
 * an env-var or shell-flag bypass is itself drift). Expiry is mandatory:
 * an expired waiver blocks again.
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { EventBus } from "@roll/core";

function eventsPath(cwd: string): string {
  const rt = (process.env["ROLL_PROJECT_RUNTIME_DIR"] ?? "").trim();
  return join(rt !== "" ? rt : join(cwd, ".roll", "loop"), "events.ndjson");
}

function operatorName(cwd: string): string {
  try {
    const n = execFileSync("git", ["config", "user.name"], { cwd, encoding: "utf8" }).trim();
    if (n !== "") return n;
  } catch {
    /* fall through */
  }
  return process.env["USER"] ?? "unknown";
}

export interface WaiverDeps {
  nowSec?: number;
  operator?: string;
  append?: (cwd: string, event: object) => void;
}

export function releaseWaiverCommand(args: string[], deps: WaiverDeps = {}): number {
  const get = (flag: string): string => {
    const i = args.indexOf(flag);
    return i >= 0 ? (args[i + 1] ?? "") : "";
  };
  const reason = get("--reason");
  const scope = get("--scope");
  const days = Number.parseFloat(get("--days") || "0");
  if (reason.trim() === "" || scope.trim() === "" || !Number.isFinite(days) || days <= 0) {
    process.stderr.write(
      "Usage: roll release waiver --reason <why> --scope <rule|subject|all> --days <n>\n" +
        "  Records an owner waiver into the fact stream (events.ndjson).\n" +
        "  A waiver without reason/scope/expiry is not a waiver — all three are required.\n",
    );
    return 1;
  }
  const cwd = process.cwd();
  const nowSec = deps.nowSec ?? Math.floor(Date.now() / 1000);
  const operator = deps.operator ?? operatorName(cwd);
  const event = {
    type: "release:waiver",
    reason: reason.trim(),
    scope: scope.trim(),
    expiresSec: Math.floor(nowSec + days * 86400),
    operator,
    ts: nowSec,
  };
  const append =
    deps.append ??
    ((c: string, e: object): void => {
      new EventBus().appendEvent(eventsPath(c), e as never);
    });
  append(cwd, event);
  process.stdout.write(
    `✓ waiver recorded: scope=${scope.trim()} expires in ${days}d operator=${operator}\n` +
      `✓ 豁免已记录入事实流——后续审计与发版闸都会看到它\n`,
  );
  return 0;
}
