/**
 * US-PAIR-001 — `roll pair init`: scaffold an explicit `.roll/pairing.yaml` from
 * the live registry. The owner's "third way": not a hidden default-on (invisible)
 * and not hand-authored opt-in (toil), but an auto-generated yet auditable file —
 * the generator fills it, you can read/diff/edit it, and its presence is the
 * on/off switch (delete to disable; pairing never fires silently).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { agentsInstalled, defaultPairingConfig, renderPairingConfig } from "@roll/core";
import { realAgentEnv } from "./agent-list.js";

const HELP = `Usage: roll pair init [--force]
  Scaffold .roll/pairing.yaml from installed agents (roll agents list).
  File present = pairing on; delete it = off. --force overwrites an existing file.

  从已安装的 agent 物化 .roll/pairing.yaml；文件在=开，删掉=关；--force 覆盖已有文件。
`;

export function pairCommand(args: string[]): number {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    process.stdout.write(HELP);
    return 0;
  }
  if (args[0] !== "init") {
    process.stderr.write(`[roll] unknown pair subcommand: ${args[0]}\n`);
    process.stderr.write(HELP);
    return 1;
  }
  // strict arg check (kimi pair-review): reject stray args rather than silently
  // accept `roll pair init --force extra`.
  const extra = args.slice(1).filter((a) => a !== "--force");
  if (extra.length > 0) {
    process.stderr.write(`[roll] unexpected argument(s): ${extra.join(" ")}\n`);
    process.stderr.write(HELP);
    return 1;
  }
  const force = args.includes("--force");
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
