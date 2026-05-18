import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    pool: "threads",
    reporters: ["default"],
    // Anthropic / Supabase / Voyage clients are mocked per-test; never let
    // a unit suite reach the public internet.
    setupFiles: ["./test/setup.ts"],
  },
});
