import { defineConfig } from "vitest/config";

// Unit tests only. The end-to-end tests in e2e/ need a running PDS and have their own config
// (vitest.e2e.config.ts), so `pnpm test` never picks them up.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
