/**
 * `GithubActions`: every workflow under `.github/workflows/` passes actionlint.
 *
 * Reads: the workflow files through `github-actionlint`. That npm wrapper fetches the official
 * actionlint binary on first use and caches it, so the standard stays `npm install`-only.
 *
 * Fails on any finding. Fails when actionlint cannot resolve a project root because this is not a
 * git repository yet; the fix is `git init`, as `GitHygiene` says. Never warns. Passes with no
 * `.github/workflows/` directory. Passes on a clean exit with no JSON: some actionlint versions
 * print nothing.
 *
 * Exceptions: none.
 *
 * Runs in the consumer `contract` job, in both git hooks, and in IPC's own self-contract.
 */
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { abnormalTermination, combinedOutput, firstExisting } from "./shared.js"

/** actionlint's own exact wording when it can't resolve a project root because the consumer isn't a git repository yet. Matched on content, not `.git` presence, so this only fires for the real cause -- never masking a genuinely different actionlint failure (a crash, a bad flag) that happens to coincide with a missing `.git` in a test fixture or an unusual checkout. */
const NOT_A_GIT_REPO_PATTERN = /no project was found in any parent director/i

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
      if (NOT_A_GIT_REPO_PATTERN.test(printed)) {
        return {
          outcome: "fail",
          rationale:
            'GitHub Actions: not a git repository yet -- actionlint needs one to resolve the project root. Run `git init` (see README "Adopt it"), then re-run.',
        }
      }
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
