/**
 * Keeps the facts a package's documents derive from its own sources from drifting. A document marks such a
 * fact as a generated region (`<!-- ipc:begin entry-points -->` ... `<!-- ipc:end entry-points -->`);
 * `internal-package-contract generate` writes it from `package.json` and `docs/surface.json`. This check runs
 * `generate --check`: it fails when a region is stale, when its markers are malformed, or when its source is
 * missing or disagrees with what the package really exports. A package with no regions passes.
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
