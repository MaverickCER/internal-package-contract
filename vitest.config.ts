import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "template/**"],
    watch: false,
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      include: ["checks/**/*.ts"],
      reporter: ["text", "html", "lcov", "json-summary"],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
})
