/**
 * Keeps a published package's README focused on the one decision it exists for: whether a developer should
 * install and adopt the package. The README answers the same questions in the same order in every package
 * (see scripts/readme/validate.mjs), carries the trust badges, stays short, and leaves everything else to
 * the guides. A private package has no adopters to convert and is exempt.
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
