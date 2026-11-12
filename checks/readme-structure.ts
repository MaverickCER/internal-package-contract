/**
 * `ReadmeStructure`: a published package's README answers the same questions, in the same order, as
 * every other package's. A developer can then decide whether to adopt it.
 *
 * Reads: package.json and README.md, through `scripts/check-readme.mjs` and
 * `scripts/readme/validate.mjs`: the section layout, the trust badges and the length limit.
 *
 * Fails when README.md is missing, breaks the layout, lacks a badge, or is too long. Never warns.
 * Passes for a private package, which has no adopters to convert.
 *
 * Exceptions: none.
 *
 * Runs in the consumer `contract` job and in both git hooks. IPC's own self-contract leaves it out:
 * this package is private.
 */
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { packageRoot, parseToolEnvelope } from "./shared.js"

const scriptPath = path.join(packageRoot, "scripts", "check-readme.mjs")

interface ReadmeReport {
  readonly ok: boolean
  readonly state?: "exempt" | "current" | "problem"
  readonly message?: string
}

/** @returns the `ReadmeStructure` check. */
export function readmeStructureCheck(): CheckDefinitionConfig {
  return {
    run: ["node", scriptPath],
    output: { format: "json" },
    policy: ({ result }): PolicyResult => {
      const envelope = parseToolEnvelope<ReadmeReport>(result, "check-readme", "ReadmeStructure:")
      if (!envelope.ok) return envelope.result
      switch (envelope.value.state) {
        case "exempt":
          return {
            outcome: "pass",
            rationale:
              "ReadmeStructure: this package is private, so its README is not an adoption page.",
          }
        case "current":
          return {
            outcome: "pass",
            rationale:
              "ReadmeStructure: the README follows the shared layout, has the trust badges and is within the length limit.",
          }
        default:
          return {
            outcome: "fail",
            rationale: `ReadmeStructure: ${envelope.value.message ?? "the README could not be checked."}`,
          }
      }
    },
  }
}
