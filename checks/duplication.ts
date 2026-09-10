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
      const raw = await readFile(
        path.join(process.cwd(), "reports/jscpd/jscpd-report.json"),
        "utf8",
      )
      report = JSON.parse(raw) as JscpdReport
    } catch {
      return { outcome: "fail", rationale: "Duplication: jscpd did not produce its JSON report." }
    }

    const pct = report.statistics?.total?.percentage
    const duplicates = Array.isArray(report.duplicates) ? report.duplicates : []
    if (typeof pct !== "number" || !Number.isFinite(pct)) {
      return { outcome: "fail", rationale: "Duplication: jscpd produced no total percentage." }
    }

    if (pct <= DUPLICATION_MAX_PERCENTAGE) {
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
