/**
 * CRAP score (Change Risk Anti-Patterns: complexity vs. coverage) via
 * `@danibram/crap4ts`, plus an independent raw-cyclomatic-complexity ceiling.
 * A faithful recreation of repo-contract's own `crap` check, including its two
 * numbers ({@link CRAP_THRESHOLD} 30, {@link MAX_COMPLEXITY} 20 -- ESLint's own
 * default `complexity` limit).
 *
 * Reads the same `coverage/coverage-final.json` the `Coverage` check just
 * produced, so it is declared with `dependsOn: ["Coverage"]` in contract.ts.
 *
 * `--output` writes crap4ts's own JSON report straight to a file
 * ({@link crapReportPath}) instead of this check reading it back off the
 * process's captured stdout -- deliberate, not cosmetic: crap4ts's own CLI
 * calls `process.exit()` immediately after an un-awaited `process.stdout.write()`,
 * which can terminate the process before a large report (hundreds of
 * functions) finishes draining through the OS pipe's own backpressure,
 * silently truncating stdout -- confirmed to reproduce on an unmodified
 * checkout, independent of any consumer's own source. Writing to a real file
 * isn't subject to that same pipe-sized race, so this sidesteps the bug at
 * its call site rather than depending on an upstream fix.
 */
import { readFile } from "node:fs/promises"
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { abnormalTermination, combinedOutput } from "./shared.js"

const crapReportPath = path.join("reports", "crap.json")

/** CRAP ceiling. Above this a function is too risky for its coverage. */
export const CRAP_THRESHOLD = 30
/** Raw cyclomatic-complexity ceiling -- CRAP collapses toward plain complexity as coverage approaches 100%, so this keeps pressure on a fully-covered but deeply-branchy function. */
export const MAX_COMPLEXITY = 20

interface CrapFunction {
  readonly file: string
  readonly name: string
  readonly startLine: number
  readonly complexity: number
  readonly crap: number
}
interface CrapReport {
  readonly functions?: readonly CrapFunction[]
}

export const crap: CheckDefinitionConfig = {
  run: [
    "crap4ts",
    "src",
    "--coverage",
    "coverage/coverage-final.json",
    "--threshold",
    String(CRAP_THRESHOLD),
    "--reporter",
    "json",
    "--output",
    crapReportPath,
  ],
  policy: async ({ result, evidence }): Promise<PolicyResult> => {
    const terminated = abnormalTermination(result, "crap4ts")
    if (terminated) return { outcome: "fail", rationale: terminated }

    let value: unknown
    try {
      // Stryker disable next-line StringLiteral: see coverage.ts's identical, already-verified
      // justification for this exact pattern.
      const raw = await readFile(path.join(process.cwd(), crapReportPath), "utf8")
      value = JSON.parse(raw)
    } catch {
      const testsExit = evidence.checks["Tests"]?.exitCode
      if (testsExit !== undefined && testsExit !== 0) {
        return {
          outcome: "warn",
          rationale:
            "CRAP: not evaluated -- the `Tests` run did not pass, so there is no coverage to weight complexity against (see `Tests`).",
        }
      }
      const printed = combinedOutput(result)
      return {
        outcome: "fail",
        rationale: `CRAP: crap4ts wrote no readable ${crapReportPath} (no coverage/coverage-final.json?).${printed ? `\n${printed}` : ""}`,
      }
    }

    const functions = (value as CrapReport | null)?.functions
    if (!Array.isArray(functions)) {
      return { outcome: "fail", rationale: "CRAP: crap4ts produced invalid JSON report data." }
    }

    const unreadable = functions.filter(
      (fn) => !Number.isFinite(fn.crap) || !Number.isFinite(fn.complexity),
    )
    if (unreadable.length > 0) {
      return {
        outcome: "fail",
        rationale: [
          `CRAP: ${String(unreadable.length)} function(s) with an unreadable CRAP/complexity score:`,
          ...unreadable.map((fn) => `- ${fn.file}:${String(fn.startLine)} ${fn.name}`),
        ].join("\n"),
      }
    }

    const crapOffenders = functions
      .filter((fn) => fn.crap > CRAP_THRESHOLD)
      .sort((a, b) => b.crap - a.crap)
    const complexityOffenders = functions
      .filter((fn) => fn.complexity > MAX_COMPLEXITY)
      .sort((a, b) => b.complexity - a.complexity)

    if (crapOffenders.length === 0 && complexityOffenders.length === 0) {
      return {
        outcome: "pass",
        rationale: `CRAP: no function above CRAP ${String(CRAP_THRESHOLD)} or complexity ${String(MAX_COMPLEXITY)} (${String(functions.length)} analyzed).`,
      }
    }

    const sections: string[] = []
    if (crapOffenders.length > 0) {
      sections.push(
        `CRAP threshold (${String(CRAP_THRESHOLD)}) exceeded by ${String(crapOffenders.length)} function(s):`,
        ...crapOffenders.map(
          (fn) => `- ${fn.file}:${String(fn.startLine)} ${fn.name} — CRAP ${String(fn.crap)}`,
        ),
      )
    }
    if (complexityOffenders.length > 0) {
      sections.push(
        `Complexity ceiling (${String(MAX_COMPLEXITY)}) exceeded by ${String(complexityOffenders.length)} function(s):`,
        ...complexityOffenders.map(
          (fn) =>
            `- ${fn.file}:${String(fn.startLine)} ${fn.name} — complexity ${String(fn.complexity)}`,
        ),
      )
    }

    return { outcome: "fail", rationale: sections.join("\n") }
  },
}
