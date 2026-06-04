#!/usr/bin/env node
// Roll v3 CLI entry — TS-first, bash fallback (US-SCAF-004).
import { dispatch } from "../dist/index.js";

const { status } = await dispatch(process.argv.slice(2));
process.exit(status);
