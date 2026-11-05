import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["e2e/**/*.e2e.test.ts"],
    // Fails the run with a message naming the missing environment variables, or the unreachable
    // PDS, instead of letting every test fail with a network error.
    globalSetup: ["e2e/global-setup.ts"],
    // The tests count the records in two shared accounts, so test files must not write at the
    // same time.
    fileParallelism: false,
    // Real network round trips, with blob uploads and applyWrites commits.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
