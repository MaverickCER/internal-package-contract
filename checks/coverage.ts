/**
 * Aggregate test-coverage thresholds. A pure reader: it does NOT run tests --
 * the `Tests` check runs Vitest with V8 coverage once, and this reads the
 * `coverage/coverage-summary.json` that produced. Declared `dependsOn: ["Tests"]`
 * in contract.ts.
 *
 * The threshold is this standard's number ({@link COVERAGE_THRESHOLDS}), not
 * Vitest's -- a consumer never lowers it by editing their own vitest config.
 */
import { readFile } from "node:fs/promises"
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"

/** The minimum aggregate coverage every publishable package must hold, per metric. */
export const COVERAGE_THRESHOLDS = {
  lines: 80,
  statements: 80,
  functions: 80,
  branches: 80,
} as const

interface CoverageSummary {
  readonly total?: Record<string, { readonly pct?: number }>
}

export const coverage: CheckDefinitionConfig = {
  // No work of its own -- a harmless noop so the check has a `run`; all the
  // signal is in the artifact `Tests` produced.
  run: ["node", "--version"],
  policy: async (ctx): Promise<PolicyResult> => {
    let summary: CoverageSummary
    try {
      const raw = await readFile(path.join(process.cwd(), "coverage/coverage-summary.json"), "utf8")
      summary = JSON.parse(raw) as CoverageSummary
    } catch {
      // Vitest writes no coverage summary when the suite itself failed -- that
      // is already reported by `Tests`, so don't pile a second red line on the
      // same root cause.
      const testsExit = ctx.evidence.checks["Tests"]?.exitCode
      if (testsExit !== undefined && testsExit !== 0) {
        return {
          outcome: "warn",
          rationale: "Coverage: not evaluated -- the `Tests` run did not pass (see `Tests`).",
        }
      }
      return {
        outcome: "fail",
        rationale:
          "Coverage: no coverage/coverage-summary.json -- the `Tests` run produced no coverage (is `@vitest/coverage-v8` installed?).",
      }
    }

    const total = summary.total
    if (!total || typeof total !== "object") {
      return {
        outcome: "fail",
        rationale: "Coverage: coverage-summary.json has no `total` section.",
      }
    }

    const failures: string[] = []
    const parts: string[] = []
    for (const [metric, threshold] of Object.entries(COVERAGE_THRESHOLDS)) {
      const pct = total[metric]?.pct
      if (typeof pct !== "number" || !Number.isFinite(pct)) {
        failures.push(`${metric}: percentage missing or invalid`)
        continue
      }
      parts.push(`${metric} ${String(pct)}%`)
      if (pct < threshold) {
        failures.push(
          `${metric}: ${String(pct)}% < ${String(threshold)}% required (${(threshold - pct).toFixed(2)} points short)`,
        )
      }
    }

    if (failures.length > 0) {
      return {
        outcome: "fail",
        rationale: ["Coverage thresholds not met:", ...failures.map((f) => `- ${f}`)].join("\n"),
      }
    }

    return { outcome: "pass", rationale: `Coverage thresholds met (${parts.join(", ")}).` }
  },
}
