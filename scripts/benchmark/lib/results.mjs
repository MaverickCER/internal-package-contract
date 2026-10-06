// Shared helpers for reading a consumer's own `results.json` (the shape
// env-cap's and data-cap's `benchmark-fixtures/measure.mjs`-driven
// run-benchmark.mjs scripts already produce) and normalizing it into the
// same compact `{ [group]: { [tier]: { medianMs, inputs? } } }` shape used
// by a committed history entry's own `measurements` field -- so
// classify-complexity.mjs, append-history.mjs, render-summary.mjs, and
// render-page.mjs can all reason about "current run" and "history entry"
// data uniformly, through one function, instead of four slightly different
// re-implementations of "how do I find a benchmark's medianMs."
//
// Deliberately dependency-free (no consumer-repo assumptions beyond the
// `results.json`/history-entry shapes themselves) and framework-free (plain
// functions, no CLI of its own) -- imported by the scripts that do have a
// CLI.

import { readFileSync } from "node:fs"

/**
 * Finds the first `medianMs`-bearing field on a raw results.json tier entry.
 * Not every benchmark shape has one under the same key (`totalMs` vs a
 * generic `durationMs`) -- ported unchanged from env-cap's/data-cap's own
 * render-benchmark-summary.mjs, which both independently arrived at this
 * exact two-field fallback.
 */
export function primaryMedianMs(entry) {
  if (entry?.totalMs?.medianMs !== undefined) return entry.totalMs.medianMs
  return entry?.durationMs?.medianMs
}

/** Reads and JSON-parses a file, returning `null` on any read/parse failure (a missing "previous" results.json on a first-ever run, say) instead of throwing. */
export function tryReadJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath).toString())
  } catch {
    return null
  }
}

/** Reads and JSON-parses a file, throwing a clear error on failure -- for a path the caller has already decided is required (unlike `tryReadJson`'s "missing is fine"). */
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
 * Normalizes a raw results.json into the compact `{ group: { tier: {
 * medianMs, inputs? } } }` shape shared with a history entry's own
 * `measurements`. Only `status: "completed"` tiers with a resolvable
 * `medianMs` are included -- a failed/skipped tier contributes nothing to
 * either the timing chart or complexity classification, same as today's
 * append-benchmark-history.mjs behavior. `inputs` is carried through
 * verbatim (schema v2's whole point -- see append-history.mjs) when the raw
 * entry has one; omitted otherwise, so a caller can tell "no inputs
 * recorded" apart from "inputs was an empty object."
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
    }
  }
  return measurements
}

/** The most recent entry in a history file (`entries` is append-ordered), or `undefined` for an empty/missing history. */
export function latestHistoryEntry(history) {
  const entries = history?.entries
  return Array.isArray(entries) ? entries[entries.length - 1] : undefined
}
