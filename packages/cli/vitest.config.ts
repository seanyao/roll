import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Several suites spawn a `node` CLI leg + git/gh shims per case — solo
    // that's fast, but under the full suite's parallel load any of them can
    // blow vitest's 5s default. The generous ceiling is contention headroom,
    // not the expected cost; a real hang (e.g. a stray credential prompt)
    // still fails, just slower.
    testTimeout: 30_000,
    // Several files here are subprocess-bound (they spawn `node` CLI legs
    // and git/gh shims), so a worker per core oversubscribes the box
    // several-fold and starves those heavier harnesses. Cap the file-level
    // parallelism instead of letting it float.
    maxWorkers: 6,
    minWorkers: 1,
  },
});
