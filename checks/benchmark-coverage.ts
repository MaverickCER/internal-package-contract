/**
 * `BenchmarkCoverage`: every public function with several inputs is benchmarked across all of them.
 *
 * Reads: the committed API baselines under `.repo-contract/api-contract/`, which list the public
 * functions and their signatures. Then each suite's committed `results.json`, whose
 * `analysis.coverage` says what the benchmark swept, varied, held fixed or left out, and why. Both
 * through `scripts/check-benchmark-coverage.mjs` and `scripts/benchmark/coverage/scan.mjs`. Nothing
 * is measured and no build is needed.
 *
 * Fails on a function, or one of its inputs, that no benchmark accounts for. Fails when a suite's
 * results predate `analysis.coverage`; `benchmark --render` rewrites them without measuring. Never
 * warns. Passes with no API baseline: there are no public functions to cover.
 *
 * Exceptions: none in a registry. A function is listed under the suite's `notBenchmarked` with the
 * reason.
 *
 * Runs in the consumer `contract` job and in both git hooks. IPC's own self-contract leaves it out.
 */
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { packageRoot, parseToolEnvelope } from "./shared.js"

const scriptPath = path.join(packageRoot, "scripts", "check-benchmark-coverage.mjs")

interface CoverageReport {
  readonly ok: boolean
  readonly state: "no-api" | "no-coverage" | "checked"
  readonly suites: readonly string[]
  readonly functions: number
  readonly findings: readonly { readonly message: string }[]
  readonly stale: readonly string[]
}

/** @returns the `BenchmarkCoverage` check. */
export function benchmarkCoverageCheck(): CheckDefinitionConfig {
  return {
    run: ["node", scriptPath],
    output: { format: "json" },
    policy: ({ result }): PolicyResult => {
      const envelope = parseToolEnvelope<CoverageReport>(
        result,
        "check-benchmark-coverage",
        "BenchmarkCoverage:",
      )
      if (!envelope.ok) return envelope.result
      const { state, suites, functions, findings, stale } = envelope.value
      if (state === "no-api") {
        return {
          outcome: "pass",
          rationale:
            "BenchmarkCoverage: this package commits no API baseline, so it has no public functions to cover.",
        }
      }
      if (state === "no-coverage") {
        return {
          outcome: "fail",
          rationale: [
            `BenchmarkCoverage: ${String(stale.length)} benchmark suite(s) have committed results that do not say what they cover. Re-render them with \`benchmark --render\` (no measuring) and commit the result:`,
            ...stale.map((suite) => `- benchmarks/${suite}/results.json`),
          ].join("\n"),
        }
      }
      if (findings.length > 0) {
        return {
          outcome: "fail",
          rationale: [
            `BenchmarkCoverage: ${String(findings.length)} gap(s) between the public functions that take several inputs and the benchmarks that cover them:`,
            ...findings.map((finding) => `- ${finding.message}`),
          ].join("\n"),
        }
      }
      return {
        outcome: "pass",
        rationale: `BenchmarkCoverage: all ${String(functions)} public function(s) with several inputs are benchmarked, and every one of their inputs is accounted for (${String(suites.length)} suite(s)).`,
      }
    },
  }
}
