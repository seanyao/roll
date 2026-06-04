/**
 * `roll backlog` display mode — TS port of lib/roll-backlog.py (US-CLI-005).
 * Parses .roll/backlog.md and renders items grouped by type; management
 * subcommands (lint/unstick/sync/block/defer/unblock/promote) stay on bash.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolveLang, t, v2Catalog } from "@roll/spec";
import { c, pad, renderState, RESET_RAW, row, trunc } from "../render.js";

export const BACKLOG_MGMT_SUBCOMMANDS = [
  "lint",
  "unstick",
  "sync",
  "block",
  "defer",
  "unblock",
  "promote",
];

interface Item {
  id: string;
  desc: string;
  status: string;
  reason: string;
}

const ID_RE = /\[([^\]]+)\]\([^)]+\)/;
const REASON_RE = /\[([^\]]+)\]/;

function parseBacklog(path: string): Item[] {
  const items: Item[] = [];
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.replace(/\n$/, "");
    if (!line.startsWith("|")) continue;
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length < 4) continue;
    const idCell = parts[1] ?? "";
    const descCell = parts[2] ?? "";
    const statusCell = parts[3] ?? "";
    const m = ID_RE.exec(idCell);
    const itemId = m !== null ? (m[1] ?? "") : idCell.trim();
    if (!/^(US|FIX|REFACTOR|IDEA)-/.test(itemId)) continue;
    let reason = "";
    if (statusCell.includes("Blocked") || statusCell.includes("Deferred")) {
      const rm = REASON_RE.exec(statusCell);
      reason = rm !== null ? (rm[1] ?? "") : "";
    }
    items.push({ id: itemId, desc: descCell, status: statusCell, reason });
  }
  return items;
}

const MAX_DESC = 62;
const BG_RUN = "\x1b[48;2;40;20;70m";

export function backlogCommand(args: string[]): number {
  const noColor =
    args.includes("--no-color") || !process.stdout.isTTY || (process.env["NO_COLOR"] ?? "") !== "";
  renderState.useColor = !noColor;

  const backlog = ".roll/backlog.md";
  if (!existsSync(backlog)) {
    // Mirrors cmd_backlog's pre-check (bash err + msg catalog) — exit 1.
    const lang = resolveLang({
      rollLang: process.env["ROLL_LANG"],
      lcAll: process.env["LC_ALL"],
      lang: process.env["LANG"],
    });
    const RED = noColor ? "" : "\x1b[0;31m";
    const NC = noColor ? "" : "\x1b[0m";
    process.stderr.write(
      `${RED}[roll]${NC} ${t(v2Catalog, lang, "backlog.roll_backlog_md_not_found_run")}\n`,
    );
    return 1;
  }

  const items = parseBacklog(backlog);
  const todoFix: Item[] = [];
  const todoUs: Item[] = [];
  const todoRef: Item[] = [];
  const todoIdea: Item[] = [];
  const inProgress: Item[] = [];
  const blocked: Item[] = [];
  const deferred: Item[] = [];
  for (const it of items) {
    const st = it.status;
    if (st.includes("In Progress")) inProgress.push(it);
    else if (st.includes("Blocked")) blocked.push(it);
    else if (st.includes("Deferred")) deferred.push(it);
    else if (st.includes("Todo")) {
      if (it.id.startsWith("FIX-")) todoFix.push(it);
      else if (it.id.startsWith("US-")) todoUs.push(it);
      else if (it.id.startsWith("REFACTOR-")) todoRef.push(it);
      else if (it.id.startsWith("IDEA-")) todoIdea.push(it);
    }
  }

  const out: string[] = [];
  const todoTotal = todoFix.length + todoUs.length + todoRef.length + todoIdea.length;

  out.push("");
  let tags = c("fg", `${todoTotal + inProgress.length} Pending`, { bold: true });
  if (blocked.length > 0) tags += c("muted", " · ") + c("amber", `${blocked.length} Blocked`);
  if (deferred.length > 0) tags += c("muted", " · ") + c("dim", `${deferred.length} Deferred`);
  const headerLeft =
    "  " + c("pink", "BACKLOG", { bold: true }) + c("muted", "  ·  ") + c("dim", "待处理任务");
  out.push(row(headerLeft, "  " + tags));
  out.push("");

  if (inProgress.length > 0) {
    for (const it of inProgress) {
      if (renderState.useColor) {
        const line = `  ${c("purple", "⏵")} ${c("purple", pad(it.id, 16), { bold: true })}  ${c("purple", trunc(it.desc, MAX_DESC))}`;
        out.push(BG_RUN + line + RESET_RAW);
      } else {
        out.push(`  ⏵ ${it.id}  ${it.desc}`);
      }
    }
    out.push("");
  }

  const renderGroup = (titleEn: string, titleZh: string, color: string, group: Item[]): void => {
    if (group.length === 0) return;
    out.push(
      c(color, `  ${titleEn}`, { bold: true }) + c("muted", "  ·  ") + c("dim", titleZh) +
        c("muted", `  (${group.length})`),
    );
    for (const it of group) {
      out.push(`    ${c(color, pad(it.id, 16))}  ${c(color === "dim" ? "dim" : color, trunc(it.desc, MAX_DESC))}`);
    }
    out.push("");
  };

  renderGroup("Bug Fixes", "缺陷修复", "red", todoFix);
  renderGroup("User Stories", "用户故事", "blue", todoUs);
  renderGroup("Refactors", "重构", "amber", todoRef);
  renderGroup("Ideas", "创意", "dim", todoIdea);

  if (todoTotal === 0 && inProgress.length === 0) {
    out.push(c("green", "  ✓ Nothing pending — backlog is clear  暂无待处理任务"));
    out.push("");
  }

  if (blocked.length > 0) {
    out.push(
      c("amber", "  Blocked", { bold: true }) + c("muted", "  ·  ") + c("dim", "已阻塞") +
        c("muted", `  (${blocked.length})`),
    );
    for (const it of blocked) {
      const reasonStr = it.reason !== "" ? c("muted", `  (${it.reason})`) : "";
      out.push(`  🔒 ${c("amber", pad(it.id, 16))}  ${c("dim", trunc(it.desc, 50))}${reasonStr}`);
    }
    out.push("");
  }

  if (deferred.length > 0) {
    out.push(c("dim", `  Deferred  ·  已推迟  (${deferred.length})`));
    for (const it of deferred) {
      const reasonStr = it.reason !== "" ? c("muted", `  (${it.reason})`) : "";
      out.push(`  ⏸ ${c("dim", pad(it.id, 16))}  ${c("dim", trunc(it.desc, 50))}${reasonStr}`);
    }
    out.push("");
  }

  out.push(c("muted", "  ") + c("dim", "triage: ") + c("blue", "roll backlog block/defer/unblock <pattern> [reason]"));
  out.push("");
  process.stdout.write(out.join("\n") + "\n");
  return 0;
}
