import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Difftests spawn the bash oracle (bin/roll, ~7k lines) once per case —
    // solo that's 1-2s, but under the full suite's parallel load (or a
    // concurrent bats run) any of them can blow vitest's 5s default. The
    // generous ceiling is contention headroom, not the expected cost; a real
    // hang (e.g. a stray credential prompt) still fails, just slower.
    testTimeout: 30_000,
    // Most files here are subprocess-bound (each spawns oracle + leg process
    // trees), so a worker per core oversubscribes the box several-fold and
    // starves the heavyweight harnesses (parallel-verify's v2 leg) past their
    // watchdogs. Cap the file-level parallelism instead of letting it float.
    maxWorkers: 6,
    minWorkers: 1,
  },
});
