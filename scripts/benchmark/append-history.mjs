#!/usr/bin/env node
// Extracts a compact entry from a fresh results.json and appends it to a
// consumer-owned history JSON file (env-cap's docs/benchmark-history/<name>.json,
// data-cap's benchmarks/history/<name>.json, or wherever a future consumer
// points it -- this script takes both paths as arguments and makes no
// assumption about either one's location or naming). Generalizes env-cap's
// and data-cap's own (near-identical) scripts/append-benchmark-history.mjs /
// benchmarks/append-benchmark-history.mjs: same "called only by the
// benchmark-pr job, only when the PR's diff touches benchmarked code, never
// by a local run" contract, same compact-entry intent, but now carries each
// tier's full `inputs` object through (schema v2 -- see below) instead of
// deriving one hardcoded throughput figure (env-cap's `variablesPerSecond`)
// and discarding the rest.
//
// Usage: node append-history.mjs <results.json> <history.json>

import fs from "node:fs/promises"
import path from "node:path"
import { inputTotal } from "./classify-complexity.mjs"
import { readJson, resultsToMeasurements } from "./lib/results.mjs"

/**
 * History schema v2: each tier measurement in `entries[].measurements.<group>.<tier>`
 * gains an `inputs: Record<string, number>` alongside `medianMs` (schema v1
 * had only `medianMs`, or env-cap's `medianMs` + a hardcoded
 * `variablesPerSecond`). Old v1 entries remain valid as-is -- nothing here
 * back-fills or migrates them; they simply lack `inputs` and are excluded
 * from complexity classification by classify-complexity.mjs's own filtering
 * (never from the timing chart, which only ever needed `medianMs`).
 *
 * `unitsPerSecond` is a schema-v2 generalization of env-cap's own
 * `variablesPerSecond`: instead of a hardcoded "divide `inputs.variables` by
 * time" (meaningless for a group whose `inputs` has no `variables` key --
 * e.g. every one of data-cap's own groups), it divides the SAME generic
 * `inputTotal` this file's own complexity classifier uses by elapsed
 * seconds. One consistent "how much size, how fast" figure per tier,
 * computed the same way regardless of what a consumer's `inputs` object
 * happens to contain.
 */
const HISTORY_SCHEMA_VERSION = 2

async function main() {
  const [, , resultsPath, historyPath] = process.argv
  if (!resultsPath || !historyPath) {
    console.error("Usage: node append-history.mjs <results.json> <history.json>")
    process.exitCode = 1
    return
  }

  const results = readJson(resultsPath)

  let history
  try {
    history = JSON.parse(await fs.readFile(historyPath, "utf8"))
  } catch {
    history = { historySchemaVersion: HISTORY_SCHEMA_VERSION, entries: [] }
  }
  // A file that already exists (schema v1, or a v2 file from an earlier
  // append) keeps its own `entries`; only the version marker is bumped to
  // reflect what THIS (newest) entry's shape actually is -- a reader already
  // has to tolerate older entries lacking `inputs` (see above), so the
  // top-level marker tracking "the newest writer's schema" rather than "the
  // oldest entry's schema" is the more useful signal.
  history.historySchemaVersion = HISTORY_SCHEMA_VERSION
  history.entries = Array.isArray(history.entries) ? history.entries : []

  const rawMeasurements = resultsToMeasurements(results)

  // Intentionally compact: medianMs + inputs + a generic derived throughput
  // figure per completed (group, tier), not the full per-run detail (min/
  // max/stdDev/memory) already reachable via `gitCommit` in that commit's
  // own results.json. Duplicating all of that here would make this file
  // grow unboundedly for no benefit.
  const measurements = {}
  for (const [group, tiers] of Object.entries(rawMeasurements)) {
    measurements[group] = {}
    for (const [tier, measurement] of Object.entries(tiers)) {
      const size = inputTotal(measurement.inputs)
      measurements[group][tier] = {
        medianMs: measurement.medianMs,
        ...(measurement.inputs ? { inputs: measurement.inputs } : {}),
        ...(size !== undefined && measurement.medianMs > 0
          ? { unitsPerSecond: Math.round((size / (measurement.medianMs / 1000)) * 100) / 100 }
          : {}),
      }
    }
  }

  // `versions` is copied verbatim from results.metadata.versions rather than
  // singling out one "the package's own version" field by a hardcoded key
  // (env-cap's `envCapVersion`, data-cap's `dataCapVersion`, and any future
  // consumer's own naming would each need a special case otherwise) -- see
  // this repo's PR description for the full reasoning. A reader wanting "the
  // package version at this point in history" reads whichever key its own
  // results.json happens to report, e.g. `entry.versions.dataCapVersion`.
  history.entries.push({
    timestamp: results.metadata?.timing?.finishedAtUtc,
    gitCommit: results.metadata?.git?.gitCommit,
    runner: results.metadata?.environment?.runner,
    versions: { ...results.metadata?.versions },
    measurements,
  })

  await fs.mkdir(path.dirname(historyPath), { recursive: true })
  await fs.writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`, "utf8")
  console.log(
    `[append-history] appended entry to ${historyPath} (${String(history.entries.length)} total, schema v${String(HISTORY_SCHEMA_VERSION)})`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
