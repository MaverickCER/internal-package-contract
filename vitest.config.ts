import { defineConfig } from "vitest/config"
import { ENTRY_SHELLS, NON_RUNTIME } from "./scope.mjs"

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "template/**"],
    watch: false,
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      // Everything this package ships and runs -- see scope.mjs for the one exclusion (process entry
      // points) and why.
      include: ["checks/**/*.ts", "scripts/**/*.{ts,mjs}", "bin/**/*.mjs"],
      exclude: [...NON_RUNTIME, ...ENTRY_SHELLS],
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
