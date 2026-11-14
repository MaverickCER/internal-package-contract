// Whether a branch edited a committed baseline without a release. A baseline moves with a release: the
// `version` script runs `update-baseline` on the release pull request, which also changes package.json's
// version. A branch that keeps the base branch's version but rewrites a baseline would hide its own API or
// surface change from `ApiContract` and `SurfaceContract`, which compare against that baseline.
//
// The comparison point is the merge base of HEAD with the base branch: `origin/$GITHUB_BASE_REF` on a pull
// request, `origin/main` otherwise. Three edits are allowed:
// - a version that differs from the base's on the release branch (`changeset-release/*`, where the `version`
//   script runs). Elsewhere a changed version is not a release, so it excuses nothing. When
//   `GITHUB_EVENT_PATH` holds a pull request, its head must also be in `GITHUB_REPOSITORY`: a fork can name
//   its branch `changeset-release/x`, but it cannot push to this repository.
// - a baseline the base did not have (the first one).
// - a base baseline that was already stale (its recorded version differs from the base's package.json).
//   Refreshing it is the fix.
// Without the base ref (a shallow clone, no remote) nothing can be compared, and the result says so.

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

/**
 * @param {string} cwd - the package root.
 * @param {string[]} args - git arguments.
 * @returns {string | undefined} stdout, or `undefined` when git fails. Its stderr is captured, not shown.
 */
function git(cwd, args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" })
  } catch {
    // git failed: no repository, an unknown ref, or a path the commit lacks.
  }
}

/**
 * @param {() => string | Buffer | undefined} read - returns a JSON text, or throws.
 * @returns {any} the parsed JSON, or `undefined` when `read` throws or returns `undefined` (which
 *   `String` turns into text that does not parse) or malformed text.
 */
function readJson(read) {
  try {
    return JSON.parse(String(read()))
  } catch {
    // Nothing readable: treated like an absent file.
  }
}

/**
 * @param {Readonly<Record<string, string | undefined>>} env - the environment.
 * @returns {boolean} false when the event payload is a pull request whose head lives in another
 *   repository (a fork). True with no readable payload, or for any other event.
 */
function headInThisRepository(env) {
  // An unset `GITHUB_EVENT_PATH` makes readFileSync throw, which reads as no payload.
  const pullRequest = readJson(() =>
    readFileSync(/** @type {string} */ (env["GITHUB_EVENT_PATH"])),
  )?.pull_request
  return !pullRequest || pullRequest.head?.repo?.full_name === env["GITHUB_REPOSITORY"]
}

/**
 * @param {object} input
 * @param {string} input.cwd - the package root.
 * @param {string} input.version - package.json's version on this branch.
 * @param {{ path: string, versionFile: string, current: string | undefined }[]} input.baselines - each
 *   baseline file to judge, the file inside it that records its version (`baseline.meta.json` for an API
 *   target, the baseline itself for the surface), and its content on this branch.
 * @param {Readonly<Record<string, string | undefined>>} [input.env] - the environment (`GITHUB_BASE_REF`,
 *   `GITHUB_HEAD_REF`, `GITHUB_EVENT_PATH`, `GITHUB_REPOSITORY`).
 * @returns {{ compared: boolean, edited: string[] }} whether a base was found, and each baseline path the
 *   branch changed without a release.
 */
export function baselinesEditedWithoutRelease({ cwd, version, baselines, env = process.env }) {
  const baseRef = `origin/${env["GITHUB_BASE_REF"] || "main"}`
  const head = git(cwd, ["rev-parse", "HEAD"])?.trim()
  // Without HEAD, merge-base fails too, so this check also covers a missing repository.
  const mergeBase = git(cwd, ["merge-base", "HEAD", baseRef])?.trim()
  if (mergeBase === undefined) return { compared: false, edited: [] }
  if (mergeBase === head) return { compared: true, edited: [] }
  let baseVersion
  try {
    const basePackage = git(cwd, ["show", `${mergeBase}:package.json`])
    baseVersion = /** @type {{ version?: unknown }} */ (JSON.parse(String(basePackage))).version
  } catch {
    return { compared: false, edited: [] }
  }
  // HEAD resolved above, so `rev-parse --abbrev-ref` always prints a name (`HEAD` when detached).
  const branch = String(env["GITHUB_HEAD_REF"] || git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]))
  if (
    baseVersion !== version &&
    branch.startsWith("changeset-release/") &&
    headInThisRepository(env)
  ) {
    return { compared: true, edited: [] }
  }
  const edited = []
  for (const baseline of baselines) {
    const base = git(cwd, ["show", `${mergeBase}:${baseline.path}`])
    if (base === undefined || base === baseline.current) continue
    const baseRecorded = readJson(() =>
      git(cwd, ["show", `${mergeBase}:${baseline.versionFile}`]),
    )?.packageVersion
    // A base baseline that was already stale is being refreshed, which is the fix. On a non-release branch
    // that also changed the version, the refreshed baseline would match the new version: still refused.
    if (baseRecorded !== baseVersion && baseVersion === version) continue
    edited.push(baseline.path)
  }
  return { compared: true, edited }
}
