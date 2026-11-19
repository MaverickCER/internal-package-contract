// How one version range in package.json compares with the range the last release recorded. SurfaceContract
// reads `engines` and `peerDependencies` this way (classify.ts). A missing range is read as `*`: nothing is
// required. A range that is not valid semver is "unreadable", and classify.ts treats it as breaking.

import semver from "semver"

/**
 * @param {string} before - the range the baseline recorded.
 * @param {string} after - the range package.json declares now.
 * @returns {"same" | "narrowed" | "widened" | "rewritten" | "unreadable"} `narrowed` when some version
 *   `before` accepted is now refused; `widened` when `after` accepts everything `before` did and more;
 *   `rewritten` when the text changed and the accepted versions did not.
 */
export function compareRanges(before, after) {
  if (before === after) return "same"
  if (semver.validRange(before) === null || semver.validRange(after) === null) return "unreadable"
  if (!semver.subset(before, after)) return "narrowed"
  return semver.subset(after, before) ? "rewritten" : "widened"
}
