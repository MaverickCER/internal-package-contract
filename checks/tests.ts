/**
 * The consumer's whole Vitest suite, run once WITH V8 coverage instrumentation.
 *
 * repo-contract splits this into `test-unit`/`test-integration`/`test-property`/
 * `test-e2e`; here one `Tests` check runs everything. It is the single
 * heaviest check, so it also produces the coverage artifacts the `Coverage` and
 * `Crap` checks then read (they `dependsOn` it) -- one Vitest run, not three.
 *
 * The Vitest JSON report goes to a file (`--outputFile`) so stdout stays free
 * for the coverage reporter; the policy reads the file and delegates the verdict
 * to repo-contract's own `test` preset policy.
 */
import { readFile } from "node:fs/promises"
import path from "node:path"
import type { CheckDefinitionConfig, PolicyContext, PolicyResult } from "repo-contract"
import { test as testPreset } from "repo-contract/presets"
import { abnormalTermination, combinedOutput } from "./shared.js"

/** Where the Vitest JSON reporter writes; also read by `Coverage`/`Crap` siblings via `coverage/`. */
export const VITEST_RESULTS_PATH = "reports/vitest-results.json"

/** @returns the `Tests` check. */
export function tests(): CheckDefinitionConfig {
  return {
    run: [
      "vitest",
      "run",
      "--coverage",
      "--coverage.provider=v8",
      "--coverage.reporter=json-summary",
      "--coverage.reporter=json",
      "--coverage.reportsDirectory=coverage",
      "--reporter=json",
      `--outputFile=${VITEST_RESULTS_PATH}`,
    ],
    policy: async (ctx): Promise<PolicyResult> => {
      const terminated = abnormalTermination(ctx.result, "Vitest")
      if (terminated) return { outcome: "fail", rationale: terminated }

      let value: unknown
      try {
        // Stryker disable next-line StringLiteral: an equivalent mutant -- `readFile(path, "")`
        // returns a Buffer instead of a string, but `JSON.parse` coerces any non-string argument
        // via its default (utf8) `toString()`, which produces byte-for-byte the same text `"utf8"`
        // would have decoded. Hand-verified: forcing this to `""` leaves every test in
        // tests-check.test.ts passing unchanged.
        value = JSON.parse(await readFile(path.join(process.cwd(), VITEST_RESULTS_PATH), "utf8"))
      } catch {
        const tail = combinedOutput(ctx.result).slice(-3000)
        return {
          outcome: "fail",
          rationale: `Tests: Vitest did not produce ${VITEST_RESULTS_PATH}.${tail ? `\n${tail}` : ""}`,
        }
      }

      // Stryker disable StringLiteral: an equivalent mutant -- `testPreset`'s own policy never
      // reads `output.format`, only `output.success` and `output.value`. Hand-verified: forcing
      // this to `""` leaves every test in tests-check.test.ts passing unchanged.
      const synthetic: PolicyContext = {
        ...ctx,
        result: { ...ctx.result, output: { format: "json", success: true, value } },
      }
      // Stryker restore StringLiteral
      return testPreset.policy(synthetic)
    },
  }
}
