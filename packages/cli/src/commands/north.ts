import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  buildNorthStarReport,
  type NorthStarBacklogEntry,
  type NorthStarCardMeta,
  type NorthStarDelivery,
  type NorthStarEvent,
  type NorthStarRun,
} from "@roll/core";
import { shWindowDays } from "../lib/sh-time.js";

const USAGE = "Usage: roll north --json\n  Emit the north-star metrics JSON. Read-only.\n";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringField(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" ? value : undefined;
}

function numberField(row: Record<string, unknown>, key: string): number | undefined {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArrayField(row: Record<string, unknown>, key: string): string[] | undefined {
  const value = row[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}

function jsonlObjects(paths: readonly string[]): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    if (!existsSync(path)) continue;
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim();
      if (line === "" || seen.has(line)) continue;
      seen.add(line);
      try {
        const parsed = JSON.parse(line) as unknown;
        if (isRecord(parsed)) rows.push(parsed);
      } catch {
        continue;
      }
    }
  }
  return rows;
}

function rotatedPaths(dir: string, base: string): string[] {
  const paths = [join(dir, base)];
  for (let i = 1; i < 5; i++) paths.push(join(dir, `${base}.${i}`));
  return paths;
}

function projectRoot(): string {
  const envRoot = (process.env["ROLL_MAIN_PROJECT"] ?? "").trim();
  return envRoot === "" ? process.cwd() : envRoot;
}

function loopDir(root: string): string {
  const envDir = (process.env["ROLL_PROJECT_RUNTIME_DIR"] ?? "").trim();
  return envDir === "" ? join(root, ".roll", "loop") : envDir;
}

function readRuns(dir: string): NorthStarRun[] {
  return jsonlObjects(rotatedPaths(dir, "runs.jsonl")).map((row) => ({
    runId: stringField(row, "run_id") ?? stringField(row, "runId"),
    cycleId: stringField(row, "cycle_id") ?? stringField(row, "cycleId"),
    status: stringField(row, "status"),
    outcome: stringField(row, "outcome"),
    ts: stringField(row, "ts") ?? numberField(row, "ts"),
    storyId: stringField(row, "story_id") ?? stringField(row, "storyId"),
    built: stringArrayField(row, "built"),
    failureClass: stringField(row, "failure_class") ?? stringField(row, "failureClass"),
    rootCauseKey: stringField(row, "root_cause_key") ?? stringField(row, "rootCauseKey"),
  }));
}

function readEvents(dir: string): NorthStarEvent[] {
  return jsonlObjects(rotatedPaths(dir, "events.ndjson")).map((row) => ({
    type: stringField(row, "type"),
    ts: stringField(row, "ts") ?? numberField(row, "ts"),
    storyId: stringField(row, "storyId") ?? stringField(row, "story_id"),
    cycleId: stringField(row, "cycleId") ?? stringField(row, "cycle_id"),
    actor: stringField(row, "actor"),
    failureClass: stringField(row, "failure_class") ?? stringField(row, "failureClass"),
  }));
}

function readDeliveries(dir: string): NorthStarDelivery[] {
  return jsonlObjects(rotatedPaths(dir, "deliveries.jsonl")).map((row) => {
    const mergedAt = row["mergedAt"];
    const delivery: NorthStarDelivery = {
      storyId: stringField(row, "storyId") ?? stringField(row, "story_id") ?? "",
      lifecycleState: stringField(row, "lifecycleState") ?? stringField(row, "lifecycle_state"),
      recordedAt: numberField(row, "recordedAt") ?? numberField(row, "recorded_at"),
    };
    if (isRecord(mergedAt)) {
      delivery.mergedAt = {
        present: typeof mergedAt["present"] === "boolean" ? mergedAt["present"] : undefined,
        value: typeof mergedAt["value"] === "number" ? mergedAt["value"] : undefined,
      };
    }
    return delivery;
  }).filter((delivery) => delivery.storyId !== "");
}

function readBacklog(root: string): NorthStarBacklogEntry[] {
  const path = join(root, ".roll", "backlog.md");
  if (!existsSync(path)) return [];
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const entries: NorthStarBacklogEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((cell) => cell.trim()).filter((cell) => cell !== "");
    if (cells.length < 3 || /^-+$/.test(cells[0] ?? "")) continue;
    const idCell = cells[0] ?? "";
    const idMatch = /\b([A-Z][A-Z0-9]*(?:-[A-Z0-9a-z]+)*-\d+[a-z]?)\b/.exec(idCell);
    if (idMatch === null) continue;
    entries.push({ id: idMatch[1] ?? "", status: cells[cells.length - 1] ?? "" });
  }
  return entries.filter((entry) => entry.id !== "");
}

function walkFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  let st;
  try {
    st = statSync(dir);
  } catch {
    return [];
  }
  if (!st.isDirectory()) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

function frontmatter(text: string): Record<string, string> {
  if (!text.startsWith("---")) return {};
  const end = text.indexOf("\n---", 3);
  if (end < 0) return {};
  const meta: Record<string, string> = {};
  for (const line of text.slice(3, end).split("\n")) {
    const m = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*?)\s*$/.exec(line);
    if (m !== null) meta[m[1] ?? ""] = (m[2] ?? "").replace(/^["']|["']$/g, "");
  }
  return meta;
}

function gitCreatedFallback(root: string, specPath: string): string | undefined {
  const metaRoot = join(root, ".roll");
  if (!existsSync(metaRoot)) return undefined;
  try {
    const out = execFileSync("git", ["-C", metaRoot, "log", "--diff-filter=A", "--format=%ct", "--", specPath.slice(metaRoot.length + 1)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim().split("\n").filter((line) => line !== "").at(-1);
    if (out === undefined) return undefined;
    const seconds = Number(out);
    return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString().slice(0, 10) : undefined;
  } catch {
    return undefined;
  }
}

function readCards(root: string): NorthStarCardMeta[] {
  const featuresRoot = join(root, ".roll", "features");
  const cards: NorthStarCardMeta[] = [];
  for (const path of walkFiles(featuresRoot).filter((item) => item.endsWith("spec.md"))) {
    let text = "";
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    const fm = frontmatter(text);
    const id = fm["id"];
    if (id === undefined || id === "") continue;
    const card: NorthStarCardMeta = { id };
    const type = fm["type"] ?? id.split("-")[0]?.toLowerCase();
    const epic = fm["epic"] ?? path.slice(featuresRoot.length + 1).split("/")[0];
    const created = fm["created"] ?? (/^FIX-/i.test(id) ? gitCreatedFallback(root, path) : undefined);
    const rootCauseKey = fm["root_cause_key"] ?? fm["rootCauseKey"];
    if (type !== undefined && type !== "") card.type = type;
    if (epic !== undefined && epic !== "") card.epic = epic;
    if (created !== undefined && created !== "") card.created = created;
    if (rootCauseKey !== undefined && rootCauseKey !== "") card.rootCauseKey = rootCauseKey;
    cards.push(card);
  }
  return cards;
}

function nowForNorth(): Date {
  const injected = (process.env["ROLL_NORTH_NOW"] ?? "").trim();
  if (injected !== "") {
    const parsed = Date.parse(injected);
    if (Number.isFinite(parsed)) return new Date(parsed);
  }
  return new Date();
}

export function northCommand(args: string[]): number {
  if (args[0] !== "--json") {
    process.stderr.write(USAGE);
    return 1;
  }
  const root = projectRoot();
  const dir = loopDir(root);
  const now = nowForNorth();
  const report = buildNorthStarReport({
    nowMs: now.getTime(),
    days: shWindowDays(now, 14),
    runs: readRuns(dir),
    events: readEvents(dir),
    cards: readCards(root),
    backlog: readBacklog(root),
    deliveries: readDeliveries(dir),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return 0;
}
