/**
 * GitHub Actions workflow correctness + security via actionlint (rhysd/actionlint),
 * run through the `github-actionlint` npm wrapper -- it resolves the official
 * actionlint binary on first use and caches it, so the standard stays
 * `npm install`-only. A generic recreation of repo-contract's own
 * `github-actions` check; the analysis is actionlint's, this policy only turns it
 * into a verdict.
 *
 * Any finding blocks. No workflow files -> pass (nothing to lint).
 */
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { abnormalTermination, combinedOutput, firstExisting } from "./shared.js"

interface ActionlintFinding {
  readonly message: string
  readonly filepath: string
  readonly line: number
  readonly column: number
  readonly kind?: string
}

export const githubActions: CheckDefinitionConfig = {
  run: ["github-actionlint", "-format", "{{json .}}", "-no-color"],
  output: { format: "json" },
  policy: ({ result }): PolicyResult => {
    if (!firstExisting([".github/workflows"])) {
      return {
        outcome: "pass",
        rationale: "GitHub Actions: no .github/workflows/ directory to lint.",
      }
    }

    const terminated = abnormalTermination(result, "actionlint")
    if (terminated) return { outcome: "fail", rationale: terminated }

    const value: unknown = result.output?.success ? result.output.value : undefined

    if (!Array.isArray(value)) {
      // actionlint prints nothing (and exits 0) when there are no findings on
      // some versions; treat a clean exit with unparseable/empty output as pass.
      if (result.exitCode === 0) {
        return { outcome: "pass", rationale: "GitHub Actions: actionlint reported 0 issues." }
      }
      const printed = combinedOutput(result)
      return {
        outcome: "fail",
        rationale: `GitHub Actions: actionlint output could not be parsed as JSON.${printed ? `\n${printed}` : ""}`,
      }
    }

    const findings = value as readonly ActionlintFinding[]
    if (findings.length === 0) {
      return { outcome: "pass", rationale: "GitHub Actions: actionlint reported 0 issues." }
    }

    return {
      outcome: "fail",
      rationale: [
        `GitHub Actions: actionlint reported ${String(findings.length)} issue(s):`,
        ...findings.map(
          (f) =>
            `- ${f.filepath}:${String(f.line)}:${String(f.column)}${f.kind ? ` [${f.kind}]` : ""} ${f.message}`,
        ),
      ].join("\n"),
    }
  },
}
