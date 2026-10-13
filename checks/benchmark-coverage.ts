/**
 * Fails when a public function that takes more than one input (several parameters, or an object with several
 * keys) is not benchmarked across all of them. Each of those inputs can change what the function costs, so each
 * has to be accounted for in the benchmark that exercises it: swept, a variant, held fixed (and why) or not
 * covered (and why). A function can instead be listed under the suite's `notBenchmarked` with the reason.
 *
 * The functions come from the committed API baselines (`.repo-contract/api-contract`), and what each benchmark
 * covers from the committed results (`analysis.coverage`, derived from the suite's definition by
 * `benchmark --render`), so the check measures nothing and needs no build. A package with no API baseline has no
 * public functions to cover and passes. A suite whose committed results predate `analysis.coverage` fails: it must
 * be re-rendered.
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
