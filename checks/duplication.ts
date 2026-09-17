/**
 * Copy-paste detection via jscpd. A recreation of the `duplication` preset with
 * one difference: it fails on a *percentage* budget ({@link DUPLICATION_MAX_PERCENTAGE}),
 * not on `> 0` clones.
 *
 * Zero duplication is neither realistic nor always desirable (a small, fully
 * tested, dependency-free helper is sometimes cheaper duplicated than shared
 * across a bundling boundary). jscpd is itself threshold-based; this check
 * matches that, and matches every other budgeted check in the contract
 * (`Coverage`, `Crap`, `Mutation`). Deliberate duplication a package has decided
 * to keep is marked in place with `jscpd:ignore-start` / `jscpd:ignore-end` (or
 * a `.jscpd.json`), which jscpd honours and this check inherits.
 */
import { readFile } from "node:fs/promises"
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { abnormalTermination } from "./shared.js"

/** Maximum share of `src/` that may be duplicated code. */
export const DUPLICATION_MAX_PERCENTAGE = 0.75

interface JscpdDuplicate {
  readonly lines: number
  readonly tokens: number
  readonly firstFile: { readonly name: string; readonly start: number }
  readonly secondFile: { readonly name: string; readonly start: number }
}
interface JscpdReport {
  readonly duplicates?: readonly JscpdDuplicate[]
  readonly statistics?: {
    readonly total?: { readonly percentage?: number; readonly lines?: number }
  }
}

export const duplication: CheckDefinitionConfig = {
  run: ["jscpd", "src", "--reporters", "json", "--output", "reports/jscpd", "--silent"],
  policy: async ({ result }): Promise<PolicyResult> => {
    const terminated = abnormalTermination(result, "jscpd")
    if (terminated) return { outcome: "fail", rationale: terminated }

    let report: JscpdReport
    try {
      // Stryker disable StringLiteral: an equivalent mutant -- `readFile(path, "")` returns a
      // Buffer instead of a string, but `JSON.parse` coerces any non-string argument via its
      // default (utf8) `toString()`, which produces byte-for-byte the same text `"utf8"` would
      // have decoded. Hand-verified: forcing this to `""` leaves every test in
      // duplication.test.ts passing unchanged.
      const raw = await readFile(
        path.join(process.cwd(), "reports/jscpd/jscpd-report.json"),
        "utf8",
      )
      // Stryker restore StringLiteral
      report = JSON.parse(raw) as JscpdReport
    } catch {
      return { outcome: "fail", rationale: "Duplication: jscpd did not produce its JSON report." }
    }

    const pct = report.statistics?.total?.percentage
    const duplicates = Array.isArray(report.duplicates) ? report.duplicates : []
    // Stryker disable next-line ConditionalExpression: an equivalent mutant -- forcing
    // `typeof pct !== "number"` to `false` leaves just `!Number.isFinite(pct)`, which is already
    // logically equivalent to the full expression: `Number.isFinite` (unlike the global
    // `isFinite`) never coerces, so for any non-number `pct` it already returns `false` --
    // `typeof pct !== "number"` never adds a case `!Number.isFinite(pct)` didn't already cover.
    // Hand-verified: forcing this to `false` leaves every test in duplication.test.ts passing
    // unchanged.
    if (typeof pct !== "number" || !Number.isFinite(pct)) {
      return { outcome: "fail", rationale: "Duplication: jscpd produced no total percentage." }
    }

    if (pct <= DUPLICATION_MAX_PERCENTAGE) {
      // Stryker disable ConditionalExpression,EqualityOperator: an equivalent mutant -- forcing
      // this to always take the "build the list" branch produces byte-identical output to the
      // `: ""` fallback whenever `duplicates` really is empty (`["", ...[].map(...)].join("\n")`
      // is `""`, same as the fallback), and produces the SAME "build the list" output as the
      // unmutated code whenever `duplicates` is genuinely non-empty (the real condition already
      // takes this same branch then) -- there is no `duplicates` array this can ever diverge on.
      // Hand-verified: forcing this to `true` leaves every test in duplication.test.ts passing
      // unchanged.
      const detail =
        duplicates.length > 0
          ? [
              "",
              ...duplicates.map(
                (d) =>
                  `- ${d.firstFile.name}:${String(d.firstFile.start)} <-> ${d.secondFile.name}:${String(d.secondFile.start)} (${String(d.lines)} lines)`,
              ),
            ].join("\n")
          : ""
      // Stryker restore ConditionalExpression,EqualityOperator
      return {
        outcome: "pass",
        rationale: `Duplication: ${pct.toFixed(2)}% of src/ within the ${String(DUPLICATION_MAX_PERCENTAGE)}% budget (${String(duplicates.length)} block(s)).${detail}`,
      }
    }

    return {
      outcome: "fail",
      rationale: [
        `Duplication: ${pct.toFixed(2)}% of src/ exceeds the ${String(DUPLICATION_MAX_PERCENTAGE)}% budget (${String(duplicates.length)} block(s)):`,
        ...duplicates.map(
          (d) =>
            `- ${d.firstFile.name}:${String(d.firstFile.start)} <-> ${d.secondFile.name}:${String(d.secondFile.start)} (${String(d.lines)} lines)`,
        ),
        "",
        "Refactor the accidental ones; wrap a deliberate, documented copy in `// jscpd:ignore-start` / `// jscpd:ignore-end`.",
      ].join("\n"),
    }
  },
}
