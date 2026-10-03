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
      // Everything this package ships and runs: the checks, the scripts they and consumers call, and the
      // CLI. (Coverage used to cover `checks/` only, which left the API-contract engine that decides
      // every package's release bump, and the whole benchmark kit, outside every gate.)
      include: ["checks/**/*.ts", "scripts/**/*.{ts,mjs}", "bin/**/*.mjs"],
      // Process entry points: a few lines that read argv/env, call a tested function and print. They
      // are exercised by tests that spawn them as a child process, which V8 coverage cannot attribute,
      // so their logic lives in the importable modules above and the shell is excluded -- the one
      // exclusion this package makes, and the reason for each is its file's own header comment.
      exclude: [
        "**/*.d.mts",
        "scripts/check-*.mjs",
        "scripts/audit-dev-deps.mjs",
        "scripts/code-scanning-alerts.mjs",
        "scripts/git-hygiene.mjs",
        "scripts/run-*.mjs",
        "scripts/socket-package-score.mjs",
        "scripts/benchmark/run-suite.mjs",
        "bin/*.mjs",
      ],
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
