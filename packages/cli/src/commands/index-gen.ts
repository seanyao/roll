/**
 * US-META-001 — `roll index`: (re)generate `.roll/index.json`, the authoritative
 * ID→epic map the archive layout uses to place a card's deliverables under
 * `features/<epic>/<ID>/`. Deterministic + idempotent (see archive.generateIndex).
 */
import { generateIndex } from "../lib/archive.js";

/** `roll index` — regenerate the backlog-derived ID→epic index. */
export function indexCommand(args: string[]): number {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write("Usage: roll index\n  Regenerate .roll/index.json (ID→epic map) from .roll/backlog.md.\n");
    return 0;
  }
  const stories = generateIndex(process.cwd());
  const n = Object.keys(stories).length;
  process.stdout.write(`index.json regenerated\n索引已重建\n  ${n} stories mapped to epics (.roll/index.json)\n`);
  return 0;
}
