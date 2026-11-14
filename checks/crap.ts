/**
 * `Crap`: no function is both complex and poorly covered.
 *
 * Reads: `src/`, which IPC's own self-contract retargets at `checks/`, `scripts/` and `bin/`, and
 * `coverage/coverage-final.json`, which `Tests` wrote, through `@danibram/crap4ts`. Its JSON goes
 * to `reports/crap.json` rather than stdout: crap4ts exits before a large report drains through a
 * pipe. `src/_ipc/**` is ignored: those managed copies are covered and mutation-tested in this
 * repository. Declares `dependsOn: ["Coverage"]`.
 *
 * Fails on a function above {@link CRAP_THRESHOLD} (30) or above {@link MAX_COMPLEXITY} (20). Fails
 * on an unreadable score, and when no report was written although `Tests` passed. Warns, not
 * evaluated, when `Tests` failed. Under `--scope affected` only functions in the affected sources
 * are judged. With no affected test file it passes without measuring.
 *
 * Exceptions: none. Split the function, or cover its branches.
 *
 * Runs in the consumer `contract` job and in IPC's own self-contract. The pre-commit hook runs it
 * narrowed; the pre-push hook skips it by name.
 */
import { readFile } from "node:fs/promises"
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { narrowedScope } from "./scope.js"
import { abnormalTermination, combinedOutput } from "./shared.js"

const crapReportPath = path.join("reports", "crap.json")

/**
 * @param file - a path crap4ts reported, relative to the working directory or absolute.
 * @returns the same file relative to the repository, with forward slashes.
 */
function repoRelative(file: string): string {
  return path.relative(process.cwd(), path.resolve(process.cwd(), file)).split(path.sep).join("/")
}

/** CRAP ceiling. Above this a function is too risky for its coverage. */
export const CRAP_THRESHOLD = 30
/** Raw cyclomatic-complexity ceiling: CRAP collapses toward plain complexity as coverage approaches 100%, so this keeps pressure on a fully-covered but deeply-branchy function. */
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
    // Managed copies of this package's runtime modules are covered and mutation-tested here, not in the
    // consumer, so scoring them against the consumer's (excluded) coverage would only report them as untested.
    // The leading `**/` matters: crap4ts does not match `src/_ipc/**` against paths that begin with `src`.
    "--ignore",
    "**/_ipc/**",
    "--coverage",
    "coverage/coverage-final.json",
    "--threshold",
    String(CRAP_THRESHOLD),
    "--reporter",
    "json",
    "--output",
    crapReportPath,
  ],
  policy: async (ctx): Promise<PolicyResult> => {
    const { result, evidence } = ctx
    // A narrowed run executed only the tests a change affects, so only the files those tests exercise have
    // coverage worth weighing complexity against; the rest would read as untested.
    const narrowed = narrowedScope(ctx)
    if (narrowed?.tests.length === 0) {
      return {
        outcome: "pass",
        rationale: "CRAP: no test file is affected, so no function was measured.",
      }
    }
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
            "CRAP: not evaluated, because the `Tests` run did not pass, so there is no coverage to weight complexity against (see `Tests`).",
        }
      }
      const printed = combinedOutput(result)
      return {
        outcome: "fail",
        rationale: `CRAP: crap4ts wrote no readable ${crapReportPath} (no coverage/coverage-final.json?).${printed ? `\n${printed}` : ""}`,
      }
    }

    const reported = (value as CrapReport | null)?.functions
    if (!Array.isArray(reported)) {
      return { outcome: "fail", rationale: "CRAP: crap4ts produced invalid JSON report data." }
    }
    const functions =
      narrowed === undefined
        ? reported
        : reported.filter((fn) => new Set(narrowed.sources).has(repoRelative(fn.file)))

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
        rationale: `CRAP: no function above CRAP ${String(CRAP_THRESHOLD)} or complexity ${String(MAX_COMPLEXITY)} (${String(functions.length)} analyzed${narrowed === undefined ? "" : " in the affected files"}).`,
      }
    }

    const sections: string[] = []
    if (crapOffenders.length > 0) {
      sections.push(
        `CRAP threshold (${String(CRAP_THRESHOLD)}) exceeded by ${String(crapOffenders.length)} function(s):`,
        ...crapOffenders.map(
          (fn) => `- ${fn.file}:${String(fn.startLine)} ${fn.name}: CRAP ${String(fn.crap)}`,
        ),
      )
    }
    if (complexityOffenders.length > 0) {
      sections.push(
        `Complexity ceiling (${String(MAX_COMPLEXITY)}) exceeded by ${String(complexityOffenders.length)} function(s):`,
        ...complexityOffenders.map(
          (fn) =>
            `- ${fn.file}:${String(fn.startLine)} ${fn.name}: complexity ${String(fn.complexity)}`,
        ),
      )
    }

    return { outcome: "fail", rationale: sections.join("\n") }
  },
}
