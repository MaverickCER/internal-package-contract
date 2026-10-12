/**
 * A public package publishes its OpenSSF Scorecard result, which its README badge reads live. This check
 * fails when no workflow runs `ossf/scorecard-action`, or when the one that does cannot publish (see
 * scripts/scorecard/validate.mjs). A private package publishes nothing and is exempt.
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
