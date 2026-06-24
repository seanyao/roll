#!/usr/bin/env node
// Roll v3 CLI entry — TS-first (US-SCAF-004).
import { createProductionWakeDeps, dispatch, registerAll } from "../dist/index.js";

registerAll();

// US-LOOP-079i: build production wake deps so the wake-on-roll-command hook
// fires on productive commands when the loop is DORMANT. Best-effort —
// if the project identity is unavailable, the hook simply doesn't fire.
const wakeDeps = await createProductionWakeDeps();

const { status } = await dispatch(process.argv.slice(2), undefined, wakeDeps);
process.exit(status);
