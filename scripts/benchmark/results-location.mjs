// Where a benchmark suite's results live. Only CI's figures are committed (and so published); a run on a
// developer's machine is a gate, not a figure, so it is written under `.benchmark-local/` (never committed) and the
// checks read it in preference to the committed results when it exists.

import { existsSync, readdirSync } from "node:fs"
import path from "node:path"

/** Where a local run writes, one folder per suite, at the repository root. */
export const LOCAL_DIRECTORY = ".benchmark-local"

/**
 * @param {Record<string, string | undefined>} env - the process environment.
 * @returns {boolean} whether this is a CI run, whose figures are the ones that are committed.
 */
export function isCi(env) {
  return env.CI === "true" || env.CI === "1"
}

/**
 * @param {string} suiteDirectory - a suite's own folder, `<root>/benchmarks/<suite>`.
 * @param {Record<string, string | undefined>} env - the process environment.
 * @returns {string} where a run writes its results by default: the suite's folder in CI, `.benchmark-local/<suite>`
 *   anywhere else.
 */
export function defaultOutput(suiteDirectory, env) {
  if (isCi(env)) return suiteDirectory
  return path.join(suiteDirectory, "..", "..", LOCAL_DIRECTORY, path.basename(suiteDirectory))
}

/**
 * @param {string} cwd - the repository root.
 * @param {string} suite - a suite's folder name under `benchmarks/`.
 * @returns {string | undefined} the results the checks should read: the local run's when there is one, else the
 *   committed ones, else nothing.
 */
export function currentResults(cwd, suite) {
  for (const directory of [
    path.join(cwd, LOCAL_DIRECTORY, suite),
    path.join(cwd, "benchmarks", suite),
  ]) {
    const file = path.join(directory, "results.json")
    if (existsSync(file)) return file
  }
  return undefined
}

/**
 * @param {string} cwd - the repository root.
 * @returns {string[]} the suites (folder names under `benchmarks/`) that have results, local or committed.
 */
export function suiteDirectories(cwd) {
  const root = path.join(cwd, "benchmarks")
  if (!existsSync(root)) return []
  // Stryker disable next-line MethodExpression: readdir order is platform-defined; sorting only makes the output stable, which a filesystem that already lists alphabetically cannot show.
  return readdirSync(root)
    .filter((name) => currentResults(cwd, name) !== undefined)
    .sort()
}
