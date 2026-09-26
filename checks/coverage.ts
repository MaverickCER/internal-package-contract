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
  readonly total?: Record<string, { readonly pct?: number | "Unknown" }>
}

/** V8/Istanbul's own `pct` sentinel for a metric with nothing instrumented (`0/0`, printed instead of dividing 0 by 0) -- the literal string `"Unknown"`, distinct from a missing field or an actual `NaN`/`Infinity`. Checked directly, ahead of the generic per-metric loop, so a brand-new consumer with no `src/` yet gets one clear explanation instead of the same vague "percentage missing or invalid" bullet repeated four times. Requires every metric to say so (not just one) -- a report that is genuinely missing a single field, or carries a real `NaN`, still falls through to the generic per-metric message, which already names exactly which metric and why. Callers only reach this after already ruling out a missing/non-object `total`, so it takes the narrowed, non-nullable type rather than re-guarding against something that can't happen here. */
function hasNoInstrumentedCode(total: NonNullable<CoverageSummary["total"]>): boolean {
  const metrics = Object.values(total)
  return metrics.length > 0 && metrics.every((metric) => metric?.pct === "Unknown")
}

export const coverage: CheckDefinitionConfig = {
  // No work of its own -- a harmless noop so the check has a `run`; all the
  // signal is in the artifact `Tests` produced.
  run: ["node", "--version"],
  policy: async (ctx): Promise<PolicyResult> => {
    let summary: CoverageSummary
    try {
      // Stryker disable next-line StringLiteral: an equivalent mutant -- `readFile(path, "")`
      // returns a Buffer instead of a string, but `JSON.parse` coerces any non-string argument via
      // its default (utf8) `toString()`, which produces byte-for-byte the same text `"utf8"` would
      // have decoded. Hand-verified: forcing this to `""` leaves every test in coverage.test.ts
      // passing unchanged.
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

    if (hasNoInstrumentedCode(total)) {
      return {
        outcome: "fail",
        rationale:
          "Coverage: 0 statements instrumented -- there is no source under `src/` for Tests to cover yet. Add source files (and tests for them); this check starts scoring once Tests instruments real code.",
      }
    }

    const failures: string[] = []
    const parts: string[] = []
    for (const [metric, threshold] of Object.entries(COVERAGE_THRESHOLDS)) {
      const pct = total[metric]?.pct
      // Stryker disable next-line ConditionalExpression: an equivalent mutant -- forcing
      // `typeof pct !== "number"` to `false` leaves just `!Number.isFinite(pct)`, which is already
      // logically equivalent to the full expression: `Number.isFinite` (unlike the global
      // `isFinite`) never coerces, so for any non-number `pct` it already returns `false` --
      // `typeof pct !== "number"` never adds a case `!Number.isFinite(pct)` didn't already cover.
      // Hand-verified: forcing this to `false` leaves every test in coverage.test.ts passing
      // unchanged.
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
