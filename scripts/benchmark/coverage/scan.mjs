// What `BenchmarkCoverage` reads from a repository: the public functions, and what each suite covers.
//
// The functions come from the API the branch ships. Each target under `.repo-contract/api-contract/`, at any depth
// (`index/`, `adapters/express/`), is read from `current.api.json`, plus `current.d.ts` where it exists. ApiContract
// writes both on every run, and the `BenchmarkCoverage` check runs after it. A target with no `current.api.json` is
// read from its committed `baseline.api.json` and `baseline.d.ts`. The baseline alone would be wrong on a branch: it
// moves only with a release, so a function added since would read as stale. What each benchmark covers comes from
// the suite's current `results.json` (`analysis.coverage`, local or committed). Nothing is built or measured.
//
// `no-api`: no target, so no public functions, and the check passes. `no-coverage`: a suite's results predate
// `analysis.coverage` and must be re-rendered with `--render`; the check fails and no finding is judged.
// `checked`: the findings are what the check reports.

import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { currentResults, suiteDirectories } from "../results-location.mjs"
import { coverageFindings } from "./findings.mjs"
import { signaturesOf } from "./signatures.mjs"

/** Where ApiContract keeps each target's API: the committed baseline and the current extraction. */
export const API_CONTRACT_DIR = ".repo-contract/api-contract"

/** The file stems a target's API is read from, in order of preference: the branch's own API, then the release's. */
const SOURCES = ["current", "baseline"]

/**
 * @param {string} dir - a directory.
 * @returns {string[]} the directory and every directory below it, depth first in name order. A symbolic link is not
 *   followed, so a link back up the tree cannot loop.
 */
function directoriesUnder(dir) {
  // Stryker disable next-line MethodExpression: readdir order is platform-defined; sorting only makes the order stable, which a filesystem that already lists alphabetically cannot show.
  const children = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  return [dir, ...children.flatMap((name) => directoriesUnder(path.join(dir, name)))]
}

/**
 * @param {string} cwd - the repository root.
 * @returns {{ models: object[], declarations: string[] }} every target's parsed API model, and the text of its
 *   rolled-up declarations where it has them. Each target is read from `current.*` when it has a
 *   `current.api.json`, else from `baseline.*`.
 */
export function readApi(cwd) {
  const root = path.join(cwd, API_CONTRACT_DIR)
  const models = []
  const declarations = []
  if (!existsSync(root)) return { models, declarations }
  for (const dir of directoriesUnder(root)) {
    const source = SOURCES.find((stem) => existsSync(path.join(dir, `${stem}.api.json`)))
    if (source === undefined) continue
    models.push(JSON.parse(readFileSync(path.join(dir, `${source}.api.json`)).toString()))
    const rollup = path.join(dir, `${source}.d.ts`)
    if (existsSync(rollup)) declarations.push(readFileSync(rollup).toString())
  }
  return { models, declarations }
}

/**
 * @param {string} cwd - the repository root.
 * @returns {{ state: "no-api" | "no-coverage" | "checked", suites: string[], functions: number, findings: object[], stale: string[] }}
 *   `no-api` when the package has no API target (nothing public to cover); `no-coverage` lists the suites whose
 *   committed results predate `analysis.coverage` (they must be re-rendered); otherwise the findings.
 */
export function scanCoverage(cwd) {
  const { models, declarations } = readApi(cwd)
  if (models.length === 0)
    return { state: "no-api", suites: [], functions: 0, findings: [], stale: [] }
  const signatures = signaturesOf(models, declarations)
  const suites = suiteDirectories(cwd)
  const benchmarks = []
  const notBenchmarked = {}
  const stale = []
  for (const suite of suites) {
    const results = JSON.parse(readFileSync(currentResults(cwd, suite)).toString())
    const coverage = results?.analysis?.coverage
    if (coverage === undefined) {
      stale.push(suite)
      continue
    }
    for (const entry of coverage.benchmarks ?? []) {
      benchmarks.push({ suite, benchmark: entry.id, covers: entry.covers })
    }
    Object.assign(notBenchmarked, coverage.notBenchmarked ?? {})
  }
  const multi = [...signatures.values()].filter((signature) => signature.multiInput).length
  return {
    state: stale.length > 0 ? "no-coverage" : "checked",
    suites,
    functions: multi,
    findings: stale.length > 0 ? [] : coverageFindings(signatures, benchmarks, notBenchmarked),
    stale,
  }
}
