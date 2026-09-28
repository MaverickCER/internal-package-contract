import type { RequiredReleaseLevel } from "./evidence-types.js"

/**
 * Hand-rolled `X.Y.Z` parsing rather than a new `semver` dependency -- the parsing this feature
 * needs is trivial (no ranges, no prerelease negotiation). Ported from repo-contract's own
 * `scripts/api-contract/semver.ts`; this is the one and only version-comparison implementation in
 * the feature -- check.ts, checks/api-contract.ts, and update-baseline.ts all import from here.
 */
interface Version {
  readonly major: number
  readonly minor: number
  readonly patch: number
}

// The trailing suffix is an alternation (`[-+].*` or empty) rather than a
// `(?:...)?` group around it -- a `?` wrapping the already-quantified `.*`
// would nest one repetition inside another, which is what actually trips
// eslint-plugin-security's detect-unsafe-regex heuristic (it flags nesting
// depth, not whether the quantifiers are on disjoint tokens).
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*|)$/

/**
 * Parses a strict `major.minor.patch` prefix (an optional `-prerelease`/`+build` suffix is accepted and ignored). Returns `undefined` for anything else.
 * @param raw - The version string to parse, e.g. from package.json's `version` field.
 * @returns The parsed `major`/`minor`/`patch` triple, or `undefined` if `raw` doesn't match the expected pattern.
 */
export function parseVersion(raw: string): Version | undefined {
  const match = VERSION_PATTERN.exec(raw.trim())
  if (!match) return undefined

  const [, majorText, minorText, patchText] = match
  return {
    major: Number(majorText),
    minor: Number(minorText),
    patch: Number(patchText),
  }
}

/**
 * `<0` if `a` precedes `b`, `0` if equal, `>0` if `a` follows `b`.
 * @param a - The first version to compare.
 * @param b - The second version to compare.
 * @returns A negative, zero, or positive number per the standard comparator contract, compared major then minor then patch.
 */
export function compareVersions(a: Version, b: Version): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  return a.patch - b.patch
}

/**
 * @param version - The version to render.
 * @returns The `major.minor.patch` string form of `version`.
 */
export function formatVersion(version: Version): string {
  return `${String(version.major)}.${String(version.minor)}.${String(version.patch)}`
}

/**
 * @param base - The version to bump from.
 * @param level - The SemVer magnitude to bump by.
 * @returns `base` incremented at `level`, with every lower component reset to zero.
 */
function bumpForLevel(base: Version, level: Exclude<RequiredReleaseLevel, "none">): Version {
  switch (level) {
    case "major":
      return { major: base.major + 1, minor: 0, patch: 0 }
    case "minor":
      return { major: base.major, minor: base.minor + 1, patch: 0 }
    case "patch":
      return { major: base.major, minor: base.minor, patch: base.patch + 1 }
  }
}

/**
 * Derives the minimum required package version from a baseline version and a required release
 * level. `baselineVersion === undefined` means no historical contract exists yet (the
 * initial-baseline case) -- this always returns `"0.1.0"` regardless of `requiredLevel`; the
 * caller must never substitute the current package.json version here, and must never call this at
 * all when the level is indeterminate (`RequiredReleaseLevel` has no `"unknown"` member for
 * exactly this reason).
 * @param baselineVersion - The historical baseline's version, or `undefined` if no baseline exists yet.
 * @param requiredLevel - The SemVer magnitude the classified contract delta requires.
 * @returns `"0.1.0"` when `baselineVersion` is absent; otherwise `baselineVersion` formatted as-is when `requiredLevel` is `"none"`, or bumped at `requiredLevel` otherwise.
 */
export function computeMinimumRequiredVersion(
  baselineVersion: Version | undefined,
  requiredLevel: RequiredReleaseLevel,
): string {
  if (baselineVersion === undefined) return "0.1.0"
  if (requiredLevel === "none") return formatVersion(baselineVersion)
  return formatVersion(bumpForLevel(baselineVersion, requiredLevel))
}
