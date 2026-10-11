// Finds every complexity gain in a repository: for each benchmark suite (`benchmarks/<suite>/results.json`),
// the committed results are compared with the results committed at the last release tag. The release is the
// fixed point, so a series of small increases cannot ratchet the baseline upward unnoticed, and what ships is
// what a human has accepted.

import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { complexityGains } from "./complexity-gain.mjs"

/** @returns {string | undefined} the output of `git <args>` in `cwd`, or undefined when git fails. */
function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" })
  // Stryker disable next-line ConditionalExpression: equivalent -- a failed git prints nothing to stdout,
  // and an empty string is treated exactly like undefined by every caller (no tag, no released results).
  return result.status === 0 ? result.stdout : undefined
}

/**
 * @param {string} cwd - the repository root.
 * @returns {string[]} the suite directories (names under `benchmarks/`) that have committed results.
 */
export function suiteDirectories(cwd) {
  const root = path.join(cwd, "benchmarks")
  if (!existsSync(root)) return []
  // Stryker disable next-line MethodExpression: readdir order is platform-defined; sorting only makes the output stable, which a filesystem that already lists alphabetically cannot show.
  return readdirSync(root)
    .filter((name) => existsSync(path.join(root, name, "results.json")))
    .sort()
}

/**
 * @param {string} cwd - the repository root.
 * @returns {{ state: "none" | "no-baseline" | "compared", tag: string | null, suites: string[], gains: import("./complexity-gain.mjs").Gain[] }}
 */
export function scanComplexity(cwd) {
  const suites = suiteDirectories(cwd)
  if (suites.length === 0) return { state: "none", tag: null, suites, gains: [] }
  const tag = git(cwd, ["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", "HEAD"])?.trim()
  if (!tag) return { state: "no-baseline", tag: null, suites, gains: [] }
  const gains = []
  for (const suite of suites) {
    const released = git(cwd, ["show", `${tag}:benchmarks/${suite}/results.json`])
    // A suite that did not exist at the release has nothing to be compared with.
    if (released === undefined) continue
    const current = readFileSync(path.join(cwd, "benchmarks", suite, "results.json")).toString()
    gains.push(...complexityGains(suite, JSON.parse(released), JSON.parse(current)))
  }
  return { state: "compared", tag, suites, gains }
}
