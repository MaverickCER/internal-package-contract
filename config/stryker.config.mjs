/**
 * Baseline Stryker config for a publishable TypeScript package: the default the
 * `Mutation` check uses when a consumer has no `stryker.config.*` of its own.
 *
 * A consumer extends it:
 *
 *   import baseline from "internal-package-contract/config/stryker"
 *   export default { ...baseline, mutate: [...baseline.mutate, "!src/legacy/**"] }
 *
 * No score threshold is set here, so `thresholds.break` is left undefined on
 * purpose. The `Mutation` check owns the policy: repo-contract's Mutation preset
 * at a score of 100 (checks/strict.ts). No Survived, NoCoverage or Timeout
 * mutant passes, unless a documented exception record covers it; no record
 * covers a Timeout.
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
  // One worker. With several, tests that spawn processes or hold timers contend for CPU. They then
  // exceed the test runner's per-test timeout and fail. That reads as a killed mutant even when the
  // mutation changed nothing, while other mutants lose their attributed runs and survive. This is
  // the test's own timeout, not Stryker's `Timeout` status, which the Mutation check rejects. The
  // survivors then differ from run to run. On a 6k-mutant package: 143 non-killed at four workers,
  // 209 at one, only 93 in common. A full run was also slower at four workers than at one. A
  // consumer whose suite is purely synchronous can raise it.
  concurrency: 1,
  // The first, unmutated run reruns the whole suite with per-test coverage. Stryker's 5-minute default
  // aborted it on a loaded machine. 10 matches repo-contract's strykerConfig().
  dryRunTimeoutMinutes: 10,
  disableTypeChecks: "{src,test}/**/*.{ts,tsx}",
  tempDirName: ".stryker-tmp",
  cleanTempDir: true,
}
