// Pure helpers for the benchmark page: what kind of group a benchmark is, the package-cost table, and
// where the recorded runs came from. No HTML here; render-page.mjs turns these into markup.

import { inputTotal } from "./classify-complexity.mjs"

/**
 * @param {string} name - a benchmark group name.
 * @returns {"baseline" | "with-package" | "derived-overhead" | "function" | undefined} what the group is,
 *   or `undefined` for a name the suite kit does not produce.
 */
export function groupKind(name) {
  if (name === "end-to-end:baseline") return "baseline"
  if (name === "end-to-end:with-package") return "with-package"
  if (name === "end-to-end:overhead") return "derived-overhead"
  if (name.startsWith("fn:")) return "function"
  return undefined
}

/**
 * @param {string} name - a benchmark group name.
 * @returns {boolean} whether the group is computed from other groups rather than measured. Its cost is
 *   the difference of two noisy medians, so it is never given a complexity class.
 */
export function isDerivedGroup(name) {
  return groupKind(name) === "derived-overhead"
}

/**
 * The baseline and with-package times side by side, per input size, from one run.
 * @param {Record<string, Record<string, { medianMs: number, inputs?: Record<string, number> }>> | undefined} measurements
 * @param {readonly string[]} tierOrder
 * @param {number} noiseFloorMs - a baseline below this is timer noise, so no relative cost is given.
 * @returns {{ tier: string, size: number | null, baselineMs: number, withPackageMs: number, addedMs: number, relativePercent: number | null }[]}
 */
export function packageCostRows(measurements, tierOrder, noiseFloorMs) {
  const baseline = measurements?.["end-to-end:baseline"]
  const withPackage = measurements?.["end-to-end:with-package"]
  if (!baseline || !withPackage) return []
  const rows = []
  for (const tier of tierOrder) {
    const base = baseline[tier]
    const full = withPackage[tier]
    if (!base || !full) continue
    const addedMs = full.medianMs - base.medianMs
    rows.push({
      tier,
      size: inputTotal(full.inputs) ?? inputTotal(base.inputs) ?? null,
      baselineMs: base.medianMs,
      withPackageMs: full.medianMs,
      addedMs,
      relativePercent: base.medianMs >= noiseFloorMs ? (addedMs / base.medianMs) * 100 : null,
    })
  }
  // By input size when every row has one; otherwise the order the tiers were given.
  return rows.every((row) => row.size !== null) ? rows.sort((a, b) => a.size - b.size) : rows
}

const plural = (count, word) => `${String(count)} ${word}${count === 1 ? "" : "s"}`

/**
 * A plain sentence on where the recorded runs came from, so a reader knows how much a trend can bear.
 * @param {readonly { commit: string | null, runner: string | null, cpuModel: string | null }[]} runs
 * @returns {string}
 */
export function describeProvenance(runs) {
  if (runs.length === 0) return "No runs recorded."
  const commits = runs.map((run) => run.commit).filter((commit) => commit !== null)
  const distinct = new Set(commits).size
  const counts = `${plural(runs.length, "run")} from ${plural(distinct, "commit")}.`
  let how = "Each run is one measurement of one commit, not a repeat."
  if (commits.length > distinct) how = "Some commits were measured more than once."
  else if (commits.length < runs.length) how = "Some runs have no commit recorded."

  const environments = new Map()
  for (const run of runs) {
    const label = [run.runner ?? "an unrecorded runner", run.cpuModel].filter(Boolean).join(", ")
    environments.set(label, (environments.get(label) ?? 0) + 1)
  }
  const listed = [...environments].map(([label, n]) => `${label} (${plural(n, "run")})`).join("; ")
  const anyProcessor = runs.some((run) => run.cpuModel)
  const where = anyProcessor
    ? `Measured on ${listed}.`
    : `Measured on ${listed}; the processor was not recorded.`
  return `${counts} ${how} ${where}`
}
