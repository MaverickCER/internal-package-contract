/**
 * `Sbom`: the package's committed CycloneDX 1.6 SBOMs match `package-lock.json`.
 *
 * Reads: `package-lock.json`, `docs/sbom.cdx.json` and `docs/sbom.production.cdx.json`, through
 * repo-contract's `sbom` preset. The preset builds both documents from the lockfile with `node -e`,
 * deterministically, and compares them with the committed ones. `serialNumber`,
 * `metadata.timestamp`, key order and formatting are ignored. It writes nothing.
 *
 * Fails on a document that is missing, is not a JSON object, or differs from what the lockfile
 * gives. Fails on a lockfile that cannot be read or has no `packages` map. The message names
 * `internal-package-contract tool sbom`, which writes the documents with the same generator. Never
 * warns.
 *
 * Exceptions: none.
 *
 * Not in the standard set: a package turns it on by name (`add check Sbom`). It reads files only,
 * so it waits on nothing.
 */
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { sbom } from "repo-contract/presets"

/** The command a failure tells the reader to run. */
export const SBOM_FIX = "internal-package-contract tool sbom"

/** @returns the `Sbom` check. */
export function sbomCheck(): CheckDefinitionConfig {
  const preset = sbom({ fix: SBOM_FIX })
  return {
    ...preset,
    policy: async (context): Promise<PolicyResult> => {
      const verdict = await preset.policy(context)
      return { ...verdict, rationale: `Sbom: ${verdict.rationale}` }
    },
  }
}
