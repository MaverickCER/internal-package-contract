/**
 * `ScorecardWorkflow`: a workflow publishes the package's OpenSSF Scorecard result, which the
 * README badge reads live.
 *
 * Reads: package.json and every `.github/workflows/*.yml`, through
 * `scripts/check-scorecard-workflow.mjs` and `scripts/scorecard/validate.mjs`.
 *
 * Fails when no workflow runs `ossf/scorecard-action`. Fails when the one that does cannot publish
 * its result. Never warns. Passes for a private package, which publishes nothing.
 *
 * Exceptions: none. `internal-package-contract init` scaffolds the workflow; `sync` restores it.
 *
 * Runs in the consumer `contract` job and in both git hooks. IPC's own self-contract leaves it out:
 * this package is private.
 */
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { packageRoot, parseToolEnvelope } from "./shared.js"

const scriptPath = path.join(packageRoot, "scripts", "check-scorecard-workflow.mjs")

interface ScorecardReport {
  readonly ok: boolean
  readonly state?: "exempt" | "current" | "problem"
  readonly message?: string
}

/** @returns the `ScorecardWorkflow` check. */
export function scorecardWorkflowCheck(): CheckDefinitionConfig {
  return {
    run: ["node", scriptPath],
    output: { format: "json" },
    policy: ({ result }): PolicyResult => {
      const envelope = parseToolEnvelope<ScorecardReport>(
        result,
        "check-scorecard-workflow",
        "ScorecardWorkflow:",
      )
      if (!envelope.ok) return envelope.result
      switch (envelope.value.state) {
        case "exempt":
          return {
            outcome: "pass",
            rationale: "ScorecardWorkflow: this package is private, so it publishes no Scorecard.",
          }
        case "current":
          return {
            outcome: "pass",
            rationale:
              "ScorecardWorkflow: a workflow publishes the OpenSSF Scorecard result on a schedule.",
          }
        default:
          return {
            outcome: "fail",
            rationale: `ScorecardWorkflow: ${envelope.value.message ?? "the Scorecard workflow could not be checked."}`,
          }
      }
    },
  }
}
