/**
 * Says whether the package is adopting the standard, and holds it to the end date. While `.repo-contract/
 * adoption.json` is active, every other check still reports its errors but only the promoted ones can fail the run (see scripts/adoption/mode.mjs) and
 * this check warns with what is still not enforced and how long is left. Once the date has passed it fails, so
 * "adopting" cannot become permanent; `internal-package-contract promote --all` ends the mode.
 */
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { packageRoot, parseToolEnvelope } from "./shared.js"

const scriptPath = path.join(packageRoot, "scripts", "check-adoption-mode.mjs")

interface AdoptionReport {
  readonly ok: boolean
  readonly state?: "absent" | "active" | "expired" | "invalid"
  readonly expiresAt?: string
  readonly enforce?: readonly string[]
  readonly daysLeft?: number
  readonly problem?: string
}

/** @returns the `AdoptionMode` check. */
export function adoptionModeCheck(): CheckDefinitionConfig {
  return {
    run: ["node", scriptPath],
    output: { format: "json" },
    policy: ({ result }): PolicyResult => {
      const envelope = parseToolEnvelope<AdoptionReport>(
        result,
        "check-adoption-mode",
        "AdoptionMode:",
      )
      if (!envelope.ok) return envelope.result
      const { state, expiresAt, enforce = [], daysLeft, problem } = envelope.value
      switch (state) {
        case "active":
          return {
            outcome: "warn",
            rationale: `AdoptionMode: this package is adopting the standard, so a failing check reports its error but does not fail the run until ${String(expiresAt)} (${String(daysLeft)} day(s) left). Enforcing: ${enforce.length === 0 ? "nothing yet" : enforce.join(", ")}. Run \`internal-package-contract promote <Check>\` as each is fixed, or \`promote --all\` to end it.`,
          }
        case "expired":
          return {
            outcome: "fail",
            rationale: `AdoptionMode: the adoption period ended on ${String(expiresAt)}. Run \`internal-package-contract promote --all\` so every check enforces, or promote the rest and delete .repo-contract/adoption.json.`,
          }
        case "invalid":
          return {
            outcome: "fail",
            rationale: `AdoptionMode: ${problem ?? "the adoption file is invalid."}`,
          }
        default:
          return {
            outcome: "pass",
            rationale: "AdoptionMode: not adopting; every check can fail the run.",
          }
      }
    },
  }
}
