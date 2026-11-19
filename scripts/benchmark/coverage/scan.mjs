// What `BenchmarkCoverage` reads from a repository: the public functions, and what each suite covers.
//
// The functions come from the committed API baselines (`.repo-contract/api-contract/<target>/baseline.api.json`,
// plus `baseline.d.ts` where it exists). A target name may contain slashes, so a baseline can sit at any depth.
// What each benchmark covers comes from the suite's current `results.json` (`analysis.coverage`, local or
// committed). Nothing is built or measured.
//
// `no-api`: no baseline, so no public functions, and the check passes. `no-coverage`: a suite's results predate
// `analysis.coverage` and must be re-rendered with `--render`; the check fails and no finding is judged.
// `checked`: the findings are what the check reports.

import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { currentResults, suiteDirectories } from "../results-location.mjs"
import { coverageFindings } from "./findings.mjs"
import { signaturesOf } from "./signatures.mjs"

/** Where the API baselines are committed. */
export const API_CONTRACT_DIR = ".repo-contract/api-contract"

/**
 * @param {string} root - the folder the API baselines are committed under.
 * @param {string} folder - a folder relative to `root`; `""` is `root` itself.
 * @returns {string[]} every folder under `folder` that holds a `baseline.api.json`, in path order. A target name
 *   with a slash (`adapters/express`) is committed one level deeper per slash, so the walk has no depth limit.
 */
function baselineFolders(root, folder) {
  // Stryker disable next-line MethodExpression: readdir order is platform-defined; sorting only makes the order stable, which a filesystem that already lists alphabetically cannot show.
  const children = readdirSync(path.join(root, folder), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(folder, entry.name))
    .sort()
  return children.flatMap((child) => [
    ...(existsSync(path.join(root, child, "baseline.api.json")) ? [child] : []),
    ...baselineFolders(root, child),
  ])
}

/**
 * @param {string} cwd - the repository root.
 * @returns {{ models: object[], declarations: string[] }} every entry point's parsed `baseline.api.json`, and the
 *   text of its rolled-up `baseline.d.ts` where it has one.
 */
export function readBaselines(cwd) {
  const root = path.join(cwd, API_CONTRACT_DIR)
  if (!existsSync(root)) return { models: [] }
  const entries = baselineFolders(root, "")
  return {
    models: entries.map((entry) =>
      JSON.parse(readFileSync(path.join(root, entry, "baseline.api.json")).toString()),
    ),
    declarations: entries
      .filter((entry) => existsSync(path.join(root, entry, "baseline.d.ts")))
      .map((entry) => readFileSync(path.join(root, entry, "baseline.d.ts")).toString()),
  }
}

/**
 * @param {string} cwd - the repository root.
 * @returns {{ state: "no-api" | "no-coverage" | "checked", suites: string[], functions: number, findings: object[], stale: string[] }}
 *   `no-api` when the package commits no API baseline (nothing public to cover); `no-coverage` lists the suites whose
 *   committed results predate `analysis.coverage` (they must be re-rendered); otherwise the findings.
 */
export function scanCoverage(cwd) {
  const { models, declarations } = readBaselines(cwd)
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
