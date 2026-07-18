import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/live/**/*.live.test.ts"],
    exclude: [...configDefaults.exclude],
    testTimeout: 120_000,
    maxWorkers: 1,
    minWorkers: 1,
  },
});
