#!/usr/bin/env node
try {
  await import("../dist/postinstall.mjs");
} catch (error) {
  // The source checkout may not have been bundled yet. Published tarballs carry
  // dist/postinstall.mjs; either way npm install must never fail here.
  const reason = error instanceof Error ? error.message : String(error);
  process.stderr.write(`postinstall skipped: ${reason}\n`);
}
