/**
 * Baseline Stryker config for a publishable TypeScript package -- the default the
 * `Mutation` check uses when a consumer has no `stryker.config.*` of its own.
 *
 * A consumer extends it:
 *
 *   import baseline from "internal-package-contract/config/stryker"
 *   export default { ...baseline, mutate: [...baseline.mutate, "!src/legacy/**"] }
 *
 * The mutation-score threshold is NOT set here -- the `Mutation` check owns that
 * number (`MUTATION_THRESHOLD` in checks/mutation.ts) and reads the report
 * directly, so `thresholds.break` is left undefined on purpose.
 *
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
export default {
  packageManager: "npm",
  testRunner: "vitest",
  reporters: ["json", "clear-text", "progress"],
  coverageAnalysis: "perTest",
  mutate: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.{test,spec}.{ts,tsx}",
    "!src/**/*.d.ts",
    "!src/**/__tests__/**",
    "!src/**/__mocks__/**",
  ],
  ignoreStatic: true,
  disableTypeChecks: "{src,test}/**/*.{ts,tsx}",
  tempDirName: ".stryker-tmp",
  cleanTempDir: true,
}
