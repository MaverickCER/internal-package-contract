// One way to read a results.json, shared by every script that judges or renders one.
//
// `resultsToMeasurements` turns a results.json into `{ [group]: { [tier]: { medianMs, inputs?, ... } } }`.
// That is the shape a history entry's `measurements` already has, so a run and an entry compare the same way.
// Only `status: "completed"` tiers with a median are kept; a failed tier contributes nothing. The median is
// read from `totalMs` first, then `durationMs`. `inputs` is carried through only when the entry has one, so
// "none recorded" stays distinct from an empty object. The spread figures (`stdDevMs`, `p95Ms`, `iterations`)
// come along when finite, so a reader can tell a change from the run's own noise.
//
// Plain functions, no CLI, and no assumption about the package beyond the file shapes.

import { readFileSync } from "node:fs"

/**
 * Finds the first `medianMs`-bearing field on a raw results.json tier entry.
 * Benchmark shapes keep it under different keys (`totalMs` or a generic `durationMs`). This
 * two-field fallback is ported unchanged from the render-benchmark-summary.mjs of env-cap and
 * data-cap, which each reached it on their own.
 */
export function primaryMedianMs(entry) {
  if (entry?.totalMs?.medianMs !== undefined) return entry.totalMs.medianMs
  return entry?.durationMs?.medianMs
}

/**
 * The spread of the same measurement `primaryMedianMs` summarizes: standard deviation, 95th
 * percentile and iteration count, each only when it is a finite number. A median alone hides how
 * noisy a run was. With these, a reader can later judge whether a change is larger than the run's
 * noise. A derived entry (the overhead) has none and yields `{}`.
 * @param {any} entry - one tier of a raw results.json.
 * @returns {{ stdDevMs?: number, p95Ms?: number, iterations?: number }}
 */
export function dispersionOf(entry) {
  const source = entry?.totalMs?.medianMs !== undefined ? entry.totalMs : entry?.durationMs
  const kept = {}
  for (const key of ["stdDevMs", "p95Ms", "iterations"]) {
    if (Number.isFinite(source?.[key])) kept[key] = source[key]
  }
  return kept
}

/** Reads and JSON-parses a file, returning `null` on any read/parse failure (a missing "previous" results.json on a first-ever run, say) instead of throwing. */
export function tryReadJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath).toString())
  } catch {
    return null
  }
}

/**
 * Reads and JSON-parses a file, throwing a clear error on failure. It is for a path the caller has
 * already decided is required; `tryReadJson` is the one where missing is fine.
 */
export function readJson(filePath) {
  return JSON.parse(readFileSync(filePath).toString())
}

/** Flattens a raw results.json's `results` map into a flat `{ name, tier, entry }` list, regardless of how many named benchmarks or tiers it declares. */
export function collectEntries(results) {
  const entries = []
  if (!results?.results) return entries
  for (const [name, benchmark] of Object.entries(results.results)) {
    for (const [tier, entry] of Object.entries(benchmark.tiers ?? {})) {
      entries.push({ name, tier, entry })
    }
  }
  return entries
}

/**
 * Normalizes a raw results.json into the compact `{ group: { tier: { medianMs, inputs? } } }` shape
 * shared with a history entry's own `measurements`. Only `status: "completed"` tiers with a
 * resolvable `medianMs` are included. A failed or skipped tier adds nothing to the timing chart or
 * the complexity classification, as in append-benchmark-history.mjs. `inputs` is copied verbatim
 * when the raw entry has one; schema v2 exists for it (see append-history.mjs). It is omitted
 * otherwise. A caller can then tell "no inputs recorded" apart from "inputs was an empty object."
 */
export function resultsToMeasurements(results) {
  const measurements = {}
  for (const { name, tier, entry } of collectEntries(results)) {
    if (entry.status !== "completed") continue
    const medianMs = primaryMedianMs(entry)
    if (medianMs === undefined) continue
    measurements[name] = measurements[name] ?? {}
    measurements[name][tier] = {
      medianMs,
      ...(entry.inputs && typeof entry.inputs === "object" ? { inputs: entry.inputs } : {}),
      ...dispersionOf(entry),
    }
  }
  return measurements
}

/** The most recent entry in a history file (`entries` is append-ordered), or `undefined` for an empty/missing history. */
export function latestHistoryEntry(history) {
  const entries = history?.entries
  return Array.isArray(entries) ? entries[entries.length - 1] : undefined
}
