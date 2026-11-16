/**
 * `BundledDependencies`: every package that package.json bundles is also declared in `dependencies`.
 *
 * Reads: package.json, through repo-contract's `bundledDependencies` preset. Its reader prints the
 * `bundleDependencies` and `bundledDependencies` fields and the names under `dependencies`. npm
 * publishes an undeclared bundled name into the registry manifest as `"*"`. Socket reports that
 * mismatch as manifest confusion.
 *
 * Fails on a bundled name missing from `dependencies`, listing each one. Fails on a bundling field
 * that is neither a list of names nor a boolean, and on a package.json that cannot be read. Never
 * warns. Passes a package that bundles nothing. Passes a private package, whose manifest npm never
 * publishes.
 *
 * Exceptions: none. Add each bundled name to `dependencies` at the version that is bundled.
 *
 * Runs in the consumer `contract` job and in both git hooks. IPC's own self-contract leaves it out:
 * this package is private.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { bundledDependencies } from "repo-contract/presets"

/**
 * @internal Exported for direct unit coverage.
 * @param cwd - The package's root.
 * @returns whether its package.json says `"private": true`. An unreadable file is not private, so
 *   the preset reports why it could not read it. JSON `null` throws on the property read and lands
 *   in the same branch.
 */
export function isPrivate(cwd: string): boolean {
  try {
    const manifest = JSON.parse(readFileSync(path.join(cwd, "package.json")).toString()) as {
      readonly private?: unknown
    }
    return manifest.private === true
  } catch {
    return false
  }
}

/**
 * @param input - Test seam: where package.json is read from.
 * @param input.cwd - The package's root; defaults to the working directory.
 * @returns the `BundledDependencies` check.
 */
export function bundledDependenciesCheck(
  input: { readonly cwd?: string } = {},
): CheckDefinitionConfig {
  return {
    ...bundledDependencies,
    policy: async (context): Promise<PolicyResult> => {
      if (isPrivate(input.cwd ?? process.cwd())) {
        return {
          outcome: "pass",
          rationale:
            "BundledDependencies: this package is private, so npm never publishes its manifest.",
        }
      }
      const verdict = await bundledDependencies.policy(context)
      return { ...verdict, rationale: `BundledDependencies: ${verdict.rationale}` }
    },
  }
}
