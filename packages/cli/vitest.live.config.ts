import { configDefaults, defineConfig } from "vitest/config";

/**
 * US-BROW-020 — config for the declared live managed-lane gate ONLY.
 *
 * The default config (vitest.config.ts) excludes `**\/*.live.test.ts` so the
 * live gate never runs in `roll test` / `npm test`. That exclude also blocks an
 * explicit `vitest run test/live/...` filter, so the Chrome-capable CI lane
 * (`pnpm test:browser-live`) uses THIS config, which includes exactly the live
 * gate and nothing else.
 */
export default defineConfig({
  test: {
    include: ["test/live/**/*.live.test.ts"],
    exclude: [...configDefaults.exclude],
    testTimeout: 300_000,
    maxWorkers: 1,
    minWorkers: 1,
  },
});
