import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    watch: false,
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // "json" is load-bearing: it writes coverage/coverage-final.json, the raw per-file data the
      // Crap check hands to crap4ts.
      reporter: ["text", "html", "lcov", "json", "json-summary"],
      // Starting floor; raise as coverage improves, never lower it.
      thresholds: { branches: 90, functions: 100, lines: 95, statements: 95 },
    },
  },
})
