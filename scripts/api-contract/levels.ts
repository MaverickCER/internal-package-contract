/**
 * SemVer bump-magnitude arithmetic over `RequiredReleaseLevel`. Ported from repo-contract's own
 * `scripts/api-contract/levels.ts` — this engine now lives only here (see contract.ts's own note on
 * `ApiContract`); repo-contract consumes it as a devDependency rather than hosting a copy.
 */

import type { ContractImpact, RequiredReleaseLevel } from "./evidence-types.js"

/** Ranks a release level by bump magnitude. `"none"` ranks below `"patch"`. */
const LEVEL_RANK: Record<RequiredReleaseLevel, number> = {
  none: 0,
  patch: 1,
  minor: 2,
  major: 3,
}

/**
 * The higher-magnitude of two release levels. `undefined` is treated as identity
 * (`maxLevel(x, undefined) === x`), so folding an empty list of levels yields `undefined`.
 * @param a - one level, or `undefined`.
 * @param b - the other level, or `undefined`.
 * @returns whichever ranks higher, or the one defined operand, or `undefined` if both are.
 */
export function maxLevel(
  a: RequiredReleaseLevel | undefined,
  b: RequiredReleaseLevel | undefined,
): RequiredReleaseLevel | undefined {
  const present = [a, b].filter((level) => level !== undefined)
  return present.sort((x, y) => LEVEL_RANK[y] - LEVEL_RANK[x])[0]
}

/**
 * Whether `declared` is at least as large a bump as `required` -- the api-contract gate's
 * core comparison. Anything satisfies a `"none"` requirement; `"none"` satisfies only `"none"`.
 * @param declared - the level the branch's changesets declare.
 * @param required - the minimum level the public-API diff requires.
 * @returns `true` iff `declared` ranks at least as high as `required`.
 */
export function rankAtLeast(
  declared: RequiredReleaseLevel,
  required: RequiredReleaseLevel,
): boolean {
  return LEVEL_RANK[declared] >= LEVEL_RANK[required]
}

/**
 * The release level one contract delta requires.
 *
 * Below 1.0.0 the level is deflated one step -- a breaking change needs `minor`, a change that
 * widens the surface needs only `patch` -- the usual 0.x convention, and the one the changeset
 * generator applies. It is also what makes 1.0.0 a decision: no API diff, however breaking, can
 * require a `major` while the package is 0.x, so the version crosses to 1.0.0 only when a human
 * writes a `major` changeset (which satisfies every requirement).
 * @param impact - the classified impact of the delta.
 * @param widensSurface - whether any change adds to the public surface (`*-added`, a widened release tag).
 * @param preOne - whether the package is below 1.0.0.
 * @returns the required level, or `undefined` when the impact is indeterminate.
 */
export function requiredLevelFor(
  impact: ContractImpact,
  widensSurface: boolean,
  preOne: boolean,
): RequiredReleaseLevel | undefined {
  if (impact === "unknown") return undefined
  if (impact === "breaking") return preOne ? "minor" : "major"
  if (impact === "compatible") return widensSurface && !preOne ? "minor" : "patch"
  return "none"
}
