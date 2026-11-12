// What `BenchmarkComplexity` reads from a repository before judging it.
//
// Each suite under `benchmarks/` that has results is compared with the `results.json` committed at the last
// release tag (`git describe --tags --match 'v[0-9]*'`). The current results are a local run under
// `.benchmark-local/<suite>/` when there is one, else the committed file (results-location.mjs). The release
// is the fixed point, so a series of small increases cannot move the baseline unnoticed.
//
// States: `none` (no suite has results), `no-baseline` (no release tag yet), `compared`. A suite that did not
// exist at the tag is skipped. Groups whose big-O could not be determined are listed separately with the
// reason, so the check can warn about them without failing.

import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { complexityGains } from "./complexity-gain.mjs"
import { explainUndetermined } from "./explain-undetermined.mjs"
import { currentResults, suiteDirectories } from "./results-location.mjs"

/** @returns {string | undefined} the output of `git <args>` in `cwd`, or undefined when git fails. */
function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" })
  // Stryker disable next-line ConditionalExpression: equivalent -- a failed git prints nothing to stdout,
  // and an empty string is treated exactly like undefined by every caller (no tag, no released results).
  return result.status === 0 ? result.stdout : undefined
}

/**
 * @param {string} cwd - the repository root.
 * @param {string[]} suites - the suites with committed results.
 * @returns {{ suite: string, group: string, reason: string }[]} every group whose big-O could not be determined.
 */
export function undeterminedGroups(cwd, suites) {
  return suites.flatMap((suite) => {
    const results = JSON.parse(readFileSync(currentResults(cwd, suite)).toString())
    return Object.entries(results?.analysis?.complexity ?? {})
      .filter(([, value]) => value?.class === null)
      .map(([group, value]) => ({
        suite,
        group,
        ...(value.variable === undefined ? {} : { variable: value.variable }),
        reason: explainUndetermined(value),
      }))
  })
}

/**
 * @param {string} cwd - the repository root.
 * @returns {{ state: "none" | "no-baseline" | "compared", tag: string | null, suites: string[], gains: import("./complexity-gain.mjs").Gain[], undetermined: { suite: string, group: string, reason: string }[] }}
 */
export function scanComplexity(cwd) {
  const suites = suiteDirectories(cwd)
  if (suites.length === 0) return { state: "none", tag: null, suites, gains: [], undetermined: [] }
  const undetermined = undeterminedGroups(cwd, suites)
  const tag = git(cwd, ["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", "HEAD"])?.trim()
  if (!tag) return { state: "no-baseline", tag: null, suites, gains: [], undetermined }
  const gains = []
  for (const suite of suites) {
    const released = git(cwd, ["show", `${tag}:benchmarks/${suite}/results.json`])
    // A suite that did not exist at the release has nothing to be compared with.
    if (released === undefined) continue
    const current = readFileSync(currentResults(cwd, suite)).toString()
    gains.push(...complexityGains(suite, JSON.parse(released), JSON.parse(current)))
  }
  return { state: "compared", tag, suites, gains, undetermined }
}
