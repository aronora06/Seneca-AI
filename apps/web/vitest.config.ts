import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "happy-dom",
    pool: "threads",
    reporters: ["default"],
    setupFiles: ["./test/setup.ts"],
  },
});
