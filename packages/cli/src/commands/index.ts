/** Ported-command registry — one line per migrated subcommand. */
import { registerPorted } from "../bridge.js";
import { statusCommand } from "./status.js";

let registered = false;

export function registerAll(): void {
  if (registered) return;
  registered = true;
  registerPorted("status", statusCommand);
}
