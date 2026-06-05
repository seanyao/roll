import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Difftests spawn the bash oracle (bin/roll, ~7k lines) once per case —
    // solo that's 1-2s, but under the full suite's parallel load (or a
    // concurrent bats run) any of them can blow vitest's 5s default. The
    // generous ceiling is contention headroom, not the expected cost; a real
    // hang (e.g. a stray credential prompt) still fails, just slower.
    testTimeout: 30_000,
  },
});
