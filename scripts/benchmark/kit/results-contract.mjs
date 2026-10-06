// The OUTPUT contract of the benchmark kit: the exact shape of the `results.json` it writes. Anything
// that reads results (history, PR summary, history page, dashboards, a CTO's spreadsheet) can rely on
// this shape; `validateResults` checks a results object against it and returns every violation.
//
// results.json (schemaVersion 4)
// {
//   metadata: {
//     schemaVersion: 3,
//     package: { name, version?, bundleFiles? },
//     workload: { unit, description, typicalN },
//     tiers: number[],                        // the ladder this run measured
//     environment: { cpuModel, logicalCores, physicalCores, totalMemoryMb, platform, processArch, nodeVersion, runner, isCI },
//     git: { gitCommit, gitBranch, gitDirty },
//     bundleSizes: { [file]: { bytes, gzipBytes } },
//     costRates: { vCpuHourUsd, gbSecondUsd, minMemoryMb },
//     timing: { startedAtUtc, finishedAtUtc, totalSuiteDurationMs },
//     generatedBy, versions
//   },
//   results: {                                // one entry per measured group
//     "<group>": {                            // "end-to-end:baseline" | "end-to-end:with-package" | "end-to-end:overhead" | "fn:<id>" | "fn:<id>@<variant>"
//       area: "end-to-end" | "function", derived?: true,
//       tiers: { "n<size>": { id, status: "completed"|"failed", inputs: { <unit>: size },
//                              durationMs: { minMs, medianMs, p95Ms, maxMs, stdDevMs, iterations, warmupIterations },
//                              cpuMs: <same stats>, heapDeltaBytes, opsPerSecond, configuration }
//                         | { id, status: "failed", inputs, error: { name, message } } }
//     }
//   },
//   analysis: {
//     complexity: { "<group>": { class, exponent, rSquared, reason?, notation, points, expected?, expectedNotation?, agreement? } },
//     endToEnd:   [ { n, baselineMs, withPackageMs, overheadMs, overheadPercent, overheadCpuMs, overheadHeapBytes, cost } ],
//     contribution: [ { id, group, description, rows: [ { n, calls, estimatedMs, exclusiveMs, shareOfTotal } ] } ],
//     cost: { typicalN, typical, largest }
//   }
// }

import { RESULTS_SCHEMA_VERSION } from "./run.mjs"

/**
 * Reads `key` off `value`, tolerating a missing value -- a results file under validation may be
 * anything, and every departure from the contract must be reported, not crash the validator.
 * @param {any} value - what to read from.
 * @param {string} key - the property to read.
 * @returns {any} the property, or `undefined`.
 */
const get = (value, key) => value?.[key]

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
const STAT_KEYS = [
  "minMs",
  "medianMs",
  "p95Ms",
  "maxMs",
  "stdDevMs",
  "iterations",
  "warmupIterations",
]

function checkStats(stats, at, problems) {
  if (!isObject(stats)) {
    problems.push(`${at} must be a duration-statistics object.`)
    return
  }
  for (const key of STAT_KEYS) {
    // `Number.isFinite` is false for anything that is not a finite number, strings included.
    if (!Number.isFinite(stats[key])) {
      problems.push(`${at}.${key} must be a finite number.`)
    }
  }
}

/**
 * @param {unknown} results - a parsed results.json.
 * @returns {string[]} every way it departs from the documented shape; empty when valid.
 */
export function validateResults(results) {
  const problems = []
  if (!isObject(results)) return ["results must be an object."]

  const { metadata, results: groups, analysis } = results
  if (!isObject(metadata)) problems.push("metadata must be an object.")
  else {
    if (metadata["schemaVersion"] !== RESULTS_SCHEMA_VERSION) {
      problems.push(`metadata.schemaVersion must be ${String(RESULTS_SCHEMA_VERSION)}.`)
    }
    if (typeof get(metadata["package"], "name") !== "string")
      problems.push("metadata.package.name must be a string.")
    if (typeof get(metadata["workload"], "unit") !== "string")
      problems.push("metadata.workload.unit must be a string.")
    if (!Array.isArray(metadata["tiers"]) || metadata["tiers"].length === 0)
      problems.push("metadata.tiers must list the measured sizes.")
    for (const key of ["environment", "git", "bundleSizes", "costRates", "timing"]) {
      if (!isObject(metadata[key])) problems.push(`metadata.${key} must be an object.`)
    }
  }

  if (!isObject(groups)) problems.push("results must map each group to its tiers.")
  else {
    for (const [group, value] of Object.entries(groups)) {
      if (!["end-to-end", "function"].includes(get(value, "area")))
        problems.push(`results["${group}"].area must be "end-to-end" or "function".`)
      if (!isObject(get(value, "tiers"))) {
        problems.push(`results["${group}"].tiers must be an object.`)
        continue
      }
      for (const [tier, entry] of Object.entries(value.tiers)) {
        const at = `results["${group}"].tiers.${tier}`
        if (!/^n\d+$/.test(tier)) problems.push(`${at}: tier names look like "n640".`)
        if (typeof get(entry, "id") !== "string") problems.push(`${at}.id must be a string.`)
        if (!isObject(get(entry, "inputs"))) problems.push(`${at}.inputs must be an object.`)
        const status = get(entry, "status")
        if (status === "completed") {
          if (entry.derived) {
            // A derived entry (the overhead) carries only the figure computed from other groups.
            if (typeof get(entry.durationMs, "medianMs") !== "number") {
              problems.push(`${at}.durationMs.medianMs must be a number.`)
            }
          } else {
            checkStats(entry.durationMs, `${at}.durationMs`, problems)
            checkStats(entry.cpuMs, `${at}.cpuMs`, problems)
            if (typeof entry.heapDeltaBytes !== "number")
              problems.push(`${at}.heapDeltaBytes must be a number.`)
          }
        } else if (status === "failed") {
          if (typeof get(entry.error, "message") !== "string")
            problems.push(`${at}.error.message must be a string.`)
        } else {
          problems.push(`${at}.status must be "completed" or "failed".`)
        }
      }
    }
  }

  if (!isObject(analysis)) problems.push("analysis must be an object.")
  else {
    if (!isObject(analysis["complexity"])) problems.push("analysis.complexity must be an object.")
    if (!Array.isArray(analysis["endToEnd"])) problems.push("analysis.endToEnd must be an array.")
    if (!Array.isArray(analysis["contribution"]))
      problems.push("analysis.contribution must be an array.")
    if (!isObject(analysis["cost"])) problems.push("analysis.cost must be an object.")
  }
  return problems
}
