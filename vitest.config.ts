import { defineConfig } from "vitest/config";

/**
 * Root Vitest configuration.
 *
 * The workspace is declared in `vitest.workspace.ts`. This root config supplies
 * global defaults (exclusions, etc.) inherited by every workspace project.
 *
 * FIX-1387: cycle worktrees live under `.roll/loop/worktrees/`; without an
 * explicit exclude, Vitest recurses into those nested checkouts and tries to
 * run their tests too, failing on duplicate / out-of-sync files.
 */
export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      ".roll/loop/worktrees/**",
    ],
  },
});
