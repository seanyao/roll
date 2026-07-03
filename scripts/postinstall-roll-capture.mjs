#!/usr/bin/env node
try {
  await import("../dist/postinstall.mjs");
} catch {
  // The source checkout may not have been bundled yet. Published tarballs carry
  // dist/postinstall.mjs; either way npm install must never fail here.
}
