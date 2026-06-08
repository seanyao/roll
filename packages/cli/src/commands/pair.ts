/**
 * Cross-Agent Pairing CLI surface.
 *   `roll pair init`   (US-PAIR-001) — scaffold an explicit .roll/pairing.yaml.
 *   `roll pair status` (US-PAIR-002) — observability: who is in the pairing pool,
 *     their vendor + capability, and why an agent is excluded. Observability is a
 *     first-class need; kept OFF `roll agent list` (byte-difftest'd) by living
 *     under `pair` so the existing command's output is untouched.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  agentDisplayName,
  agentsInstalled,
  defaultPairingConfig,
  pairingPoolView,
  parsePairingConfig,
  renderPairingConfig,
} from "@roll/core";
import { realAgentEnv } from "./agent-list.js";

const HELP = `Usage: roll pair <init|status>
  init [--force]   Scaffold .roll/pairing.yaml from installed agents.
                   File present = pairing on; delete it = off. --force overwrites.
  status           Show the pairing pool: who pairs, vendor, capability, why excluded.

  init   从已安装的 agent 物化 .roll/pairing.yaml；文件在=开，删掉=关；--force 覆盖。
  status 显示结对池：谁能结对、厂商、能力、谁因何被排除。
`;

export function pairCommand(args: string[]): number {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    process.stdout.write(HELP);
    return 0;
  }
  if (args[0] === "init") return pairInit(args.slice(1));
  if (args[0] === "status") return pairStatus(args.slice(1));
  process.stderr.write(`[roll] unknown pair subcommand: ${args[0]}\n`);
  process.stderr.write(HELP);
  return 1;
}

function pairInit(rest: string[]): number {
  // strict arg check (kimi pair-review): reject stray args.
  const extra = rest.filter((a) => a !== "--force");
  if (extra.length > 0) {
    process.stderr.write(`[roll] unexpected argument(s): ${extra.join(" ")}\n`);
    process.stderr.write(HELP);
    return 1;
  }
  const force = rest.includes("--force");
  const path = join(process.cwd(), ".roll", "pairing.yaml");

  if (existsSync(path) && !force) {
    process.stdout.write(
      `pairing.yaml already exists — left untouched (use --force to regenerate)\n` +
        `pairing.yaml 已存在，未改动（--force 可重新生成）\n  ${path}\n`,
    );
    return 0;
  }

  const installed = agentsInstalled(realAgentEnv());
  const cfg = defaultPairingConfig(installed);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderPairingConfig(cfg), "utf8");

  const peers = Object.keys(cfg.capability).join(", ") || "(none)";
  process.stdout.write(
    `pairing.yaml written\npairing.yaml 已生成\n` +
      `  ${path}\n` +
      `  enabled: ${cfg.enabled} · stages: [${cfg.stages.join(", ")}]\n` +
      `  agents: ${peers}\n` +
      (cfg.enabled
        ? `  Pairing is ON for the code stage — a different-vendor agent will cross-check each delivery.\n` +
          `  已为 code 阶段开启结对——交付会由一个不同厂商的 agent 互检。\n`
        : `  Pairing is OFF: fewer than two distinct vendors installed (no heterogeneous peer).\n` +
          `  结对未开启：已装 agent 不足两个不同厂商（无异构搭档）。\n`),
  );
  return 0;
}

function pairStatus(rest: string[]): number {
  if (rest.length > 0) {
    process.stderr.write(`[roll] unexpected argument(s): ${rest.join(" ")}\n`);
    return 1;
  }
  const path = join(process.cwd(), ".roll", "pairing.yaml");
  if (!existsSync(path)) {
    process.stdout.write(
      `pairing is OFF — no .roll/pairing.yaml (run \`roll pair init\`)\n` +
        `结对未开启——没有 .roll/pairing.yaml（先跑 \`roll pair init\`）\n`,
    );
    return 0;
  }
  const noColor = (process.env["NO_COLOR"] ?? "") !== "";
  const GREEN = noColor ? "" : "\x1b[0;32m";
  const DIM = noColor ? "" : "\x1b[0;90m";
  const NC = noColor ? "" : "\x1b[0m";

  let view;
  try {
    view = pairingPoolView(agentsInstalled(realAgentEnv()), parsePairingConfig(readFileSync(path, "utf8")));
  } catch (e) {
    process.stderr.write(`[roll] pairing.yaml invalid: ${(e as Error).message}\n`);
    return 1;
  }

  const out: string[] = ["", `  Cross-Agent Pairing — pool status / 结对池状态`, ""];
  out.push(`  enabled: ${view.enabled} · stages: [${view.stages.join(", ")}]`, "");
  for (const a of view.agents) {
    const disp = agentDisplayName(a.agent);
    const cap = a.capability.length > 0 ? `[${a.capability.join(", ")}]` : "—";
    if (a.inPool) {
      out.push(`    ${GREEN}✓ ${disp}${NC}  ${DIM}vendor=${a.vendor} · ${cap}${NC}`);
    } else {
      out.push(`    ${DIM}· ${disp}  vendor=${a.vendor} · ${cap} · excluded: ${a.reason}${NC}`);
    }
  }
  out.push("");
  process.stdout.write(out.join("\n") + "\n");
  return 0;
}
