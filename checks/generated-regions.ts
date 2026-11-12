/**
 * `GeneratedRegions`: every generated region in the package's documents matches what its sources
 * produce.
 *
 * Reads: the documents that carry `<!-- ipc:begin name -->` ... `<!-- ipc:end name -->` markers,
 * and the `package.json` and `docs/surface.json` they are generated from.
 * `scripts/check-generated-regions.mjs` runs `generate --check` in-process.
 *
 * Fails when a region is stale, or when its markers are malformed. Fails when a region's source is
 * missing or disagrees with what the package exports. Never warns. Passes when no document marks a
 * region.
 *
 * Exceptions: none. Run `internal-package-contract generate` and commit the result.
 *
 * Runs in the consumer `contract` job and in both git hooks. IPC's own self-contract leaves it out:
 * its documents mark no region.
 */
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { packageRoot, parseToolEnvelope } from "./shared.js"

const scriptPath = path.join(packageRoot, "scripts", "check-generated-regions.mjs")

interface RegionsReport {
  readonly ok: boolean
  readonly state?: "absent" | "current" | "problem"
  readonly message?: string
}

/** @returns the `GeneratedRegions` check. */
export function generatedRegionsCheck(): CheckDefinitionConfig {
  return {
    run: ["node", scriptPath],
    output: { format: "json" },
    policy: ({ result }): PolicyResult => {
      const envelope = parseToolEnvelope<RegionsReport>(
        result,
        "check-generated-regions",
        "GeneratedRegions:",
      )
      if (!envelope.ok) return envelope.result
      switch (envelope.value.state) {
        case "absent":
          return {
            outcome: "pass",
            rationale:
              "GeneratedRegions: no document marks a generated region, so there is nothing to check.",
          }
        case "current":
          return {
            outcome: "pass",
            rationale: "GeneratedRegions: every generated region matches what its sources produce.",
          }
        default:
          return {
            outcome: "fail",
            rationale: `GeneratedRegions: ${envelope.value.message ?? "the generated regions could not be checked."}`,
          }
      }
    },
  }
}
