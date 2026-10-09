/**
 * Baseline Stryker config for a publishable TypeScript package -- the default the
 * `Mutation` check uses when a consumer has no `stryker.config.*` of its own.
 *
 * A consumer extends it:
 *
 *   import baseline from "internal-package-contract/config/stryker"
 *   export default { ...baseline, mutate: [...baseline.mutate, "!src/legacy/**"] }
 *
 * No score threshold is set here -- the `Mutation` check owns the policy
 * (checks/mutation.ts) and it isn't a numeric score gate at all: it's
 * zero-tolerance, requiring exactly 0 Survived/NoCoverage/Timeout mutants
 * (each waivable only via a documented exception record), so
 * `thresholds.break` is left undefined on purpose.
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
  // One worker. With several, tests that spawn processes or hold timers contend for CPU: they then
  // time out and are counted as kills, while other mutants lose their attributed runs and survive,
  // so the set of survivors differs from run to run (measured on a 6k-mutant package: 143 non-killed
  // at four workers, 209 at one, only 93 in common) and a full run was slower at four workers than at
  // one. A consumer whose suite is purely synchronous can raise it.
  concurrency: 1,
  disableTypeChecks: "{src,test}/**/*.{ts,tsx}",
  tempDirName: ".stryker-tmp",
  cleanTempDir: true,
}
